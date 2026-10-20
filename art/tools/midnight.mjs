// Generates ALL sprites of Midnight into art/themes/midnight/sprites/.
// Run from the project root:  node art/tools/midnight.mjs   (then: pnpm assets:build)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canvas, dome, inEllipse, maskHeight, puffs, set, shape, stamp, text, tone } from "./px.mjs";
import { sparkles } from "./mascot.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "themes", "midnight", "sprites");
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

// ---------- palette groups ----------
const CLOUD = ["f", "g", "v", "x"];
const CLOUD_BACK = ["g", "v", "x", "x"];           // night clouds (outline e)
const FAINT = ["F", "e", "l", "l"];           // faint clouds of the title strip (outline E)
const CAT = ["j", "k", "o", "n"];             // black cat (outline m)
const MOON = ["z", "y", "N", "w"];            // moon / stars (outline Z)

// ---------- shape helpers ----------
const poly = (pts) => (x, y) => {
  let inside = false;
  const px = x + 0.5, py = y + 0.5;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const starPts = (cx, cy, R, r) => Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R;
  return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
});
function star(c, cx, cy, R, r, opts = {}) {
  const m = poly(starPts(cx, cy, R, r));
  shape(c, { mask: m, height: maskHeight(m, c[0].length, c.length, 1.2), tones: MOON, outline: "Z", dither: 0.3, ...opts });
}
/** Crescent = outer disc minus a shifted disc, lit from the top-left like a sphere slice. */
function crescent(c, cx, cy, R, cutX, cutY, cutR, opts = {}) {
  const out = inEllipse(cx, cy, R, R), cut = inEllipse(cutX, cutY, cutR, cutR);
  shape(c, { mask: (x, y) => out(x, y) && !cut(x, y), height: dome(cx, cy, R, R, 1.1), tones: MOON, outline: "Z", dither: 0.45, ...opts });
}
const dots = (c, list, ch) => list.forEach(([x, y]) => set(c, x, y, ch));
const cross5 = (c, x, y, ch = "y", mid = "w") => { for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) set(c, x + dx, y + dy, dx || dy ? ch : mid); };
const flip = (c) => c.map((r) => [...r].reverse());
const merge = (...layers) => { const out = canvas(layers[0][0].length, layers[0].length); for (const l of layers) l.forEach((r, y) => r.forEach((ch, x) => { if (ch !== ".") out[y][x] = ch; })); return out; };

