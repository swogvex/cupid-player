// Generates ALL sprites of Lavender into art/themes/lavender/sprites/.
// Run from the project root:  node art/tools/lavender.mjs   (then: pnpm assets:build)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canvas, dome, inEllipse, maskHeight, puffs, set, shape, stamp, text, tone } from "./px.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "themes", "lavender", "sprites");
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
/** Timeline of argument tuples -> unique frames + play order. */
function seq(timeline, fn) {
  const map = new Map(), frames = [], order = [];
  for (const key of timeline) {
    const k = JSON.stringify(key);
    if (!map.has(k)) { map.set(k, frames.length); frames.push(text(fn(...key))); }
    order.push(map.get(k));
  }
  return { frames, order };
}
const saveSeq = (name, timeline, fn) => { const { frames, order } = seq(timeline, fn); save(name, frames, order); };

// ---------- palette groups (letters live in art/themes/lavender/theme.json) ----------
const BUD = ["2", "a", "h", "4"];      // lavender buds, outline s
const LEAF = ["e", "f", "g", "G"];     // sage leaves, outline E
const FUR = ["k", "o", "n", "w"];      // white bunny, outline m
const PETAL = ["k", "o", "n", "w"];    // white flowers, outline x
const WING = ["s", "a", "h", "4"];     // butterfly, outline 1

// ---------- geometry helpers ----------
const R = Math.round, FL = Math.floor;
const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const rot = (d, deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [d[0] * c - d[1] * s, d[0] * s + d[1] * c]; };
/** Ellipse with semi-axis rl along direction d and rw across it. */
const axisE = (cx, cy, rw, rl, d) => (x, y) => {
  const px = x + 0.5 - cx, py = y + 0.5 - cy, a = px * d[0] + py * d[1], b = -px * d[1] + py * d[0];
  return (a / rl) ** 2 + (b / rw) ** 2 <= 1;
};
const axisDome = (cx, cy, rw, rl, d, k = 1.1) => (x, y) => {
  const px = x + 0.5 - cx, py = y + 0.5 - cy, a = px * d[0] + py * d[1], b = -px * d[1] + py * d[0];
  const q = (a / rl) ** 2 + (b / rw) ** 2;
  return q >= 1 ? 0 : Math.sqrt(1 - q) * k * Math.min(rw, rl);
};
const blob = (c, cx, cy, rw, rl, d, opts) => shape(c, { mask: axisE(cx, cy, rw, rl, d), height: axisDome(cx, cy, rw, rl, d), ...opts });
const bez = (p0, p1, p2, t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
const dots = (c, list, ch) => list.forEach(([x, y]) => set(c, x, y, ch));
const cross5 = (c, x, y, arm = "h", mid = "a") => { for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) set(c, x + dx, y + dy, dx || dy ? arm : mid); };
const merge = (...layers) => { const out = canvas(layers[0][0].length, layers[0].length); for (const l of layers) l.forEach((r, y) => r.forEach((ch, x) => { if (ch !== ".") out[y][x] = ch; })); return out; };

/**
 * A lavender sprig: sage stalk, leaf pairs near the base, buds along the top.
 * pts = [start, control, tip] of a quadratic curve; sway pushes the tip sideways (animation).
 */
