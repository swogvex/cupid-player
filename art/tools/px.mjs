// Pixel-art toolkit: shaded shapes (dome lighting from the top-left), outlines, dithering.
export const canvas = (w, h) => Array.from({ length: h }, () => Array(w).fill("."));
export const text = (c) => c.map((r) => r.join(""));
export const pad = (rows, w = Math.max(...rows.map((r) => r.length))) => rows.map((r) => r.padEnd(w, "."));
export const mirror = (rows) => pad(rows).map((r) => [...r].reverse().join(""));
export function stamp(c, piece, x, y) {
  pad(piece).forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === ".") return;
    const X = x + i, Y = y + j;
    if (Y >= 0 && Y < c.length && X >= 0 && X < c[0].length) c[Y][X] = ch;
  }));
  return c;
}
export const set = (c, x, y, ch) => { if (c[y] && c[y][x] !== undefined) c[y][x] = ch; };
export const sparkle = (c, x, y, ch = "y", ch2 = null) => {
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) set(c, x + dx, y + dy, ch2 && (dx || dy) ? ch2 : ch);
};

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/** v in 0..1 -> tone, ordered dithering inside a narrow band between two tones. */
export function tone(tones, v, x, y, dither = 0.7) {
  const n = tones.length;
  const t = Math.min(n - 1, Math.max(0, v * (n - 1) * 0.999));
  const lo = Math.floor(t);
  let f = t - lo;
  f = f < 0.5 - dither * 0.5 ? 0 : f > 0.5 + dither * 0.5 ? 1 : (f - (0.5 - dither * 0.5)) / dither;
  const th = (BAYER[y & 3][x & 3] + 0.5) / 16;
  return tones[Math.min(n - 1, lo + (f > th ? 1 : 0))];
}

/** Height-field helpers. A "dome" is a half ellipsoid. */
export const dome = (cx, cy, rx, ry, k = 1) => (x, y) => {
  const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
  const d = nx * nx + ny * ny;
  return d >= 1 ? 0 : Math.sqrt(1 - d) * k * Math.min(rx, ry);
};
export const inEllipse = (cx, cy, rx, ry) => (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;

/**
 * Renders a shape. mask(x,y)->bool, height(x,y)->number, tones: array (dark..light) or function(x,y)->array.
 * Rim pixels get the outline letter; the inside is lit from the top-left and quantised to the tones.
 */
export function shape(c, { mask, height, tones, outline = "s", light = [-0.5, -0.62, 0.6], dither = 0.7, spec = null, bias = 0, outlineFn = null }) {
  const H = c.length, W = c[0].length;
  const L = Math.hypot(...light), l = light.map((q) => q / L);
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask(x, y);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask(x, y)) continue;
    const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    if (rim && outline) { c[y][x] = outlineFn ? outlineFn(x, y) : outline; continue; }
    const gx = (height(x + 1, y) - height(x - 1, y)) / 2, gy = (height(x, y + 1) - height(x, y - 1)) / 2;
    const len = Math.hypot(gx, gy, 1);
    const lit = (-gx * l[0] - gy * l[1] + l[2]) / len;
    const v = Math.min(1, Math.max(0, (lit - 0.18) / 0.82 + bias));
    const tt = typeof tones === "function" ? tones(x, y) : tones;
    let ch = tone(tt, v, x, y, dither);
    if (spec && v > spec.at && spec.mask?.(x, y) !== false) ch = spec.ch;
    c[y][x] = ch;
  }
}

/** Distance-based height for an arbitrary mask (soft dome). */
export function maskHeight(mask, W, H, k = 1.1) {
  const d = Array.from({ length: H }, () => Array(W).fill(0));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask(x, y)) continue;
    let best = 99;
    for (let yy = Math.max(0, y - 7); yy < Math.min(H, y + 8); yy++) for (let xx = Math.max(0, x - 7); xx < Math.min(W, x + 8); xx++)
      if (!mask(xx, yy)) best = Math.min(best, Math.hypot(xx - x, yy - y));
    if (best === 99) best = 7;
    d[y][x] = best;
  }
  return (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : Math.sqrt(d[y][x]) * k * 2);
}

