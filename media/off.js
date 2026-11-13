// Parse OpenSCAD's OFF export, which (unlike STL) keeps color() per face:
//   OFF nv nf ne
//   x y z                    (nv lines)
//   n i0 i1 .. [r g b [a]]   (nf lines, colour components 0-255)

/**
 * Returns non-indexed triangle data: { positions: Float32Array (xyz),
 * colors: Float32Array (rgba, 0-1), hasAlpha }. Faces without a colour get `fallback`.
 */
export function parseOFF(text, fallback = [1, 1, 1]) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const header = lines.shift().replace(/^OFF\s*/, '') || lines.shift();
  const [nv, nf] = header.split(/\s+/).map(Number);
  const verts = lines.slice(0, nv).map((l) => l.split(/\s+/).map(Number));
  const positions = [], colors = [];
  let hasAlpha = false;
  for (const line of lines.slice(nv, nv + nf)) {
    const f = line.split(/\s+/).map(Number);
    const n = f[0], idx = f.slice(1, 1 + n), c = f.slice(1 + n);
    const rgba = c.length >= 3
      ? [c[0] / 255, c[1] / 255, c[2] / 255, (c[3] ?? 255) / 255]
      : [...fallback, 1];
    if (rgba[3] < 1) hasAlpha = true;
    for (let k = 1; k < n - 1; k++) { // fan-triangulate
      for (const v of [idx[0], idx[k], idx[k + 1]]) {
        positions.push(...verts[v]);
        colors.push(...rgba);
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), hasAlpha };
}
