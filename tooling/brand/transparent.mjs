/**
 * Makes the white backdrop around the logo transparent for Windows icons, which Windows draws
 * as-is in title bars and the taskbar. Only near-white pixels connected to the image border are
 * removed, so white areas enclosed by the artwork (the book pages) stay opaque.
 */
export function removeWhiteBackdrop({ width, height, rgba }, { threshold = 236, feather = 3, padding = 0.04 } = {}) {
  const out = Buffer.from(rgba);
  const at = (x, y) => (y * width + x) * 4;
  const whiteish = (i) => Math.min(out[i], out[i + 1], out[i + 2]) >= threshold;
  const background = new Uint8Array(width * height);
  const queue = [];
  const seed = (x, y) => { const p = y * width + x; if (!background[p] && whiteish(p * 4)) { background[p] = 1; queue.push(p); } };
  for (let x = 0; x < width; x += 1) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y += 1) { seed(0, y); seed(width - 1, y); }
  while (queue.length) {
    const p = queue.pop(); const x = p % width; const y = (p - x) / width;
    if (x > 0) seed(x - 1, y); if (x < width - 1) seed(x + 1, y); if (y > 0) seed(x, y - 1); if (y < height - 1) seed(x, y + 1);
  }
  // Distance (in pixels, Chebyshev) from the removed backdrop, capped at `feather`.
  const distance = new Uint8Array(width * height).fill(255);
  for (let p = 0; p < background.length; p += 1) if (background[p]) distance[p] = 0;
  for (let step = 1; step <= feather; step += 1) {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const p = y * width + x; if (distance[p] !== 255) continue;
      for (let dy = -1; dy <= 1 && distance[p] === 255; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && distance[ny * width + nx] === step - 1) { distance[p] = step; break; }
      }
    }
  }
  for (let p = 0; p < background.length; p += 1) {
    const i = p * 4;
    if (background[p]) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
    if (distance[p] > feather) continue;
    // Colour-to-alpha against white for the anti-aliased rim.
    const alpha = Math.max(255 - out[i], 255 - out[i + 1], 255 - out[i + 2]) / 255;
    if (alpha <= 0) { out[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c += 1) out[i + c] = Math.round(Math.min(255, Math.max(0, (out[i + c] - (1 - alpha) * 255) / alpha)));
    out[i + 3] = Math.round(alpha * (out[i + 3] / 255) * 255);
  }
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (out[at(x, y) + 3] > 8) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  if (right < 0) throw new Error('Logo has no visible pixels after removing the backdrop.');
  const side = Math.ceil(Math.max(right - left + 1, bottom - top + 1) * (1 + padding * 2));
  const offsetX = Math.round((side - (right - left + 1)) / 2) - left;
  const offsetY = Math.round((side - (bottom - top + 1)) / 2) - top;
  const square = Buffer.alloc(side * side * 4);
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) out.copy(square, ((y + offsetY) * side + x + offsetX) * 4, at(x, y), at(x, y) + 4);
  return { width: side, height: side, rgba: square };
}