function branch(c, pts, o = {}) {
  const { sway = 0, buds = 5, budW = 1.5, budL = 2.3, leaves = [0.1, 0.26], leafW = 1.15, leafL = 2.7, t0 = 0.5, leafAngle = 42, budAngle = 26, budStyle = "outlined" } = o;
  const [p0, p1, p2] = pts;
  const P = (t) => { const q = bez(p0, p1, p2, t); return [q[0] + sway * t * t, q[1]]; };
  const T = (t) => { const a = P(Math.max(0, t - 0.02)), b = P(Math.min(1, t + 0.02)); return unit([b[0] - a[0], b[1] - a[1]]); };
  const N = Math.ceil(Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) * 3);
  for (let i = 0; i <= N; i++) { const q = P(i / N); set(c, FL(q[0]), FL(q[1]), "e"); }
  for (const t of leaves) for (const side of [-1, 1]) {
    const d = rot(T(t), side * leafAngle), q = P(t);
    blob(c, q[0] + d[0] * leafL * 0.85, q[1] + d[1] * leafL * 0.85, leafW, leafL, d, { tones: LEAF, outline: "E", dither: 0.3 });
  }
  const bo = { tones: ["2", "a", "h"], outline: budStyle === "flat" ? null : "s", dither: 0.15, spec: { at: 0.92, ch: "4" } };
  for (let i = 0; i < buds; i++) {
    const t = t0 + ((1 - t0) * i) / buds, side = i % 2 ? -1 : 1, q = P(t);
    const d = rot(T(t), side * budAngle);
    blob(c, q[0] + d[0] * budL * 0.8, q[1] + d[1] * budL * 0.8, budW, budL, d, bo);
  }
  const q = P(1), d = T(1);
  blob(c, q[0] + d[0] * budL * 0.75, q[1] + d[1] * budL * 0.75, budW * 1.05, budL * 1.1, d, bo);
}

/** Five-petal flower. rotDeg turns it; centre pixels are pink with a yellow heart. */
function flower(c, cx, cy, ring, pr, rotDeg = -90, { tones = PETAL, outline = "x", crease = "k", centre = ["R", "y"] } = {}) {
  const circles = Array.from({ length: 5 }, (_, i) => { const a = ((rotDeg + i * 72) * Math.PI) / 180; return [cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, pr]; });
  puffs(c, circles, { tones, outline, crease, dither: 0.3 });
  const x = FL(cx), y = FL(cy);
  if (centre) { set(c, x, y, centre[1]); set(c, x - 1, y, centre[0]); set(c, x, y - 1, centre[0]); set(c, x + 1, y, centre[0]); set(c, x, y + 1, centre[0]); }
}

/** Hand-drawn butterfly, left half (10 cols, outer edge first). The right half is its mirror; 2 body columns go between. */
const BF_HALF = [
  "..1111....",
  ".1hhh41...",
  "1hh4whha1.",
  "1hhhh4haa1",
  "1hhhhhaaa1",
  "1hhhhaaa21",
  ".1hhaaa221",
  "..1aaaa221",
  "..1haaa21.",
  "..1haa221.",
  "...1aa21..",
  "....1221..",
  ".....11...",
];
/** Draws the butterfly with its top-left at (x0, y0). f = wing opening 0.3..1 (columns are squeezed towards the body). */
function butterfly(c, x0, y0, f = 1) {
  const nw = Math.max(3, R(10 * f));
  BF_HALF.forEach((row, j) => {
    for (let i = 0; i < nw; i++) {
      const ch = row[FL((i * 10) / nw)];
      if (ch === ".") continue;
      const dx = 10 - nw + i; // right-aligned to the body
      set(c, x0 + dx, y0 + j, ch);
      set(c, x0 + 21 - dx, y0 + j, ch);
    }
  });
  for (let j = 2; j <= 11; j++) { set(c, x0 + 10, y0 + j, "1"); set(c, x0 + 11, y0 + j, "1"); }
  set(c, x0 + 10, y0 + 1, "1"); set(c, x0 + 11, y0 + 1, "1");
  set(c, x0 + 9, y0, "1"); set(c, x0 + 12, y0, "1");
}

