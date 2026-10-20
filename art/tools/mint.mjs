// Generates ALL sprites of Mint into art/themes/mint/sprites/.
// Run from the project root:  node art/tools/mint.mjs   (then: pnpm assets:build)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canvas, dome, inEllipse, maskHeight, puffs, set, shape, stamp, text, tone } from "./px.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "themes", "mint", "sprites");
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

// ---------- palette groups (letters live in art/themes/mint/theme.json) ----------
const LEAF = ["e", "f", "g", "G"];      // clover / leaf greens, outline E
const LEAF_STRONG = ["s", "a", "h", "4"]; // active versions, outline d
const CW = ["v", "x", "o", "w"];        // white cat fur, outline m
const CG = ["j", "k", "n", "c"];        // grey patches, outline m
const PETAL = ["v", "x", "o", "w"];     // white flowers, outline Z

// ---------- geometry helpers ----------
const R = Math.round, FL = Math.floor, PI = Math.PI;
const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const rot = (d, deg) => { const r = (deg * PI) / 180, c = Math.cos(r), s = Math.sin(r); return [d[0] * c - d[1] * s, d[0] * s + d[1] * c]; };
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
const bez3 = (p, t) => { const u = 1 - t; return [0, 1].map((i) => u ** 3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t ** 3 * p[3][i]); };
const dots = (c, list, ch) => list.forEach(([x, y]) => set(c, x, y, ch));
const cross5 = (c, x, y, arm = "4", mid = "w") => { for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) set(c, x + dx, y + dy, dx || dy ? arm : mid); };
const merge = (...layers) => { const out = canvas(layers[0][0].length, layers[0].length); for (const l of layers) l.forEach((r, y) => r.forEach((ch, x) => { if (ch !== ".") out[y][x] = ch; })); return out; };
const stampList = (c, rows, x, y) => stamp(c, rows, x, y);

/** Leaf frond: a stalk with pairs of leaves, getting smaller towards the tip. pts = [start, control, tip]. */
function leafSpray(c, pts, o = {}) {
  const { sway = 0, n = 5, t0 = 0.16, leafW = 1.5, leafL = 3.4, angle = 50, taper = 0.5, pairs = true, tones = LEAF, outline = "E", stalk = "D" } = o;
  const [p0, p1, p2] = pts;
  const P = (t) => { const q = bez(p0, p1, p2, t); return [q[0] + sway * t * t, q[1]]; };
  const T = (t) => { const a = P(Math.max(0, t - 0.02)), b = P(Math.min(1, t + 0.02)); return unit([b[0] - a[0], b[1] - a[1]]); };
  const N = Math.ceil(Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) * 3);
  for (let i = 0; i <= N; i++) { const q = P(i / N); set(c, FL(q[0]), FL(q[1]), stalk); }
  for (let i = 0; i < n; i++) {
    const t = t0 + ((1 - t0) * i) / n, f = 1 - taper * t, q = P(t);
    for (const side of pairs ? [-1, 1] : [i % 2 ? -1 : 1]) {
      const d = rot(T(t), side * angle), L = leafL * f;
      blob(c, q[0] + d[0] * L * 0.85, q[1] + d[1] * L * 0.85, leafW * f, L, d, { tones, outline, dither: 0.3 });
    }
  }
  const q = P(1), d = T(1), L = leafL * 0.8;
  blob(c, q[0] + d[0] * L * 0.8, q[1] + d[1] * L * 0.8, leafW * 0.85, L, d, { tones, outline, dither: 0.3 });
}

/** A pointed leaf from base (bx,by) along unit direction d, total length len. Widest near the base, with a midrib. */
function bigLeaf(c, bx, by, d, len, rw, o = {}) {
  const W = c[0].length, H = c.length, outline = o.outline ?? "E";
  const mask = (x, y) => {
    const px = x + 0.5 - bx, py = y + 0.5 - by, a = px * d[0] + py * d[1], b = -px * d[1] + py * d[0];
    if (a < 0 || a > len) return false;
    const u = a / len;
    return Math.abs(b) <= rw * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.85);
  };
  shape(c, { mask, height: maskHeight(mask, W, H, 1.1), tones: o.tones ?? LEAF, outline, dither: 0.3 });
  for (let t = 1; t < len * 0.86; t += 0.5) {
    const x = FL(bx + d[0] * t), y = FL(by + d[1] * t);
    if (c[y]?.[x] && c[y][x] !== "." && c[y][x] !== outline) c[y][x] = o.vein ?? "e";
  }
}

