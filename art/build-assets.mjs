// Reads art/sprites/*.txt (one char = one palette letter, "." = transparent)
// and writes public/assets/sprites/*.png
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";

const { PNG } = pngjs;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "art", "sprites");
const outDir = join(root, "public", "assets", "sprites");

// Strip BOM (Windows PowerShell 5.1 adds one with -Encoding utf8)
const readText = (p) => readFileSync(p, "utf8").replace(/^\uFEFF/, "");

const palette = {};
const rawPalette = JSON.parse(readText(join(root, "art", "palette.json")));
for (const [key, hex] of Object.entries(rawPalette)) {
  if (key.length !== 1 || key === ".") throw new Error(`palette.json: invalid key "${key}"`);
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`palette.json: invalid color for "${key}": ${hex}`);
  const n = parseInt(m[1], 16);
  palette[key] = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

mkdirSync(outDir, { recursive: true });
const errors = [];

const files = readdirSync(srcDir)
  .filter((f) => f.endsWith(".txt"))
  .sort();

for (const file of files) {
  const name = basename(file, ".txt");
  const rows = readText(join(srcDir, file))
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l !== "" && !l.startsWith("#"));

  if (rows.length === 0) {
    errors.push(`${file}: empty sprite`);
    continue;
  }

  const width = rows[0].length;
  const before = errors.length;
  rows.forEach((row, y) => {
    if (row.length !== width) {
      errors.push(`${file}: row ${y + 1} has ${row.length} chars, expected ${width}`);
      return;
    }
    for (const ch of row) {
      if (ch !== "." && !palette[ch]) {
        errors.push(`${file}: row ${y + 1} uses unknown letter "${ch}"`);
        break;
      }
    }
  });
  if (errors.length > before) continue;

  const png = new PNG({ width, height: rows.length });
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = ch === "." ? [0, 0, 0, 0] : palette[ch];
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    });
  });
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(png));
  console.log(`ok  ${name}  ${width}x${rows.length}`);
}

if (errors.length > 0) {
  console.error("\nSprite errors:\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exitCode = 1;
}