// ---------- small icons ----------
{ const c = canvas(8, 7); flower(c, 4, 3.5, 1.7, 1.55, -90, { crease: null, outline: "x" }); one("heart-8", c); }
{ // simple corner: a 3x3 flower and two sparkles, all inside the 3 px padding of the panel
  const c = canvas(7, 7);
  stamp(c, [".h.", "hyh", ".h."], 0, 0);
  set(c, 4, 1, "a"); set(c, 1, 4, "a");
  one("corner-7", c);
}
one("nav-heart", (() => { const c = canvas(5, 5); stamp(c, [".a.a.", "ahwha", ".wyw.", "ahwha", ".a.a."], 0, 0); return c; })());
one("nav-heart-on", (() => { const c = canvas(5, 5); stamp(c, [".w.w.", "wwwww", ".wyw.", "wwwww", ".w.w."], 0, 0); return c; })());

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
  hover: { outline: "s", fill: "p", hi: "w", lo: "U" },
  pressed: { outline: "s", fill: "a", hi: "h", lo: "1" },
  disabled: { outline: "l", fill: "p", hi: "q", lo: "p" },
};
for (const [k, o] of Object.entries(BTN)) {
  one(`button-${k}`, roundRect(8, 8, 3, o));
  one(`ctl-${k}`, roundRect(12, 12, 5, o));
}
{
  // Panel frame (9-slice, 12x12, corner 4). Stretched strips (rows/cols 4..7) are uniform along their length.
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

// ---------- title: butterfly on a bow between two sprays of lavender ----------
const TW = 96, TH = 22;
const BOW = (() => {
  const half = [".ssss..", "swwhhs.", "shhhhha", "shhhhsa", ".ssss.s"];
  return half.map((r) => r + [...r].reverse().join(""));
})();
const mirPts = (pts) => pts.map(([x, y]) => [TW - x, y]);
const SPRAYS = [
  { pts: [[40, 19.5], [15, 20], [7, 5]], buds: 6, t0: 0.52, leaves: [0.22, 0.4] },
  { pts: [[41, 18.5], [24, 17], [18, 2]], buds: 5, t0: 0.5, leaves: [0.24, 0.42] },
  { pts: [[42, 17.5], [33, 15], [27, 5]], buds: 3, t0: 0.55, leaves: [0.32], budL: 2.0, budW: 1.2 },
];
const SPRAY_OPTS = { budW: 1.3, budL: 2.2, leafW: 1.1, leafL: 2.9, leafAngle: 50, budAngle: 22, budStyle: "flat" };
function titleMid(k, flap = 1, swayStep = 0) {
  const c = canvas(TW, TH);
  const sw = swayStep * 0.45;
  SPRAYS.forEach((s, i) => {
    branch(c, s.pts, { ...SPRAY_OPTS, ...s, sway: sw * (i === 1 ? 1.2 : 0.8) });
    branch(c, mirPts(s.pts), { ...SPRAY_OPTS, ...s, sway: -sw * (i === 1 ? 1.2 : 0.8) });
  });
  flower(c, 34, 11, 2.5, 2.25, -90);
  flower(c, TW - 34, 11, 2.5, 2.25, -50);
  stamp(c, BOW, 41, 12);
  butterfly(c, TW / 2 - 11, 0, flap);
  const tw = (x, y, ph) => { const t = (k + ph) % 12; if (t === 0 || t === 6) set(c, x, y, "4"); if (t >= 1 && t <= 5) cross5(c, x, y, "4", "w"); };
  tw(3, 12, 0); tw(92, 12, 6); tw(13, 14, 9); tw(83, 14, 3); tw(30, 2, 4); tw(66, 2, 10);
  return c;
}
{
  const FLAP = Array(48).fill(1);
  [0.85, 0.65, 0.5, 0.65, 0.85, 1, 0.85, 0.65, 0.5, 0.65, 0.85].forEach((v, i) => { FLAP[(18 + i) % 48] = v; });
  const SW = (k) => Math.round(Math.sin((2 * Math.PI * k) / 48) * 2);
  saveSeq("title-heart", Array.from({ length: 48 }, (_, k) => [k % 12, FLAP[k], SW(k)]), titleMid);
}
{ // faint strip along the whole title bar: tiny lavender sprigs, drifting petals and glints (seamless)
  const W = 128, H = 12, c = canvas(W, H);
  const tiny = (x, baseY, h, lean) => {
    for (let i = 0; i < h; i++) set(c, x + R((lean * i) / h), baseY - i, "D");
    for (let i = 3; i < h; i += 2) { const bx = x + R((lean * i) / h), side = (i / 2) % 2 ? -1 : 1; set(c, bx + side, baseY - i, "Z"); set(c, bx + side, baseY - i - 1, "Z"); set(c, bx + side * 2, baseY - i - 1, "C"); }
    set(c, x + lean, baseY - h, "Z"); set(c, x + lean, baseY - h - 1, "Z"); set(c, x + lean, baseY - h - 2, "C");
    set(c, x - 1, baseY - 2, "D"); set(c, x + 1, baseY - 1, "D"); set(c, x - 2, baseY - 3, "D"); set(c, x + 2, baseY - 2, "D");
  };
  const list = [[8, 9, 5, 1], [16, 11, 7, -1], [25, 9, 4, 1], [35, 11, 6, 1], [44, 10, 8, -1], [53, 11, 5, 1], [63, 9, 6, -1], [72, 11, 7, 1], [82, 10, 5, -1], [91, 11, 8, 1], [101, 9, 4, -1], [110, 11, 6, 1], [120, 10, 7, -1]];
  for (const [x, by, h, l] of list) tiny(x, by, h, l);
  dots(c, [[4, 2], [21, 4], [39, 1], [58, 3], [76, 2], [97, 4], [116, 2], [30, 6], [68, 5], [106, 7]], "F");
  dots(c, [[12, 5], [48, 3], [86, 4], [124, 5]], "C");
  one("title-clouds", c);
}

// ---------- small butterfly (divider, ambient button, download knob) ----------
const symOdd = (half) => half.map((r) => r + [...r.slice(0, -1)].reverse().join(""));
const BFLY9 = symOdd(["..s.1", ".shh1", "sh4a1", "shaa1", ".saa1", ".sha1", "..sa1", "...s1"]);
function smallButterfly(map = {}) { const c = canvas(9, 8); stamp(c, BFLY9, 0, 0); return c.map((r) => r.map((ch) => map[ch] ?? ch)); }
one("deco-heart", smallButterfly());
one("knob-download", smallButterfly({ "4": "w" }));
{ const c = canvas(9, 8); flower(c, 4.5, 4, 1.9, 1.7, -90, { crease: null }); one("title-heart-s", c); }

// ---------- knobs ----------
function knobFlower(v = 0, strong = false) {
  const c = canvas(11, 11);
  const o = strong ? { tones: ["s", "a", "h", "4"], outline: "1", crease: "2", centre: ["w", "y"] } : {};
  flower(c, 5.5, 5.5, 2.7 + 0.13 * v, 2.3 + 0.03 * v, -90 + 5 * v, o);
  return c;
}
one("knob-music", knobFlower(0));
{ const c = knobFlower(0, true); dots(c, [[0, 0], [10, 1], [10, 9], [0, 10]], "y"); one("knob-music-drag", c); }
saveSeq("knob-music-beat", [0, 0, 1, 2, 3, 2, 1, 0, 1, 2, 1, 0].map((v) => [v]), knobFlower);
{ // volume: a lavender bud with two sage sepals
  const c = canvas(9, 8);
  blob(c, 3.6, 3.4, 2.2, 3.2, [0.12, -0.99], { tones: BUD, outline: "s", dither: 0.25, spec: { at: 0.9, ch: "4" } });
  blob(c, 1.9, 6.4, 1.0, 2.1, unit([-0.8, -0.6]), { tones: LEAF, outline: "E", dither: 0.2 });
  blob(c, 5.4, 6.4, 1.0, 2.1, unit([0.8, -0.6]), { tones: LEAF, outline: "E", dither: 0.2 });
  set(c, 3, 7, "e"); set(c, 4, 7, "e");
  cross5(c, 7, 1, "h", "w");
  one("knob-volume", c);
}

// ---------- cover: lavender field at dusk ----------
const sparkLayer = (L, k, n) => {
  const c = canvas(L.W, L.H);
  L.sparks.forEach(([x, y], i) => {
    const t = ((k + i * 5) % n) / n;
    const s = t < 0.15 ? 0 : t < 0.3 ? 1 : t < 0.55 ? 2 : t < 0.7 ? 1 : 0;
    if (s === 1) set(c, x, y, "h");
    if (s === 2) cross5(c, x, y, "h", "w");
  });
  return c;
};
{
  const W = 30, c = canvas(W, W), HZ = 15;
  for (let y = 0; y <= HZ + 1; y++) for (let x = 0; x < W; x++) c[y][x] = tone(["a", "h", "l", "p", "N"], Math.min(1, y / 15), x, y, 0.55);
  const lerp = (pts) => (x) => { for (let i = 0; i < pts.length - 1; i++) if (x >= pts[i][0] && x <= pts[i + 1][0]) return pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (x - pts[i][0])) / (pts[i + 1][0] - pts[i][0]); return pts[pts.length - 1][1]; };
  const far = lerp([[0, 11], [4, 8.5], [8, 6.5], [12, 9.5], [17, 7.5], [22, 5.5], [26, 8], [29, 9.5], [30, 10]]);
  const near = lerp([[0, 13.5], [6, 11.5], [12, 13], [19, 12], [25, 11], [29, 12.5], [30, 12.5]]);
  const cl = canvas(12, 7);
  puffs(cl, [[4, 4.4, 2.6], [7.2, 3.8, 3.0], [9.8, 4.6, 2.2]], { tones: ["p", "N", "w", "w"], outline: "h", crease: "p", dither: 0.3 });
  stamp(c, text(cl), 15, 1);
  for (let x = 0; x < W; x++) {
    for (let y = Math.max(0, Math.round(far(x))); y <= HZ; y++) c[y][x] = y - far(x) < 1 ? "4" : "D";
    if (far(x) < 7.4) { set(c, x, Math.round(far(x)), "w"); }
    for (let y = Math.round(near(x)); y <= HZ; y++) c[y][x] = y - near(x) < 1 ? "h" : y - near(x) < 2.6 ? "x" : "Z";
  }
  for (let y = HZ; y < W; y++) {
    const d = (y - HZ + 0.5) / (W - HZ), laneW = 1.4 + d * 6.5;
    for (let x = 0; x < W; x++) {
      const lane = (x + 0.5 - 15) / laneW, f = lane - Math.floor(lane);
      let ch = f < 0.2 ? "h" : f < 0.62 ? "a" : "s";
      if (f < 0.62 && d > 0.3 && (y + Math.floor(lane)) % 3 === 0) ch = "2";
      if (d < 0.12) ch = f < 0.62 ? "x" : "Z";
      c[y][x] = ch;
    }
  }
  dots(c, [[3, 3], [26, 5], [9, 1], [11, 7]], "w");
  cross5(c, 24, 2, "w", "w");
  one("cover-ph-30", c);
}
{
  // glints plus a small butterfly that flutters across every 4 s
  const W = 30, N = 48;
  const L = { W, H: W, sparks: [[4, 4], [26, 3], [27, 12], [9, 21], [21, 24]] };
  const open = [["a", "1", ".", "1", "a"], ["h", "h", "1", "h", "h"], [".", "h", "1", "h", "."], [".", ".", "1", ".", "."]];
  const half = [[".", "a", "1", "a", "."], [".", "h", "1", "h", "."], [".", ".", "1", ".", "."], [".", ".", "1", ".", "."]];
  const shut = [[".", ".", "1", ".", "."], [".", ".", "1", ".", "."], [".", ".", "1", ".", "."], [".", ".", "1", ".", "."]];
  const forms = [open, half, shut, half];
  save("cover-shine", Array.from({ length: N }, (_, k) => {
    const c = sparkLayer(L, k % 24, 24);
    if (k >= 6 && k <= 41) {
      const p = (k - 6) / 35, x = R(-5 + p * 38), y = R(7 + 4 * Math.sin(p * 9) + p * 6);
      forms[(k >> 1) % 4].forEach((row, j) => row.forEach((ch, i) => { if (ch !== ".") set(c, x + i, y + j, ch); }));
    }
    return text(c);
  }));
}