// ---------- small icons ----------
{ const c = canvas(8, 7); crescent(c, 3.5, 3.6, 3.5, 5.4, 2.5, 2.9, { outline: null, dither: 0.3 }); set(c, 6, 5, "y"); one("heart-8", c); }
{ const c = canvas(9, 8); crescent(c, 3.9, 4, 3.9, 6.2, 2.7, 3.3, { outline: null, dither: 0.3 }); sparkleDot(c, 7, 5); one("deco-heart", c); }
function sparkleDot(c, x, y) { set(c, x, y, "w"); set(c, x - 1, y, "y"); set(c, x + 1, y, "y"); set(c, x, y - 1, "y"); set(c, x, y + 1, "y"); }
{ // simple corner: a 3x3 star and two sparkles, all inside the 3 px padding of the panel
  const c = canvas(7, 7);
  stamp(c, [".y.", "yyy", ".y."], 0, 0);
  set(c, 1, 1, "w");
  set(c, 4, 1, "h"); set(c, 1, 4, "h");
  one("corner-7", c);
}
{ const c = canvas(5, 5); stamp(c, ["..y..", ".yyy.", "yyyyy", ".yyy.", ".y.y."], 0, 0); set(c, 2, 1, "N"); one("nav-heart", c); }
{ const c = canvas(5, 5); stamp(c, ["..w..", ".www.", "wwwww", ".www.", ".w.w."], 0, 0); one("nav-heart-on", c); }

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
  normal: { outline: "s", fill: "l", hi: "g", lo: "u" },
  hover: { outline: "s", fill: "L", hi: "v", lo: "f" },
  pressed: { outline: "s", fill: "a", hi: "h", lo: "U" },
  disabled: { outline: "q", fill: "p", hi: "q", lo: "p" },
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
  const ring = (d) => (d < 1.5 ? "s" : d < 2.5 ? "g" : d < 3.5 ? "l" : d < 4.5 ? "q" : "p");
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
const TW = 64, TH = 22;
function titleMid(k) {
  const c = canvas(TW, TH);
  dots(c, [[2, 3], [9, 6], [58, 3], [61, 9], [47, 2], [18, 1]], "h");
  // moon first, the cloud bank covers its lower edge
  crescent(c, 31, 8.5, 8.6, 36, 7, 7);
  star(c, 38.5, 8.8, 4.4, 1.9, { outline: null, dither: 0.2 });
  puffs(c, [[5, 19, 5], [12, 17, 6], [19, 19, 5.5], [26, 20, 5], [32, 21, 6], [38, 20, 5], [45, 19, 5.5], [52, 17, 6], [59, 19, 5]],
    { tones: CLOUD, outline: "e", crease: "e", dither: 0.45, openBottom: true });
  const tw = (x, y, ph) => { const t = (k + ph) % 12; if (t === 0 || t === 6) set(c, x, y, "w"); if (t >= 1 && t <= 5) cross5(c, x, y); };
  tw(6, 11, 0); tw(57, 11, 5); tw(14, 6, 8); tw(49, 7, 3);
  const g = k % 12; // glint on the star inside the crescent
  if (g >= 2 && g <= 4) cross5(c, 38, 8, "w", "w");
  // shooting star crosses every 4 s
  if (k >= 20 && k <= 29) {
    const p = (k - 20) / 9, hx = Math.round(63 - p * 20), hy = Math.round(1 + p * 8);
    for (let i = 1; i <= 7; i++) set(c, hx + i, hy - Math.round(i * 0.45), i < 3 ? "x" : i < 5 ? "v" : "g");
    cross5(c, hx, hy, "y", "w");
  }
  return c;
}
save("title-heart", Array.from({ length: 48 }, (_, k) => text(titleMid(k))));
{ const c = canvas(9, 8); star(c, 4.5, 4.4, 4.5, 1.9, { outline: null, dither: 0.2 }); one("title-heart-s", c); }
{
  // seamless faint strip: clouds along the bottom plus dim stars above
  const W = 128, H = 12, c = canvas(W, H);
  const base = [[8, 10, 5], [16, 8, 6], [26, 10, 5], [38, 9, 6], [49, 11, 5], [60, 9, 6], [70, 7, 5], [78, 10, 5], [90, 9, 6], [101, 11, 5], [112, 8, 6], [121, 10, 5]];
  const circles = [];
  for (const [x, y, r] of base) for (const o of [-W, 0, W]) circles.push([x + o, y + 2, r]);
  puffs(c, circles, { tones: FAINT, outline: "E", crease: "F", dither: 0.3, openBottom: true });
  for (const [x, y] of [[4, 2], [21, 4], [34, 1], [55, 3], [66, 1], [84, 3], [97, 1], [118, 3]]) if (c[y][x] === ".") set(c, x, y, "g");
  for (const [x, y] of [[12, 3], [45, 2], [76, 2], [108, 2]]) if (c[y][x] === ".") set(c, x, y, "v");
  one("title-clouds", c);
}

