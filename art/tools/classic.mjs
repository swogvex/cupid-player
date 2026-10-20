// Generates ALL sprites of Classic into art/themes/classic/sprites/.
// Run from the project root:  node art/tools/classic.mjs   (then: pnpm assets:build)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canvas, dome, inEllipse, maskHeight, puffs, set, shape, stamp, text, tone } from "./px.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "themes", "classic", "sprites");

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


// ---------- palette groups (letters live in art/themes/classic/theme.json) ----------
const ROSE = ["e", "f", "g", "G"];          // rose petals, outline E
const LEAF = ["u", "v", "x", "z"];          // sage leaves, outline V
const FUR = ["j", "k", "n", "o"];           // grey tabby fur, outline m
const STRIPE = ["c", "C", "C", "J"];        // tabby stripes
const WHITE = ["Q", "R", "w", "w"];         // white muzzle / paws / porcelain

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
/** A pointed leaf from base (bx,by) along unit direction d, total length len. Widest near the base, with a midrib. */
function bigLeaf(c, bx, by, d, len, rw, o = {}) {
  const W = c[0].length, H = c.length, outline = o.outline ?? "V";
  const mask = (x, y) => {
    const px = x + 0.5 - bx, py = y + 0.5 - by, a = px * d[0] + py * d[1], b = -px * d[1] + py * d[0];
    if (a < 0 || a > len) return false;
    const u = a / len;
    return Math.abs(b) <= rw * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.85);
  };
  shape(c, { mask, height: maskHeight(mask, W, H, 1.1), tones: o.tones ?? LEAF, outline, dither: 0.3 });
  for (let t = 1; t < len * 0.86; t += 0.5) {
    const x = FL(bx + d[0] * t), y = FL(by + d[1] * t);
    if (c[y]?.[x] && c[y][x] !== "." && c[y][x] !== outline) c[y][x] = o.vein ?? "u";
  }
}


/** Leaf frond: a stalk with pairs of leaves, getting smaller towards the tip. pts = [start, control, tip]. */
function leafSpray(c, pts, o = {}) {
  const { sway = 0, n = 5, t0 = 0.16, leafW = 1.5, leafL = 3.4, angle = 50, taper = 0.5, pairs = true, tones = LEAF, outline = "V", stalk = "V" } = o;
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

// ---------- roses and buds ----------
/** Top-view rose: outer ring of 6 petals, 5 inside, a tight curl in the middle (small ones: 5 + 3). */
function rose(c, cx, cy, Rr, rotDeg = -90, o = {}) {
  const ring = (n, dist, pr, rd) => Array.from({ length: n }, (_, i) => { const a = ((rd + (i * 360) / n) * PI) / 180; return [cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, pr]; });
  const opt = { tones: o.tones ?? ROSE, outline: o.outline ?? "E", crease: o.crease === undefined ? "e" : o.crease, dither: 0.25 };
  if (Rr >= 6) {
    puffs(c, ring(6, Rr * 0.64, Rr * 0.38, rotDeg), opt);
    puffs(c, ring(5, Rr * 0.36, Rr * 0.33, rotDeg + 20), opt);
    puffs(c, ring(3, Rr * 0.14, Rr * 0.24, rotDeg + 50), opt);
  } else {
    puffs(c, ring(5, Rr * 0.58, Rr * 0.48, rotDeg), opt);
    puffs(c, ring(3, Rr * 0.2, Rr * 0.36, rotDeg + 40), opt);
  }
}
/** Rosebud pointing along d: pink egg with a calyx of two leaves. */
function bud(c, cx, cy, h, w, d = [0, -1]) {
  blob(c, cx, cy, w / 2, h / 2, d, { tones: ROSE, outline: "E", dither: 0.3 });
  const bx = cx - d[0] * (h / 2 - 0.2), by = cy - d[1] * (h / 2 - 0.2), pp = [-d[1], d[0]];
  for (const s of [-1, 1]) set(c, R(bx + pp[0] * s * 1.1), R(by + pp[1] * s * 1.1), "u");
  set(c, R(bx), R(by), "V");
}
/** Five-petal tiny flower with a gold centre. */
function flower(c, cx, cy, ring, pr, rotDeg = -90, { tones = ROSE, outline = "E", crease = "e", centre = ["Y", "y"] } = {}) {
  const circles = Array.from({ length: 5 }, (_, i) => { const a = ((rotDeg + i * 72) * PI) / 180; return [cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, pr]; });
  puffs(c, circles, { tones, outline, crease, dither: 0.3 });
  const x = FL(cx), y = FL(cy);
  if (centre) { set(c, x, y, centre[1]); for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) set(c, x + dx, y + dy, centre[0]); }
}