// ---------- mascot: a white bunny sleeping among lavender, same canvas per layer ----------
const mk = (o) => o;
const LAYOUTS = {
  full: mk({
    W: 70, H: 50, S: 1,
    head: { cx: 35, cy: 28, rx: 10.5, ry: 8.5 }, body: { cx: 35, cy: 38.5, rx: 11.5, ry: 9.8 },
    paws: [[31, 44.6], [39, 44.6]], pawR: [2.9, 1.9], eyeDx: 5, eyeW: 4,
    ear: { len: 15, w: 3.3, roots: [[29.8, 22], [40.2, 22]], ang: [-13, 13] },
    sprigsL: [
      { pts: [[9, 47], [5, 36], [3, 19]], buds: 6 },
      { pts: [[15, 47], [12, 34], [14, 12]], buds: 7 },
      { pts: [[18, 47], [17.5, 39], [18.5, 28]], buds: 4, budL: 2.0, budW: 1.3 },
    ],
    sprigsR: [
      { pts: [[61, 47], [65, 35], [67, 17]], buds: 6 },
      { pts: [[55, 47], [58, 33], [56, 10]], buds: 7 },
      { pts: [[52, 47], [52.5, 38], [51, 27]], buds: 4, budL: 2.0, budW: 1.3 },
    ],
    spOpts: { budW: 1.45, budL: 2.3, leafW: 1.1, leafL: 2.9, leafAngle: 48, budAngle: 24, budStyle: "flat", leaves: [0.12, 0.26], t0: 0.5 },
    bushes: [[5, 48, 6], [12, 49, 6.5], [20, 49.5, 5.5], [50, 49.5, 5.5], [58, 49, 6.5], [65, 48, 6]],
    daisies: [[8, 44], [57, 43], [24, 46], [47, 46]],
    tufts: [[12, 50, 14], [18, 49, -16], [23, 50, 8], [47, 50, -8], [52, 49, 16], [58, 50, -14]],
    petals: { n: 36, top: 2, bottom: 43, xs: [10, 24, 47, 60] },
    sparks: [[8, 6], [21, 13], [48, 14], [62, 4], [67, 28], [4, 28]],
  }),
  compact: mk({
    W: 70, H: 28, S: 0.62,
    head: { cx: 35, cy: 14.5, rx: 7.4, ry: 6 }, body: { cx: 35, cy: 21.5, rx: 8.6, ry: 6.4 },
    paws: [[32, 25.8], [38, 25.8]], pawR: [2.1, 1.4], eyeDx: 3, eyeW: 3,
    ear: { len: 9.5, w: 2.4, roots: [[31.4, 11], [38.6, 11]], ang: [-12, 12] },
    sprigsL: [
      { pts: [[11, 27], [8, 20], [7, 9]], buds: 4 },
      { pts: [[17, 27], [15, 19], [17, 6]], buds: 5 },
      { pts: [[22, 27], [21, 22], [21.5, 15]], buds: 3 },
    ],
    sprigsR: [
      { pts: [[59, 27], [62, 20], [63, 8]], buds: 4 },
      { pts: [[53, 27], [55, 18], [53, 5]], buds: 5 },
      { pts: [[48, 27], [49, 22], [48.5, 14]], buds: 3 },
    ],
    spOpts: { budW: 1.1, budL: 1.7, leafW: 0.9, leafL: 2.1, leafAngle: 48, budAngle: 24, budStyle: "flat", leaves: [0.14], t0: 0.45 },
    bushes: [[8, 27.5, 4], [15, 28.5, 4], [23, 28.5, 3.5], [47, 28.5, 3.5], [55, 28.5, 4], [62, 27.5, 4]],
    daisies: [],
    tufts: [[17, 28, -14], [22, 28.5, 8], [48, 28.5, -8], [53, 28, 14]],
    petals: { n: 36, top: 1, bottom: 22, xs: [12, 26, 46, 60] },
    sparks: [[6, 5], [22, 3], [48, 4], [66, 9]],
  }),
};

