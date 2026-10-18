// Textures procédurales (couleur + normal map + rugosité) dessinées sur canvas.
import * as THREE from 'three';
import { makeNoise, clamp, mulberry32 } from './util.js';

function toTexture(data, size, srgb) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function finalize(size, color, height, rough, strength) {
  const n = new Uint8ClampedArray(size * size * 4);
  const r = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hL = height[y * size + ((x - 1 + size) % size)];
      const hR = height[y * size + ((x + 1) % size)];
      const hU = height[((y - 1 + size) % size) * size + x];
      const hD = height[((y + 1) % size) * size + x];
      let nx = (hL - hR) * strength, ny = (hD - hU) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      n[i * 4] = (nx * 0.5 + 0.5) * 255;
      n[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      n[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      n[i * 4 + 3] = 255;
      const rv = clamp(rough[i], 0, 1) * 255;
      r[i * 4] = r[i * 4 + 1] = r[i * 4 + 2] = rv;
      r[i * 4 + 3] = 255;
    }
  }
  return {
    map: toTexture(color, size, true),
    normalMap: toTexture(n, size, false),
    roughnessMap: toTexture(r, size, false),
  };
}

// ---------- Mur de briques de pierre ----------
export function wallTextures(seed = 7) {
  const S = 512, N = makeNoise(seed), R = mulberry32(seed);
  const color = new Uint8ClampedArray(S * S * 4), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  const rows = 8, rh = S / rows, bw = 128;
  const off = [], tones = [];
  for (let i = 0; i < rows; i++) {
    off.push((i % 2) * 64 + Math.floor(R() * 30 - 15));
    tones.push([0, 1, 2, 3].map(() => [0.78 + R() * 0.4, R() * 0.12 - 0.06]));
  }
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rh), ly = y - row * rh;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const xx = (x + off[row] + S * 4) % S;
      const col = Math.floor(xx / bw), lx = xx - col * bw;
      const edge = Math.min(lx, bw - lx, ly, rh - ly);
      const u = x / S, v = y / S;
      const n = N.fbm(u * 8, v * 8, 5, 8);
      const n2 = N.fbm(u * 32 + 3, v * 32, 3, 32);
      const mortar = 3.5 + n * 4;
      let h, cr, cg, cb, ro;
      if (edge < mortar) {
        h = 0.05 * n2;
        const k = 0.75 + 0.5 * n;
        cr = 52 * k; cg = 47 * k; cb = 42 * k;
        ro = 1;
      } else {
        const bevel = clamp((edge - mortar) / 12, 0, 1);
        const [tone, hue] = tones[row][col];
        h = 0.55 * Math.sqrt(bevel) + 0.35 * n + 0.12 * n2;
        const k = tone * (0.68 + 0.55 * n) * (0.88 + 0.24 * n2);
        cr = (122 + hue * 120) * k; cg = 112 * k; cb = (100 - hue * 80) * k;
        // mousse / humidité
        const moss = clamp((N.fbm(u * 4 + 10, v * 4, 4, 4) - 0.56) * 5, 0, 1) * clamp(v * 1.4, 0, 1);
        cr = cr * (1 - moss) + 60 * moss * k; cg = cg * (1 - moss) + 74 * moss * k; cb = cb * (1 - moss) + 48 * moss * k;
        // fissures
        const crack = Math.abs(N.noise(u * 18 + 50, v * 18, 18) - 0.5);
        if (crack < 0.008 && N.noise(u * 6 + 9, v * 6 + 4, 6) > 0.8) { h -= 0.12; cr *= 0.72; cg *= 0.72; cb *= 0.72; }
        ro = 0.82 - 0.12 * n - moss * 0.1;
      }
      height[i] = h;
      rough[i] = ro;
      color[i * 4] = cr; color[i * 4 + 1] = cg; color[i * 4 + 2] = cb; color[i * 4 + 3] = 255;
    }
  }
  return finalize(S, color, height, rough, 6);
}