/** One heart-shaped clover leaf pointing at angle `ang` (radians) from the centre. */
function heartLeaf(c, cx, cy, ang, ring, r, o = {}) {
  const W = c[0].length, H = c.length;
  const d = [Math.cos(ang), Math.sin(ang)], pp = [-d[1], d[0]];
  const lobeOff = r * 0.7, lobeR = r * 0.78;
  const lobes = [1, -1].map((s) => [cx + d[0] * ring + pp[0] * lobeOff * s, cy + d[1] * ring + pp[1] * lobeOff * s]);
  const lobeIns = lobes.map(([x, y]) => inEllipse(x, y, lobeR, lobeR));
  const bridge = axisE(cx + d[0] * ring * 0.48, cy + d[1] * ring * 0.48, r * 0.55, ring * 0.6 + r * 0.25, d);
  const mask = (x, y) => lobeIns.some((f) => f(x, y)) || bridge(x, y);
  shape(c, { mask, height: maskHeight(mask, W, H, 1.0), tones: o.tones ?? LEAF, outline: o.outline ?? "E", dither: 0.3, light: [-0.5, -0.62, 0.6] });
  // vein from the centre outwards
  if (o.vein !== false) {
    const len = ring + r * 0.7;
    for (let t = 0.5; t <= len; t += 0.5) { const x = FL(cx + d[0] * t), y = FL(cy + d[1] * t); if (c[y]?.[x] && c[y][x] !== "." && c[y][x] !== (o.outline ?? "E")) c[y][x] = o.veinCh ?? "e"; }
  }
}
/** Four-leaf clover. rotDeg turns it (45 = leaves on the diagonals). */
function clover(c, cx, cy, ring, r, rotDeg = 45, o = {}) {
  for (let i = 0; i < 4; i++) heartLeaf(c, cx, cy, ((rotDeg + 90 * i) * PI) / 180, ring, r, o);
}

/** Five-petal flower, centre pink with a yellow heart. */
function flower(c, cx, cy, ring, pr, rotDeg = -90, { tones = PETAL, outline = "Z", crease = "x", centre = ["R", "y"] } = {}) {
  const circles = Array.from({ length: 5 }, (_, i) => { const a = ((rotDeg + i * 72) * PI) / 180; return [cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, pr]; });
  puffs(c, circles, { tones, outline, crease, dither: 0.3 });
  const x = FL(cx), y = FL(cy);
  if (centre) { set(c, x, y, centre[1]); for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) set(c, x + dx, y + dy, centre[0]); }
}

// ---------- small icons ----------
const symOdd = (half) => half.map((r) => r + [...r.slice(0, -1)].reverse().join(""));
const symEven = (half) => half.map((r) => r + [...r].reverse().join(""));
{ // heart-8 (title icon): a little four-leaf clover
  one("heart-8", stamp(canvas(8, 7), [".EE..EE.", "EGfEEGfE", "EffEEffE", ".EE..EE.", "EGfEEGfE", "EffEEffE", ".EE..EE."], 0, 0));
}
{ // corner: a 3x3 clover and two glints, all inside the 3 px padding of the panel
  const c = canvas(7, 7);
  stamp(c, ["h.h", ".a.", "h.h"], 0, 0);
  set(c, 4, 1, "h"); set(c, 1, 4, "h");
  one("corner-7", c);
}
one("nav-heart", (() => { const c = canvas(5, 5); stamp(c, ["aa.aa", "ah.ha", "..s..", "ah.ha", "aa.aa"], 0, 0); return c; })());
one("nav-heart-on", (() => { const c = canvas(5, 5); stamp(c, ["ww.ww", "w4.4w", "..h..", "w4.4w", "ww.ww"], 0, 0); return c; })());

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
  pressed: { outline: "s", fill: "a", hi: "h", lo: "2" },
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