function bedBack(L) {
  const c = canvas(L.W, L.H);
  puffs(c, L.bushes, { tones: ["f", "g", "G", "G"], outline: "e", crease: "f", dither: 0.3, openBottom: true });
  for (const [x, y] of L.daisies) { stamp(c, [".w.", "wyw", ".w."], x, y); set(c, x, y, "n"); }
  return c;
}
function bedFront(L) {
  const c = canvas(L.W, L.H);
  for (const [x, y, ang] of L.tufts) {
    const d = rot([0, -1], ang), len = L.S === 1 ? 4.2 : 2.9;
    blob(c, x + d[0] * len * 0.8, y + d[1] * len * 0.8, L.S === 1 ? 1.25 : 0.95, len, d, { tones: LEAF, outline: "E", dither: 0.25 });
  }
  return c;
}
/** Bunny body + head + paws + sleeping face. b in 0..1 = breath. */
function bunny(L, b) {
  const c = canvas(L.W, L.H);
  const { head, body } = L;
  const hy = head.cy - b * 0.5 * L.S, by = body.cy - b * 0.4 * L.S, bry = body.ry + b * 0.6 * L.S;
  shape(c, { mask: inEllipse(body.cx, by, body.rx, bry), height: dome(body.cx, by, body.rx, bry, 1.1), tones: FUR, outline: "m", dither: 0.35 });
  shape(c, { mask: inEllipse(head.cx, hy, head.rx, head.ry), height: dome(head.cx, hy, head.rx, head.ry, 1.0), tones: FUR, outline: "m", dither: 0.4 });
  for (const [px, py] of L.paws) {
    shape(c, { mask: inEllipse(px, py, L.pawR[0], L.pawR[1]), height: dome(px, py, L.pawR[0], L.pawR[1], 1.2), tones: FUR, outline: "m", dither: 0.3 });
    if (L.S === 1) { set(c, R(px) - 1, R(py), "m"); set(c, R(px) + 1, R(py), "m"); }
  }
  const cx = R(head.cx), ey = R(hy + head.ry * 0.12), ed = L.eyeDx;
  const eye = (x0) => (L.eyeW === 4 ? [[0, 0], [1, 1], [2, 1], [3, 0]] : [[0, 0], [1, 1], [2, 0]]).forEach(([dx, dy]) => set(c, x0 + dx, ey + dy, "m"));
  const ew = L.eyeW;
  eye(cx - ed - (ew === 4 ? 2 : 1)); eye(cx + ed - (ew === 4 ? 2 : 1));
  const ny = ey + (L.S === 1 ? 3 : 2);
  set(c, cx - 1, ny, "r"); set(c, cx, ny, "r");
  if (L.S === 1) { set(c, cx - 1, ny + 1, "m"); set(c, cx, ny + 1, "m"); set(c, cx - 2, ny + 2, "m"); set(c, cx + 1, ny + 2, "m"); }
  const ch = ey + 1;
  for (const dx of [-(ed + 4), -(ed + 3), ed + 2, ed + 3]) if (c[ch]?.[cx + dx] && c[ch][cx + dx] !== "m") set(c, cx + dx, ch, "R");
  return c;
}
/** Ears: fa / fb in 0..1 = how far the left / right ear flicks outwards. Drawn over the head. */
function earsLayer(L, fa, fb) {
  const c = canvas(L.W, L.H);
  const { head, ear } = L;
  const ex = inEllipse(head.cx, head.cy, head.rx - 1, head.ry - 1);
  [0, 1].forEach((i) => {
    const f = i === 0 ? fa : fb, sg = i === 0 ? -1 : 1;
    const root = ear.roots[i], d = rot([0, -1], ear.ang[i] + sg * f * 9), len = ear.len * (1 - 0.05 * f);
    const cxm = root[0] + d[0] * len * 0.5, cym = root[1] + d[1] * len * 0.5;
    const m0 = axisE(cxm, cym, ear.w, len / 2, d);
    shape(c, { mask: (x, y) => m0(x, y) && !ex(x, y), height: axisDome(cxm, cym, ear.w, len / 2, d), tones: FUR, outline: "m", dither: 0.3 });
    // open the root: the outline that faces the head becomes fur
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
      if (c[y][x] !== "m") continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m0(x + dx, y + dy) && ex(x + dx, y + dy))) c[y][x] = "o";
    }
    // pink inside, darker towards the root
    const ic = [root[0] + d[0] * len * 0.52, root[1] + d[1] * len * 0.52];
    const inner = axisE(ic[0], ic[1], ear.w * 0.5, len * 0.33, d);
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
      if (!inner(x, y) || c[y][x] === "." || c[y][x] === "m") continue;
      const a = ((x + 0.5 - root[0]) * d[0] + (y + 0.5 - root[1]) * d[1]) / len;
      c[y][x] = a < 0.4 ? "r" : "R";
    }
  });
  return c;
}
/** Lavender sprigs swaying. sl / sr are sway steps for the left and right group. */
function sprigsLayer(L, sl, sr) {
  const c = canvas(L.W, L.H);
  L.sprigsL.forEach((s, i) => branch(c, s.pts, { ...L.spOpts, ...s, sway: sl * 0.5 * (1 + i * 0.15) }));
  L.sprigsR.forEach((s, i) => branch(c, s.pts, { ...L.spOpts, ...s, sway: sr * 0.5 * (1 + i * 0.15) }));
  return c;
}
/** Petals drifting down. */
const PET = [[["h.", ".a"], [".h", "a."]], [["R.", ".r"], [".R", "r."]]];
function petalLayer(L, k) {
  const c = canvas(L.W, L.H), P = L.petals;
  P.xs.forEach((x0, i) => {
    const t = ((k + Math.round((P.n * i) / P.xs.length) + i * 3) % P.n) / P.n;
    if (t > 0.94) return;
    const y = R(P.top + t * (P.bottom - P.top)), x = R(x0 + 2.2 * Math.sin(t * 9.4 + i * 1.7));
    const g = PET[i % 2][(FL(k / 3) + i) % 2];
    g.forEach((row, j) => [...row].forEach((ch, q) => { if (ch !== ".") set(c, x + q, y + j, ch); }));
  });
  return c;
}

