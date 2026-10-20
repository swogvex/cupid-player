import { canvas, text, stamp, shape, dome, inEllipse, heartMask, maskHeight, puffs, set, mirror, smallHeart } from "./px.mjs";

export const TW = 64, TH = 22;

function goldCurl(c, side) {
  // scroll curl rising from the heart's shoulder and curling outward
  const pts = [[27, 9], [25, 5.5], [21.5, 3.2], [17.5, 3.4], [14.8, 6], [15.6, 9], [18.2, 9.6], [19.6, 7.8]];
  const sm = [];
  for (let i = 0; i < pts.length - 1; i++) for (let t = 0; t < 1; t += 0.12) sm.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
  const cs = sm.map(([x, y], i) => [side < 0 ? x : TW - x, y, 1.45 - 0.35 * (i / sm.length)]);
  const ins = cs.map(([x, y, r]) => inEllipse(x, y, r, r));
  shape(c, {
    mask: (x, y) => ins.some((f) => f(x, y)),
    height: (x, y) => Math.max(0, ...cs.map(([cx, cy, r]) => dome(cx, cy, r, r, 1)(x, y))),
    tones: ["z", "y", "n"], outline: "j", dither: 0.2,
  });
}

function wing(dy) {
  const c = canvas(TW, TH);
  const f = [[11, 10 + dy, 4.8, 2.7], [8, 13 + dy, 4.3, 2.4], [13, 7 + dy, 3.4, 2.1]];
  puffs(c, f, { tones: ["e", "f", "g", "w"], outline: "s", crease: "e", dither: 0.4 });
  return c;
}

function sparkle5(c, x, y) { for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) set(c, x + dx, y + dy, dx || dy ? "y" : "w"); }

/** Centre piece: heart with gold scrolls, arrow, gem and small wings. k = animation frame (0..23). */
export function titleHeart(k) {
  const c = canvas(TW, TH);
  const flap = 0.5 + 0.5 * Math.sin((2 * Math.PI * k) / 12 - 1.2); // 0..1
  const dy = -Math.round(flap * 2.2);
  // arrow (behind the heart): shaft, fletching, head
  for (let x = 8; x <= 55; x++) { set(c, x, 16, "y"); set(c, x, 17, "z"); }
  for (let x = 9; x <= 54; x += 3) set(c, x, 16, "n");
  stamp(c, ["a.a.", ".aaa", "aa.a", ".aaa", "a.a."], 4, 14);
  stamp(c, ["...ss...", "..saas..", ".sahhas.", "saaaaaas", ".saaaas.", "..sss..."], 55, 13);
  // wings
  const w = wing(dy);
  stamp(c, text(w), 0, 0);
  stamp(c, mirror(text(w)), 0, 0);
  // gold scrolls
  goldCurl(c, -1); goldCurl(c, 1);
  // heart
  const hx = 24, hy = 5, hw = 16, hh = 15;
  const hm = heartMask(hw, hh, hx, hy);
  shape(c, { mask: hm, height: maskHeight(hm, TW, TH, 1.1), tones: ["r", "a", "h", "w"], outline: "s", dither: 0.55, spec: { at: 0.97, ch: "w", mask: (x, y) => x < hx + hw / 2 && y < hy + 6 } });
  // gem on top, with a glint
  stamp(c, ["..s..", ".sws.", "shaas", ".sas.", "..s.."], 30, 0);
  if (k >= 8 && k <= 10) { set(c, 31, 2, "w"); if (k === 9) { set(c, 31, 1, "w"); set(c, 33, 2, "w"); set(c, 32, 3, "w"); } }
  // tiny sparkles
  const twinkle = (x, y, ph) => { const t = (k + ph) % 12; if (t === 0 || t === 4) set(c, x, y, "w"); if (t >= 1 && t <= 3) sparkle5(c, x, y); };
  twinkle(4, 4, 0); twinkle(59, 5, 6);
  return c;
}

export function titleHeartSmall() { return smallHeart(9, 9, 8); }

/** Seamless strip of faint clouds that sits along the bottom of the title bar. */
export function titleClouds() {
  const W = 128, H = 12, c = canvas(W, H);
  const base = [[8, 10, 5], [16, 8, 6], [26, 10, 5], [38, 9, 6], [49, 11, 5], [60, 9, 6], [70, 7, 5], [78, 10, 5], [90, 9, 6], [101, 11, 5], [112, 8, 6], [121, 10, 5]];
  const circles = [];
  for (const [x, y, r] of base) for (const o of [-W, 0, W]) circles.push([x + o, y + 2, r]);
  puffs(c, circles, { tones: ["f", "g", "w", "w"], outline: "e", crease: "e", dither: 0.3, openBottom: true });
  return c;
}