// ---------- small icons ----------
one("heart-8", stamp(canvas(8, 7), ["..EEEE..", ".EGggfE.", "EGgfffeE", "EgfEEfeE", "EffeEfeE", ".EefffE.", "..EEEE.."], 0, 0));
{ // corner: a 3x3 rosette and two gold glints, all inside the 3 px padding of the panel
  const c = canvas(7, 7);
  stamp(c, [".g.", "gfg", ".g."], 0, 0);
  set(c, 1, 1, "G"); set(c, 4, 1, "y"); set(c, 1, 4, "y");
  one("corner-7", c);
}
one("nav-heart", stamp(canvas(5, 5), [".EEE.", "EGgfE", "EgfeE", ".EEE.", "..V.."], 0, 0));
one("nav-heart-on", stamp(canvas(5, 5), [".www.", "wGwGw", "wwGww", ".www.", "..w.."], 0, 0));

// ---------- 9-slice frames: panel, buttons, round buttons ----------
const BTN = {
  normal: { outline: "s", fill: "q", hi: "w", lo: "P" },
  hover: { outline: "s", fill: "p", hi: "w", lo: "M" },
  pressed: { outline: "s", fill: "a", hi: "h", lo: "F" },
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


// ---------- title: a big rose with leaves between two vines of buds ----------
const TW = 96, TH = 22;
/** One vine, drawn for the left side; the right side is the mirror image (x -> TW - x). */
function vine(c, sg, sw) {
  const X = (x) => (sg < 0 ? x : TW - x);
  const P = (pts) => pts.map(([x, y]) => [X(x), y]);
  const stem = (x, y0, y1) => { for (let y = y1; y <= y0; y++) set(c, X(x), y, "V"); };
  leafSpray(c, P([[40, 15], [27, 19.5], [6, 14 + sw * 0.3]]), { n: 5, t0: 0.12, leafW: 1.9, leafL: 4.6, angle: 52, taper: 0.4, pairs: false, sway: sg * -sw * 0.4 });
  leafSpray(c, P([[41, 12.5], [31, 8], [19, 8.5 + sw * 0.2]]), { n: 3, t0: 0.22, leafW: 1.6, leafL: 3.8, angle: 50, taper: 0.35, pairs: false, sway: sg * -sw * 0.3 });
  stem(29, 15, 10); bud(c, X(29), 7.5, 6, 4, [0, -1]);
  stem(14.5, 16, 12); bud(c, X(14.5), 9.5 + sw * 0.2, 5.4, 3.8, [sg * -0.2, -1]);
  rose(c, X(21.5), 15, 3.6, -90, {});
}
function titleMid(k, sw = 0, gl = -1) {
  const c = canvas(TW, TH);
  vine(c, -1, sw); vine(c, 1, sw);
  // two big leaves behind the rose
  bigLeaf(c, 48, 15, unit([-1, 0.35]), 15, 3.2);
  bigLeaf(c, 48, 15, unit([1, 0.35]), 15, 3.2);
  bigLeaf(c, 48, 13, unit([-0.8, -0.55]), 10, 2.4);
  bigLeaf(c, 48, 13, unit([0.8, -0.55]), 10, 2.4);
  rose(c, 48, 10, 8.6, -90 + sw);
  if (gl >= 0) { // glint sweeping over the petals
    for (let y = 0; y < 20; y++) for (let x = 38; x < 59; x++) {
      const v = x + y * 0.7 - (36 + gl * 2.6);
      if (v > -1.2 && v < 1.2 && ["f", "g", "G"].includes(c[y][x])) c[y][x] = "w";
    }
  }
  const tw = (x, y, ph) => { const t = (k + ph) % 12; if (t === 0 || t === 6) set(c, x, y, "y"); if (t >= 1 && t <= 5) cross5(c, x, y, "y", "w"); };
  tw(4, 17, 0); tw(91, 17, 6); tw(33, 3, 9); tw(62, 3, 3); tw(10, 3, 4); tw(85, 3, 10);
  return c;
}
{
  const GL = (k) => (k >= 16 && k < 28 ? k - 16 : -1);
  const SW = (k) => Math.round(Math.sin((2 * PI * k) / 48) * 2);
  saveSeq("title-heart", Array.from({ length: 48 }, (_, k) => [k % 12, SW(k), GL(k)]), titleMid);
}
{ // faint strip along the whole title bar: tiny rosebuds on stems, drifting leaves and gold glints (seamless)
  const W = 128, H = 12, c = canvas(W, H);
  const tiny = (x, baseY, h, lean) => {
    for (let i = 0; i < h; i++) set(c, x + R((lean * i) / h), baseY - i, "L");
    for (let i = 2; i < h; i += 2) { const bx = x + R((lean * i) / h), side = (i / 2) % 2 ? -1 : 1; set(c, bx + side, baseY - i, "L"); set(c, bx + side * 2, baseY - i - 1, "N"); }
    set(c, x + lean, baseY - h, "N"); set(c, x + lean, baseY - h - 1, "N"); set(c, x + lean - 1, baseY - h, "L"); set(c, x + lean + 1, baseY - h, "L");
  };
  const list = [[8, 9, 5, 1], [16, 11, 7, -1], [25, 9, 4, 1], [35, 11, 6, 1], [44, 10, 8, -1], [53, 11, 5, 1], [63, 9, 6, -1], [72, 11, 7, 1], [82, 10, 5, -1], [91, 11, 8, 1], [101, 9, 4, -1], [110, 11, 6, 1], [120, 10, 7, -1]];
  for (const [x, by, h, l] of list) tiny(x, by, h, l);
  dots(c, [[4, 2], [21, 4], [39, 1], [58, 3], [76, 2], [97, 4], [116, 2], [30, 6], [68, 5], [106, 7]], "N");
  dots(c, [[12, 5], [48, 3], [86, 4], [124, 5]], "L");
  one("title-clouds", c);
}

// ---------- small rose (divider, ambient button) and side flower ----------
{
  const c = canvas(9, 8);
  stamp(c, ["xu.....ux", ".VuVVVuV."], 0, 6);
  puffs(c, [[4, 2.6, 1.9], [2.7, 3.7, 1.7], [5.4, 3.8, 1.7], [4, 4.3, 1.8]], { tones: ROSE, outline: "E", crease: "e", dither: 0.3 });
  set(c, 4, 3, "E");
  one("deco-heart", c);
}
{ const c = canvas(9, 8); flower(c, 4.5, 4, 1.9, 1.7, -90, { crease: null }); one("title-heart-s", c); }

// ---------- knobs: a vinyl record that turns ----------
/** Vinyl of diameter 11. th = angle of the two gloss wedges (deg), mode: normal | drag. */
function vinyl(th = -135, strong = false) {
  const c = canvas(11, 11), cx = 5.5, cy = 5.5;
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
    if (r > 5.5) continue;
    if (r > 4.7) { c[y][x] = strong ? "d" : "m"; continue; }
    let ch = Math.round(r) % 2 === 0 ? "W" : "X";
    const a = (Math.atan2(dy, dx) * 180) / PI;
    for (const off of [0, 180]) { let da = Math.abs(((a - th - off + 540) % 360) - 180); if (da < 16 && r > 2.8) ch = da < 7 ? "J" : "C"; }
    if (r < 2.7) ch = strong ? "y" : "f";
    if (r < 0.8) ch = "w";
    c[y][x] = ch;
  }
  // label mark that turns with the record
  const mx = R(cx - 0.5 + Math.cos((th * PI) / 180) * 1.6), my = R(cy - 0.5 + Math.sin((th * PI) / 180) * 1.6);
  set(c, mx, my, strong ? "Y" : "E");
  return c;
}
one("knob-music", vinyl(-135));
{ const c = vinyl(-135, true); dots(c, [[0, 0], [10, 1], [10, 9], [0, 10]], "y"); one("knob-music-drag", c); }
saveSeq("knob-music-beat", Array.from({ length: 12 }, (_, i) => [-135 + i * 30]), (th) => vinyl(th));
{ // volume: a rosebud on a short stalk with one leaf
  const c = canvas(9, 8);
  for (const [x, y] of [[4, 7], [4, 6], [4, 5], [3, 7]]) set(c, x, y, "V");
  blob(c, 6.6, 6, 1.5, 2.3, unit([0.9, -0.5]), { tones: LEAF, outline: "V", dither: 0.3 });
  bud(c, 4, 2.7, 5.4, 3.8, [0, -1]);
  cross5(c, 7, 1, "y", "w");
  one("knob-volume", c);
}
{ // download: an envelope sealed with wax; the seal glints now and then
  const env = (g) => {
    const c = canvas(9, 8);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) c[y][x] = y === 0 || y === 6 || x === 0 || x === 8 ? "s" : y === 5 ? "Q" : y > 3 ? "R" : "w";
    for (let i = 0; i < 4; i++) { set(c, 1 + i, 1 + i, "Q"); set(c, 7 - i, 1 + i, "Q"); }
    set(c, 1, 1, "R"); set(c, 7, 1, "R");
    stamp(c, [".E.", "EfE", ".E."], 3, 2); set(c, 4, 3, "f");
    set(c, 3, 3, "e"); set(c, 5, 3, "e");
    c[3][4] = g ? "w" : "g";
    if (g === 2) { set(c, 4, 2, "w"); set(c, 4, 4, "w"); }
    return c;
  };
  const tl = Array.from({ length: 20 }, () => [0]); tl.push([1], [2], [1], [0], [0], [0]);
  saveSeq("knob-download", tl, env);
}