const rest = (n) => Array(n).fill(0);
for (const [key, L] of Object.entries(LAYOUTS)) {
  const P = `mascot-${key}`;
  one(`${P}-back`, bedBack(L));
  one(`${P}-front`, bedFront(L));
  // breathing: 12 levels, up then down (2 s)
  save(`${P}-body`, Array.from({ length: 12 }, (_, i) => text(bunny(L, i / 11))), [...Array(12).keys(), ...[...Array(12).keys()].reverse()]);
  // lavender sways (4 s); the right group is a little behind the left one
  saveSeq(`${P}-tail`, Array.from({ length: 48 }, (_, s) => [R(3 * Math.sin((2 * Math.PI * s) / 48)), R(3 * Math.sin((2 * Math.PI * s) / 48 - 1.4))]), (a, b) => sprigsLayer(L, a, b));
  // ears: each one flicks at its own moment (4 s)
  const fl = (start) => { const a = [...rest(48)]; [1, 2, 2, 1, 0, 0, 1, 2, 1].forEach((v, i) => { a[(start + i) % 48] = v; }); return a; };
  const ea = fl(36), eb = fl(14);
  saveSeq(`${P}-ears`, Array.from({ length: 48 }, (_, s) => [ea[s] / 2, eb[s] / 2]), (a, b) => earsLayer(L, a, b));
  save(`${P}-hearts`, Array.from({ length: L.petals.n }, (_, k) => text(petalLayer(L, k))));
  save(`${P}-sparks`, Array.from({ length: 24 }, (_, k) => text(sparkLayer(L, k, 24))));
}
console.log("Lavender sprites written to", outDir);
