// Generates ALL sprites of Cupid Pink v3 into art/themes/pink/sprites/.
// Run from the project root:  node art/tools/pink.mjs   (then: pnpm assets:build)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canvas, dome, inEllipse, puffs, set, shape, smallHeart, sparkle, stamp, text } from "./px.mjs";
import { LAYOUTS, bedBack, bedFront, catBody, ears, floatingHearts, sparkles, tail } from "./mascot.mjs";
import { titleClouds, titleHeart, titleHeartSmall } from "./title.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "themes", "pink", "sprites");
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith(".txt")) rmSync(join(outDir, f)); // no stale sprites

function save(name, frames, order) {
  const w = frames[0][0].length, h = frames[0].length;
  frames.forEach((f, i) => {
    if (f.length !== h || f.some((r) => r.length !== w)) throw new Error(`${name}: frame ${i} has a wrong size`);
  });
  let body = frames.map((f) => f.join("\n")).join("\n---\n");
  if (order) body = `# order: ${order.join(" ")}\n` + body;
  if (order || frames.length > 1) body = `# fps: 12\n` + body;
  writeFileSync(join(outDir, `${name}.txt`), body + "\n");
}
const one = (name, c) => save(name, [text(c)]);

// ---------- small hearts, corners ----------
one("heart-8", smallHeart(8, 8, 7));
one("deco-heart", smallHeart(9, 9, 8));
{
  // simple corner: a 3x3 heart and two sparkles, all inside the 3 px padding of the panel
  const c = canvas(7, 7);
  stamp(c, ["a.a", "aaa", ".a."], 0, 0);
  set(c, 0, 0, "h");
  set(c, 4, 1, "y"); set(c, 1, 4, "y");
  one("corner-7", c);
}
{ const c = canvas(5, 5); stamp(c, [".a.a.", "ahaaa", "aaaaa", ".aaa.", "..a.."], 0, 0); one("nav-heart", c); }
{ const c = canvas(5, 5); stamp(c, [".w.w.", "wwwww", "wwwww", ".www.", "..w.."], 0, 0); one("nav-heart-on", c); }

// ---------- 9-slice frames: panel, buttons, round buttons ----------
function roundRect(W, H, r, { outline, fill, hi, lo }) {
  const c = canvas(W, H);
  const ins = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const dx = Math.max(r - 0.5 - x, 0, x - (W - 1 - r + 0.5)), dy = Math.max(r - 0.5 - y, 0, y - (H - 1 - r + 0.5));
    return dx * dx + dy * dy <= r * r;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!ins(x, y)) continue;
    const rim = !ins(x - 1, y) || !ins(x + 1, y) || !ins(x, y - 1) || !ins(x, y + 1);
    if (rim) { c[y][x] = outline; continue; }
    let ch = fill;
    if (y === 1 || (!ins(x, y - 2) && y <= 2)) ch = hi;
    else if (y === H - 2 || (!ins(x, y + 2) && y >= H - 3)) ch = lo;
    c[y][x] = ch;
  }
  return c;
}
const BTN = {
  normal: { outline: "s", fill: "q", hi: "w", lo: "u" },
  hover: { outline: "s", fill: "p", hi: "w", lo: "e" },
  pressed: { outline: "s", fill: "a", hi: "h", lo: "r" },
  disabled: { outline: "l", fill: "p", hi: "q", lo: "p" },
};
for (const [k, o] of Object.entries(BTN)) {
  one(`button-${k}`, roundRect(8, 8, 3, o));
  one(`ctl-${k}`, roundRect(12, 12, 5, o));
}
{
  // Panel frame (9-slice, 12x12, corner 4). The strips that get STRETCHED (rows/cols 4..7) must be
  // uniform along their length, so they use the straight-edge distance; only the 4x4 corners are rounded.
  const W = 12, c = canvas(W, W), r = 3.6;
  const ins = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= W) return false;
    const dx = Math.max(r - 0.5 - x, 0, x - (W - 1 - r + 0.5)), dy = Math.max(r - 0.5 - y, 0, y - (W - 1 - r + 0.5));
    return dx * dx + dy * dy <= r * r;
  };
  const ring = (d) => (d < 1.5 ? "s" : d < 2.5 ? "w" : d < 3.5 ? "q" : d < 4.5 ? "l" : "p");
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    if (!ins(x, y)) continue;
    let d;
    if ((x >= 4 && x <= 7) || (y >= 4 && y <= 7)) d = Math.min(x, y, W - 1 - x, W - 1 - y) + 1;
    else {
      d = 99;
      for (let yy = -5; yy <= 5; yy++) for (let xx = -5; xx <= 5; xx++) if (!ins(x + xx, y + yy)) d = Math.min(d, Math.hypot(xx, yy));
    }
    c[y][x] = ring(d);
  }
  one("panel", c);
}

