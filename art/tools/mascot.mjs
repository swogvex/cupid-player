import { canvas, stamp, shape, dome, inEllipse, maskHeight, puffs, set } from "./px.mjs";

const PEACH = ["j", "k", "o", "n"], WHITE = ["v", "x", "w"];
const tri = (a, b, c) => (x, y) => {
  const p = [x + 0.5, y + 0.5];
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const R = Math.round;

/** Two variants drawn on a fixed canvas each; every layer uses the same canvas so they stack at (0,0). */
export const LAYOUTS = {
  full: {
    W: 70, H: 50, S: 1,
    head: { cx: 28, cy: 30, rx: 14, ry: 11 }, body: { cx: 47, cy: 36, rx: 15, ry: 10 },
    paws: [[21.5, 40.6], [32.5, 40.6]], pawR: [4.8, 2.7], eyeDx: 7, eyeW: 5, earH: 7,
    tail: [[61, 36], [67, 40], [63, 44], [54, 44.5]],
    back: [[8, 33, 7], [15, 30, 6], [6, 40, 6], [63, 34, 7], [56, 30, 6], [65, 40, 6], [35, 34, 14], [24, 32, 8], [46, 32, 9]],
    front: [[8, 45, 7], [17, 48, 7], [27, 49, 6], [36, 50, 7], [46, 49, 7], [56, 48, 7], [64, 45, 6]],
    bows: [[3, 6], [3, 15], [56, 6], [56, 15]],
    hearts: { x: 27, y: 17, top: 1 }, sparks: [[8, 4], [20, 11], [47, 7], [62, 3], [67, 26], [4, 27]],
  },
  compact: {
    W: 70, H: 28, S: 0.62,
    head: { cx: 30, cy: 14, rx: 9, ry: 7.2 }, body: { cx: 44, cy: 17, rx: 10.5, ry: 6.8 },
    paws: [[26.5, 20.2], [33.5, 20.2]], pawR: [3.3, 1.9], eyeDx: 4, eyeW: 3, earH: 4,
    tail: [[52, 17], [58, 19], [55, 23], [48, 23.6]],
    back: [[10, 19, 5], [16, 17, 4], [60, 19, 5], [54, 17, 4], [36, 19, 9]],
    front: [[8, 25, 5], [15, 27, 5], [23, 28, 5], [31, 28, 5], [39, 28, 5], [47, 28, 5], [55, 27, 5], [62, 25, 4]],
    bows: [[2, 8], [57, 8]],
    hearts: { x: 40, y: 6, top: 0 }, sparks: [[6, 6], [22, 3], [48, 5], [66, 10]],
  },
};

const bowRows = (() => {
  const half = [".sss..", "swwhs.", "shhhha", "shhhsa", ".sss.s"];
  return half.map((r) => r + [...r.slice(0, -1)].reverse().join(""));
})();

export function bedBack(L) {
  const c = canvas(L.W, L.H);
  puffs(c, L.back, { openBottom: true });
  for (const [x, y] of L.bows) stamp(c, bowRows, x, y);
  return c;
}
export function bedFront(L) {
  const c = canvas(L.W, L.H);
  puffs(c, L.front, { openBottom: true });
  return c;
}

/** Body + head + paws + face. b in 0..1 = breath. */
export function catBody(L, b) {
  const c = canvas(L.W, L.H);
  const { head, body } = L;
  const hy = head.cy - b * 0.6 * L.S, by = body.cy - b * 0.5 * L.S, bry = body.ry + b * 0.7 * L.S;
  const bm = inEllipse(body.cx, by, body.rx, bry);
  shape(c, { mask: bm, height: dome(body.cx, by, body.rx, bry, 1.1), tones: PEACH, outline: "m", dither: 0.3, spec: { at: 0.93, ch: "n" } });
  const hm = inEllipse(head.cx, hy, head.rx, head.ry);
  const muzzle = inEllipse(head.cx, hy + head.ry * 0.5, head.rx * 0.5, head.ry * 0.46);
  const blaze = (x, y) => Math.abs(x + 0.5 - head.cx) < head.rx * 0.13 + (y - hy + head.ry) * 0.06 && y < hy + head.ry * 0.3;
  shape(c, {
    mask: hm, height: dome(head.cx, hy, head.rx, head.ry, 1.0), outline: "m", dither: 0.4,
    tones: (x, y) => (muzzle(x, y) || blaze(x, y) ? WHITE : PEACH),
    spec: { at: 0.95, ch: "n", mask: (x, y) => !(muzzle(x, y) || blaze(x, y)) },
  });
  for (const [px, py] of L.paws) {
    const m = inEllipse(px, py, L.pawR[0], L.pawR[1]);
    shape(c, { mask: m, height: dome(px, py, L.pawR[0], L.pawR[1], 1.2), tones: WHITE, outline: "m", dither: 0.3 });
    if (L.S === 1) set(c, R(px), R(py) + 1, "m");
  }
  const cx = R(head.cx), ey = R(hy + head.ry * 0.05), ed = L.eyeDx;
  const eye = (x0) => {
    if (L.eyeW === 5) [[0, 0], [1, 1], [2, 1], [3, 1], [4, 0]].forEach(([dx, dy]) => set(c, x0 + dx - 2, ey + dy, "m"));
    else [[0, 0], [1, 1], [2, 0]].forEach(([dx, dy]) => set(c, x0 + dx - 1, ey + dy, "m"));
  };
  eye(cx - ed); eye(cx + ed);
  const ny = ey + (L.S === 1 ? 5 : 4);
  set(c, cx - 1, ny, "a"); set(c, cx, ny, "a"); set(c, cx + 1, ny, "a"); set(c, cx, ny + 1, "a");
  if (L.S === 1) { set(c, cx - 1, ny + 2, "m"); set(c, cx + 1, ny + 2, "m"); set(c, cx, ny + 1, "r"); }
  const by2 = ey + (L.S === 1 ? 4 : 3);
  for (const dx of [-(ed + 3), -(ed + 2), ed + 2, ed + 3]) if (c[by2]?.[cx + dx] && c[by2][cx + dx] !== "m") set(c, cx + dx, by2, "h");
  return c;
}

/** flick: 0..1. Ears are drawn over the head. */
export function ears(L, flick) {
  const c = canvas(L.W, L.H);
  const { head } = L, hy = head.cy, eh = L.earH;
  const ty = hy - head.ry - eh * 0.75;
  const defs = [-1, 1].map((sg) => {
    const f = sg < 0 ? flick : 0;
    return [
      [head.cx + sg * head.rx * 0.97, hy - head.ry * 0.28],
      [head.cx + sg * (head.rx * 0.74) - f * 1.2, ty + f * 1.4],
      [head.cx + sg * head.rx * 0.18, hy - head.ry * 0.9],
    ];
  });
  for (const [a, b, d] of defs) {
    const m = tri(a, b, d);
    shape(c, { mask: m, height: maskHeight(m, L.W, L.H, 0.7), tones: PEACH, outline: "m", dither: 0.3 });
    const cxm = (a[0] + b[0] + d[0]) / 3, cym = (a[1] + b[1] + d[1]) / 3;
    const k = 0.52;
    const inner = tri([cxm + (a[0] - cxm) * k, cym + (a[1] - cym) * k], [cxm + (b[0] - cxm) * k, cym + (b[1] - cym) * k - 0.5], [cxm + (d[0] - cxm) * k, cym + (d[1] - cym) * k]);
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (inner(x, y) && c[y][x] !== "." && c[y][x] !== "m") c[y][x] = "h";
  }
  return c;
}

/** p in 0..1: tail tip lifts. */
export function tail(L, p) {
  const c = canvas(L.W, L.H);
  const pts = L.tail.map(([x, y], i) => [x, i === L.tail.length - 1 ? y - p * 3.2 * L.S : i === L.tail.length - 2 ? y - p * 1.2 * L.S : y]);
  const circles = [];
  const N = 26;
  for (let k = 0; k <= N; k++) {
    const t = k / N, u = 1 - t;
    const [a, b, d, e] = pts;
    const x = u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * d[0] + t ** 3 * e[0];
    const y = u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * d[1] + t ** 3 * e[1];
    circles.push([x, y, (2.1 - 0.5 * t) * (L.S === 1 ? 1 : 0.7), t]);
  }
  const ins = circles.map(([x, y, r]) => inEllipse(x, y, r, r));
  const mask = (x, y) => ins.some((f) => f(x, y));
  const hgt = (x, y) => Math.max(0, ...circles.map(([cx, cy, r]) => dome(cx, cy, r, r, 1)(x, y)));
  const whiteAt = (x, y) => {
    let best = 9, t = 0;
    for (const [cx, cy, , tt] of circles) { const d = Math.hypot(x - cx, y - cy); if (d < best) { best = d; t = tt; } }
    return t > 0.8;
  };
  shape(c, { mask, height: hgt, tones: (x, y) => (whiteAt(x, y) ? WHITE : PEACH), outline: "m", dither: 0.6 });
  return c;
}

/** Hearts floating up from the head. k in 0..n-1 */
export function floatingHearts(L, k, n) {
  const c = canvas(L.W, L.H);
  const H3 = ["a.a", "aaa", ".a."], H5 = [".a.a.", "ahaaa", "aaaaa", ".aaa.", "..a.."];
  const rise = L.hearts.y - L.hearts.top;
  for (const [off, dx] of [[0, 0], [n / 2, 9]]) {
    const t = ((k + off) % n) / n;
    const y = R(L.hearts.y - t * rise), x = L.hearts.x + dx + R(1.6 * Math.sin(t * 6.3));
    if (t < 0.9) stamp(c, t < 0.35 ? H3 : H5, x, y);
  }
  return c;
}

/** Twinkling sparkles: each one has its own phase. */
export function sparkles(L, k, n) {
  const c = canvas(L.W, L.H);
  L.sparks.forEach(([x, y], i) => {
    const t = ((k + i * 5) % n) / n;
    const s = t < 0.15 ? 0 : t < 0.3 ? 1 : t < 0.55 ? 2 : t < 0.7 ? 1 : 0;
    if (s === 1) set(c, x, y, "y");
    if (s === 2) for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) set(c, x + dx, y + dy, dx || dy ? "y" : "w");
  });
  return c;
}