// ---------- cover: a gramophone with roses ----------
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
  const W = 30, c = canvas(W, W);
  // damask wallpaper, a dado rail and a wooden table
  for (let y = 0; y < 25; y++) for (let x = 0; x < W; x++) c[y][x] = (x % 6 === 3 && y % 6 === 2) || (x % 6 === 0 && y % 6 === 5) ? "M" : y > 20 ? "P" : "H";
  for (let y = 25; y < W; y++) for (let x = 0; x < W; x++) c[y][x] = y === 25 ? "s" : y === 26 ? "h" : y < 28 ? "a" : (x + y) % 9 === 0 ? "W" : "F";
  // horn: a flared bell rising from the box, curving to the left
  const cxAt = (t) => 13.2 - t * 3.2, hwAt = (t) => 1.1 + Math.pow(t, 1.9) * 6.6;
  const hornMask = (x, y) => { if (y < 3 || y > 15) return false; const t = (15 - y) / 12; return Math.abs(x + 0.5 - cxAt(t)) <= hwAt(t); };
  shape(c, { mask: hornMask, height: maskHeight(hornMask, W, W, 1.1), tones: ["Y", "y", "Z", "Z"], outline: "d", dither: 0.4, bias: 0.2 });
  const mouth = inEllipse(cxAt(1), 4.4, hwAt(1) - 0.6, 1.9);
  for (let y = 2; y < 8; y++) for (let x = 0; x < W; x++) if (mouth(x, y)) c[y][x] = y === 3 ? "W" : "F";
  for (let x = 3; x < 19; x++) if (c[2][x] === "d" || c[2][x] === ".") { const e = inEllipse(cxAt(1), 4.4, hwAt(1), 2.4)(x, 2); if (e) c[2][x] = "d"; }
  dots(c, [[6, 4], [7, 3], [8, 3]], "Z");
  // box
  const bm = (x, y) => x >= 6 && x <= 23 && y >= 16 && y <= 25 && !((x === 6 || x === 23) && y === 16);
  shape(c, { mask: bm, height: maskHeight(bm, W, W, 0.9), tones: ["W", "F", "a", "h"], outline: "d", dither: 0.4, bias: 0.1 });
  for (let y = 19; y <= 23; y++) for (let x = 9; x <= 20; x++) c[y][x] = y === 19 || x === 9 ? "W" : "F";
  stamp(c, [".yy.", "yZZy", ".yy."], 13, 20);
  // turntable with a record on top of the box, and the arm
  puffs(c, [[14.5, 14.6, 6.2, 1.9]], { tones: ["X", "W", "W", "C"], outline: "d", crease: null, dither: 0.2 });
  set(c, 14, 14, "f"); set(c, 15, 14, "f");
  for (const [x, y] of [[22, 10], [21, 11], [20, 12], [19, 13], [18, 14]]) set(c, x, y, "Y");
  set(c, 22, 9, "y"); set(c, 23, 9, "y"); set(c, 18, 14, "Z");
  // roses at both ends of the table
  const ROSE7 = ["..EEE..", ".EGgGE.", "EGgffeE", "EgfEfeE", ".EfeeE.", "..EEE.."];
  for (const [x, y] of [[0, 19], [23, 19]]) {
    bigLeaf(c, x < 15 ? 6 : 23, y + 5, unit([x < 15 ? 1 : -1, -0.3]), 4, 1.2);
    stamp(c, ROSE7, x, y);
  }
  dots(c, [[27, 4], [2, 9], [5, 13]], "y");
  one("cover-ph-30", c);
}
{
  const W = 30, N = 48;
  const L = { W, H: W, sparks: [[4, 5], [26, 3], [27, 13], [9, 20], [21, 12]] };
  const petals = [[["g", "f"], ["f", "e"]], [["f", "."], [".", "e"]], [["g", "f"], ["e", "."]], [["f", "e"], [".", "e"]]];
  save("cover-shine", Array.from({ length: N }, (_, k) => {
    const c = sparkLayer(L, k % 24, 24);
    if (k >= 6 && k <= 41) { // a petal drifts across every 4 s
      const p = (k - 6) / 35, x = R(-4 + p * 36), y = R(5 + 4 * Math.sin(p * 8) + p * 10);
      petals[(k >> 1) % 4].forEach((row, j) => row.forEach((ch, i) => { if (ch !== ".") set(c, x + i, y + j, ch); }));
    }
    return text(c);
  }));
}