// ---------- title ----------
save("title-heart", Array.from({ length: 24 }, (_, k) => text(titleHeart(k))));
one("title-heart-s", titleHeartSmall());
one("title-clouds", titleClouds());

// ---------- knobs ----------
{
  const h11 = smallHeart(11, 11, 11, 0, 1);
  one("knob-music", h11);
  const drag = smallHeart(11, 11, 11, 0, 1);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (drag[y][x] === "a") drag[y][x] = "h"; else if (drag[y][x] === "r") drag[y][x] = "a";
  set(drag, 0, 0, "y"); set(drag, 5, 0, "y"); set(drag, 10, 0, "y");
  one("knob-music-drag", drag);
  save("knob-music-beat", [text(h11), text(smallHeart(9, 11, 11, 1, 2))], [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  const dl = smallHeart(9, 9, 8);
  for (const [x, y] of [[4, 2], [4, 3], [4, 4], [3, 4], [5, 4], [4, 5]]) set(dl, x, y, "w");
  one("knob-download", dl);
  const vol = smallHeart(7, 9, 8, 0, 2);
  sparkle(vol, 7, 1);
  one("knob-volume", vol);
}

// ---------- cover: vinyl on clouds ----------
{
  const W = 30, cx = 15, cy = 12, c = canvas(W, W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d > 12) continue;
    if (d > 11) { c[y][x] = "s"; continue; }
    let ch = "D";
    if (d >= 6.3 && Math.floor(d) % 2 === 1) ch = "d"; // grooves
    if (d >= 6 && d < 10.6 && Math.abs(dx + dy * 0.9 + 3.4) < 1.4 && dx < 0) ch = "s"; // soft gloss band
    c[y][x] = ch;
  }
  const label = inEllipse(cx, cy, 4.6, 4.6);
  shape(c, { mask: label, height: dome(cx, cy, 4.6, 4.6, 1), tones: ["r", "a", "h", "h"], outline: "s", dither: 0.4 });
  stamp(c, [".w.w.", "wwwww", ".www.", "..w.."], 13, 10);
  const cl = canvas(W, 13);
  puffs(cl, [[4, 9, 5], [11, 8, 6], [19, 8, 7], [26, 9, 5], [15, 12, 7]], { openBottom: true, openLeft: true, openRight: true });
  stamp(c, text(cl), 0, 17);
  sparkle(c, 3, 4); sparkle(c, 27, 6); set(c, 25, 2, "y"); set(c, 2, 9, "y");
  one("cover-ph-30", c);
  // two opposite glints turning around the disc (12 frames)
  const N = 12;
  const frames = Array.from({ length: N }, (_, k) => {
    const f = canvas(W, W), a0 = k * (180 / N);
    for (let y = 0; y < 21; y++) for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      if (d < 5.8 || d > 10.7) continue;
      const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 720) % 360;
      for (const base of [a0 + 200, a0 + 20]) {
        const diff = (a - base + 720) % 360;
        if (diff < 36) f[y][x] = diff > 6 && diff < 24 ? (d > 9.2 ? "h" : "l") : "s";
      }
    }
    return text(f);
  });
  save("cover-shine", frames);
}

// ---------- mascot: layers of the same canvas, stacked in the app ----------
const frames = (n, fn) => Array.from({ length: n }, (_, i) => text(fn(i, n)));
const rest = (n) => Array(n).fill(0);
for (const [key, L] of Object.entries(LAYOUTS)) {
  const P = `mascot-${key}`;
  one(`${P}-back`, bedBack(L));
  one(`${P}-front`, bedFront(L));
  // breathing: 12 levels, up then down (2 s at 12 fps)
  save(`${P}-body`, frames(12, (i) => catBody(L, i / 11)), [...Array(12).keys(), ...[...Array(12).keys()].reverse()]);
  // tail: rest, a big swish, a small one, rest (4 s)
  save(`${P}-tail`, frames(8, (i) => tail(L, i / 7)), [...rest(14), 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 3, 2, 1, ...rest(12)]);
  // ear flick (4 s)
  save(`${P}-ears`, frames(3, (i) => ears(L, i / 2)), [...rest(40), 1, 2, 2, 1, 0, 0, 1, 2, 1, 0, ...rest(2)]);
  save(`${P}-hearts`, frames(36, (k) => floatingHearts(L, k, 36)));
  save(`${P}-sparks`, frames(24, (k) => sparkles(L, k, 24)));
}
console.log("Cupid Pink v3 sprites written to", outDir);