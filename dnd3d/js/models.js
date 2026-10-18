// Modèles 3D procéduraux (héros, monstres, dragon) + animation par squelette d'articulations.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { scaleTextures } from './textures.js';
import { lerp } from './util.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------- Cache de géométries
const GC = new Map();
const geo = (key, make) => { if (!GC.has(key)) GC.set(key, make()); return GC.get(key); };
const cap = (r, l) => geo(`cap${r}_${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10).translate(0, -(l / 2 + r), 0));
const sph = (r, w = 14, h = 10) => geo(`sph${r}_${w}`, () => new THREE.SphereGeometry(r, w, h));
const hemi = (r) => geo(`hemi${r}`, () => new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2));
const box = (x, y, z) => geo(`box${x}_${y}_${z}`, () => new THREE.BoxGeometry(x, y, z));
const cyl = (a, b, h, s = 10) => geo(`cyl${a}_${b}_${h}_${s}`, () => new THREE.CylinderGeometry(a, b, h, s));
const cone = (r, h, s = 8) => geo(`cone${r}_${h}_${s}`, () => new THREE.ConeGeometry(r, h, s));
const torus = (r, t, arc = Math.PI * 2) => geo(`tor${r}_${t}_${arc}`, () => new THREE.TorusGeometry(r, t, 6, 16, arc));

function std(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.7, metalness: o.m ?? 0,
    emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    ...(o.extra || {}),
  });
}
function mesh(g, mat, parent, pos, rot, scale) {
  const m = new THREE.Mesh(g, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  if (scale !== undefined) typeof scale === 'number' ? m.scale.setScalar(scale) : m.scale.set(...scale);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function grp(parent, pos) {
  const g = new THREE.Group();
  if (pos) g.position.set(...pos);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- Squelette humanoïde
function rig(o) {
  const root = new THREE.Group();
  const body = grp(root);
  const hips = grp(body, [0, o.legLen, 0]);
  const torso = grp(hips, [0, 0.03, 0]);
  const neck = grp(torso, [0, o.torsoLen, 0]);
  const head = grp(neck, [0, 0.06, 0]);
  const sy = o.torsoLen - 0.07;
  const shL = grp(torso, [o.shoulderW, sy, 0]), shR = grp(torso, [-o.shoulderW, sy, 0]);
  const elL = grp(shL, [0, -o.upperArm, 0]), elR = grp(shR, [0, -o.upperArm, 0]);
  const handL = grp(elL, [0, -o.foreArm, 0]), handR = grp(elR, [0, -o.foreArm, 0]);
  const hipL = grp(hips, [o.hipW, 0, 0]), hipR = grp(hips, [-o.hipW, 0, 0]);
  const kn = o.legLen * 0.5;
  const knL = grp(hipL, [0, -kn, 0]), knR = grp(hipR, [0, -kn, 0]);
  const ftL = grp(knL, [0, -kn + 0.04, 0]), ftR = grp(knR, [0, -kn + 0.04, 0]);
  root.scale.setScalar(o.scale || 1);
  return { root, body, hips, torso, neck, head, shL, shR, elL, elR, handL, handR, hipL, hipR, knL, knR, ftL, ftR, o };
}

// membres génériques
function limbs(R, m, dims) {
  const { ua, fa, th, sh, ra = 0.055, rf = 0.05, rt = 0.075, rs = 0.065 } = dims;
  for (const [s, e, h] of [[R.shL, R.elL, R.handL], [R.shR, R.elR, R.handR]]) {
    mesh(cap(ra, ua - ra * 2), m.arm, s);
    mesh(cap(rf, fa - rf * 2), m.fore || m.arm, e);
    mesh(sph(rf * 1.05), m.hand || m.skin, h, [0, -0.01, 0]);
  }
  for (const [hp, kn, ft] of [[R.hipL, R.knL, R.ftL], [R.hipR, R.knR, R.ftR]]) {
    mesh(cap(rt, th - rt * 2), m.leg, hp);
    mesh(cap(rs, sh - rs * 2), m.shin || m.leg, kn);
    mesh(box(rs * 1.7, 0.08, 0.23), m.foot, ft, [0, -0.01, 0.05]);
  }
}

// ---------------------------------------------------------------- Armes
function sword(parent, m, len = 0.95, width = 0.07) {
  const w = grp(parent);
  w.rotation.x = 0.42;
  mesh(box(width, 0.016, len), m.steel, w, [0, 0, 0.13 + len / 2]);
  mesh(geo(`tip${width}`, () => new THREE.ConeGeometry(width / 1.4, 0.16, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.25, 1)), m.steel, w, [0, 0, 0.13 + len + 0.08]);
  mesh(box(width * 4.2, 0.045, 0.05), m.gold || m.steel, w, [0, 0, 0.1]);
  mesh(geo('grip', () => new THREE.CylinderGeometry(0.022, 0.024, 0.2, 8).rotateX(Math.PI / 2)), m.leather, w, [0, 0, 0]);
  mesh(sph(0.035, 8, 6), m.gold || m.steel, w, [0, 0, -0.12]);
  const base = grp(w, [0, 0, 0.25]), tip = grp(w, [0, 0, 0.13 + len + 0.1]);
  return { w, base, tip };
}
function dagger(parent, m) { return sword(parent, m, 0.36, 0.05); }

// ---------------------------------------------------------------- Héros
export function buildHero(cls) {
  const skin = std(0xd9a27a, { r: 0.6 });
  let R, m, weapons = {}, cape = null, castPoint = null;
  if (cls === 'guerrier') {
    m = {
      steel: std(0xc3c9d2, { m: 0.92, r: 0.28 }), dark: std(0x2b2e33, { m: 0.7, r: 0.4 }), gold: std(0xd4a54a, { m: 1, r: 0.3 }),
      leather: std(0x4a2f1d, { r: 0.8 }), chain: std(0x80858d, { m: 0.75, r: 0.5 }), cloth: std(0x8c1418, { r: 0.9, extra: { side: THREE.DoubleSide } }), skin,
    };
    R = rig({ legLen: 0.92, torsoLen: 0.62, shoulderW: 0.25, hipW: 0.11, upperArm: 0.3, foreArm: 0.28 });
    limbs(R, { arm: m.chain, fore: m.steel, hand: m.leather, leg: m.chain, shin: m.steel, foot: m.leather, skin }, { ua: 0.3, fa: 0.28, th: 0.46, sh: 0.46, ra: 0.058, rf: 0.054, rt: 0.08, rs: 0.07 });
    mesh(cyl(0.2, 0.27, 0.3, 12), m.chain, R.hips, [0, -0.08, 0]);
    mesh(sph(0.26, 18, 12), m.steel, R.torso, [0, 0.38, 0.0], null, [0.95, 1.05, 0.72]);
    mesh(cyl(0.17, 0.19, 0.24, 12), m.leather, R.torso, [0, 0.12, 0]);
    mesh(torus(0.19, 0.03), m.leather, R.torso, [0, 0.02, 0], [Math.PI / 2, 0, 0]);
    mesh(box(0.08, 0.07, 0.04), m.gold, R.torso, [0, 0.02, 0.19]);
    mesh(box(0.03, 0.3, 0.02), m.gold, R.torso, [0, 0.4, 0.185]);
    for (const s of [R.shL, R.shR]) {
      mesh(hemi(0.14), m.steel, s, [0, 0.02, 0], null, [1.1, 0.95, 1.1]);
      mesh(torus(0.15, 0.015), m.gold, s, [0, 0.02, 0], [Math.PI / 2, 0, 0]);
    }
    mesh(sph(0.11), skin, R.head, [0, 0.12, 0]);
    mesh(sph(0.138, 18, 12), m.steel, R.head, [0, 0.14, 0], null, [1, 1.05, 1.08]);
    mesh(box(0.2, 0.024, 0.05), m.dark, R.head, [0, 0.12, 0.125]);
    mesh(box(0.02, 0.12, 0.04), m.steel, R.head, [0, 0.08, 0.14]);
    mesh(cone(0.05, 0.42, 8), m.cloth, R.head, [0, 0.28, -0.12], [-2.1, 0, 0]);
    mesh(torus(0.14, 0.012), m.gold, R.head, [0, 0.1, 0], [Math.PI / 2, 0, 0]);
    weapons.main = sword(R.handR, m);
    // bouclier
    const sh = grp(R.handL, [0, 0.1, 0.07]);
    sh.rotation.x = Math.PI / 2;
    mesh(cyl(0.4, 0.4, 0.05, 24), m.cloth, sh);
    mesh(geo('shieldRim', () => new THREE.TorusGeometry(0.4, 0.03, 6, 28).rotateX(Math.PI / 2)), m.steel, sh);
    mesh(hemi(0.1), m.gold, sh, [0, 0.025, 0]);
    mesh(box(0.06, 0.055, 0.6), m.gold, sh, [0, 0.0, 0], [0, 0, 0]);
    mesh(box(0.6, 0.055, 0.06), m.gold, sh, [0, 0.0, 0]);
    weapons.shield = sh;
    cape = makeCape(R, m.cloth, 0.52, 1.1);
  } else if (cls === 'magicien') {
    m = {
      robe: std(0x1e2a78, { r: 0.85 }), trim: std(0xd9ae52, { m: 1, r: 0.35 }), wood: std(0x5a3a22, { r: 0.7 }),
      beard: std(0xe8e4dc, { r: 0.9 }), leather: std(0x3a2618, { r: 0.8 }), skin,
      crystal: std(0xff8a30, { e: 0xff6a10, ei: 4, r: 0.1 }),
    };
    R = rig({ legLen: 0.9, torsoLen: 0.6, shoulderW: 0.22, hipW: 0.1, upperArm: 0.29, foreArm: 0.27 });
    limbs(R, { arm: m.robe, hand: skin, leg: m.robe, foot: m.leather, skin }, { ua: 0.29, fa: 0.27, th: 0.45, sh: 0.45, ra: 0.065, rf: 0.07, rt: 0.075, rs: 0.065 });
    const robeGeo = geo('robe', () => new THREE.LatheGeometry([[0.001, 0.08], [0.21, 0.08], [0.25, -0.15], [0.31, -0.45], [0.38, -0.75], [0.43, -0.88], [0.001, -0.88]].map(([x, y]) => new THREE.Vector2(x, y)), 18));
    mesh(robeGeo, m.robe, R.hips);
    mesh(torus(0.425, 0.02), m.trim, R.hips, [0, -0.86, 0], [Math.PI / 2, 0, 0]);
    mesh(sph(0.24, 16, 12), m.robe, R.torso, [0, 0.36, 0], null, [0.9, 1.1, 0.75]);
    mesh(torus(0.2, 0.035), m.trim, R.torso, [0, 0.08, 0], [Math.PI / 2, 0, 0]);
    mesh(box(0.05, 0.42, 0.02), m.trim, R.torso, [0, 0.3, 0.17]);
    for (const s of [R.shL, R.shR]) mesh(hemi(0.12), m.robe, s, [0, 0.0, 0], null, [1.2, 0.8, 1.2]);
    mesh(sph(0.11), skin, R.head, [0, 0.12, 0]);
    mesh(geo('beard', () => new THREE.ConeGeometry(0.1, 0.34, 10).rotateX(Math.PI)), m.beard, R.head, [0, -0.04, 0.07], [0.25, 0, 0]);
    mesh(box(0.13, 0.025, 0.04), m.beard, R.head, [0, 0.1, 0.1]);
    mesh(cyl(0.27, 0.29, 0.025, 22), m.robe, R.head, [0, 0.2, 0]);
    mesh(torus(0.125, 0.02), m.trim, R.head, [0, 0.23, 0], [Math.PI / 2, 0, 0]);
    const hat = grp(R.head, [0, 0.21, 0]);
    hat.rotation.x = -0.18;
    mesh(cone(0.135, 0.36, 14), m.robe, hat, [0, 0.18, 0]);
    mesh(cone(0.07, 0.2, 10), m.robe, hat, [0, 0.42, -0.06], [-0.7, 0, 0]);
    // bâton
    const st = grp(R.handR);
    st.rotation.x = Math.PI / 2;
    mesh(cyl(0.024, 0.03, 1.75, 8), m.wood, st, [0, 0.32, 0]);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      mesh(cone(0.02, 0.22, 5), m.wood, st, [Math.cos(a) * 0.06, 1.25, Math.sin(a) * 0.06], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4]);
    }
    const crystal = mesh(geo('oct', () => new THREE.OctahedronGeometry(0.085)), m.crystal, st, [0, 1.3, 0], null, [1, 1.5, 1]);
    crystal.castShadow = false;
    castPoint = crystal;
    weapons.main = { w: st, base: grp(st, [0, 1.0, 0]), tip: grp(st, [0, 1.32, 0]) };
    weapons.crystal = crystal;
    cape = makeCape(R, std(0x161e55, { r: 0.9, extra: { side: THREE.DoubleSide } }), 0.42, 0.95);
  } else if (cls === 'lucas') {
    // Lucas, le héros de « Prout Évasion » : un cube bleu tout rond
    m = {
      blue: std(0x2f6fe4, { r: 0.42, m: 0.05 }), light: std(0x6fa2ff, { r: 0.35 }), shine: std(0x7fb0ff, { r: 0.2, e: 0x2a5cc0, ei: 0.35 }), hair: std(0x7a4520, { r: 0.75 }),
      white: std(0xffffff, { r: 0.25 }), black: std(0x0e0e10, { r: 0.15 }), cheek: std(0xff9aa2, { r: 0.6 }),
      mouth: std(0x7a1f2b, { r: 0.6 }), booger: std(0x8fd14f, { r: 0.15, e: 0x3a7a10, ei: 0.5 }),
      shoe: std(0xf2f2f2, { r: 0.6 }), sole: std(0xd23a2a, { r: 0.6 }), skin,
    };
    R = rig({ legLen: 0.5, torsoLen: 0.6, shoulderW: 0.5, hipW: 0.2, upperArm: 0.24, foreArm: 0.22 });
    limbs(R, { arm: m.blue, hand: m.light, leg: m.blue, foot: m.shoe, skin }, { ua: 0.24, fa: 0.22, th: 0.25, sh: 0.25, ra: 0.075, rf: 0.07, rt: 0.095, rs: 0.09 });
    for (const f of [R.ftL, R.ftR]) mesh(box(0.16, 0.03, 0.25), m.sole, f, [0, -0.05, 0.05]);
    const bodyGeo = geo('lucasBody', () => new RoundedBoxGeometry(1.0, 1.0, 0.9, 5, 0.2));
    const body = mesh(bodyGeo, m.blue, R.torso, [0, 0.47, 0]);
    mesh(geo('lucasShine', () => new RoundedBoxGeometry(0.6, 0.1, 0.03, 3, 0.04)), m.shine, R.torso, [0, 0.84, 0.445]);
    // mèche de cheveux
    mesh(cone(0.17, 0.5, 10), m.hair, R.torso, [0, 1.17, 0.08], [0.35, 0, 0]);
    mesh(cone(0.11, 0.34, 8), m.hair, R.torso, [0.15, 1.08, 0.02], [0.2, 0, -0.55]);
    mesh(cone(0.11, 0.34, 8), m.hair, R.torso, [-0.15, 1.08, 0.02], [0.2, 0, 0.55]);
    // yeux, joues, bouche
    const eyes = [];
    for (const x of [0.2, -0.2]) {
      mesh(sph(0.135, 16, 12), m.white, R.torso, [x, 0.6, 0.41], null, [1, 1, 0.55]);
      eyes.push(mesh(sph(0.065, 12, 8), m.black, R.torso, [x * 0.93, 0.585, 0.475]));
      mesh(sph(0.02, 6, 4), m.white, R.torso, [x * 0.93 + 0.02, 0.61, 0.53]);
      mesh(sph(0.075, 10, 8), m.cheek, R.torso, [x * 1.8, 0.37, 0.43], null, [1, 0.8, 0.35]);
    }
    mesh(geo('lucasMouth', () => new RoundedBoxGeometry(0.26, 0.1, 0.05, 2, 0.03)), m.mouth, R.torso, [0, 0.26, 0.45]);
    // la crotte de nez qui pend :)
    const snot = grp(R.torso, [0.02, 0.44, 0.47]);
    mesh(sph(0.04, 8, 6), m.booger, snot);
    mesh(cap(0.025, 0.06), m.booger, snot, [0, 0, 0.005]);
    const mouthPt = grp(R.torso, [0, 0.26, 0.55]);
    castPoint = mouthPt;
    weapons = { snot, eyes, body };
  } else {
    m = {
      leather: std(0x2c2420, { r: 0.75 }), cloth: std(0x1d3a2b, { r: 0.92, extra: { side: THREE.DoubleSide } }), steel: std(0xc8ced8, { m: 0.95, r: 0.22 }),
      dark: std(0x121212, { r: 0.8 }), belt: std(0x5a3a20, { r: 0.7 }), gold: std(0xb08a40, { m: 1, r: 0.35 }), skin,
    };
    R = rig({ legLen: 0.91, torsoLen: 0.58, shoulderW: 0.22, hipW: 0.1, upperArm: 0.29, foreArm: 0.27 });
    limbs(R, { arm: m.cloth, fore: m.leather, hand: m.dark, leg: m.leather, foot: m.dark, skin }, { ua: 0.29, fa: 0.27, th: 0.455, sh: 0.455, ra: 0.052, rf: 0.05, rt: 0.072, rs: 0.062 });
    mesh(cyl(0.17, 0.2, 0.2, 12), m.leather, R.hips, [0, -0.04, 0]);
    mesh(sph(0.22, 16, 12), m.leather, R.torso, [0, 0.35, 0], null, [0.95, 1.1, 0.72]);
    mesh(torus(0.18, 0.025), m.belt, R.torso, [0, 0.04, 0], [Math.PI / 2, 0, 0]);
    mesh(box(0.025, 0.5, 0.02), m.belt, R.torso, [0, 0.33, 0.165], [0, 0, 0.6]);
    for (const x of [0.12, -0.12]) mesh(box(0.08, 0.08, 0.06), m.belt, R.torso, [x, 0.02, 0.15]);
    for (const s of [R.shL, R.shR]) mesh(hemi(0.11), m.leather, s, [0, 0.01, 0], null, [1.1, 0.8, 1.1]);
    mesh(sph(0.11), skin, R.head, [0, 0.12, 0]);
    mesh(box(0.17, 0.08, 0.1), m.dark, R.head, [0, 0.07, 0.07]);
    const hood = mesh(geo('hood', () => new THREE.SphereGeometry(0.15, 16, 12, Math.PI * 0.75, Math.PI * 1.5, 0, Math.PI * 0.68)), m.cloth, R.head, [0, 0.13, -0.01], null, [1, 1.08, 1.12]);
    hood.material = m.cloth;
    mesh(cone(0.09, 0.2, 10), m.cloth, R.head, [0, 0.22, -0.1], [-1.9, 0, 0]);
    mesh(sph(0.012, 6, 4), std(0x000000, { e: 0x88ffcc, ei: 3 }), R.head, [0.04, 0.135, 0.105]);
    mesh(sph(0.012, 6, 4), std(0x000000, { e: 0x88ffcc, ei: 3 }), R.head, [-0.04, 0.135, 0.105]);
    weapons.main = dagger(R.handR, m);
    weapons.off = dagger(R.handL, m);
    cape = makeCape(R, m.cloth, 0.46, 0.85);
  }
  R.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { R, m, weapons, cape, castPoint };
}

function makeCape(R, mat, w, h) {
  const g = new THREE.PlaneGeometry(w, h, 4, 10).translate(0, -h / 2, 0);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(0, R.o.torsoLen - 0.05, -0.17);
  mesh.castShadow = true;
  R.torso.add(mesh);
  const base = Float32Array.from(g.attributes.position.array);
  return { mesh, base, h };
}

export function animateCape(cape, speed, t, dt) {
  if (!cape) return;
  const p = cape.mesh.geometry.attributes.position;
  const b = cape.base;
  const sp = Math.min(1.5, speed / 6);
  for (let i = 0; i < p.count; i++) {
    const x = b[i * 3], y = b[i * 3 + 1];
    const d = Math.min(1, Math.max(0, -y / cape.h));
    const back = Math.pow(d, 1.3) * (0.12 + sp * 0.45);
    const wave = Math.sin(t * (5 + sp * 6) + d * 5 + x * 4) * 0.04 * d * (0.4 + sp);
    p.setXYZ(i, x * (1 + d * 0.25), y + Math.pow(d, 2) * sp * 0.25 * cape.h, -back + wave - d * 0.05);
  }
  p.needsUpdate = true;
  cape.mesh.geometry.computeVertexNormals();
}

// ---------------------------------------------------------------- Squelette (ennemi)
export function buildSkeleton(archer = false) {
  const m = {
    bone: std(0xd9d0b6, { r: 0.78 }), dark: std(0x161210, { r: 1 }), rust: std(0x6e5240, { m: 0.65, r: 0.55 }),
    eye: std(0x000000, { e: 0xff3018, ei: 7 }), wood: std(0x4a3420, { r: 0.85 }), cloth: std(0x2e2a22, { r: 0.95, extra: { side: THREE.DoubleSide } }),
    steel: null,
  };
  m.steel = m.rust; m.leather = m.dark; m.gold = m.rust;
  const R = rig({ legLen: 0.9, torsoLen: 0.58, shoulderW: 0.21, hipW: 0.1, upperArm: 0.29, foreArm: 0.27 });
  for (const [s, e, h] of [[R.shL, R.elL, R.handL], [R.shR, R.elR, R.handR]]) {
    mesh(cyl(0.024, 0.02, 0.27, 6), m.bone, s, [0, -0.14, 0]);
    mesh(sph(0.035, 8, 6), m.bone, e);
    mesh(cyl(0.02, 0.018, 0.25, 6), m.bone, e, [0, -0.13, 0]);
    mesh(box(0.05, 0.07, 0.03), m.bone, h, [0, -0.02, 0]);
    mesh(sph(0.042, 8, 6), m.bone, s);
  }
  for (const [hp, kn, ft] of [[R.hipL, R.knL, R.ftL], [R.hipR, R.knR, R.ftR]]) {
    mesh(cyl(0.03, 0.025, 0.42, 6), m.bone, hp, [0, -0.22, 0]);
    mesh(sph(0.04, 8, 6), m.bone, kn);
    mesh(cyl(0.025, 0.022, 0.4, 6), m.bone, kn, [0, -0.21, 0]);
    mesh(box(0.07, 0.04, 0.17), m.bone, ft, [0, 0, 0.04]);
  }
  mesh(torus(0.11, 0.025), m.bone, R.hips, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 0.8, 1]);
  mesh(cyl(0.03, 0.03, 0.6, 6), m.bone, R.torso, [0, 0.3, -0.07]);
  const rib = geo('rib', () => new THREE.TorusGeometry(1, 0.11, 4, 14, Math.PI * 1.55).rotateX(Math.PI / 2).rotateY(Math.PI / 4 + Math.PI));
  for (let k = 0; k < 4; k++) {
    const r = 0.15 - k * 0.012;
    mesh(rib, m.bone, R.torso, [0, 0.46 - k * 0.075, -0.02], null, [r, r * 0.9, r * 0.8]);
  }
  mesh(box(0.38, 0.03, 0.04), m.bone, R.torso, [0, 0.54, -0.02]);
  // crâne
  mesh(sph(0.125, 14, 10), m.bone, R.head, [0, 0.14, 0], null, [0.95, 1, 1.08]);
  mesh(box(0.13, 0.05, 0.11), m.bone, R.head, [0, 0.04, 0.04]);
  for (const x of [0.045, -0.045]) {
    mesh(sph(0.034, 8, 6), m.dark, R.head, [x, 0.14, 0.095]);
    const e = mesh(sph(0.017, 6, 4), m.eye, R.head, [x, 0.14, 0.115]);
    e.castShadow = false;
  }
  mesh(box(0.1, 0.012, 0.02), m.dark, R.head, [0, 0.065, 0.1]);
  let weapons = {};
  if (archer) {
    const bow = grp(R.handL, [0, -0.02, 0]);
    bow.rotation.set(0, 0, 0);
    mesh(geo('bow', () => new THREE.TorusGeometry(0.55, 0.018, 5, 18, Math.PI * 0.85).rotateZ(Math.PI / 2 - Math.PI * 0.425)), m.wood, bow, [0, 0, -0.3], [0, Math.PI / 2, 0]);
    weapons.bow = bow;
    mesh(cyl(0.07, 0.06, 0.5, 8), m.dark, R.torso, [0.08, 0.35, -0.16], [0.3, 0, -0.3]);
    weapons.main = { w: bow };
  } else {
    weapons.main = sword(R.handR, m, 0.72, 0.065);
    if (Math.random() < 0.45) {
      const sh = grp(R.handL, [0, 0.08, 0.06]);
      sh.rotation.x = Math.PI / 2;
      mesh(cyl(0.3, 0.3, 0.04, 9), m.wood, sh);
      mesh(hemi(0.07), m.rust, sh, [0, 0.02, 0]);
      weapons.shield = sh;
    }
  }
  if (Math.random() < 0.35) mesh(hemi(0.14), m.rust, R.head, [0, 0.16, 0], null, [1, 0.9, 1.1]);
  if (Math.random() < 0.5) mesh(geo('rag', () => new THREE.CylinderGeometry(0.16, 0.24, 0.32, 8, 1, true)), m.cloth, R.hips, [0, -0.12, 0]);
  return { R, m, weapons };
}

// ---------------------------------------------------------------- Gobelin
export function buildGoblin() {
  const m = {
    skin: std(0x5f8a33, { r: 0.65 }), cloth: std(0x5b3a20, { r: 0.92 }), leather: std(0x2a1d14, { r: 0.8 }),
    steel: std(0x8d8f92, { m: 0.8, r: 0.4 }), eye: std(0x000000, { e: 0xffd21a, ei: 5 }), teeth: std(0xe8dcb8, { r: 0.5 }),
  };
  const R = rig({ scale: 0.78, legLen: 0.72, torsoLen: 0.5, shoulderW: 0.2, hipW: 0.1, upperArm: 0.26, foreArm: 0.25 });
  limbs(R, { arm: m.skin, hand: m.skin, leg: m.skin, foot: m.skin, skin: m.skin }, { ua: 0.26, fa: 0.25, th: 0.36, sh: 0.36, ra: 0.045, rf: 0.04, rt: 0.06, rs: 0.05 });
  mesh(cyl(0.17, 0.22, 0.26, 8), m.cloth, R.hips, [0, -0.08, 0]);
  mesh(sph(0.21, 14, 10), m.cloth, R.torso, [0, 0.27, 0], null, [1, 1.05, 0.85]);
  mesh(torus(0.18, 0.03), m.leather, R.torso, [0, 0.08, 0], [Math.PI / 2, 0, 0]);
  mesh(sph(0.2, 16, 12), m.skin, R.head, [0, 0.14, 0.02], null, [1.05, 0.92, 1.05]);
  mesh(geo('earL', () => new THREE.ConeGeometry(0.06, 0.3, 6).rotateZ(-Math.PI / 2 + 0.25)), m.skin, R.head, [0.25, 0.18, -0.02], [0, 0.3, 0]);
  mesh(geo('earR', () => new THREE.ConeGeometry(0.06, 0.3, 6).rotateZ(Math.PI / 2 - 0.25)), m.skin, R.head, [-0.25, 0.18, -0.02], [0, -0.3, 0]);
  mesh(geo('nose', () => new THREE.ConeGeometry(0.04, 0.16, 6).rotateX(Math.PI / 2)), m.skin, R.head, [0, 0.12, 0.25]);
  for (const x of [0.075, -0.075]) { const e = mesh(sph(0.035, 8, 6), m.eye, R.head, [x, 0.18, 0.18]); e.castShadow = false; }
  for (const x of [0.06, -0.06]) mesh(cone(0.015, 0.05, 4), m.teeth, R.head, [x, 0.04, 0.2], [Math.PI, 0, 0]);
  const weapons = { main: sword(R.handR, { steel: m.steel, leather: m.leather, gold: m.leather }, 0.5, 0.07) };
  return { R, m, weapons, lean: 0.35 };
}

// ---------------------------------------------------------------- Ogre
export function buildOgre() {
  const m = {
    skin: std(0x8d8462, { r: 0.7 }), cloth: std(0x4d3420, { r: 0.92 }), leather: std(0x2a1d14, { r: 0.8 }),
    wood: std(0x4a3018, { r: 0.85 }), iron: std(0x45454a, { m: 0.85, r: 0.4 }), eye: std(0x000000, { e: 0xff5a10, ei: 5 }), teeth: std(0xe8dcb8, { r: 0.5 }),
  };
  const R = rig({ scale: 1.65, legLen: 0.8, torsoLen: 0.62, shoulderW: 0.3, hipW: 0.14, upperArm: 0.32, foreArm: 0.3 });
  limbs(R, { arm: m.skin, hand: m.skin, leg: m.skin, foot: m.leather, skin: m.skin }, { ua: 0.32, fa: 0.3, th: 0.4, sh: 0.4, ra: 0.09, rf: 0.085, rt: 0.11, rs: 0.095 });
  mesh(cyl(0.27, 0.33, 0.3, 10), m.cloth, R.hips, [0, -0.08, 0]);
  mesh(sph(0.33, 16, 12), m.skin, R.torso, [0, 0.25, 0.05], null, [1.05, 1, 0.95]);
  mesh(sph(0.3, 16, 12), m.skin, R.torso, [0, 0.48, -0.02], null, [1.2, 0.8, 0.85]);
  mesh(torus(0.3, 0.04), m.leather, R.torso, [0, 0.05, 0.02], [Math.PI / 2, 0, 0]);
  mesh(sph(0.15, 14, 10), m.skin, R.head, [0, 0.08, 0.06]);
  mesh(box(0.22, 0.06, 0.08), m.skin, R.head, [0, 0.14, 0.15]);
  mesh(box(0.2, 0.08, 0.14), m.skin, R.head, [0, 0.0, 0.1]);
  for (const x of [0.06, -0.06]) {
    mesh(cone(0.022, 0.11, 6), m.teeth, R.head, [x, 0.06, 0.17]);
    const e = mesh(sph(0.022, 6, 4), m.eye, R.head, [x * 0.9, 0.1, 0.19]); e.castShadow = false;
  }
  const club = grp(R.handR);
  club.rotation.x = 0.3;
  mesh(geo('club', () => new THREE.CylinderGeometry(0.11, 0.045, 1.1, 8).rotateX(Math.PI / 2)), m.wood, club, [0, 0, 0.5]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    mesh(cone(0.03, 0.12, 4), m.iron, club, [Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.85 + (k % 2) * 0.1], [Math.sin(a) * 1.57, 0, -Math.cos(a) * 1.57 + Math.PI]);
  }
  const weapons = { main: { w: club, base: grp(club, [0, 0, 0.4]), tip: grp(club, [0, 0, 1.05]) } };
  return { R, m, weapons, lean: 0.2 };
}

// ---------------------------------------------------------------- Cube gélatineux
export function buildCube() {
  const m = {
    jelly: new THREE.MeshStandardMaterial({ color: 0x48d070, transparent: true, opacity: 0.42, roughness: 0.05, metalness: 0.1, emissive: 0x0b4a18, emissiveIntensity: 0.9, depthWrite: false }),
    bone: std(0xd0c8ae, { r: 0.8 }), steel: std(0x8a8c90, { m: 0.8, r: 0.4 }), gold: std(0xdcae50, { m: 1, r: 0.3 }),
  };
  const root = new THREE.Group();
  const body = grp(root);
  const cube = new THREE.Mesh(geo('cube', () => new THREE.BoxGeometry(2.2, 2.2, 2.2, 3, 3, 3).translate(0, 1.1, 0)), m.jelly);
  cube.renderOrder = 6;
  body.add(cube);
  mesh(sph(0.15, 10, 8), m.bone, body, [0.3, 0.9, 0.2], [0.4, 0.8, 0]);
  mesh(cyl(0.03, 0.03, 0.6, 5), m.bone, body, [-0.4, 0.6, -0.3], [0.5, 0, 1.2]);
  mesh(cyl(0.03, 0.03, 0.5, 5), m.bone, body, [0.1, 1.4, -0.4], [1.2, 0.4, 0.2]);
  mesh(box(0.05, 0.015, 0.8), m.steel, body, [-0.2, 1.2, 0.3], [0.4, 0.9, 0.3]);
  for (let k = 0; k < 6; k++) mesh(cyl(0.08, 0.08, 0.015, 8), m.gold, body, [Math.random() - 0.5, 0.2 + Math.random() * 1.5, Math.random() - 0.5], [Math.random() * 3, 0, Math.random() * 3]);
  return { root, body, cube, m };
}

// ---------------------------------------------------------------- Dragon
let dragonTex = null;
export function buildDragon() {
  if (!dragonTex) {
    dragonTex = scaleTextures();
    for (const t of Object.values(dragonTex)) t.repeat.set(5, 5);
  }
  const m = {
    scale: new THREE.MeshStandardMaterial({ color: 0xc23a22, map: dragonTex.map, normalMap: dragonTex.normalMap, roughnessMap: dragonTex.roughnessMap, metalness: 0.2, normalScale: new THREE.Vector2(1.5, 1.5) }),
    belly: std(0xc8954e, { r: 0.55 }),
    horn: std(0x2c231c, { r: 0.35 }),
    membrane: new THREE.MeshStandardMaterial({ color: 0x6e120c, roughness: 0.65, side: THREE.DoubleSide, emissive: 0x2a0402, emissiveIntensity: 1 }),
    claw: std(0x15110e, { r: 0.3 }),
    eye: std(0x000000, { e: 0xffb21a, ei: 9 }),
    teeth: std(0xefe6ce, { r: 0.4 }),
    glow: std(0x000000, { e: 0xff5a12, ei: 0 }),
  };
  const root = new THREE.Group();
  const body = grp(root, [0, 2.7, 0]);
  mesh(sph(1, 28, 18), m.scale, body, [0, 0, 0], null, [1.35, 1.15, 2.3]);
  mesh(sph(1, 22, 14), m.belly, body, [0, -0.38, 0.15], null, [1.1, 0.85, 2.0]);
  mesh(sph(1, 22, 14), m.scale, body, [0, 0.25, 1.55], null, [1.2, 1.15, 1.1]);
  mesh(sph(1, 22, 14), m.scale, body, [0, 0.1, -1.7], null, [1.1, 1.0, 1.15]);
  for (let k = 0; k < 9; k++) {
    const z = 2.1 - k * 0.5;
    const y = 1.1 + Math.cos((z / 3) * 1.2) * 0.12 + (k < 2 ? 0.1 : 0);
    mesh(cone(0.14, 0.55 - k * 0.025, 6), m.horn, body, [0, y, z], [-0.35, 0, 0]);
  }
  // cou
  const neck = [];
  for (let k = 0; k < 8; k++) neck.push(mesh(sph(0.78 - k * 0.045, 16, 12), m.scale, root));
  const neckSpikes = [];
  for (let k = 0; k < 7; k++) neckSpikes.push(mesh(cone(0.1, 0.4, 5), m.horn, root));
  // tête
  const head = grp(root);
  mesh(sph(0.62, 20, 14), m.scale, head, [0, 0, 0], null, [1, 0.82, 1.15]);
  mesh(sph(1, 18, 12), m.scale, head, [0, -0.06, 0.82], null, [0.42, 0.3, 0.78]);
  mesh(box(0.85, 0.16, 0.3), m.scale, head, [0, 0.33, 0.35], [0.25, 0, 0]);
  const jaw = grp(head, [0, -0.25, 0.2]);
  mesh(sph(1, 16, 10), m.scale, jaw, [0, -0.04, 0.62], null, [0.36, 0.13, 0.78]);
  mesh(sph(1, 12, 8), m.belly, jaw, [0, -0.1, 0.4], null, [0.3, 0.1, 0.55]);
  for (let k = 0; k < 6; k++) {
    for (const s of [1, -1]) {
      mesh(cone(0.035, 0.13, 4), m.teeth, jaw, [s * (0.27 - k * 0.025), 0.06, 0.25 + k * 0.17]);
      mesh(cone(0.035, 0.14, 4), m.teeth, head, [s * (0.3 - k * 0.025), -0.32, 0.4 + k * 0.17], [Math.PI, 0, 0]);
    }
  }
  for (const s of [1, -1]) {
    mesh(cone(0.13, 1.25, 7), m.horn, head, [s * 0.36, 0.38, -0.45], [-2.35, 0, s * -0.35]);
    mesh(cone(0.08, 0.7, 6), m.horn, head, [s * 0.52, 0.1, -0.35], [-2.0, 0, s * -0.9]);
    mesh(cone(0.05, 0.3, 5), m.horn, head, [s * 0.2, 0.05, 1.45], [-0.6, 0, 0]);
    const e = mesh(sph(0.085, 10, 8), m.eye, head, [s * 0.36, 0.17, 0.42]);
    e.castShadow = false;
    mesh(sph(0.04, 6, 4), m.glow, head, [s * 0.12, -0.02, 1.55]);
  }
  const throat = mesh(sph(0.22, 10, 8), m.glow, jaw, [0, 0.12, 0.5]);
  throat.castShadow = false;
  const mouth = grp(head, [0, -0.2, 1.4]);
  // queue
  const tail = [];
  for (let k = 0; k < 13; k++) tail.push(mesh(sph(0.68 - k * 0.048, 14, 10), m.scale, root));
  const spade = mesh(geo('spade', () => new THREE.ConeGeometry(0.42, 0.8, 4).rotateX(-Math.PI / 2).scale(1, 0.25, 1)), m.horn, root);
  // pattes
  const legs = [];
  for (const [x, z, front] of [[1.05, 1.35, true], [-1.05, 1.35, true], [1.05, -1.5, false], [-1.05, -1.5, false]]) {
    const hip = grp(body, [x, -0.45, z]);
    mesh(cap(0.42, 0.55), m.scale, hip, null, null, [1.25, 1, 1.35]);
    const knee = grp(hip, [0, -1.15, 0]);
    mesh(cap(0.27, 0.6), m.scale, knee);
    const foot = grp(knee, [0, -1.12, 0]);
    mesh(sph(1, 12, 8), m.scale, foot, [0, 0.0, 0.18], null, [0.34, 0.18, 0.48]);
    for (const cx of [-0.18, 0, 0.18]) mesh(geo('claw', () => new THREE.ConeGeometry(0.06, 0.3, 5).rotateX(Math.PI / 2 + 0.4)), m.claw, foot, [cx, -0.04, 0.6]);
    legs.push({ hip, knee, foot, front, side: Math.sign(x) });
  }
  // ailes
  const wingGeo = makeWingGeometry();
  const wingL = grp(body, [0.85, 0.95, 0.9]);
  const wingR = grp(body, [-0.85, 0.95, 0.9]);
  const wl = new THREE.Mesh(wingGeo.membrane, m.membrane); wl.castShadow = true; wingL.add(wl);
  const wr = new THREE.Mesh(wingGeo.membraneR, m.membrane); wr.castShadow = true; wingR.add(wr);
  for (const [a, b, r] of wingGeo.bones) {
    for (const [wg, s] of [[wingL, 1], [wingR, -1]]) {
      const A = new V3(a[0] * s, a[1], a[2]), B = new V3(b[0] * s, b[1], b[2]);
      const len = A.distanceTo(B);
      const c = new THREE.Mesh(cyl(r * 0.7, r, 1, 6), m.scale);
      c.scale.set(1, len, 1);
      c.position.copy(A).add(B).multiplyScalar(0.5);
      c.quaternion.setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
      c.castShadow = true;
      wg.add(c);
    }
  }
  root.scale.setScalar(1.3);
  root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return { root, body, neck, neckSpikes, head, jaw, mouth, tail, spade, legs, wingL, wingR, m, throat };
}

function makeWingGeometry() {
  const S = [0, 0, 0], E = [2.0, 0.7, -0.5], Wr = [3.9, 1.5, -0.3];
  const F1 = [6.6, 0.7, -1.2], F2 = [5.9, -0.2, -2.6], F3 = [4.3, -0.6, -3.6], B = [0.2, -0.4, -2.9];
  const tris = [[S, E, B], [E, F3, B], [E, Wr, F3], [Wr, F2, F3], [Wr, F1, F2]];
  const build = (s) => {
    const pos = [];
    for (const t of tris) for (const p of t) pos.push(p[0] * s, p[1], p[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  };
  return {
    membrane: build(1),
    membraneR: build(-1),
    bones: [[S, E, 0.16], [E, Wr, 0.12], [Wr, F1, 0.07], [Wr, F2, 0.06], [Wr, F3, 0.06]],
  };
}

// ---------------------------------------------------------------- Animation
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _x = new V3(), _y = new V3(), _z = new V3();
const _zh = new V3();
const toV = (v, out) => (Array.isArray(v) ? out.set(v[0], v[1], v[2]) : out.copy(v));
export function aimQuat(d, zh, out = _q) {
  toV(d, _y).normalize().negate();
  toV(zh, _zh);
  _z.copy(_zh).addScaledVector(_y, -_zh.dot(_y));
  if (_z.lengthSq() < 1e-5) { _z.set(0, 0, 1).addScaledVector(_y, -_y.z); if (_z.lengthSq() < 1e-5) _z.set(1, 0, 0); }
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

const _dL = new V3(), _dR = new V3(), _zF = new V3(0, 0, 1);
// P: { walk, amt, armR:{d,z}, armL:{d,z}, sharp, torsoYaw, lean, crouch, roll, elbowR, elbowL, headPitch }
export function poseHumanoid(R, P, dt) {
  const k = 1 - Math.exp(-(P.sharp ? 45 : 14) * dt);
  const kl = 1 - Math.exp(-14 * dt);
  const s = Math.sin(P.walk || 0), c = Math.cos(P.walk || 0), a = P.amt || 0;
  const cr = P.crouch || 0;
  R.hipL.rotation.x = lerp(R.hipL.rotation.x, -s * 0.75 * a - cr * 0.7, kl);
  R.hipR.rotation.x = lerp(R.hipR.rotation.x, s * 0.75 * a - cr * 0.7, kl);
  R.knL.rotation.x = lerp(R.knL.rotation.x, Math.max(0, c) * 1.1 * a + 0.05 + cr * 1.2, kl);
  R.knR.rotation.x = lerp(R.knR.rotation.x, Math.max(0, -c) * 1.1 * a + 0.05 + cr * 1.2, kl);
  R.ftL.rotation.x = lerp(R.ftL.rotation.x, -cr * 0.5, kl);
  R.ftR.rotation.x = lerp(R.ftR.rotation.x, -cr * 0.5, kl);
  const pv = P.pivot || 0;
  R.hips.position.y = R.o.legLen - Math.abs(c) * 0.05 * a - cr * 0.22 - pv;
  R.hips.position.z = cr * -0.05;
  if (P.armL) aimQuat(P.armL.d, P.armL.z);
  else aimQuat(_dL.set(0.14, -1, -s * 0.55 * a), _zF);
  R.shL.quaternion.slerp(_q, P.armL && P.sharp ? k : kl);
  if (P.armR) aimQuat(P.armR.d, P.armR.z);
  else aimQuat(_dR.set(-0.14, -1, s * 0.55 * a), _zF);
  R.shR.quaternion.slerp(_q, P.armR && P.sharp ? k : kl);
  R.elL.rotation.x = lerp(R.elL.rotation.x, -(P.elbowL ?? 0.3), kl);
  R.elR.rotation.x = lerp(R.elR.rotation.x, -(P.elbowR ?? 0.3), P.sharp ? k : kl);
  R.torso.rotation.y = lerp(R.torso.rotation.y, P.torsoYaw || 0, P.sharp ? k : kl);
  R.torso.rotation.x = lerp(R.torso.rotation.x, (P.lean || 0) + a * 0.08, kl);
  R.torso.rotation.z = lerp(R.torso.rotation.z, -s * 0.04 * a, kl);
  R.head.rotation.x = lerp(R.head.rotation.x, P.headPitch || 0, kl);
  R.body.rotation.x = P.roll || 0;
  R.body.rotation.z = P.rollZ || 0;
  R.body.position.y = pv + (P.bodyY || 0);
}

// ---- Dragon
const _P0 = new V3(), _C = new V3(), _H = new V3(), _tmp = new V3();
export function animateDragon(D, s, dt) {
  const t = s.t;
  // corps : respiration + soulèvement
  D.body.position.y = 2.7 + Math.sin(t * 1.4) * 0.06 + (s.lift || 0);
  D.body.rotation.x = s.bodyPitch || 0;
  // cou (bézier quadratique)
  _P0.set(0, D.body.position.y + 0.7, 2.0);
  _H.copy(s.headPos);
  _C.set(0, _P0.y + 1.4, 2.4).lerp(_tmp.copy(_P0).add(_H).multiplyScalar(0.5).add(new V3(0, 0.8, 0)), 0.5);
  const N = D.neck.length;
  for (let k = 0; k < N; k++) {
    const u = (k + 0.5) / N * 0.92;
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    D.neck[k].position.set(_P0.x * a + _C.x * b + _H.x * c, _P0.y * a + _C.y * b + _H.y * c, _P0.z * a + _C.z * b + _H.z * c);
  }
  for (let k = 0; k < D.neckSpikes.length; k++) {
    const sp = D.neckSpikes[k], seg = D.neck[k];
    sp.position.copy(seg.position);
    sp.position.y += 0.6 - k * 0.04;
    sp.rotation.x = -0.6;
  }
  // tête : orientation selon la fin du cou + inclinaison voulue
  const pPrev = D.neck[N - 2].position;
  _tmp.copy(_H).sub(pPrev);
  const yaw = Math.atan2(_tmp.x, _tmp.z);
  const pitch = -Math.atan2(_tmp.y, Math.hypot(_tmp.x, _tmp.z)) * 0.5 + (s.headPitch || 0);
  D.head.position.copy(_H);
  D.head.rotation.set(pitch, yaw, 0, 'YXZ');
  D.jaw.rotation.x = s.jaw || 0;
  D.m.glow.emissiveIntensity = (s.glow || 0) * 12;
  // queue
  let ang = 0;
  const p = _tmp.set(0, D.body.position.y + 0.1, -2.7);
  for (let k = 0; k < D.tail.length; k++) {
    ang += (s.tailSwing || 0) / D.tail.length + Math.sin(t * 1.7 - k * 0.45) * 0.035;
    p.x += Math.sin(ang) * 0.55;
    p.z -= Math.cos(ang) * 0.55;
    p.y = Math.max(0.5 + k * 0.01, p.y - 0.17);
    D.tail[k].position.copy(p);
  }
  D.spade.position.copy(p).add(new V3(Math.sin(ang) * 0.5, 0, -Math.cos(ang) * 0.5));
  D.spade.rotation.y = -ang + Math.PI;
  // pattes
  const w = s.walk || 0, ph = s.phase || 0;
  for (const L of D.legs) {
    const off = (L.front ? 0 : Math.PI) + (L.side > 0 ? 0 : Math.PI);
    const sw = Math.sin(ph + off) * 0.45 * w;
    const lift = Math.max(0, Math.cos(ph + off)) * 0.6 * w;
    L.hip.rotation.x = -sw + (L.front ? -0.25 : 0.3);
    L.knee.rotation.x = (L.front ? 0.35 : -0.15) + lift;
    L.foot.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x);
  }
  // ailes
  const spread = s.wingSpread ?? 0;
  const flap = Math.sin(s.flap || 0) * 0.7 * spread;
  for (const [wg, sg] of [[D.wingL, 1], [D.wingR, -1]]) {
    wg.rotation.set(0, sg * (1 - spread) * 1.15, sg * (0.25 + flap + (1 - spread) * 0.35), 'YXZ');
    wg.scale.set(0.5 + 0.5 * spread, 1, 0.7 + 0.3 * spread);
  }
}
