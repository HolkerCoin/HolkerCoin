import sharp from 'sharp';

/**
 * Trace a binary mask into closed polygons.
 * Pixel-edge following (inside on the left), loops closed by corner key, then
 * Ramer-Douglas-Peucker simplification. Works on the real pixel grid, no smoothing guesses.
 */
export function traceMask(mask, w, h, eps) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  const next = new Map();
  const key = (x, y) => y * (w + 1) + x;
  const add = (x1, y1, x2, y2) => {
    const k = key(x1, y1);
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([x2, y2]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops = [];
  for (const [k0, outs] of next) {
    while (outs.length) {
      const sx = k0 % (w + 1), sy = Math.floor(k0 / (w + 1));
      const pts = [[sx, sy]];
      let [cx, cy] = outs.pop();
      while (cx !== sx || cy !== sy) {
        pts.push([cx, cy]);
        const c = next.get(key(cx, cy));
        if (!c || !c.length) break;
        [cx, cy] = c.pop();
      }
      loops.push(pts);
    }
  }
  return loops.map((l) => rdpClosed(l, eps)).filter((l) => l.length >= 3);
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let dmax = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
function rdpClosed(pts, eps) {
  let far = 0, fd = -1;
  for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const r = [...pts.slice(0, far + 1)], q = [...pts.slice(far), pts[0]];
  return [...rdp(r, eps).slice(0, -1), ...rdp(q, eps).slice(0, -1)];
}

/** Bounding box of pixels whose alpha clears the threshold, read from the real RGBA grid. */
export async function alphaBBox(file, threshold = 8) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
