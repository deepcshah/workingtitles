#!/usr/bin/env node
/**
 * Copy MapLibre's web worker into public/ so it can be served as a static file.
 *
 * Next 16 bundles with Turbopack, which doesn't resolve MapLibre's default
 * worker URL — the request 404s to the HTML page and the map fails with
 * "Worker failed to load". We serve the worker ourselves and point MapLibre at
 * it with maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs") (see Explorer.tsx).
 *
 * Runs from predev/prebuild so the copy tracks the installed maplibre-gl
 * version. The copy is also committed, so production works even if the host
 * runs `next build` directly without the npm lifecycle hook.
 */
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const DEST = path.join(ROOT, "public/maplibre-gl-worker.mjs");

try {
  await mkdir(path.dirname(DEST), { recursive: true });
  await copyFile(SRC, DEST);
  console.log("copied maplibre worker -> public/maplibre-gl-worker.mjs");
} catch (e) {
  console.warn(`! could not copy maplibre worker: ${e.message}`);
  process.exitCode = 0; // don't fail the build; the committed copy may still be present
}
