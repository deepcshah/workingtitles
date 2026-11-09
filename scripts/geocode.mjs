#!/usr/bin/env node
/**
 * Place pins for notices that have no GPS.
 *
 * Most photos are screenshots of Instagram stories: no EXIF location, but the
 * cross-street is usually written on the sign or burned into the caption, so it
 * lands in `place` / `sign.location`. The ingest script parks those at City Hall
 * (the default lat/lng). This script asks Claude to turn that text into a
 * block-level lat/lng for the specific NYC corner.
 *
 *   npm run geocode           place every un-pinned entry
 *   npm run geocode -- --redo  re-place entries already geocoded here
 *
 * Coordinates are estimates (source "claude"), not survey GPS. Anything Claude
 * can't place, or that lands outside NYC, is left at City Hall for a hand fix.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.WT_MODEL ?? "claude-sonnet-5-5";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA = path.join(ROOT, "data/notices.json");

// City Hall default that ingest uses when a photo has no GPS.
const DEFAULT_LAT = 40.7128;
const DEFAULT_LNG = -74.006;
// Rough NYC bounding box, to reject anything Claude places elsewhere.
const NYC = { minLat: 40.48, maxLat: 40.93, minLng: -74.27, maxLng: -73.68 };

const atDefault = (n) => n.lat === DEFAULT_LAT && n.lng === DEFAULT_LNG;
const inNYC = (lat, lng) =>
  lat >= NYC.minLat && lat <= NYC.maxLat && lng >= NYC.minLng && lng <= NYC.maxLng;

/** The best short location string we have for an entry. */
function locationText(n) {
  return [n.place, n.sign?.location].filter(Boolean).join(" | ") || "";
}

const LOCATE_TOOL = {
  name: "record_locations",
  description: "Record block-level coordinates for each NYC film-shoot notice.",
  input_schema: {
    type: "object",
    properties: {
      locations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            found: { type: "boolean", description: "true if you can place this corner in NYC." },
            lat: { type: "number" },
            lng: { type: "number" },
            neighborhood: { type: "string", description: "e.g. SoHo, Hell's Kitchen, Fort Greene." },
            borough: { type: "string", enum: ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"] },
            confidence: { type: "number", description: "0–1 that this is the right corner." },
          },
          required: ["id", "found"],
        },
      },
    },
    required: ["locations"],
  },
};

async function geocode(client, targets) {
  const list = targets
    .map((n) => `- id: ${n.id}\n  title: ${n.realTitle || n.codename || "?"}\n  location text: ${locationText(n)}`)
    .join("\n");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [LOCATE_TOOL],
    tool_choice: { type: "auto" }, // claude-sonnet-5-5 rejects forced tool choice
    messages: [
      {
        role: "user",
        content:
          "Each item below is a New York City film-shoot notice. The location text is usually a street " +
          "intersection (sometimes with the neighborhood), e.g. \"Spring & Greene\" or \"50th & 8th Ave\". " +
          "For each id, give the latitude and longitude of that specific NYC street corner, to block-level " +
          "accuracy. Pick the correct borough from context. If the text names several blocks, use the first " +
          "or most specific one. If you cannot confidently place it in NYC, set found=false. " +
          "Then call record_locations once with every id.\n\n" +
          list,
      },
    ],
  });

  const call = res.content.find((b) => b.type === "tool_use" && b.name === "record_locations");
  return call?.input?.locations ?? [];
}

// ---- run ----
const redo = process.argv.includes("--redo");
const notices = JSON.parse(await readFile(DATA, "utf8"));

const targets = notices.filter(
  (n) => !n.example && locationText(n) && atDefault(n) && (redo || !n.geo)
);

if (!targets.length) {
  console.log("Nothing to place. (All entries are pinned, have no location text, or are already geocoded.)");
  process.exit(0);
}
console.log(`Placing ${targets.length} notice(s)…\n`);

const client = new Anthropic();
const byId = new Map(notices.map((n) => [n.id, n]));
const save = () => writeFile(DATA, JSON.stringify(notices, null, 2) + "\n");
let placed = 0;

// Chunk so the tool output stays within max_tokens, and save after each chunk.
const CHUNK = 25;
for (let i = 0; i < targets.length; i += CHUNK) {
  const batch = targets.slice(i, i + CHUNK);
  const results = await geocode(client, batch);
  const returned = new Set(results.map((r) => r.id));

  for (const r of results) {
    const n = byId.get(r.id);
    if (!n) continue;
    if (!r.found || typeof r.lat !== "number" || typeof r.lng !== "number") {
      console.log(`  · ${n.id}  — not placed (left at City Hall)`);
      continue;
    }
    if (!inNYC(r.lat, r.lng)) {
      console.log(`  · ${n.id}  — ${r.lat},${r.lng} is outside NYC, skipped`);
      continue;
    }
    n.lat = Number(r.lat.toFixed(5));
    n.lng = Number(r.lng.toFixed(5));
    n.geo = {
      source: "claude",
      query: locationText(n),
      neighborhood: r.neighborhood || undefined,
      borough: r.borough || undefined,
      confidence: r.confidence,
    };
    if (!n.borough && r.borough) n.borough = r.borough;
    placed++;
    console.log(`  ✓ ${n.id}  → ${n.lat}, ${n.lng}  (${r.neighborhood || r.borough || "NYC"}, ${Math.round((r.confidence ?? 0) * 100)}%)`);
  }
  for (const n of batch) if (!returned.has(n.id)) console.log(`  · ${n.id}  — no answer (left at City Hall)`);
  await save();
}

console.log(`\nPlaced ${placed} of ${targets.length}. The rest stay at City Hall — fix lat/lng by hand.`);