// ---------- Dalles de sol ----------
export function floorTextures(seed = 11) {
  const S = 512, N = makeNoise(seed), R = mulberry32(seed);
  const color = new Uint8ClampedArray(S * S * 4), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  const rows = 4, rh = S / rows;
  const rowSlabs = [];
  for (let r = 0; r < rows; r++) {
    const ws = [];
    let sum = 0;
    while (sum < S) {
      let w = [96, 128, 160, 192][Math.floor(R() * 4)];
      if (S - sum - w < 96) w = S - sum;
      ws.push({ x0: sum, w, tone: 0.8 + R() * 0.35, tint: R() * 0.1 - 0.05 });
      sum += w;
    }
    rowSlabs.push({ ws, off: Math.floor(R() * S) });
  }
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rh), ly = y - row * rh;
    const rs = rowSlabs[row];
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const xx = (x + rs.off) % S;
      let slab = rs.ws[0];
      for (const s of rs.ws) if (xx >= s.x0 && xx < s.x0 + s.w) slab = s;
      const lx = xx - slab.x0;
      const edge = Math.min(lx, slab.w - lx, ly, rh - ly);
      const u = x / S, v = y / S;
      const n = N.fbm(u * 6, v * 6, 5, 6);
      const n2 = N.fbm(u * 40, v * 40, 2, 40);
      const gap = 3 + n * 3;
      let h, cr, cg, cb, ro;
      const wet = clamp((N.fbm(u * 3 + 7, v * 3 + 2, 4, 3) - 0.58) * 3, 0, 1);
      if (edge < gap) {
        h = 0;
        const k = 0.6 + 0.4 * n;
        cr = 38 * k; cg = 34 * k; cb = 30 * k;
        ro = 0.95 - wet * 0.5;
      } else {
        const bevel = clamp((edge - gap) / 9, 0, 1);
        h = 0.5 * Math.sqrt(bevel) + 0.3 * n + 0.08 * n2;
        const k = slab.tone * (0.7 + 0.5 * n) * (0.9 + 0.2 * n2);
        cr = (104 + slab.tint * 200) * k; cg = 98 * k; cb = (90 - slab.tint * 150) * k;
        const crack = Math.abs(N.noise(u * 14 + 20, v * 14 + 9, 14) - 0.5);
        if (crack < 0.007 && N.noise(u * 5 + 3, v * 5 + 7, 5) > 0.8) { h -= 0.12; cr *= 0.7; cg *= 0.7; cb *= 0.7; }
        ro = 0.78 - n * 0.15;
      }
      // flaques : plus sombres et brillantes
      cr *= 1 - wet * 0.35; cg *= 1 - wet * 0.33; cb *= 1 - wet * 0.3;
      ro = ro * (1 - wet) + 0.12 * wet;
      h = h * (1 - wet * 0.15);
      height[i] = h;
      rough[i] = ro;
      color[i * 4] = cr; color[i * 4 + 1] = cg; color[i * 4 + 2] = cb; color[i * 4 + 3] = 255;
    }
  }
  return finalize(S, color, height, rough, 5);
}

// ---------- Plafond (roche brute) ----------
export function ceilingTextures(seed = 23) {
  const S = 256, N = makeNoise(seed);
  const color = new Uint8ClampedArray(S * S * 4), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, u = x / S, v = y / S;
    const n = N.fbm(u * 6, v * 6, 5, 6);
    const k = 0.5 + 0.6 * n;
    height[i] = n;
    rough[i] = 0.9;
    color[i * 4] = 70 * k; color[i * 4 + 1] = 62 * k; color[i * 4 + 2] = 56 * k; color[i * 4 + 3] = 255;
  }
  return finalize(S, color, height, rough, 4);
}

// ---------- Écailles de dragon ----------
export function scaleTextures(seed = 5) {
  const S = 256, N = makeNoise(seed);
  const color = new Uint8ClampedArray(S * S * 4), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  const cw = 32, ch = 24;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const row = Math.floor(y / ch);
    const xx = (x + (row % 2) * cw / 2) % S;
    const lx = (xx % cw) / cw - 0.5, ly = (y % ch) / ch;
    let d = Math.hypot(lx * 2, (ly - 0.15) * 1.3);
    // écaille suivante (rangée du dessous) qui recouvre
    const h = clamp(1 - d, 0, 1);
    const n = N.fbm(x / S * 8, y / S * 8, 3, 8);
    height[i] = h * 0.8 + n * 0.2;
    const edge = clamp((d - 0.75) * 4, 0, 1);
    const k = 0.7 + 0.5 * n;
    color[i * 4] = (150 - edge * 70) * k;
    color[i * 4 + 1] = (34 - edge * 14) * k;
    color[i * 4 + 2] = (26 - edge * 10) * k;
    color[i * 4 + 3] = 255;
    rough[i] = 0.45 + edge * 0.4;
  }
  return finalize(S, color, height, rough, 3);
}