// ---------- title: a big four-leaf clover between two fans of leaves and white flowers ----------
const TW = 96, TH = 22;
// [base x, base y, dir x, dir y, length, half width]; drawn back to front on the left, mirrored on the right
const FAN = [
  [21, 16, -1, -0.5, 17, 2.5],
  [38, 18, -1, -0.12, 20, 3.0],
  [39, 15, -0.82, -0.57, 18, 2.8],
  [41, 12, -0.5, -0.87, 14, 2.5],
];
function titleMid(k, sw = 0, tilt = 0, gl = -1) {
  const c = canvas(TW, TH);
  FAN.forEach(([bx, by, dx, dy, len, rw], i) => {
    const ang = sw * (1.4 + 0.5 * (i % 3)) * (i % 2 ? 1 : -1);
    const dL = unit(rot([dx, dy], -ang)), dR = unit(rot([-dx, dy], ang));
    bigLeaf(c, bx, by, dL, len, rw);
    bigLeaf(c, TW - bx, by, dR, len, rw);
  });
  flower(c, 27, 9.5, 2.4, 2.15, -90);
  flower(c, TW - 27, 9.5, 2.4, 2.15, -50);
  // stem of the clover (behind it)
  for (const [x, y] of [[48, 16], [48, 17], [48, 18], [49, 19], [49, 20], [50, 21]]) set(c, x, y, "D");
  clover(c, 48, 9.5, 5.0, 3.7, -90 + tilt);
  set(c, 48, 9, "G"); set(c, 47, 9, "g"); set(c, 48, 10, "e");
  // glint sweeping over the leaves
  if (gl >= 0) {
    for (let y = 0; y < 19; y++) for (let x = 38; x < 59; x++) {
      const v = x + y * 0.7 - (36 + gl * 2.6);
      if (v > -1.2 && v < 1.2 && ["g", "G", "f"].includes(c[y][x])) c[y][x] = "4";
    }
  }
  const tw = (x, y, ph) => { const t = (k + ph) % 12; if (t === 0 || t === 6) set(c, x, y, "4"); if (t >= 1 && t <= 5) cross5(c, x, y, "4", "w"); };
  tw(4, 15, 0); tw(91, 15, 6); tw(28, 3, 9); tw(67, 3, 3); tw(10, 2, 4); tw(85, 2, 10);
  return c;
}
{
  const GL = (k) => (k >= 16 && k < 28 ? k - 16 : -1);
  const SW = (k) => Math.round(Math.sin((2 * PI * k) / 48) * 2);
  const TL = (k) => Math.round(Math.sin((2 * PI * k) / 48 - 0.6) * 2) * 2.5;
  saveSeq("title-heart", Array.from({ length: 48 }, (_, k) => [k % 12, SW(k), TL(k), GL(k)]), titleMid);
}
{ // faint strip along the whole title bar: tiny sprouts, drifting leaves and glints (seamless)
  const W = 128, H = 12, c = canvas(W, H);
  const tiny = (x, baseY, h, lean) => {
    for (let i = 0; i < h; i++) set(c, x + R((lean * i) / h), baseY - i, "L");
    for (let i = 2; i < h; i += 2) { const bx = x + R((lean * i) / h), side = (i / 2) % 2 ? -1 : 1; set(c, bx + side, baseY - i, "L"); set(c, bx + side * 2, baseY - i - 1, "N"); }
    set(c, x + lean, baseY - h, "N"); set(c, x + lean - 1, baseY - h, "L"); set(c, x + lean + 1, baseY - h, "L");
  };
  const list = [[8, 9, 5, 1], [16, 11, 7, -1], [25, 9, 4, 1], [35, 11, 6, 1], [44, 10, 8, -1], [53, 11, 5, 1], [63, 9, 6, -1], [72, 11, 7, 1], [82, 10, 5, -1], [91, 11, 8, 1], [101, 9, 4, -1], [110, 11, 6, 1], [120, 10, 7, -1]];
  for (const [x, by, h, l] of list) tiny(x, by, h, l);
  dots(c, [[4, 2], [21, 4], [39, 1], [58, 3], [76, 2], [97, 4], [116, 2], [30, 6], [68, 5], [106, 7]], "N");
  dots(c, [[12, 5], [48, 3], [86, 4], [124, 5]], "L");
  one("title-clouds", c);
}

// ---------- small clover (divider, ambient button, download knob) ----------
const CLOVER9 = [".EE...EE.", "EGfE.EGfE", "EffE.EffE", ".EE.D.EE.", ".EE.D.EE.", "EGfE.EGfE", "EffE.EffE", ".EE...EE."];
function miniClover(map = {}, width = 9) {
  const c = canvas(9, 8);
  stamp(c, CLOVER9, 0, 0);
  if (width < 9) { // coin-turn: squeeze the columns towards the middle
    const out = canvas(9, 8), x0 = Math.floor((9 - width) / 2);
    for (let y = 0; y < 8; y++) for (let i = 0; i < width; i++) out[y][x0 + i] = c[y][Math.min(8, Math.floor(((i + 0.5) * 9) / width))];
    return out.map((r) => r.map((ch) => map[ch] ?? ch));
  }
  return c.map((r) => r.map((ch) => map[ch] ?? ch));
}
one("deco-heart", miniClover());
{ // the download knob turns like a coin now and then
  const tl = [];
  for (let i = 0; i < 20; i++) tl.push(9);
  tl.push(7, 5, 3, 5, 7, 9, 9, 9, 9);
  saveSeq("knob-download", tl.map((w) => [w]), (w) => miniClover({}, w));
}
{ const c = canvas(9, 8); flower(c, 4.5, 4, 1.9, 1.7, -90, { crease: null }); one("title-heart-s", c); }

