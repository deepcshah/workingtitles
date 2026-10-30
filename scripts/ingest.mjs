#!/usr/bin/env node
/**
 * Ingest raw shoot-notice photos.
 *
 *   1. Drop photos into photos/inbox/  (JPEG/PNG/WebP; export HEIC as JPEG first)
 *   2. npm run ingest
 *
 * For each new photo:
 *   - reads GPS + capture date from EXIF
 *   - writes a web-sized, metadata-stripped copy to public/photos/<id>.webp
 *   - if ANTHROPIC_API_KEY is set: Claude reads the sign, then searches the web
 *     to decode the title (stored once; never re-run unless you ask)
 *   - appends the entry to data/notices.json
 *
 * Flags:
 *   --redecode <id>   re-run the Claude steps for one existing entry
 *   --decode-missing  run the Claude steps for entries that have a photo but no decode yet
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INBOX = path.join(ROOT, "photos/inbox");
const OUT = path.join(ROOT, "public/photos");
const DATA = path.join(ROOT, "data/notices.json");
const EXT = /\.(jpe?g|png|webp|tiff?)$/i;
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

const slug = (s) =>
  s.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const decoder = HAS_KEY ? await import("./decode.mjs") : null;
if (!HAS_KEY) console.log("(no ANTHROPIC_API_KEY — photos will be added without reading the sign)\n");

await mkdir(OUT, { recursive: true });
const notices = JSON.parse(await readFile(DATA, "utf8"));
const save = () => writeFile(DATA, JSON.stringify(notices, null, 2) + "\n");

/** Run both Claude steps on one entry, mutating it in place. */
async function decodeEntry(n) {
  const buf = await readFile(path.join(ROOT, "public", n.photo));
  process.stdout.write(`  reading sign… `);
  const sign = await decoder.readSign(buf);
  if (!sign) return console.log("no result");
  if (!sign.is_shoot_notice) console.log("(doesn't look like a shoot notice) ");
  console.log(`"${sign.sign_title || "?"}"${sign.production_company ? ` / ${sign.production_company}` : ""}`);

  n.codename = sign.sign_title || n.codename;
  n.sign = {
    company: sign.production_company || undefined,
    dates: sign.shoot_dates || undefined,
    location: sign.location_text || undefined,
    contact: sign.contact || undefined,
    other: sign.other_text || undefined,
    legibility: sign.legibility,
  };
  if (!n.place && sign.location_text) n.place = sign.location_text;
  if (!sign.sign_title && !sign.production_company) return;

  process.stdout.write(`  searching… `);
  const m = await decoder.matchTitle(sign, n);
  if (!m) return console.log("no conclusion");
  Object.assign(n, {
    realTitle: m.realTitle,
    kind: m.kind,
    year: m.year,
    imdb: m.imdb,
    letterboxd: m.letterboxd,
    status: decoder.statusFor(m),
    match: {
      isCodename: m.isCodename,
      confidence: m.confidence,
      reasoning: m.reasoning,
      sources: m.sources,
      decodedAt: new Date().toISOString(),
    },
  });
  console.log(
    `${m.isCodename ? "codename →" : "real title:"} ${m.realTitle ?? "?"} (${Math.round(m.confidence * 100)}%, ${m.sources.length} source${m.sources.length === 1 ? "" : "s"})`
  );
}

// ---- re-decode modes ----
const args = process.argv.slice(2);
if (args[0] === "--redecode" || args[0] === "--decode-missing") {
  if (!HAS_KEY) throw new Error("ANTHROPIC_API_KEY is required for decoding");
  const targets =
    args[0] === "--redecode"
      ? notices.filter((n) => n.id === args[1])
      : notices.filter((n) => n.photo && !n.match && !n.example);
  if (!targets.length) console.log("Nothing to decode.");
  for (const n of targets) {
    console.log(`~ ${n.id}`);
    try {
      await decodeEntry(n);
    } catch (e) {
      console.warn(`  ! ${e.message}`);
    }
    await save();
  }
  process.exit(0);
}

// ---- normal ingest ----
const known = new Set(notices.map((n) => n.id));
const files = (await readdir(INBOX)).filter((f) => EXT.test(f)).sort();
let added = 0;
const noGps = [];

for (const file of files) {
  const id = slug(file);
  if (known.has(id)) continue;
  const src = path.join(INBOX, file);

  let meta = {};
  try {
    meta = (await exifr.parse(src, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"] })) ?? {};
  } catch {}

  const when = meta.DateTimeOriginal ?? meta.CreateDate;
  const lat = meta.latitude;
  const lng = meta.longitude;
  if (lat == null || lng == null) noGps.push(file);

  try {
    await sharp(src)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(path.join(OUT, `${id}.webp`));
  } catch (err) {
    console.warn(`! could not convert ${file}: ${err.message}`);
    continue;
  }

  const n = {
    id,
    codename: "TBD",
    status: "unknown",
    photo: `/photos/${id}.webp`,
    ...(when && { spottedAt: new Date(when).toISOString().slice(0, 10) }),
    lat: lat ?? 40.7128,
    lng: lng ?? -74.006,
    ...((lat == null || lng == null) && { notes: "No GPS in photo — fix lat/lng." }),
  };
  console.log(`+ ${id}${lat != null ? ` @ ${lat.toFixed(4)}, ${lng.toFixed(4)}` : " (no GPS)"}`);

  if (decoder) {
    try {
      await decodeEntry(n);
    } catch (e) {
      console.warn(`  ! decode failed: ${e.message} (retry later with --decode-missing)`);
    }
  }

  notices.push(n);
  known.add(id);
  added++;
  await save(); // save after each photo so a crash mid-batch loses nothing
}

await save();
console.log(`\nAdded ${added} notice(s). ${files.length - added} skipped or already in.`);
if (noGps.length) console.log(`No GPS (placed at City Hall, fix by hand): ${noGps.join(", ")}`);
