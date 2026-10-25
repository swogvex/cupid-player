// Writes icon-lyrics.txt (normal) and icon-lyrics-on.txt (white, for the pressed button)
// into every theme. Run from the project root:  node art/tools/lyrics-icon.mjs
// then: pnpm assets:build
// NOTE: a theme generator (pink.mjs, ...) may delete the .txt files of its theme;
// if you re-run one, run this script again afterwards.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const themes = join(dirname(fileURLToPath(import.meta.url)), "..", "themes");

// L = staff lines, S = stem, F = flag, H = note head, K = head highlight (letters of each theme.json)
const COLORS = {
  pink: { L: "i", S: "i", F: "h", H: "a", K: "h" },
  midnight: { L: "i", S: "i", F: "y", H: "y", K: "N" },
  lavender: { L: "i", S: "i", F: "r", H: "a", K: "h" },
  mint: { L: "i", S: "i", F: "g", H: "a", K: "h" },
  classic: { L: "i", S: "i", F: "Y", H: "E", K: "g" },
};

const ROWS = ["LLL.SFF", "....S.F", "LLL.S..", "....S..", "LLL.S..", ".KHHS..", ".HHH..."];

const paint = (map) =>
  ROWS.map((r) => [...r].map((ch) => (ch === "." ? "." : map[ch])).join("")).join("\n") + "\n";

for (const [id, map] of Object.entries(COLORS)) {
  const dir = join(themes, id, "sprites");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "icon-lyrics.txt"), paint(map));
  writeFileSync(join(dir, "icon-lyrics-on.txt"), paint({ L: "w", S: "w", F: "w", H: "w", K: "w" }));
}
console.log("icon-lyrics written for", Object.keys(COLORS).join(", "));