// ---------- knobs ----------
const tailMusic = [[4, 4, "x"], [3, 3, "v"], [4, 3, "v"], [3, 4, "v"], [2, 2, "g"], [1, 1, "l"], [2, 3, "g"], [3, 2, "g"], [0, 0, "s"]];
function knobMusic(variant) {
  const c = canvas(11, 11);
  const tails = [tailMusic, tailMusic.slice(0, 8), tailMusic.slice(0, 7), tailMusic.slice(0, 6)];
  for (const [x, y, ch] of tails[variant % 4]) set(c, x, y, ch);
  star(c, 6.6, 6.6, 4.7, 2.1, { outline: null, dither: 0.25 });
  return c;
}
one("knob-music", knobMusic(0));
{
  const c = knobMusic(0);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (c[y][x] === "y") c[y][x] = "N"; else if (c[y][x] === "z") c[y][x] = "y";
  set(c, 10, 0, "w"); set(c, 6, 0, "y"); set(c, 10, 4, "y"); set(c, 0, 8, "h");
  one("knob-music-drag", c);
}
saveSeq("knob-music-beat", [0, 0, 1, 2, 3, 2, 1, 0, 1, 2, 1, 0].map((v) => [v]), knobMusic);
{ // falling star: vertical tail
  const c = canvas(9, 8);
  dots(c, [[4, 0]], "l"); dots(c, [[4, 1]], "g");
  star(c, 4.5, 4.9, 3.9, 1.8, { outline: null, dither: 0.25 });
  one("knob-download", c);
}
{ const c = canvas(9, 8); crescent(c, 3.8, 4.2, 3.8, 6, 2.9, 3.2, { outline: null, dither: 0.3 }); sparkleDot(c, 7, 2); one("knob-volume", c); }

// ---------- cover: moon over clouds, full sky ----------
{
  const W = 30, c = canvas(W, W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) c[y][x] = tone(["b", "p", "q", "s"], Math.min(1, y / 22), x, y, 0.45);
  dots(c, [[3, 3], [9, 2], [24, 3], [27, 9], [5, 11], [21, 12], [13, 5], [28, 15]], "h");
  dots(c, [[6, 6], [25, 6], [2, 15]], "y");
  crescent(c, 15.5, 10.5, 8.4, 19.4, 8.2, 6.3);
  dots(c, [[11, 11], [12, 8], [11, 14]], "z");
  star(c, 22.5, 10.5, 3.2, 1.4, { outline: null, dither: 0.2 });
  const cl = canvas(W, 13);
  puffs(cl, [[4, 9, 5], [11, 8, 6], [19, 8, 7], [26, 9, 5], [15, 12, 7]], { tones: CLOUD, outline: "e", crease: "e", openBottom: true, openLeft: true, openRight: true });
  stamp(c, text(cl), 0, 17);
  one("cover-ph-30", c);
  const L = { W, H: W, sparks: [[4, 5], [25, 4], [27, 13], [19, 20]] };
  save("cover-shine", Array.from({ length: 12 }, (_, k) => text(sparkles(L, k, 12))));
}