// ---------- mascot: a grey tabby sleeping on a stack of books, with a steaming cup and a candle ----------
const tri = (a, b, c) => (x, y) => {
  const p = [x + 0.5, y + 0.5];
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const LAYOUTS = {
  full: {
    W: 70, H: 50, S: 1,
    head: { cx: 24, cy: 20, rx: 11, ry: 9 }, body: { cx: 40, cy: 24.5, rx: 14, ry: 9.5 },
    paws: [[19, 31.5], [28, 32]], pawR: [3.4, 2.1], eyeDx: 5, eyeW: 5, earH: 7,
    tail: [[53, 26], [59, 28], [60, 34], [56, 38.5]],
    books: [
      { kind: "spine", x0: 9, x1: 59, y: 44, h: 6, tones: ["4", "5", "6"], bands: [13, 54], label: [27, 41] },
      { kind: "pages", x0: 12, x1: 56, y: 39, h: 6, tones: ["7", "8", "9"] },
      { kind: "spine", x0: 14, x1: 55, y: 34, h: 6, tones: ["A", "B", "1"], bands: [18, 50], label: [28, 40] },
    ],
    cup: { x: 61, y: 42, steamX: 64, steamY: 41, rise: 13, small: false },
    candle: { x: 2, top: 38, bottom: 47, flame: [3, 33] },
    rose: { x: 52.5, y: 44.5, r: 3.4 },
    zz: { x: 37, y: 14, top: 0 }, n: 36,
    sparks: [[6, 14], [57, 6], [62, 15], [67, 27], [9, 26], [30, 2]],
  },
  compact: {
    W: 70, H: 28, S: 0.62,
    head: { cx: 25, cy: 10, rx: 8, ry: 6 }, body: { cx: 38, cy: 13.5, rx: 11, ry: 5.6 },
    paws: [[22, 18.2], [29, 18.5]], pawR: [2.4, 1.5], eyeDx: 3, eyeW: 3, earH: 4,
    tail: [[48, 14], [53, 16], [53, 20], [50, 22]],
    books: [
      { kind: "spine", x0: 11, x1: 53, y: 23, h: 5, tones: ["4", "5", "6"], bands: [14, 48], label: [24, 38] },
      { kind: "pages", x0: 13, x1: 51, y: 19, h: 5, tones: ["7", "8", "9"] },
    ],
    cup: { x: 58, y: 22, steamX: 60, steamY: 21, rise: 9, small: true },
    candle: { x: 2, top: 19, bottom: 25, flame: [4, 15] },
    rose: { x: 46.5, y: 25.5, r: 2.7 },
    zz: { x: 39, y: 8, top: 0 }, n: 36,
    sparks: [[6, 10], [44, 3], [62, 8], [66, 18]],
  },
};

function drawBook(c, b) {
  const { x0, x1, y, h, tones: [lo, mid, hi] } = b, yb = y + h - 1;
  const corner = (x, yy) => (x === x0 || x === x1) && (yy === y || yy === yb);
  for (let yy = y; yy <= yb; yy++) for (let x = x0; x <= x1; x++) {
    if (corner(x, yy)) continue;
    let ch;
    if (yy === y || yy === yb || x === x0 || x === x1) ch = "d";
    else if (b.kind === "spine") ch = yy === y + 1 ? hi : yy === yb - 1 ? lo : mid;
    else if (x <= x0 + 2) ch = yy === y + 1 ? hi : yy === yb - 1 ? lo : mid;                       // spine edge
    else if (yy === y + 1) ch = mid;                                                                // top cover
    else if (yy === yb - 1) ch = lo;                                                                // bottom cover
    else ch = (yy - y) % 2 === 0 ? "0" : "3";                                                       // pages
    c[yy][x] = ch;
  }
  if (b.kind === "pages") { for (let x = x0 + 3; x < x1; x += 1) if ((x * 7) % 5 === 0 && h > 5) c[y + 3][x] = "2"; }
  if (b.kind === "spine") {
    for (const bx of b.bands) for (const dx of [0, 1]) for (let yy = y + 1; yy < yb; yy++) c[yy][bx + dx] = yy === y + 1 || yy === yb - 1 ? "Y" : "y";
    const [l0, l1] = b.label;
    for (let yy = y + 2; yy <= (h > 5 ? yb - 2 : yb - 2); yy++) for (let x = l0; x <= l1; x++) c[yy][x] = (x + yy) % 7 === 0 ? "2" : "3";
  }
}
function cupRows(small) {
  return small
    ? { cup: [".dddd..", "dRwQd..", "dwfQddd", ".dwQd.d", "..ddd.."], saucer: [".dRwQd.", "..ddd.."] }
    : { cup: [".ddddd...", "dRwwwQd..", "dRwfwQddd", "dwwwwQd.d", ".dwwQQdd.", "..dddd..."], saucer: [".dRwwwwQd", "..ddddd.."] };
}
function bedBack(L) {
  const c = canvas(L.W, L.H);
  // candle: brass dish, wax with a drip, wick
  const { candle: cd } = L, big = L.S === 1;
  const x0 = cd.x + (big ? 1 : 1);
  const wax = (y) => y === cd.bottom ? "d022d" : y === cd.top ? ".ddd." : y === cd.top + 3 && big ? "d033d" : "d032d";
  for (let y = cd.top; y <= cd.bottom; y++) stamp(c, [wax(y)], x0, y);
  set(c, x0 + 2, cd.top - 1, "d");
  if (big) { set(c, x0 + 4, cd.top + 4, "3"); set(c, x0 + 4, cd.top + 5, "3"); }
  stamp(c, [big ? "dZyyyYd" : "dZyYd", big ? ".ddddd." : ".ddd."], x0 - (big ? 1 : 0), cd.bottom + 1 - (big ? 0 : 0));
  // books, bottom to top
  for (const b of [...L.books]) drawBook(c, b);
  // cup and saucer
  const { cup: cu } = L, rows = cupRows(cu.small);
  stamp(c, rows.cup, cu.x, cu.y);
  stamp(c, rows.saucer, cu.x, L.H - 2);
  return c;
}
function bedFront(L) {
  const c = canvas(L.W, L.H);
  const { rose: r } = L;
  bigLeaf(c, r.x, r.y + 0.5, unit([-1, -0.25]), L.S === 1 ? 7 : 4, L.S === 1 ? 1.7 : 1.1);
  bigLeaf(c, r.x, r.y + 0.5, unit([1, -0.3]), L.S === 1 ? 5.5 : 3.4, L.S === 1 ? 1.5 : 1);
  rose(c, r.x, r.y, r.r, -90);
  return c;
}
const inPatch = (list) => { const fs = list.map(([cx, cy, rx, ry]) => inEllipse(cx, cy, rx, ry)); return (x, y) => fs.some((f) => f(x, y)); };
/** Cat body + head + paws + sleeping face. b in 0..1 = breath. */
function catBody(L, b) {
  const c = canvas(L.W, L.H);
  const { head, body } = L, S = L.S;
  const hy = head.cy - b * 0.5 * S, by = body.cy - b * 0.4 * S, bry = body.ry + b * 0.6 * S;
  const bx0 = Math.floor(body.cx - body.rx);
  const bodyStripe = (x, y) => {
    const dx = (x + 0.5 - body.cx) / body.rx, top = by - bry * Math.sqrt(Math.max(0, 1 - dx * dx));
    const len = (S === 1 ? 3 : 2) + ((x * 5) % 3) * (S === 1 ? 1 : 0.6);
    const m = (((x - bx0) % (S === 1 ? 4 : 3)) + 4) % (S === 1 ? 4 : 3);
    return m === 1 && y < top + len && x > body.cx - body.rx * 0.8;
  };
  shape(c, { mask: inEllipse(body.cx, by, body.rx, bry), height: dome(body.cx, by, body.rx, bry, 1.1), tones: (x, y) => (bodyStripe(x, y) ? STRIPE : FUR), outline: "m", dither: 0.35, bias: 0.15 });
  const muzzle = inEllipse(head.cx, hy + head.ry * 0.5, head.rx * 0.5, head.ry * 0.46);
  const hdx = (x) => Math.abs(x + 0.5 - head.cx);
  const headStripe = (x, y) =>
    (hdx(x) < 0.9 && y < hy - head.ry * 0.2) || (Math.abs(hdx(x) - (S === 1 ? 2.6 : 1.9)) < 0.6 && y < hy - head.ry * 0.45) ||
    (y >= hy + head.ry * 0.12 && y < hy + head.ry * 0.12 + (S === 1 ? 1.1 : 0.9) && hdx(x) > head.rx * 0.64);
  shape(c, {
    mask: inEllipse(head.cx, hy, head.rx, head.ry), height: dome(head.cx, hy, head.rx, head.ry, 1.0), outline: "m", dither: 0.4, bias: 0.15,
    tones: (x, y) => (muzzle(x, y) ? WHITE : headStripe(x, y) ? STRIPE : FUR),
  });
  for (const [px, py] of L.paws) {
    shape(c, { mask: inEllipse(px, py, L.pawR[0], L.pawR[1]), height: dome(px, py, L.pawR[0], L.pawR[1], 1.2), tones: WHITE, outline: "m", dither: 0.3, bias: 0.3 });
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
  for (const dx of [-(ed + 3), -(ed + 2), ed + 2, ed + 3]) if (c[by2]?.[cx + dx] && c[by2][cx + dx] !== "m") set(c, cx + dx, by2, "K");
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
    shape(c, { mask: m, height: maskHeight(m, L.W, L.H, 0.7), tones: FUR, outline: "m", dither: 0.3, bias: 0.15 });
    const cxm = (a[0] + b[0] + d[0]) / 3, cym = (a[1] + b[1] + d[1]) / 3, k = 0.52;
    const inner = tri([cxm + (a[0] - cxm) * k, cym + (a[1] - cym) * k], [cxm + (b[0] - cxm) * k, cym + (b[1] - cym) * k - 0.5], [cxm + (d[0] - cxm) * k, cym + (d[1] - cym) * k]);
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (inner(x, y) && c[y][x] !== "." && c[y][x] !== "m") c[y][x] = "r";
  });
  return c;
}
/** The cat's ringed tail flicks now and then (p in 0..1). */
function tailLayer(L, p) {
  const c = canvas(L.W, L.H);
  const pts = L.tail.map(([x, y], i) => [x + (i === L.tail.length - 1 ? p * 1.6 * L.S : 0), i === L.tail.length - 1 ? y - p * 3 * L.S : i === L.tail.length - 2 ? y - p * 1.2 * L.S : y]);
  const circles = [];
  const N = 26;
  for (let k = 0; k <= N; k++) { const q = bez3(pts, k / N); circles.push([q[0], q[1], (2.1 - 0.4 * (k / N)) * (L.S === 1 ? 1 : 0.7), k / N]); }
  const ins = circles.map(([x, y, r]) => inEllipse(x, y, r, r));
  const ring = (x, y) => {
    let best = 9, t = 0;
    for (const [cx, cy, , tt] of circles) { const dd = Math.hypot(x - cx, y - cy); if (dd < best) { best = dd; t = tt; } }
    return (t > 0.3 && t < 0.42) || (t > 0.58 && t < 0.7) || t > 0.86;
  };
  shape(c, {
    mask: (x, y) => ins.some((f) => f(x, y)), height: (x, y) => Math.max(0, ...circles.map(([cx, cy, r]) => dome(cx, cy, r, r, 1)(x, y))),
    tones: (x, y) => (ring(x, y) ? STRIPE : FUR), outline: "m", dither: 0.5, bias: 0.15,
  });
  return c;
}
/** Zs rise from the head, steam curls from the cup and the candle flame flickers. k in 0..n-1 */
const Z3 = ["sss", ".s.", "sss"], Z5 = ["sssss", "...s.", "..s..", ".s...", "sssss"];
const FLAME = [[".O.", "OyO", "yZy", ".y."], ["O..", "OyO", "yZy", ".y."], [".O.", ".yO", "yZy", ".y."], ["...", ".O.", "OyO", ".y."]];
const FSEQ = [0, 1, 0, 2, 0, 3];
function zzLayer(L, k) {
  const c = canvas(L.W, L.H), n = L.n;
  const rise = L.zz.y - L.zz.top;
  for (const [off, dx] of [[0, 0], [n / 2, 8]]) {
    const t = ((k + off) % n) / n;
    const y = R(L.zz.y - t * rise), x = L.zz.x + dx + R(1.6 * Math.sin(t * 6.3));
    if (t < 0.9) stamp(c, t < 0.4 ? Z3 : Z5, x, y);
  }
  const { cup: cu } = L;
  for (const [off, ph] of [[0, 0], [n / 2, 2.1]]) {
    const t = ((k + off) % n) / n;
    if (t > 0.88) continue;
    const head = cu.steamY - t * cu.rise;
    for (let j = 0; j < (L.S === 1 ? 5 : 3); j++) {
      const y = R(head + j);
      if (y > cu.steamY) continue;
      set(c, cu.steamX + R((L.S === 1 ? 1.5 : 1) * Math.sin((head + j) * 0.8 + ph)), y, j < 2 && t < 0.6 ? "U" : "T");
    }
  }
  const [fx, fy] = L.candle.flame, fl = FLAME[FSEQ[k % 6]];
  const x0 = fx + (L.S === 1 ? 0 : 0);
  fl.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== ".") set(c, x0 + i, fy + j, ch); }));
  return c;
}

