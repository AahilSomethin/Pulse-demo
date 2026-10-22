// MapLibre GL v6 locates its web worker relative to its own module URL. Bundlers
// move that module, so the worker cannot be found. These copies are served from
// /vendor/maplibre and selected with setWorkerUrl().
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "maplibre-gl", "dist");
const target = join(root, "public", "vendor", "maplibre");
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

if (!existsSync(source)) {
  console.warn("maplibre-gl is not installed yet; skipping worker copy.");
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(join(source, file), join(target, file));
console.log(`Copied MapLibre worker files to ${target}`);