// ---------- knobs ----------
/** A sprout with two leaves. v = how far the leaves open (animation), strong = dragging colours. */
function sprout(v = 0, strong = false) {
  const c = canvas(11, 11);
  const tones = strong ? LEAF_STRONG : LEAF, outline = strong ? "d" : "E";
  for (const [x, y] of [[5, 10], [5, 9], [5, 8], [5, 7]]) set(c, x, y, strong ? "s" : "D");
  set(c, 4, 10, strong ? "s" : "D"); set(c, 6, 10, strong ? "s" : "D");
  const base = [5.5, 7];
  for (const sg of [-1, 1]) {
    const d = rot([0, -1], sg * (52 + 4 * v)), L = 3.9;
    blob(c, base[0] + d[0] * L * 0.8, base[1] + d[1] * L * 0.8 - 0.4 * v, 1.7, L, d, { tones, outline, dither: 0.25 });
  }
  set(c, 5, 6, strong ? "h" : "g"); set(c, 5, 5, strong ? "a" : "f");
  return c;
}
one("knob-music", sprout(0));
{ const c = sprout(0, true); dots(c, [[0, 0], [10, 1], [10, 9], [0, 10]], "y"); one("knob-music-drag", c); }
saveSeq("knob-music-beat", [0, 0, 1, 2, 3, 2, 1, 0, 1, 2, 1, 0].map((v) => [v]), sprout);
{ // volume: one leaf on a short stalk
  const c = canvas(9, 8);
  blob(c, 4.2, 3.3, 2.2, 3.6, unit([0.5, -0.86]), { tones: LEAF, outline: "E", dither: 0.25 });
  for (let t = 0; t < 3.2; t += 0.5) { const x = FL(2.4 + 0.7 * t), y = FL(6.2 - t * 0.9); if (c[y]?.[x] && c[y][x] !== "." && c[y][x] !== "E") c[y][x] = "e"; }
  for (const [x, y] of [[2, 6], [2, 7], [3, 7]]) set(c, x, y, "D");
  cross5(c, 7, 1, "g", "4");
  one("knob-volume", c);
}

