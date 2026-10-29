#!/usr/bin/env node
/**
 * Ingest raw shoot-notice photos.
 *
 *   1. Drop photos into photos/inbox/  (JPEG/PNG/WebP; export HEIC as JPEG first)
 *   2. npm run ingest
 *
 * For each photo it reads GPS + capture date from EXIF, writes a web-sized,
 * metadata-stripped copy to public/photos/<id>.webp, and appends a stub row
 * to data/notices.json (status "unknown") for you to fill in.
 * Photos already in notices.json are skipped, so it's safe to re-run.
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

const slug = (s) =>
  s.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

await mkdir(OUT, { recursive: true });
const notices = JSON.parse(await readFile(DATA, "utf8"));
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
    await sharp(src).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(OUT, `${id}.webp`));
  } catch (err) {
    console.warn(`! could not convert ${file}: ${err.message}`);
    continue;
  }

  notices.push({
    id,
    codename: "TBD",
    status: "unknown",
    photo: `/photos/${id}.webp`,
    ...(when && { spottedAt: new Date(when).toISOString().slice(0, 10) }),
    lat: lat ?? 40.7128,
    lng: lng ?? -74.006,
    ...((lat == null || lng == null) && { notes: "No GPS in photo — fix lat/lng." }),
  });
  known.add(id);
  added++;
  console.log(`+ ${id}${lat != null ? ` @ ${lat.toFixed(4)}, ${lng.toFixed(4)}` : " (no GPS)"}`);
}

await writeFile(DATA, JSON.stringify(notices, null, 2) + "\n");
console.log(`\nAdded ${added} notice(s). ${files.length - added} skipped or already in.`);
if (noGps.length) console.log(`No GPS (placed at City Hall, fix by hand): ${noGps.join(", ")}`);