export function heartMask(w, h, ox = 0, oy = 0) {
  return (x, y) => {
    const u = ((x - ox + 0.5) / w - 0.5) * 2.5, v = (0.58 - (y - oy + 0.5) / h) * 2.5 + 0.12;
    return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0 && x >= ox && x < ox + w && y >= oy && y < oy + h;
  };
}

/** Fluffy cloud from circles [cx,cy,r,(ry)]: dome shading per puff + a crease line where puffs meet. */
export function puffs(c, circles, { tones = ["e", "f", "g", "w"], outline = "l", crease = "e", dither = 0.6, openBottom = false, openLeft = false, openRight = false } = {}) {
  const W = c[0].length, Hh = c.length;
  const doms = circles.map(([cx, cy, r, ry]) => dome(cx, cy, r, ry ?? r, 1));
  const ins = circles.map(([cx, cy, r, ry]) => inEllipse(cx, cy, r, ry ?? r));
  const mask = (x, y) => (y >= Hh && openBottom) || (x < 0 && openLeft) || (x >= W && openRight) ? true : x >= 0 && y >= 0 && x < W && y < Hh && ins.some((f) => f(x, y));
  const owner = (x, y) => { let b = -1, bh = 0; doms.forEach((d, i) => { const h = d(x, y); if (h > bh) { bh = h; b = i; } }); return b; };
  const height = (x, y) => Math.max(0, ...doms.map((d) => d(x, y)));
  shape(c, { mask, height, tones, outline, dither });
  if (crease) {
    for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (c[y][x] === "." || c[y][x] === outline) continue;
      const o = owner(x, y);
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (c[ny]?.[nx] === "." || c[ny]?.[nx] === outline || c[ny]?.[nx] === undefined) continue;
        if (owner(nx, ny) !== o && height(x, y) <= height(nx, ny)) { c[y][x] = crease; break; }
      }
    }
  }
}

// ---------- hand-drawn small hearts (clean at 7-11 px) ----------
const symOdd = (half) => half.map((r) => r + [...r.slice(0, -1)].reverse().join(""));
const symEven = (half) => half.map((r) => r + [...r].reverse().join(""));
const putPx = (rows, list) => { const c = rows.map((r) => [...r]); for (const [x, y, ch] of list) if (c[y]?.[x] !== undefined) c[y][x] = ch; return c.map((r) => r.join("")); };
export const HEARTS = {
  11: putPx(symOdd([".sss..", "saaas.", "saaaas", "saaaaa", "saaaaa", ".saaaa", "..saaa", "...saa", "....sa", ".....s"]),
    [[1, 1, "w"], [2, 1, "h"], [1, 2, "h"], [2, 2, "h"], [3, 1, "h"], [1, 3, "h"], [8, 3, "r"], [8, 4, "r"], [8, 5, "r"], [7, 5, "r"], [7, 6, "r"], [6, 6, "r"], [6, 7, "r"], [5, 7, "r"], [7, 4, "r"], [6, 5, "r"]]),
  9: putPx(symOdd([".sss.", "saaas", "saaaa", "saaaa", ".saaa", "..saa", "...sa", "....s"]),
    [[1, 1, "w"], [2, 1, "h"], [1, 2, "h"], [6, 3, "r"], [6, 4, "r"], [5, 4, "r"], [5, 5, "r"], [4, 5, "r"]]),
  8: putPx(symEven([".ss.", "saaa", "saaa", "saaa", ".saa", "..sa", "...s"]), [[1, 1, "w"], [2, 1, "h"], [1, 2, "h"], [6, 3, "r"], [5, 4, "r"]]),
  7: putPx(symOdd([".ss.", "saaa", "saaa", ".saa", "..sa", "...s"]), [[1, 1, "w"], [2, 1, "h"], [5, 2, "r"], [4, 3, "r"]]),
};
/** Hand heart of width n placed on a w x h canvas at (ox, oy). */
export function smallHeart(n, w, h, ox = 0, oy = 0) { const c = canvas(w, h); stamp(c, HEARTS[n], ox, oy); return c; }