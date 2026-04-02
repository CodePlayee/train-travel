const NOISE_PERM = new Uint8Array(512);

export function initNoise(seed = 42): void {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  // Seeded shuffle
  let s = seed;
  const seededRandom = () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };

  for (let i = 255; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) NOISE_PERM[i] = p[i & 255];
}

// Initialize with default seed
initNoise();

export function noise2D(x: number, y: number): number {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = x - X0;
  const y0 = y - Y0;

  let i1: number, j1: number;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;

  const grad = (hash: number, gx: number, gy: number): number => {
    const h = hash & 7;
    const u = h < 4 ? gx : gy;
    const v = h < 4 ? gy : gx;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };

  let n0 = 0, n1 = 0, n2 = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * grad(NOISE_PERM[ii + NOISE_PERM[jj]], x0, y0); }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * grad(NOISE_PERM[ii + i1 + NOISE_PERM[jj + j1]], x1, y1); }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * grad(NOISE_PERM[ii + 1 + NOISE_PERM[jj + 1]], x2, y2); }

  return 70 * (n0 + n1 + n2);
}

export function fbm(x: number, y: number, octaves = 4): number {
  let val = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += noise2D(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / max;
}

export function ridgedFbm(x: number, y: number, octaves = 4): number {
  let val = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    let ridge = 1.0 - Math.abs(noise2D(x * freq, y * freq));
    ridge *= ridge;
    val += ridge * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / max;
}

export function terrainFbm(x: number, y: number, octaves = 4, ridgeFactor = 0): number {
  const smooth = fbm(x, y, octaves);
  const ridged = ridgedFbm(x, y, octaves);
  return smooth + (ridged - smooth) * ridgeFactor;
}