// ---------- Petites textures décoratives (canvas 2D) ----------
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function bannerTexture(hue = 'red') {
  return canvas(128, 256, (g, w, h) => {
    const base = hue === 'red' ? '#7a1012' : hue === 'green' ? '#174a3a' : '#1c2a66';
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.45)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    grd.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a04a';
    g.lineWidth = 6;
    g.strokeRect(10, 6, w - 20, h - 40);
    // queue d'aronde en bas
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(0, h + 1); g.lineTo(w / 2, h - 34); g.lineTo(w, h + 1); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    // emblème : dragon stylisé / épée
    g.fillStyle = '#d8b25a';
    g.save();
    g.translate(w / 2, 110);
    g.beginPath();
    g.moveTo(0, -60); g.lineTo(8, -10); g.lineTo(30, -24); g.lineTo(14, 8); g.lineTo(34, 30);
    g.lineTo(6, 22); g.lineTo(0, 60); g.lineTo(-6, 22); g.lineTo(-34, 30); g.lineTo(-14, 8); g.lineTo(-30, -24); g.lineTo(-8, -10);
    g.closePath(); g.fill();
    g.fillStyle = base;
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
    g.restore();
  });
}

export function cobwebTexture() {
  return canvas(256, 256, (g, w) => {
    g.strokeStyle = 'rgba(230,230,230,0.55)';
    g.lineWidth = 1.2;
    const cx = w / 2, cy = 0;
    const spokes = 12;
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * w * 0.7, cy + Math.sin(a) * w * 0.9); g.stroke();
    }
    for (let r = 16; r < w * 0.7; r += 14 + Math.random() * 10) {
      g.beginPath();
      for (let i = 0; i <= spokes; i++) {
        const a = (i / spokes) * Math.PI;
        const rr = r * (0.92 + Math.random() * 0.12);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 1.25;
        if (i === 0) g.moveTo(x, y); else g.quadraticCurveTo(cx + Math.cos(a - 0.13) * rr * 0.9, cy + Math.sin(a - 0.13) * rr * 1.1, x, y);
      }
      g.stroke();
    }
  });
}

export function runeTexture() {
  return canvas(512, 512, (g, w) => {
    const c = w / 2;
    g.translate(c, c);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.shadowColor = 'white';
    g.shadowBlur = 8;
    g.lineWidth = 6;
    g.beginPath(); g.arc(0, 0, 240, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 200, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, 120, 0, Math.PI * 2); g.stroke();
    // runes
    const R = mulberry32(99);
    for (let i = 0; i < 24; i++) {
      g.save();
      g.rotate((i / 24) * Math.PI * 2);
      g.translate(0, -220);
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const x0 = (R() - 0.5) * 22, y0 = (R() - 0.5) * 22;
        const x1 = (R() - 0.5) * 22, y1 = (R() - 0.5) * 22;
        g.moveTo(x0, y0); g.lineTo(x1, y1);
      }
      g.stroke();
      g.restore();
    }
    // étoile
    g.lineWidth = 4;
    g.beginPath();
    for (let i = 0; i <= 7; i++) {
      const a = (i * 3 / 7) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 200, y = Math.sin(a) * 200;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  });
}

export function crateTexture() {
  return canvas(128, 128, (g, w) => {
    g.fillStyle = '#6b4a2b';
    g.fillRect(0, 0, w, w);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(${40 + Math.random() * 30},${25 + Math.random() * 20},10,0.35)`;
      g.fillRect(0, i * 26, w, 24);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, i * 26 + 24, w, 2);
    }
    g.strokeStyle = '#3a2614';
    g.lineWidth = 12;
    g.strokeRect(6, 6, w - 12, w - 12);
    g.beginPath(); g.moveTo(6, 6); g.lineTo(w - 6, w - 6); g.stroke();
    g.fillStyle = '#888';
    for (const [x, y] of [[10, 10], [w - 10, 10], [10, w - 10], [w - 10, w - 10]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  });
}