// ---------- cover: a meadow under a bright sky ----------
const sparkLayer = (L, k, n) => {
  const c = canvas(L.W, L.H);
  L.sparks.forEach(([x, y], i) => {
    const t = ((k + i * 5) % n) / n;
    const s = t < 0.15 ? 0 : t < 0.3 ? 1 : t < 0.55 ? 2 : t < 0.7 ? 1 : 0;
    if (s === 1) set(c, x, y, "y");
    if (s === 2) cross5(c, x, y, "y", "w");
  });
  return c;
};
{
  const W = 30, c = canvas(W, W), HZ = 15;
  for (let y = 0; y <= HZ + 1; y++) for (let x = 0; x < W; x++) c[y][x] = tone(["S", "T", "V", "W"], Math.min(1, y / 14), x, y, 0.55);
  const lerp = (pts) => (x) => { for (let i = 0; i < pts.length - 1; i++) if (x >= pts[i][0] && x <= pts[i + 1][0]) return pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (x - pts[i][0])) / (pts[i + 1][0] - pts[i][0]); return pts[pts.length - 1][1]; };
  const far = lerp([[0, 11], [4, 8.5], [8, 6.5], [12, 9.5], [17, 7.5], [22, 5.5], [26, 8], [29, 9.5], [30, 10]]);
  const near = lerp([[0, 13.5], [6, 11.5], [12, 13], [19, 12], [25, 11], [29, 12.5], [30, 12.5]]);
  const cl = canvas(12, 7);
  puffs(cl, [[4, 4.4, 2.6], [7.2, 3.8, 3.0], [9.8, 4.6, 2.2]], { tones: ["V", "W", "w", "w"], outline: "T", crease: "V", dither: 0.3 });
  stamp(c, text(cl), 14, 1);
  const cl2 = canvas(8, 5);
  puffs(cl2, [[2.6, 3, 1.9], [5, 2.6, 2.1]], { tones: ["V", "W", "w", "w"], outline: "T", crease: "V", dither: 0.3 });
  stamp(c, text(cl2), 1, 2);
  for (let x = 0; x < W; x++) {
    for (let y = Math.max(0, Math.round(far(x))); y <= HZ; y++) c[y][x] = y - far(x) < 1 ? "g" : "f";
    for (let y = Math.round(near(x)); y <= HZ; y++) c[y][x] = y - near(x) < 1 ? "F" : y - near(x) < 2.6 ? "B" : "C";
  }
  // field rows in perspective: yellow-green and green stripes with tiny flowers
  for (let y = HZ; y < W; y++) {
    const d = (y - HZ + 0.5) / (W - HZ), laneW = 1.4 + d * 6.5;
    for (let x = 0; x < W; x++) {
      const lane = (x + 0.5 - 15) / laneW, f = lane - Math.floor(lane);
      let ch = f < 0.2 ? "F" : f < 0.62 ? "B" : "C";
      if (f < 0.62 && d > 0.3 && (y + Math.floor(lane)) % 3 === 0) ch = "F";
      if (d < 0.12) ch = f < 0.62 ? "B" : "C";
      c[y][x] = ch;
    }
  }
  dots(c, [[5, 21], [11, 24], [20, 22], [25, 26], [8, 28], [17, 27], [27, 20]], "w");
  dots(c, [[14, 20], [23, 24], [3, 25]], "R");
  dots(c, [[22, 29], [10, 21]], "y");
  dots(c, [[26, 3]], "w");
  one("cover-ph-30", c);
}
{
  // glints plus a small leaf that blows across every 4 s
  const W = 30, N = 48;
  const L = { W, H: W, sparks: [[4, 4], [26, 3], [27, 12], [9, 21], [21, 24]] };
  const leafA = [["g", "f", "."], [".", "f", "e"]], leafB = [[".", "g", "f"], ["f", "e", "."]], leafC = [["g", "f"], ["e", "f"]];
  const forms = [leafA, leafC, leafB, leafC];
  save("cover-shine", Array.from({ length: N }, (_, k) => {
    const c = sparkLayer(L, k % 24, 24);
    if (k >= 6 && k <= 41) {
      const p = (k - 6) / 35, x = R(-4 + p * 36), y = R(8 + 5 * Math.sin(p * 8) + p * 5);
      forms[(k >> 1) % 4].forEach((row, j) => row.forEach((ch, i) => { if (ch !== ".") set(c, x + i, y + j, ch); }));
    }
    return text(c);
  }));
}