const rest = (n) => Array(n).fill(0);
for (const [key, L] of Object.entries(LAYOUTS)) {
  const P = `mascot-${key}`;
  one(`${P}-back`, bedBack(L));
  one(`${P}-front`, bedFront(L));
  // breathing: 12 levels, up then down (2 s)
  save(`${P}-body`, Array.from({ length: 12 }, (_, i) => text(catBody(L, i / 11))), [...Array(12).keys(), ...[...Array(12).keys()].reverse()]);
  // the tail flicks now and then (4 s)
  const tl = Array.from({ length: 48 }, (_, s) => { const fl = s >= 30 && s < 40 ? [0, 0.4, 0.8, 1, 1, 0.8, 0.5, 0.3, 0.1, 0][s - 30] : 0; return [R(fl * 4) / 4]; });
  saveSeq(`${P}-tail`, tl, (p) => tailLayer(L, p));
  // ears: left ear flicks (4 s)
  const ea = rest(48); [1, 2, 2, 1, 0, 0, 1, 2, 1].forEach((v, i) => { ea[(34 + i) % 48] = v; });
  saveSeq(`${P}-ears`, Array.from({ length: 48 }, (_, s) => [ea[s] / 2]), (a) => earsLayer(L, a));
  save(`${P}-hearts`, Array.from({ length: L.n }, (_, k) => text(zzLayer(L, k))));
  save(`${P}-sparks`, Array.from({ length: 24 }, (_, k) => text(sparkLayer(L, k, 24))));
}
console.log("Classic sprites written to", outDir);
