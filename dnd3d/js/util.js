// Petites fonctions utilitaires : maths, hasard, dés, bruit procédural.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
export const rndInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function shuffle(arr, r = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- Dés ----
export const die = (n) => 1 + Math.floor(Math.random() * n);
export function roll(count, sides, bonus = 0) {
  const rolls = [];
  let total = bonus;
  for (let i = 0; i < count; i++) {
    const v = die(sides);
    rolls.push(v);
    total += v;
  }
  return { total: Math.max(0, total), rolls };
}
export const mod = (s) => Math.floor((s - 10) / 2);
export const fmtMod = (m) => (m >= 0 ? '+' : '') + m;
export const diceStr = (c, s, b = 0) => `${c}d${s}${b ? (b > 0 ? '+' + b : b) : ''}`;

// ---- Bruit de valeur tuilable (pour les textures) ----
export function makeNoise(seed = 1) {
  const r = mulberry32(seed);
  const P = 256;
  const table = new Float32Array(P * P);
  for (let i = 0; i < table.length; i++) table[i] = r();
  const lat = (ix, iy, period) => {
    ix = ((ix % period) + period) % period;
    iy = ((iy % period) + period) % period;
    return table[(iy % P) * P + (ix % P)];
  };
  function noise(x, y, period = 256) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = lat(ix, iy, period), b = lat(ix + 1, iy, period);
    const c = lat(ix, iy + 1, period), d = lat(ix + 1, iy + 1, period);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y, oct = 4, period = 8) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += amp * noise(x * f, y * f, period * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return s / norm;
  }
  return { noise, fbm };
}

export const nextFrame = () => new Promise((r) => {
  let done = false;
  const fin = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(fin);
  setTimeout(fin, 60);
});