// ---------- mascot: a white cat with grey patches sleeping on a big leaf ----------
const tri = (a, b, c) => (x, y) => {
  const p = [x + 0.5, y + 0.5];
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const LAYOUTS = {
  full: {
    W: 70, H: 50, S: 1,
    head: { cx: 27, cy: 28, rx: 11, ry: 9 }, body: { cx: 44, cy: 33, rx: 15, ry: 9.5 },
    paws: [[22, 39.2], [31, 40]], pawR: [3.4, 2.1], eyeDx: 5, eyeW: 5, earH: 7,
    tail: [[58.5, 33], [65, 37], [62.5, 42.5], [54, 43]],
    leaf: { cx: 35, cy: 45.5, rl: 24, rw: 6 },
    tipL: { cx: 9.5, cy: 44, rl: 8, rw: 3.4, d: unit([-1, -0.5]) }, tipR: { cx: 60.5, cy: 44, rl: 8, rw: 3.4, d: unit([1, -0.5]) },
    leavesBack: [
      [9, 49, -0.3, -0.95, 27, 3.3], [11, 49, 0.02, -1, 21, 3.0], [6, 49, -0.7, -0.7, 15, 2.6],
      [61, 49, 0.3, -0.95, 27, 3.3], [59, 49, -0.04, -1, 22, 3.0], [64, 49, 0.7, -0.7, 15, 2.6],
    ],
    bushes: [[4, 48.5, 4], [10, 49.5, 4], [60, 49.5, 4], [66, 48.5, 4]],
    flowers: [[4, 37], [66, 35], [15, 33], [55, 30]],
    leavesFront: [[3, 50, -0.45, -0.9, 10, 2.2], [8, 50, 0.1, -1, 7, 1.9], [66, 50, 0.45, -0.9, 10, 2.2], [61, 50, -0.1, -1, 7, 1.9]],
    zz: { x: 28, y: 12, top: 1 }, leaves: { n: 36, top: 2, bottom: 40, xs: [9, 24, 47, 61] },
    sparks: [[8, 6], [21, 13], [48, 14], [62, 4], [67, 28], [4, 28]],
  },
  compact: {
    W: 70, H: 28, S: 0.62,
    head: { cx: 30, cy: 14, rx: 8, ry: 6.6 }, body: { cx: 43, cy: 17.5, rx: 10.5, ry: 6.4 },
    paws: [[26, 21], [33, 21.5]], pawR: [2.4, 1.5], eyeDx: 3, eyeW: 3, earH: 4.5,
    tail: [[52, 17.5], [58, 20], [56, 24], [50, 24.5]],
    leaf: { cx: 35, cy: 24, rl: 17, rw: 3.5 },
    tipL: { cx: 16, cy: 23, rl: 5.5, rw: 2.2, d: unit([-1, -0.45]) }, tipR: { cx: 54, cy: 23, rl: 5.5, rw: 2.2, d: unit([1, -0.45]) },
    leavesBack: [
      [10, 27, -0.3, -0.95, 17, 2.4], [14, 27, 0.02, -1, 14, 2.1],
      [60, 27, 0.3, -0.95, 17, 2.4], [56, 27, -0.04, -1, 14, 2.1],
    ],
    bushes: [[8, 27.5, 3.2], [62, 27.5, 3.2]],
    flowers: [],
    leavesFront: [[5, 28, -0.4, -0.9, 6, 1.5], [65, 28, 0.4, -0.9, 6, 1.5]],
    zz: { x: 40, y: 9, top: 0 }, leaves: { n: 36, top: 1, bottom: 22, xs: [12, 26, 46, 60] },
    sparks: [[6, 5], [22, 3], [48, 4], [66, 9]],
  },
};

function leafMidMask(L) {
  const { cx, cy, rl, rw } = L.leaf;
  const k = L.S === 1 ? 1 : 0.62;
  const a = axisE(cx, cy, rw, rl, [1, 0]);
  const l = axisE(cx - rl * 0.55, cy - 0.5 * k, rw * 0.9, rl * 0.5, unit([1, 0.16])), r = axisE(cx + rl * 0.55, cy - 0.5 * k, rw * 0.9, rl * 0.5, unit([1, -0.16]));
  return (x, y) => a(x, y) || l(x, y) || r(x, y);
}
function bedBack(L) {
  const c = canvas(L.W, L.H);
  for (const [x, y, dx, dy, len, rw] of L.leavesBack) bigLeaf(c, x, y, unit([dx, dy]), len, rw);
  puffs(c, L.bushes, { tones: LEAF, outline: "E", crease: "e", dither: 0.3, openBottom: true });
  for (const [x, y] of L.flowers) flower(c, x, y, 1.7, 1.5, -90, { crease: null });
  const m = leafMidMask(L);
  shape(c, { mask: m, height: maskHeight(m, L.W, L.H, 1.15), tones: LEAF, outline: "E", dither: 0.35 });
  // midrib: a curve sagging in the middle
  const { cx, cy, rl } = L.leaf;
  for (let t = -0.92; t <= 0.92; t += 0.02) {
    const x = R(cx + rl * t), y = R(cy + (L.S === 1 ? 1 : 0.6) - 2.2 * L.S * (t * t) + 1.2 * L.S);
    if (c[y]?.[x] && c[y][x] !== "." && c[y][x] !== "E") c[y][x] = "e";
  }
  return c;
}
function bedFront(L) {
  const c = canvas(L.W, L.H);
  for (const [x, y, dx, dy, len, rw] of L.leavesFront) bigLeaf(c, x, y, unit([dx, dy]), len, rw);
  return c;
}
const inPatch = (list) => { const fs = list.map(([cx, cy, rx, ry]) => inEllipse(cx, cy, rx, ry)); return (x, y) => fs.some((f) => f(x, y)); };
/** Cat body + head + paws + sleeping face. b in 0..1 = breath. */
function catBody(L, b) {
  const c = canvas(L.W, L.H);
  const { head, body } = L, S = L.S;
  const hy = head.cy - b * 0.5 * S, by = body.cy - b * 0.4 * S, bry = body.ry + b * 0.6 * S;
  const bodyPatch = inPatch([[body.cx + body.rx * 0.3, by - bry * 0.5, body.rx * 0.5, bry * 0.5], [body.cx + body.rx * 0.82, by + bry * 0.1, body.rx * 0.22, bry * 0.38]]);
  shape(c, { mask: inEllipse(body.cx, by, body.rx, bry), height: dome(body.cx, by, body.rx, bry, 1.1), tones: (x, y) => (bodyPatch(x, y) ? CG : CW), outline: "m", dither: 0.35, bias: 0.3 });
  const headPatch = inPatch([[head.cx - head.rx * 0.5, hy - head.ry * 0.55, head.rx * 0.55, head.ry * 0.55]]);
  shape(c, { mask: inEllipse(head.cx, hy, head.rx, head.ry), height: dome(head.cx, hy, head.rx, head.ry, 1.0), tones: (x, y) => (headPatch(x, y) ? CG : CW), outline: "m", dither: 0.4, bias: 0.3 });
  for (const [px, py] of L.paws) {
    shape(c, { mask: inEllipse(px, py, L.pawR[0], L.pawR[1]), height: dome(px, py, L.pawR[0], L.pawR[1], 1.2), tones: CW, outline: "m", dither: 0.3, bias: 0.3 });
    if (S === 1) set(c, R(px), R(py) + 1, "m");
  }
  const cx = R(head.cx), ey = R(hy + head.ry * 0.12), ed = L.eyeDx;
  const eye = (x0) => {
    if (L.eyeW === 5) [[0, 0], [1, 1], [2, 1], [3, 1], [4, 0]].forEach(([dx, dy]) => set(c, x0 + dx - 2, ey + dy, "m"));
    else [[0, 0], [1, 1], [2, 0]].forEach(([dx, dy]) => set(c, x0 + dx - 1, ey + dy, "m"));
  };
  eye(cx - ed); eye(cx + ed);
  const ny = ey + (S === 1 ? 4 : 3);
  set(c, cx - 1, ny, "r"); set(c, cx, ny, "r"); set(c, cx + 1, ny, "r"); set(c, cx, ny + 1, "r");
  if (S === 1) { set(c, cx - 1, ny + 2, "m"); set(c, cx + 1, ny + 2, "m"); }
  const by2 = ey + (S === 1 ? 3 : 2);
  for (const dx of [-(ed + 3), -(ed + 2), ed + 2, ed + 3]) if (c[by2]?.[cx + dx] && c[by2][cx + dx] !== "m") set(c, cx + dx, by2, "R");
  return c;
}
/** flick 0..1: left ear flicks. Ears are drawn over the head. */
function earsLayer(L, flick) {
  const c = canvas(L.W, L.H);
  const { head } = L, hy = head.cy, eh = L.earH;
  const ty = hy - head.ry - eh * 0.75;
  [-1, 1].forEach((sg) => {
    const f = sg < 0 ? flick : 0;
    const a = [head.cx + sg * head.rx * 0.97, hy - head.ry * 0.28];
    const b = [head.cx + sg * (head.rx * 0.74) - f * 1.2, ty + f * 1.4];
    const d = [head.cx + sg * head.rx * 0.18, hy - head.ry * 0.9];
    const m = tri(a, b, d);
    shape(c, { mask: m, height: maskHeight(m, L.W, L.H, 0.7), tones: sg < 0 ? CG : CW, outline: "m", dither: 0.3, bias: 0.3 });
    const cxm = (a[0] + b[0] + d[0]) / 3, cym = (a[1] + b[1] + d[1]) / 3, k = 0.52;
    const inner = tri([cxm + (a[0] - cxm) * k, cym + (a[1] - cym) * k], [cxm + (b[0] - cxm) * k, cym + (b[1] - cym) * k - 0.5], [cxm + (d[0] - cxm) * k, cym + (d[1] - cym) * k]);
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (inner(x, y) && c[y][x] !== "." && c[y][x] !== "m") c[y][x] = "R";
  });
  return c;
}
/** The leaf tips rock gently (v = lift in px); the cat's tail sits on top and flicks (p in 0..1). */
function tailLayer(L, v, p) {
  const c = canvas(L.W, L.H);
  const mid = leafMidMask(L);
  for (const t of [L.tipL, L.tipR]) {
    const sg = t.d[0] < 0 ? -1 : 1;
    const cy = t.cy - v * (sg < 0 ? 1 : 0.6) * (L.S === 1 ? 1 : 0.6);
    const d = unit([t.d[0], t.d[1] - 0.16 * v * 0.5]);
    const m = axisE(t.cx, cy, t.rw, t.rl, d);
    shape(c, {
      mask: m, height: axisDome(t.cx, cy, t.rw, t.rl, d), tones: LEAF, dither: 0.3, outline: "E",
      outlineFn: (x, y) => ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => mid(x + dx, y + dy)) ? "f" : "E"),
    });
  }
  const pts = L.tail.map(([x, y], i) => [x, i === L.tail.length - 1 ? y - p * 3.2 * L.S : i === L.tail.length - 2 ? y - p * 1.2 * L.S : y]);
  const circles = [];
  const N = 26;
  for (let k = 0; k <= N; k++) { const q = bez3(pts, k / N); circles.push([q[0], q[1], (2.1 - 0.5 * (k / N)) * (L.S === 1 ? 1 : 0.7), k / N]); }
  const ins = circles.map(([x, y, r]) => inEllipse(x, y, r, r));
  const stripe = (x, y) => {
    let best = 9, t = 0;
    for (const [cx, cy, , tt] of circles) { const dd = Math.hypot(x - cx, y - cy); if (dd < best) { best = dd; t = tt; } }
    return (t > 0.28 && t < 0.46) || (t > 0.6 && t < 0.78);
  };
  shape(c, {
    mask: (x, y) => ins.some((f) => f(x, y)), height: (x, y) => Math.max(0, ...circles.map(([cx, cy, r]) => dome(cx, cy, r, r, 1)(x, y))),
    tones: (x, y) => (stripe(x, y) ? CG : CW), outline: "m", dither: 0.5, bias: 0.3,
  });
  return c;
}
/** Zs rising from the head and tiny leaves drifting down. k in 0..n-1 */
const Z3 = ["sss", ".s.", "sss"], Z5 = ["sssss", "...s.", "..s..", ".s...", "sssss"];
const DRIFT = [[["g.", ".f"], [".g", "f."]], [["f.", ".e"], [".f", "e."]]];
function zzLayer(L, k) {
  const c = canvas(L.W, L.H), n = L.leaves.n;
  const rise = L.zz.y - L.zz.top;
  for (const [off, dx] of [[0, 0], [n / 2, 8]]) {
    const t = ((k + off) % n) / n;
    const y = R(L.zz.y - t * rise), x = L.zz.x + dx + R(1.6 * Math.sin(t * 6.3));
    if (t < 0.9) stamp(c, t < 0.4 ? Z3 : Z5, x, y);
  }
  const P = L.leaves;
  P.xs.forEach((x0, i) => {
    const t = ((k + Math.round((P.n * i) / P.xs.length) + i * 3) % P.n) / P.n;
    if (t > 0.94) return;
    const y = R(P.top + t * (P.bottom - P.top)), x = R(x0 + 2.2 * Math.sin(t * 9.4 + i * 1.7));
    DRIFT[i % 2][(FL(k / 3) + i) % 2].forEach((row, j) => [...row].forEach((ch, q) => { if (ch !== ".") set(c, x + q, y + j, ch); }));
  });
  return c;
}