// ---------- mascot: two black cats sleeping on clouds, same canvas per layer ----------
const R = Math.round;
const tri = (a, b, c) => (x, y) => {
  const p = [x + 0.5, y + 0.5];
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
// Cat R (right one) is drawn facing left; the left cat is its mirror image.
const LAYOUTS = {
  full: {
    W: 70, H: 50, S: 1,
    head: { cx: 44, cy: 34.5, rx: 9.5, ry: 7.8 }, body: { cx: 57, cy: 39.5, rx: 10.5, ry: 6.6 },
    paws: [[40.5, 42], [47.5, 42]], pawR: [3.2, 1.8], eyeDx: 4, earH: 5,
    tail: [[66.5, 39.5], [69.4, 43], [66, 47], [60, 47.5]], tailR: 1.7,
    back: [[7, 36, 6], [14, 33, 5.5], [4, 42, 5], [63, 35, 6], [56, 33, 5.5], [66, 42, 5], [35, 38, 13], [25, 35, 7], [45, 35, 8]],
    front: [[8, 46, 6], [17, 48, 6], [27, 49, 6], [36, 50, 6.5], [46, 49, 6.5], [56, 48, 6], [64, 46, 5]],
    moon: { cx: 35, cy: 10, R: 8.3, kx: 4.6, ky: -2.4, kr: 6.8 },
    stars: [[6, 24], [63, 22], [14, 14], [56, 9], [26, 6], [47, 4], [3, 33], [67, 32]],
    z: { x: 47, y: 24, top: 8 }, sparks: [[8, 6], [20, 12], [50, 14], [62, 4], [67, 26], [4, 27]],
  },
  compact: {
    W: 70, H: 28, S: 0.62,
    head: { cx: 42, cy: 16.5, rx: 6.8, ry: 5.6 }, body: { cx: 53, cy: 20, rx: 7.8, ry: 4.4 },
    paws: [[39, 23], [44.3, 23]], pawR: [2.4, 1.4], eyeDx: 3, earH: 3.5,
    tail: [[60, 20], [64, 22.5], [62, 25.5], [56, 26]], tailR: 1.25,
    back: [[10, 19, 5], [16, 17, 4], [60, 19, 5], [54, 17, 4], [35, 20, 9]],
    front: [[8, 25, 5], [15, 27, 5], [23, 28, 5], [31, 28, 5], [39, 28, 5], [47, 28, 5], [55, 27, 5], [62, 25, 4]],
    moon: { cx: 35, cy: 5.6, R: 4.4, kx: 2.5, ky: -1.3, kr: 3.6 },
    stars: [[6, 8], [63, 7], [14, 4], [56, 3]],
    z: { x: 44, y: 9, top: 2 }, sparks: [[6, 5], [22, 3], [49, 4], [66, 10]],
  },
};

function bedBack(L) {
  const c = canvas(L.W, L.H);
  puffs(c, L.back, { tones: CLOUD_BACK, outline: "e", crease: "e", openBottom: true });
  dots(c, L.stars, "h");
  const m = L.moon;
  crescent(c, m.cx, m.cy, m.R, m.cx + m.kx, m.cy + m.ky, m.kr);
  return c;
}
function bedFront(L) {
  const c = canvas(L.W, L.H);
  puffs(c, L.front, { tones: CLOUD, outline: "e", crease: "e", openBottom: true });
  return c;
}
/** One cat (right side, facing left): body + head + paws + sleeping face. b in 0..1 = breath. */
function catR(L, b) {
  const c = canvas(L.W, L.H);
  const { head, body } = L;
  const hy = head.cy - b * 0.6 * L.S, by = body.cy - b * 0.5 * L.S, bry = body.ry + b * 0.7 * L.S;
  shape(c, { mask: inEllipse(body.cx, by, body.rx, bry), height: dome(body.cx, by, body.rx, bry, 1.1), tones: CAT, outline: "m", dither: 0.35, spec: { at: 0.94, ch: "n" } });
  shape(c, { mask: inEllipse(head.cx, hy, head.rx, head.ry), height: dome(head.cx, hy, head.rx, head.ry, 1.0), tones: CAT, outline: "m", dither: 0.4, spec: { at: 0.95, ch: "n" } });
  for (const [px, py] of L.paws) shape(c, { mask: inEllipse(px, py, L.pawR[0], L.pawR[1]), height: dome(px, py, L.pawR[0], L.pawR[1], 1.2), tones: CAT, outline: "m", dither: 0.3 });
  const cx = R(head.cx), ey = R(hy + head.ry * 0.12), ed = L.eyeDx;
  const eye = (x0) => [[0, 0], [1, 1], [2, 0]].forEach(([dx, dy]) => set(c, x0 + dx - 1, ey + dy, "h"));
  eye(cx - ed); eye(cx + ed);
  const ny = ey + (L.S === 1 ? 3 : 2);
  set(c, cx - 1, ny, "r"); set(c, cx, ny, "r");
  return c;
}
function earsR(L, flick) {
  const c = canvas(L.W, L.H);
  const { head } = L, hy = head.cy, eh = L.earH;
  const ty = hy - head.ry - eh * 0.75;
  const defs = [-1, 1].map((sg) => {
    const f = sg > 0 ? flick : 0; // the outer ear flicks
    return [
      [head.cx + sg * head.rx * 0.97, hy - head.ry * 0.28],
      [head.cx + sg * head.rx * 0.74 + f * 1.2, ty + f * 1.4],
      [head.cx + sg * head.rx * 0.18, hy - head.ry * 0.9],
    ];
  });
  for (const [a, b, d] of defs) {
    const m = tri(a, b, d);
    shape(c, { mask: m, height: maskHeight(m, L.W, L.H, 0.7), tones: CAT, outline: "m", dither: 0.3 });
    const cxm = (a[0] + b[0] + d[0]) / 3, cym = (a[1] + b[1] + d[1]) / 3, k = 0.5;
    const inner = tri([cxm + (a[0] - cxm) * k, cym + (a[1] - cym) * k], [cxm + (b[0] - cxm) * k, cym + (b[1] - cym) * k - 0.5], [cxm + (d[0] - cxm) * k, cym + (d[1] - cym) * k]);
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (inner(x, y) && c[y][x] !== "." && c[y][x] !== "m") c[y][x] = "r";
  }
  return c;
}
function tailR(L, p) {
  const c = canvas(L.W, L.H);
  const pts = L.tail.map(([x, y], i) => [x, i === L.tail.length - 1 ? y - p * 3.2 * L.S : i === L.tail.length - 2 ? y - p * 1.2 * L.S : y]);
  const circles = [], N = 26;
  for (let k = 0; k <= N; k++) {
    const t = k / N, u = 1 - t, [a, b, d, e] = pts;
    circles.push([u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * d[0] + t ** 3 * e[0], u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * d[1] + t ** 3 * e[1], L.tailR * (1.15 - 0.25 * t)]);
  }
  const ins = circles.map(([x, y, r]) => inEllipse(x, y, r, r));
  shape(c, {
    mask: (x, y) => ins.some((f) => f(x, y)),
    height: (x, y) => Math.max(0, ...circles.map(([cx, cy, r]) => dome(cx, cy, r, r, 1)(x, y))),
    tones: CAT, outline: "m", dither: 0.5,
  });
  return c;
}
/** zZ drifting up from each head. */
function zzLayer(L, k, n) {
  const c = canvas(L.W, L.H);
  const z3 = ["hhhh", "..h.", ".h..", "hhhh"], Z5 = ["wwwww", "...w.", "..w..", ".w...", "wwwww"];
  const rise = L.z.y - L.z.top;
  for (const [side, off] of [[1, 0], [-1, n / 2]]) {
    const t = ((k + off) % n) / n;
    const y = R(L.z.y - t * rise), sway = R(1.4 * Math.sin(t * 6.3));
    if (t >= 0.9) continue;
    const g = L.S === 1 && t >= 0.4 ? Z5 : z3;
    const gw = g[0].length;
    const x = side > 0 ? L.z.x + sway : L.W - L.z.x - gw - sway;
    stamp(c, g, x, y);
  }
  return c;
}

const lev = (s) => R((s < 12 ? s / 11 : (23 - s) / 11) * 11);
const rest = (n) => Array(n).fill(0);
for (const [key, L] of Object.entries(LAYOUTS)) {
  const P = `mascot-${key}`;
  one(`${P}-back`, bedBack(L));
  one(`${P}-front`, bedFront(L));
  const pair = (fnR) => (la, lb) => merge(flip(fnR(la)), fnR(lb));
  // breathing: 2 s, the left cat a third of a cycle behind
  saveSeq(`${P}-body`, Array.from({ length: 24 }, (_, s) => [lev(s), lev((s + 8) % 24)]), pair((v) => catR(L, v / 11)));
  // tails: each cat swishes at its own moment (4 s)
  const tl = (start) => { const a = [...rest(48)]; [1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1].forEach((v, i) => { a[(start + i) % 48] = v; }); return a; };
  const ta = tl(14), tb = tl(36);
  saveSeq(`${P}-tail`, Array.from({ length: 48 }, (_, s) => [ta[s], tb[s]]), pair((v) => tailR(L, v / 7)));
  // ears flick (4 s)
  const fl = (start) => { const a = [...rest(48)]; [1, 2, 2, 1, 0, 0, 1, 2, 1].forEach((v, i) => { a[(start + i) % 48] = v; }); return a; };
  const ea = fl(40), eb = fl(18);
  saveSeq(`${P}-ears`, Array.from({ length: 48 }, (_, s) => [ea[s], eb[s]]), pair((v) => earsR(L, v / 2)));
  save(`${P}-hearts`, Array.from({ length: 36 }, (_, k) => text(zzLayer(L, k, 36))));
  save(`${P}-sparks`, Array.from({ length: 24 }, (_, k) => text(sparkles(L, k, 24))));
}
console.log("Midnight sprites written to", outDir);
