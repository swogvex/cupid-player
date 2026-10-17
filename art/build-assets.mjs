// Builds every theme from text sprites.
//
//   art/themes/<id>/theme.json         palette (sprite letters) + CSS tokens of the theme
//   art/sprites/*.txt                  sprites shared by ALL themes (recoloured per theme)
//   art/themes/<id>/sprites/*.txt      sprites of ONE theme (replace a shared sprite of the same name)
//
// Output:
//   public/assets/sprites/<id>/<name>.png   one PNG per sprite and theme
//   src/styles/themes.css                   colour tokens + --spr-<name> url() variables per theme
//   src/lib/themes.generated.ts             theme list for the picker
//
// Sprite format: one char = one palette letter, "." = transparent.
// Animated sprites: several frames in ONE file separated by a line with ---, plus an
// optional "# order: 0 1 2 1" line (playback order, frames may repeat). The PNG is a
// horizontal strip with one cell per entry of the order.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";

const { PNG } = pngjs;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharedDir = join(root, "art", "sprites");
const themesDir = join(root, "art", "themes");
const outRoot = join(root, "public", "assets", "sprites");

const DEFAULT_THEME = "pink";
const LETTERS = ["a", "h", "d", "s", "l", "p", "q", "b", "y", "w", "t", "i"];

// Strip BOM (Windows PowerShell 5.1 adds one with -Encoding utf8)
const readText = (p) => readFileSync(p, "utf8").replace(/^\uFEFF/, "");
const errors = [];

function parseHex(where, key, hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) {
    errors.push(`${where}: invalid color for "${key}": ${hex}`);
    return [0, 0, 0, 255];
  }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function loadThemes() {
  const list = [];
  for (const entry of readdirSync(themesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(themesDir, entry.name, "theme.json");
    if (!existsSync(file)) {
      errors.push(`art/themes/${entry.name}: theme.json is missing`);
      continue;
    }
    const cfg = JSON.parse(readText(file));
    const where = `art/themes/${entry.name}/theme.json`;
    const palette = {};
    for (const letter of LETTERS) {
      if (!(letter in (cfg.sprites ?? {}))) errors.push(`${where}: sprites."${letter}" is missing`);
      else palette[letter] = parseHex(where, letter, cfg.sprites[letter]);
    }
    list.push({
      id: entry.name,
      name: cfg.name ?? entry.name,
      order: cfg.order ?? 99,
      tokens: cfg.tokens ?? {},
      palette,
    });
  }
  return list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Splits a sprite file into frames and an optional playback order. */
function parseSprite(text) {
  const frames = [[]];
  let order = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const m = /^#\s*order:\s*([\d\s]+)$/i.exec(line);
    if (m) {
      order = m[1].trim().split(/\s+/).map(Number);
      continue;
    }
    if (line === "---") {
      frames.push([]);
      continue;
    }
    if (line === "" || line.startsWith("#")) continue;
    frames[frames.length - 1].push(line);
  }
  return { frames, order };
}

/** name -> file path. Shared sprites first, then the theme's own (they win). */
function spriteFiles(themeId) {
  const map = new Map();
  const add = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) if (f.endsWith(".txt")) map.set(basename(f, ".txt"), join(dir, f));
  };
  add(sharedDir);
  add(join(themesDir, themeId, "sprites"));
  return map;
}

function renderSprite(theme, name, path) {
  const where = path.replace(root, "").replace(/^[\\/]/, "");
  const { frames, order: rawOrder } = parseSprite(readText(path));
  const before = errors.length;

  if (frames.some((f) => f.length === 0)) {
    errors.push(`${where}: empty sprite or empty frame`);
    return;
  }
  const width = frames[0][0].length;
  const height = frames[0].length;
  frames.forEach((rows, i) => {
    if (rows.length !== height) {
      errors.push(`${where}: frame ${i} has ${rows.length} rows, expected ${height}`);
      return;
    }
    rows.forEach((row, y) => {
      if (row.length !== width) {
        errors.push(`${where}: frame ${i} row ${y + 1} has ${row.length} chars, expected ${width}`);
        return;
      }
      for (const ch of row) {
        if (ch !== "." && !theme.palette[ch]) {
          errors.push(`${where}: frame ${i} row ${y + 1} uses unknown letter "${ch}"`);
          break;
        }
      }
    });
  });
  const order = rawOrder ?? frames.map((_, i) => i);
  if (order.some((i) => !Number.isInteger(i) || i < 0 || i >= frames.length)) {
    errors.push(`${where}: "# order:" refers to a frame that does not exist`);
  }
  if (errors.length > before) return;

  const png = new PNG({ width: width * order.length, height });
  order.forEach((frameIndex, k) => {
    frames[frameIndex].forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const i = (y * png.width + k * width + x) * 4;
        const [r, g, b, a] = ch === "." ? [0, 0, 0, 0] : theme.palette[ch];
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = a;
      });
    });
  });
  writeFileSync(join(outRoot, theme.id, `${name}.png`), PNG.sync.write(png));
}

const themes = loadThemes();
const generated = []; // { theme, names }

for (const theme of themes) {
  mkdirSync(join(outRoot, theme.id), { recursive: true });
  const files = spriteFiles(theme.id);
  for (const [name, path] of [...files].sort(([a], [b]) => a.localeCompare(b))) renderSprite(theme, name, path);
  generated.push({ theme, names: [...files.keys()].sort() });
  console.log(`ok  ${theme.id}  ${files.size} sprites`);
}

if (errors.length > 0) {
  console.error("\nErrors:\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exitCode = 1;
} else {
  // ---- themes.css ----
  let css = "/* GENERATED by art/build-assets.mjs - do not edit. */\n\n";
  for (const { theme, names } of generated) {
    css += theme.id === DEFAULT_THEME ? `:root,\n:root[data-theme="${theme.id}"] {\n` : `:root[data-theme="${theme.id}"] {\n`;
    for (const [k, v] of Object.entries(theme.tokens)) css += `  --${k}: ${v};\n`;
    for (const name of names) css += `  --spr-${name}: url("/assets/sprites/${theme.id}/${name}.png");\n`;
    css += "}\n\n";
  }
  writeFileSync(join(root, "src", "styles", "themes.css"), css);

  // ---- themes.generated.ts ----
  const list = themes.map((t) => ({
    id: t.id,
    name: t.name,
    swatches: [t.tokens.bg, t.tokens.accent, t.tokens.ink],
  }));
  const ts =
    "// GENERATED by art/build-assets.mjs - do not edit.\n" +
    `export const THEMES = ${JSON.stringify(list, null, 2)} as const;\n\n` +
    'export type ThemeId = (typeof THEMES)[number]["id"];\n';
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  writeFileSync(join(root, "src", "lib", "themes.generated.ts"), ts);
}