const rest = (n) => Array(n).fill(0);
for (const [key, L] of Object.entries(LAYOUTS)) {
  const P = `mascot-${key}`;
  one(`${P}-back`, bedBack(L));
  one(`${P}-front`, bedFront(L));
  // breathing: 12 levels, up then down (2 s)
  save(`${P}-body`, Array.from({ length: 12 }, (_, i) => text(catBody(L, i / 11))), [...Array(12).keys(), ...[...Array(12).keys()].reverse()]);
  // leaf rocks (4 s) and the tail lifts now and then
  const tl = Array.from({ length: 48 }, (_, s) => {
    const v = R(1.6 * Math.sin((2 * PI * s) / 48)); // -2..2 -> tips lift opposite ways
    const fl = s >= 30 && s < 40 ? [0, 0.4, 0.8, 1, 1, 0.8, 0.5, 0.3, 0.1, 0][s - 30] : 0;
    return [v, R(fl * 4) / 4];
  });
  saveSeq(`${P}-tail`, tl, (v, p) => tailLayer(L, v, p));
  // ears: left ear flicks (4 s)
  const ea = rest(48); [1, 2, 2, 1, 0, 0, 1, 2, 1].forEach((v, i) => { ea[(34 + i) % 48] = v; });
  saveSeq(`${P}-ears`, Array.from({ length: 48 }, (_, s) => [ea[s] / 2]), (a) => earsLayer(L, a));
  save(`${P}-hearts`, Array.from({ length: L.leaves.n }, (_, k) => text(zzLayer(L, k))));
  save(`${P}-sparks`, Array.from({ length: 24 }, (_, k) => text(sparkLayer(L, k, 24))));
}
console.log("Mint sprites written to", outDir);
