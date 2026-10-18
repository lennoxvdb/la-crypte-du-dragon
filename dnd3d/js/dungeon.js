// Génération procédurale du donjon + construction des maillages + requêtes spatiales.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';
import { mulberry32, smoothstep, shuffle } from './util.js';
import { makeFlames, flameUniforms } from './fx.js';
import { wallTextures, floorTextures, ceilingTextures, bannerTexture, cobwebTexture, runeTexture, crateTexture } from './textures.js';

export const CELL = 3;
export const WALL_H = 7;
export const T = { WALL: 0, FLOOR: 1, LAVA: 2, PIT: 3 };

export const FLOORS = [
  null,
  { name: 'Les Caves de Valcendre', size: 46, rooms: [8, 10], torch: [1.0, 0.5, 0.18], fog: 0x0b0806, wallTint: 0xc4b6a2, banner: 'red',
    enemies: { gobelin: 5, squelette: 3 }, perRoom: [1, 3] },
  { name: 'Les Catacombes oubliées', size: 50, rooms: [9, 11], torch: [1.0, 0.48, 0.16], fog: 0x08080b, wallTint: 0xa8a8b0, banner: 'blue',
    enemies: { squelette: 5, archer: 3, gobelin: 2 }, perRoom: [1, 3], traps: 4 },
  { name: 'La Forge des Gobelins', size: 54, rooms: [10, 12], torch: [1.0, 0.4, 0.12], fog: 0x0e0604, wallTint: 0xb08c78, banner: 'red',
    enemies: { gobelin: 5, archer: 2, squelette: 2, cube: 1 }, perRoom: [2, 3], traps: 5, lava: true, guardian: 'ogre' },
  { name: 'Le Sanctuaire profané', size: 56, rooms: [10, 12], torch: [0.35, 1.0, 0.75], fog: 0x040a09, wallTint: 0x92a4a0, banner: 'green',
    enemies: { squelette: 4, archer: 3, cube: 2, gobelin: 2 }, perRoom: [2, 4], traps: 7, guardian: 'ogre' },
  { name: "L'Antre de Pyraxis", boss: true, size: 60, torch: [1.0, 0.36, 0.1], fog: 0x100603, wallTint: 0x9a7466, banner: 'red' },
];

// ---------------------------------------------------------------- Ressources partagées
let A = null;
export function initDungeonAssets() {
  if (A) return A;
  const wall = wallTextures(), floor = floorTextures(), ceil = ceilingTextures();
  const lavaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: flameUniforms.uTime },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime; varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.1; a*=0.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.33;
        float n = fbm(p + vec2(uTime*0.07, uTime*0.04));
        float n2 = fbm(p*2.2 - vec2(uTime*0.11, -uTime*0.06) + n*2.0);
        float v = smoothstep(0.25, 0.85, n2*0.75 + n*0.45);
        vec3 crust = vec3(0.05, 0.012, 0.005);
        vec3 hot = vec3(5.0, 1.0, 0.1);
        vec3 white = vec3(9.0, 4.5, 1.2);
        vec3 col = mix(crust, hot, v);
        col = mix(col, white, smoothstep(0.82, 1.0, v));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const rune = runeTexture();
  const barrelProfile = [[0.001, 0], [0.37, 0], [0.43, 0.22], [0.46, 0.5], [0.43, 0.78], [0.37, 1.0], [0.001, 1.0]].map(([x, y]) => new THREE.Vector2(x, y));
  const pillarH = WALL_H - 1.1;
  const pillarGeo = mergeGeometries([
    new THREE.BoxGeometry(1.6, 0.5, 1.6).translate(0, 0.25, 0),
    new THREE.CylinderGeometry(0.58, 0.66, pillarH, 16).translate(0, 0.5 + pillarH / 2, 0),
    new THREE.TorusGeometry(0.66, 0.08, 6, 16).rotateX(Math.PI / 2).translate(0, 0.6, 0),
    new THREE.BoxGeometry(1.45, 0.6, 1.45).translate(0, WALL_H - 0.3, 0),
  ]);
  const handle = new THREE.CylinderGeometry(0.045, 0.06, 0.62, 8).rotateX(0.55).translate(0, 0.12, 0.17);
  const bracketGeo = mergeGeometries([
    new THREE.BoxGeometry(0.26, 0.5, 0.06).translate(0, 0, 0.03),
    handle,
    new THREE.CylinderGeometry(0.13, 0.07, 0.16, 10).translate(0, 0.4, 0.33),
  ]);
  const brazierGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.45, 0.55, 0.16, 12).translate(0, 0.08, 0),
    new THREE.CylinderGeometry(0.1, 0.16, 0.95, 8).translate(0, 0.6, 0),
    new THREE.CylinderGeometry(0.7, 0.35, 0.42, 14).translate(0, 1.25, 0),
    new THREE.TorusGeometry(0.7, 0.05, 6, 18).rotateX(Math.PI / 2).translate(0, 1.46, 0),
  ]);
  const stone = new THREE.MeshStandardMaterial({ map: ceil.map, normalMap: ceil.normalMap, roughness: 0.9, color: 0xb8ad9f });
  A = {
    wallMat: new THREE.MeshStandardMaterial({ map: wall.map, normalMap: wall.normalMap, roughnessMap: wall.roughnessMap, vertexColors: true, normalScale: new THREE.Vector2(1.3, 1.3) }),
    floorMat: new THREE.MeshStandardMaterial({ map: floor.map, normalMap: floor.normalMap, roughnessMap: floor.roughnessMap, vertexColors: true, normalScale: new THREE.Vector2(1.1, 1.1) }),
    ceilMat: new THREE.MeshStandardMaterial({ map: ceil.map, normalMap: ceil.normalMap, roughnessMap: ceil.roughnessMap, vertexColors: true, color: 0x6e655e }),
    stone,
    lavaMat,
    wood: new THREE.MeshStandardMaterial({ color: 0x6a4426, roughness: 0.82 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x3c3b3e, roughness: 0.45, metalness: 0.85 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b050, roughness: 0.25, metalness: 1.0, emissive: 0x3a2200, emissiveIntensity: 0.4 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xd6ceb6, roughness: 0.75 }),
    coal: new THREE.MeshStandardMaterial({ color: 0x110805, emissive: 0xff3a08, emissiveIntensity: 1.6, roughness: 1 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 }),
    banners: {
      red: new THREE.MeshStandardMaterial({ map: bannerTexture('red'), side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.95 }),
      green: new THREE.MeshStandardMaterial({ map: bannerTexture('green'), side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.95 }),
      blue: new THREE.MeshStandardMaterial({ map: bannerTexture('blue'), side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.95 }),
    },
    cobweb: new THREE.MeshBasicMaterial({ map: cobwebTexture(), transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, color: 0x8a8a8a }),
    rune: new THREE.MeshBasicMaterial({ map: rune, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.3, 0.9, 2.2) }),
    runeRed: new THREE.MeshBasicMaterial({ map: rune, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 0.4, 0.15) }),
    geo: {
      pillar: pillarGeo,
      bracket: bracketGeo,
      brazier: brazierGeo,
      barrel: new THREE.LatheGeometry(barrelProfile, 14),
      band: new THREE.TorusGeometry(0.445, 0.022, 5, 18).rotateX(Math.PI / 2),
      crate: new THREE.BoxGeometry(0.95, 0.95, 0.95).translate(0, 0.475, 0),
      skull: new THREE.SphereGeometry(0.15, 10, 8).scale(1, 0.95, 1.15),
      bone: new THREE.CylinderGeometry(0.028, 0.028, 0.5, 5).rotateZ(Math.PI / 2),
      rock: new THREE.DodecahedronGeometry(0.28),
      banner: new THREE.PlaneGeometry(1.3, 2.6),
      rod: new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6).rotateZ(Math.PI / 2),
      cobweb: new THREE.PlaneGeometry(3.4, 2.6),
      coin: new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10),
    },
  };
  return A;
}

// ---------------------------------------------------------------- Constructeur de géométrie
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.v = 0; }
  quad(P, n, UV, C) {
    for (let k = 0; k < 4; k++) {
      this.p.push(P[k][0], P[k][1], P[k][2]);
      this.n.push(n[0], n[1], n[2]);
      this.uv.push(UV[k][0], UV[k][1]);
      this.c.push(C[k], C[k], C[k]);
    }
    const v = this.v;
    this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- Donjon
export class Dungeon {
  constructor(floor, seed = (Math.random() * 1e9) | 0) {
    this.floor = floor;
    this.cfg = FLOORS[floor];
    this.rng = mulberry32(seed);
    this.W = this.H = this.cfg.size;
    const N = this.W * this.H;
    this.grid = new Uint8Array(N);
    this.solid = new Uint8Array(N);
    this.roomOf = new Int16Array(N).fill(-1);
    this.explored = new Uint8Array(N);
    this.dist = new Int16Array(N).fill(-1);
    this.queue = new Int32Array(N);
    this.circles = new Map();
    this.rooms = [];
    this.lights = [];
    this.torches = [];
    this.banners = [];
    this.cobwebs = [];
    this.props = { barrels: [], crates: [], skulls: [], bones: [], rocks: [], pillars: [], braziers: [] };
    this.chestSpots = [];
    this.trapSpots = [];
    this.shrineSpot = null;
    this.stairs = null;
    this.group = new THREE.Group();
    this.disposables = [];
    this.torchColor = new THREE.Color(...this.cfg.torch);
    this.wallH = this.cfg.boss ? 13 : WALL_H;
    this.generate();
  }

  // --- accès grille
  inb(i, j) { return i >= 0 && j >= 0 && i < this.W && j < this.H; }
  get(i, j) { return this.inb(i, j) ? this.grid[j * this.W + i] : T.WALL; }
  set(i, j, v) { if (this.inb(i, j)) this.grid[j * this.W + i] = v; }
  ci(x) { return Math.floor(x / CELL); }
  wx(i) { return (i + 0.5) * CELL; }
  passable(i, j) { return this.get(i, j) === T.FLOOR; }
  pathable(i, j) { return this.get(i, j) === T.FLOOR && !this.solid[j * this.W + i]; }
  isWallAt(x, z) { return this.get(this.ci(x), this.ci(z)) === T.WALL; }
  carve(x, y, w, h, t = T.FLOOR, room = -1) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      this.set(i, j, t);
      if (room >= 0 && this.inb(i, j)) this.roomOf[j * this.W + i] = room;
    }
  }
  addCircle(x, z, r, markSolid = true) {
    const i = this.ci(x), j = this.ci(z);
    const k = j * this.W + i;
    if (!this.circles.has(k)) this.circles.set(k, []);
    this.circles.get(k).push({ x, z, r });
    if (markSolid) this.solid[k] = 1;
  }
  roomAt(x, z) {
    const i = this.ci(x), j = this.ci(z);
    if (!this.inb(i, j)) return null;
    const r = this.roomOf[j * this.W + i];
    return r >= 0 ? this.rooms[r] : null;
  }

  // ------------------------------------------------------------ Génération
  generate() {
    if (this.cfg.boss) this.genBoss();
    else this.genStandard();
    this.decorate();
  }

  genStandard() {
    const r = this.rng, W = this.W, H = this.H, cfg = this.cfg;
    const target = cfg.rooms[0] + Math.floor(r() * (cfg.rooms[1] - cfg.rooms[0] + 1));
    for (let t = 0; t < 1000 && this.rooms.length < target; t++) {
      const w = 5 + Math.floor(r() * 6), h = 5 + Math.floor(r() * 6);
      const x = 2 + Math.floor(r() * (W - w - 4)), y = 2 + Math.floor(r() * (H - h - 4));
      if (this.rooms.some((o) => x < o.x + o.w + 3 && x + w + 3 > o.x && y < o.y + o.h + 3 && y + h + 3 > o.y)) continue;
      this.rooms.push({ x, y, w, h, cx: x + Math.floor((w - 1) / 2), cy: y + Math.floor((h - 1) / 2), type: 'normal' });
    }
    this.rooms.forEach((rm, k) => this.carve(rm.x, rm.y, rm.w, rm.h, T.FLOOR, k));
    const n = this.rooms.length;
    const d2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
    for (let i = 1; i < n; i++) {
      let best = 0, bd = 1e9;
      for (let j = 0; j < i; j++) { const d = d2(this.rooms[i], this.rooms[j]); if (d < bd) { bd = d; best = j; } }
      this.corridor(this.rooms[i], this.rooms[best]);
    }
    for (let k = 0; k < 3; k++) {
      const a = Math.floor(r() * n), b = Math.floor(r() * n);
      if (a !== b && d2(this.rooms[a], this.rooms[b]) < 30 * 30) this.corridor(this.rooms[a], this.rooms[b]);
    }
    // départ / sortie
    this.startRoom = this.rooms[0];
    this.startRoom.type = 'start';
    this.bfs(this.startRoom.cx, this.startRoom.cy, false);
    let far = this.rooms[1], fd = -1;
    for (const rm of this.rooms) {
      const d = this.dist[rm.cy * W + rm.cx];
      if (rm !== this.startRoom && d > fd) { fd = d; far = rm; }
    }
    this.exitRoom = far;
    far.type = 'exit';
    // lave
    if (cfg.lava) {
      const cands = shuffle(this.rooms.filter((rm) => rm.type === 'normal' && rm.w >= 8 && rm.h >= 8), r);
      for (const rm of cands.slice(0, 2)) {
        rm.lava = true;
        this.carve(rm.x + 2, rm.y + 2, rm.w - 4, rm.h - 4, T.LAVA);
      }
    }
    // escalier (2x2 cases au centre de la salle de sortie)
    const sx = far.cx, sy = far.cy;
    this.carve(sx, sy, 2, 2, T.PIT);
    this.stairs = { i: sx, j: sy, x: (sx + 1) * CELL, z: (sy + 1) * CELL };
  }

  corridor(a, b) {
    if (this.rng() < 0.5) { this.hline(a.cx, b.cx, a.cy); this.vline(a.cy, b.cy, b.cx); }
    else { this.vline(a.cy, b.cy, a.cx); this.hline(a.cx, b.cx, b.cy); }
  }
  hline(x0, x1, y) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1) + 1;
    for (let x = lo; x <= hi; x++) for (let k = 0; k < 2; k++) if (this.get(x, y + k) === T.WALL) this.set(x, y + k, T.FLOOR);
  }
  vline(y0, y1, x) {
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1) + 1;
    for (let y = lo; y <= hi; y++) for (let k = 0; k < 2; k++) if (this.get(x + k, y) === T.WALL) this.set(x + k, y, T.FLOOR);
  }

  genBoss() {
    const hall = { x: 12, y: 6, w: 36, h: 32, type: 'boss' };
    const ante = { x: 25, y: 46, w: 10, h: 9, type: 'start' };
    hall.cx = 29; hall.cy = 20; ante.cx = 29; ante.cy = 50;
    this.rooms.push(ante, hall);
    this.carve(ante.x, ante.y, ante.w, ante.h, T.FLOOR, 0);
    this.carve(hall.x, hall.y, hall.w, hall.h, T.FLOOR, 1);
    this.carve(29, 38, 2, 8, T.FLOOR);
    // fosses de lave
    this.carve(14, 9, 5, 9, T.LAVA);
    this.carve(41, 9, 5, 9, T.LAVA);
    this.carve(14, 27, 4, 8, T.LAVA);
    this.carve(42, 27, 4, 8, T.LAVA);
    this.startRoom = ante;
    this.bossRoom = hall;
    this.exitRoom = hall;
    this.dragonSpawn = { x: 30 * CELL, z: 15 * CELL };
    this.hoard = { x: 30 * CELL, z: 8 * CELL };
  }

  // ------------------------------------------------------------ Décoration / emplacements
  decorate() {
    const r = this.rng, W = this.W;
    const isWall = (i, j) => this.get(i, j) === T.WALL;
    const nearTorch = (x, z, d) => this.torches.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < d * d);
    const addTorch = (i, j, di, dj) => {
      const ax = this.wx(i) + di * CELL / 2, az = this.wx(j) + dj * CELL / 2;
      if (nearTorch(ax, az, 4.5)) return false;
      const yaw = Math.atan2(-di, -dj);
      this.torches.push({ x: ax, z: az, yaw, di, dj });
      this.lights.push({ x: ax - di * 0.8, y: 4.0, z: az - dj * 0.8, color: this.torchColor, base: 50, dist: 18, ph: r() * 10, kind: 'torch' });
      return true;
    };
    const sides = (rm) => [
      { cells: [...Array(rm.w)].map((_, k) => [rm.x + k, rm.y]), d: [0, -1] },
      { cells: [...Array(rm.w)].map((_, k) => [rm.x + k, rm.y + rm.h - 1]), d: [0, 1] },
      { cells: [...Array(rm.h)].map((_, k) => [rm.x, rm.y + k]), d: [-1, 0] },
      { cells: [...Array(rm.h)].map((_, k) => [rm.x + rm.w - 1, rm.y + k]), d: [1, 0] },
    ];

    for (const rm of this.rooms) {
      const big = rm.w * rm.h > 60;
      const step = rm.type === 'boss' ? 3 : big ? 4 : 3;
      for (const s of sides(rm)) {
        s.cells.forEach(([i, j], k) => {
          if (!isWall(i + s.d[0], j + s.d[1])) return;
          if (k % step === 1) addTorch(i, j, s.d[0], s.d[1]);
          else if (k % step === (step === 3 ? 2 : 3) && r() < 0.45 && this.get(i, j) === T.FLOOR) {
            const ax = this.wx(i) + s.d[0] * (CELL / 2 - 0.07), az = this.wx(j) + s.d[1] * (CELL / 2 - 0.07);
            this.banners.push({ x: ax, z: az, yaw: Math.atan2(-s.d[0], -s.d[1]) });
          }
        });
      }
      // piliers
      if (rm.w >= 7 && rm.h >= 7 && !rm.lava && !this.cfg.boss) {
        for (const [i, j] of [[rm.x + 1, rm.y + 1], [rm.x + rm.w - 2, rm.y + 1], [rm.x + 1, rm.y + rm.h - 2], [rm.x + rm.w - 2, rm.y + rm.h - 2]]) {
          if (this.get(i, j) !== T.FLOOR) continue;
          this.props.pillars.push({ x: this.wx(i), z: this.wx(j) });
          this.addCircle(this.wx(i), this.wx(j), 0.75);
        }
      }
      // brasero central
      if (rm.w >= 9 && rm.h >= 9 && rm.type === 'normal' && !rm.lava) {
        const i = rm.cx, j = rm.cy;
        if (this.get(i, j) === T.FLOOR) this.addBrazier(this.wx(i) + CELL / 2, this.wx(j) + CELL / 2);
      }
      // coins : tonneaux, caisses, ossements, toiles d'araignée
      if (rm.type !== 'boss') {
        for (const [i, j, di, dj] of [[rm.x, rm.y, -1, -1], [rm.x + rm.w - 1, rm.y, 1, -1], [rm.x, rm.y + rm.h - 1, -1, 1], [rm.x + rm.w - 1, rm.y + rm.h - 1, 1, 1]]) {
          const closed = isWall(i + di, j) && isWall(i, j + dj) && isWall(i + di, j + dj);
          if (!closed || this.get(i, j) !== T.FLOOR) continue;
          if (r() < 0.6) this.cobwebs.push({ x: this.wx(i) + di * 0.2, z: this.wx(j) + dj * 0.2, yaw: Math.atan2(-di, -dj) });
          const roll = r();
          const bx = this.wx(i) + di * 0.6, bz = this.wx(j) + dj * 0.6;
          if (roll < 0.35) {
            this.props.barrels.push({ x: bx, z: bz, rot: r() * 6 });
            this.addCircle(bx, bz, 0.5);
            if (r() < 0.6) { const x2 = bx - di * 1.0, z2 = bz; this.props.barrels.push({ x: x2, z: z2, rot: r() * 6 }); this.addCircle(x2, z2, 0.5); }
          } else if (roll < 0.65) {
            this.props.crates.push({ x: bx, z: bz, y: 0, rot: r() * 0.6 });
            if (r() < 0.5) this.props.crates.push({ x: bx, z: bz, y: 0.95, rot: r() * 0.8 });
            this.addCircle(bx, bz, 0.7);
          } else if (roll < 0.85) {
            this.props.skulls.push({ x: bx, z: bz, rot: r() * 6 });
            for (let k = 0; k < 3; k++) this.props.bones.push({ x: bx + (r() - 0.5) * 1.4, z: bz + (r() - 0.5) * 1.4, rot: r() * 6 });
          }
        }
        // éboulis et ossements épars
        for (let k = 0; k < 4; k++) {
          const i = rm.x + Math.floor(r() * rm.w), j = rm.y + Math.floor(r() * rm.h);
          if (this.get(i, j) !== T.FLOOR) continue;
          const x = this.wx(i) + (r() - 0.5) * 2, z = this.wx(j) + (r() - 0.5) * 2;
          if (r() < 0.5) this.props.rocks.push({ x, z, rot: r() * 6, s: 0.5 + r() * 0.9 });
          else this.props.bones.push({ x, z, rot: r() * 6 });
        }
      }
    }

    // couloirs : torches espacées
    for (let j = 0; j < this.H; j++) for (let i = 0; i < W; i++) {
      if (this.get(i, j) !== T.FLOOR || this.roomOf[j * W + i] >= 0) continue;
      if ((i * 7 + j * 13) % 9 !== 0) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (isWall(i + di, j + dj)) { if (addTorch(i, j, di, dj)) break; }
      }
    }

    if (this.cfg.boss) { this.decorateBoss(); return; }

    // coffres
    const nChests = 2 + Math.floor(this.floor / 2);
    const cand = shuffle(this.rooms.filter((rm) => rm.type === 'normal'), r);
    for (const rm of cand) {
      if (this.chestSpots.length >= nChests) break;
      const ss = shuffle(sides(rm), r);
      for (const s of ss) {
        const [i, j] = s.cells[Math.floor(s.cells.length / 2)];
        if (!isWall(i + s.d[0], j + s.d[1]) || this.get(i, j) !== T.FLOOR || this.solid[j * W + i]) continue;
        const x = this.wx(i) + s.d[0] * 0.7, z = this.wx(j) + s.d[1] * 0.7;
        this.chestSpots.push({ x, z, yaw: Math.atan2(-s.d[0], -s.d[1]), room: rm });
        this.addCircle(x, z, 0.75);
        break;
      }
    }
    // autel de soin
    if (this.floor >= 2) {
      const rm = cand.find((rm) => !rm.lava && rm.w >= 6 && rm.h >= 6 && !this.chestSpots.some((c) => c.room === rm));
      if (rm && this.get(rm.cx, rm.cy) === T.FLOOR && !this.solid[rm.cy * W + rm.cx]) {
        const x = (rm.cx + 1) * CELL, z = (rm.cy + 1) * CELL;
        this.shrineSpot = { x, z, room: rm };
        this.addCircle(x, z, 1.1);
        this.lights.push({ x, y: 2.2, z, color: new THREE.Color(0.35, 0.7, 1.0), base: 32, dist: 12, ph: 0, kind: 'shrine' });
      }
    }
    // pièges (couloirs uniquement)
    const corr = [];
    for (let j = 0; j < this.H; j++) for (let i = 0; i < W; i++) {
      if (this.get(i, j) === T.FLOOR && this.roomOf[j * W + i] < 0 && !this.solid[j * W + i]) corr.push([i, j]);
    }
    shuffle(corr, r);
    for (const [i, j] of corr) {
      if (this.trapSpots.length >= (this.cfg.traps || 0)) break;
      if (this.trapSpots.some((t) => Math.abs(t.i - i) + Math.abs(t.j - j) < 6)) continue;
      this.trapSpots.push({ i, j, x: this.wx(i), z: this.wx(j) });
    }
    // lumière de l'escalier
    if (this.stairs) this.lights.push({ x: this.stairs.x, y: -0.5, z: this.stairs.z, color: new THREE.Color(0.3, 0.75, 1.0), base: 80, dist: 15, ph: 0, kind: 'stairs' });
    // lumières de lave
    this.addLavaLights();
  }

  addBrazier(x, z, scale = 1) {
    this.props.braziers.push({ x, z, s: scale });
    this.addCircle(x, z, 0.75 * scale);
    this.lights.push({ x, y: 2.6 * scale, z, color: this.torchColor, base: 80 * scale, dist: 22, ph: this.rng() * 10, kind: 'brazier' });
  }

  addLavaLights() {
    for (let j = 0; j < this.H; j += 3) for (let i = 0; i < this.W; i += 3) {
      if (this.get(i, j) === T.LAVA || this.get(i + 1, j + 1) === T.LAVA) {
        this.lights.push({ x: (i + 1) * CELL, y: 1.2, z: (j + 1) * CELL, color: new THREE.Color(1.0, 0.32, 0.06), base: 60, dist: 14, ph: this.rng() * 10, kind: 'lava' });
      }
    }
  }

  decorateBoss() {
    const hall = this.bossRoom;
    // piliers monumentaux
    for (const [i, j] of [[21, 12], [38, 12], [21, 22], [38, 22], [21, 31], [38, 31]]) {
      this.props.pillars.push({ x: this.wx(i), z: this.wx(j) });
      this.addCircle(this.wx(i), this.wx(j), 0.75);
    }
    for (const [i, j] of [[24, 36], [35, 36], [16, 21], [44, 21], [26, 9], [33, 9]]) this.addBrazier(this.wx(i), this.wx(j), 1.25);
    for (const [i, j] of [[26, 47], [33, 47], [26, 53], [33, 53]]) this.addBrazier(this.wx(i), this.wx(j), 0.9);
    this.addLavaLights();
    // ossements d'aventuriers malchanceux
    for (let k = 0; k < 30; k++) {
      const x = (hall.x + 1 + this.rng() * (hall.w - 2)) * CELL, z = (hall.y + 1 + this.rng() * (hall.h - 2)) * CELL;
      if (this.get(this.ci(x), this.ci(z)) !== T.FLOOR) continue;
      if (this.rng() < 0.3) this.props.skulls.push({ x, z, rot: this.rng() * 6 });
      else if (this.rng() < 0.6) this.props.bones.push({ x, z, rot: this.rng() * 6 });
      else this.props.rocks.push({ x, z, rot: this.rng() * 6, s: 0.6 + this.rng() });
    }
  }

  // ------------------------------------------------------------ Construction 3D
  build() {
    const a = initDungeonAssets();
    a.wallMat.color.set(this.cfg.wallTint);
    a.floorMat.color.set(this.cfg.wallTint).lerp(new THREE.Color(0xffffff), 0.35);
    const S = CELL, H = this.wallH, W = this.W;
    const floorB = new GB(), ceilB = new GB(), wallB = new GB(), lavaB = new GB();
    const blocked = (i, j) => this.get(i, j) === T.WALL;
    const aoTab = [1, 0.66, 0.5, 0.45, 0.45];
    const vAO = (vi, vj) => {
      let c = 0;
      if (blocked(vi - 1, vj - 1)) c++;
      if (blocked(vi, vj - 1)) c++;
      if (blocked(vi - 1, vj)) c++;
      if (blocked(vi, vj)) c++;
      return aoTab[c];
    };
    const TU = 6;
    for (let j = 0; j < this.H; j++) for (let i = 0; i < W; i++) {
      const t = this.get(i, j);
      if (t === T.WALL) continue;
      const x0 = i * S, x1 = x0 + S, z0 = j * S, z1 = z0 + S;
      const ao = [vAO(i, j), vAO(i, j + 1), vAO(i + 1, j + 1), vAO(i + 1, j)];
      if (t === T.FLOOR) {
        floorB.quad([[x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]], [0, 1, 0],
          [[x0 / TU, z0 / TU], [x0 / TU, z1 / TU], [x1 / TU, z1 / TU], [x1 / TU, z0 / TU]], ao);
      } else if (t === T.LAVA) {
        lavaB.quad([[x0, -0.5, z0], [x0, -0.5, z1], [x1, -0.5, z1], [x1, -0.5, z0]], [0, 1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]], [1, 1, 1, 1]);
      }
      ceilB.quad([[x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1]], [0, -1, 0],
        [[x0 / TU, z0 / TU], [x1 / TU, z0 / TU], [x1 / TU, z1 / TU], [x0 / TU, z1 / TU]], [ao[0], ao[3], ao[2], ao[1]]);
      // murs + parois des fosses
      const y0 = t === T.LAVA ? -0.6 : t === T.PIT ? -6.5 : 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = this.get(i + di, j + dj);
        let ys = null;
        if (nt === T.WALL) ys = [y0, 0.9, 4.8, H];
        else if ((t === T.LAVA || t === T.PIT) && nt === T.FLOOR) ys = [y0, y0 + 0.01, -0.02, 0];
        else if (t === T.PIT && nt === T.LAVA) ys = [y0, y0 + 0.01, -0.62, -0.6];
        if (!ys) continue;
        const cx = (i + 0.5) * S + di * S / 2, cz = (j + 0.5) * S + dj * S / 2;
        const rx = -dj, rz = di; // vecteur "droite" vu de face
        const lx = cx - rx * S / 2, lz = cz - rz * S / 2, Rx = cx + rx * S / 2, Rz = cz + rz * S / 2;
        const uL = (lx * rx + lz * rz) / TU, uR = (Rx * rx + Rz * rz) / TU;
        const cornerL = blocked(i - rx, j - rz) && nt === T.WALL ? 0.62 : 1;
        const cornerR = blocked(i + rx, j + rz) && nt === T.WALL ? 0.62 : 1;
        const cols = nt === T.WALL ? [0.4, 0.92, 1.0, 0.55] : [0.25, 0.25, 0.6, 0.8];
        for (let k = 0; k < 3; k++) {
          const ya = ys[k], yb = ys[k + 1];
          if (yb - ya < 0.001) continue;
          wallB.quad([[lx, ya, lz], [Rx, ya, Rz], [Rx, yb, Rz], [lx, yb, lz]], [-di, 0, -dj],
            [[uL, ya / TU], [uR, ya / TU], [uR, yb / TU], [uL, yb / TU]],
            [cols[k] * cornerL, cols[k] * cornerR, cols[k + 1] * cornerR, cols[k + 1] * cornerL]);
        }
      }
    }
    const add = (geo, mat, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      this.group.add(m);
      this.disposables.push(geo);
      return m;
    };
    add(floorB.build(), a.floorMat, false);
    add(ceilB.build(), a.ceilMat, false);
    add(wallB.build(), a.wallMat, true);
    if (lavaB.v) add(lavaB.build(), a.lavaMat, false).receiveShadow = false;

    this.buildInstances(a);
    this.buildStairs(a);
    if (this.cfg.boss) this.buildHoard(a);
    G.scene.add(this.group);
  }

  inst(geo, mat, list, setter, shadow = true) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const o = new THREE.Object3D();
    list.forEach((it, k) => {
      o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
      setter(o, it);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
    });
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    this.group.add(m);
    return m;
  }

  buildInstances(a) {
    const P = this.props;
    this.inst(a.geo.pillar, a.stone, P.pillars, (o, p) => { o.position.set(p.x, 0, p.z); o.scale.set(1, this.wallH / WALL_H, 1); });
    this.inst(a.geo.barrel, a.wood, P.barrels, (o, p) => { o.position.set(p.x, 0, p.z); o.rotation.y = p.rot; });
    const bands = [];
    for (const b of P.barrels) { bands.push({ x: b.x, z: b.z, y: 0.2 }); bands.push({ x: b.x, z: b.z, y: 0.8 }); }
    this.inst(a.geo.band, a.iron, bands, (o, p) => o.position.set(p.x, p.y, p.z));
    this.inst(a.geo.crate, a.crate, P.crates, (o, p) => { o.position.set(p.x, p.y, p.z); o.rotation.y = p.rot; });
    this.inst(a.geo.skull, a.bone, P.skulls, (o, p) => { o.position.set(p.x, 0.12, p.z); o.rotation.set(0.3, p.rot, 0.2); }, false);
    this.inst(a.geo.bone, a.bone, P.bones, (o, p) => { o.position.set(p.x, 0.03, p.z); o.rotation.y = p.rot; }, false);
    this.inst(a.geo.rock, a.stone, P.rocks, (o, p) => { o.position.set(p.x, 0.1 * p.s, p.z); o.rotation.set(p.rot, p.rot * 2, 0); o.scale.setScalar(p.s); }, false);
    this.inst(a.geo.brazier, a.iron, P.braziers, (o, p) => { o.position.set(p.x, 0, p.z); o.scale.setScalar(p.s); });
    // braises
    const coalGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.05, 14);
    this.disposables.push(coalGeo);
    this.inst(coalGeo, a.coal, P.braziers, (o, p) => { o.position.set(p.x, 1.4 * p.s, p.z); o.scale.setScalar(p.s); }, false);
    // torches
    this.inst(a.geo.bracket, a.iron, this.torches, (o, t) => { o.position.set(t.x, 3.4, t.z); o.rotation.y = t.yaw; });
    // bannières
    const bm = a.banners[this.cfg.banner] || a.banners.red;
    this.inst(a.geo.banner, bm, this.banners, (o, b) => { o.position.set(b.x, 4.3, b.z); o.rotation.y = b.yaw; o.translateZ(0.02); }, false);
    this.inst(a.geo.rod, a.iron, this.banners, (o, b) => { o.position.set(b.x, 5.65, b.z); o.rotation.y = b.yaw; o.translateZ(0.12); }, false);
    this.inst(a.geo.cobweb, a.cobweb, this.cobwebs, (o, c) => { o.position.set(c.x, this.wallH - 1.25, c.z); o.rotation.y = c.yaw; o.translateZ(-0.6); o.rotateX(-0.45); }, false);

    // flammes
    const flames = [];
    const v = new THREE.Vector3();
    for (const t of this.torches) {
      v.set(0, 0.47, 0.33).applyAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw);
      flames.push({ x: t.x + v.x, y: 3.4 + v.y, z: t.z + v.z, s: 0.75 });
    }
    for (const b of P.braziers) flames.push({ x: b.x, y: 1.35 * b.s, z: b.z, s: 2.2 * b.s });
    const c = this.cfg.torch;
    const colA = [c[0] * 1.0, c[1] * 0.45, c[2] * 0.2];
    const colB = [Math.min(1, c[0] * 1.1 + 0.1), Math.min(1, c[1] * 1.4 + 0.25), Math.min(1, c[2] * 1.6 + 0.2)];
    this.flames = makeFlames(flames, colA, colB, 2.4);
    this.flameList = flames;
    this.disposables.push(this.flames.geometry);
    this.group.add(this.flames);
  }

  buildStairs(a) {
    if (!this.stairs) return;
    const { i, j } = this.stairs;
    const x0 = i * CELL, z0 = j * CELL, size = CELL * 2;
    const steps = [];
    const n = 9;
    for (let k = 0; k < n; k++) {
      const depth = size / n;
      const top = -0.35 - k * 0.68;
      steps.push(new THREE.BoxGeometry(size, 0.68, depth).translate(x0 + size / 2, top - 0.34, z0 + depth * (k + 0.5)));
    }
    const geo = mergeGeometries(steps);
    this.disposables.push(geo);
    const m = new THREE.Mesh(geo, a.stone);
    m.receiveShadow = true;
    this.group.add(m);
    const ringGeo = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2);
    this.disposables.push(ringGeo);
    this.rune = new THREE.Mesh(ringGeo, a.rune);
    this.rune.position.set(this.stairs.x, 0.05, this.stairs.z);
    this.rune.renderOrder = 7;
    this.group.add(this.rune);
  }

  buildHoard(a) {
    const { x, z } = this.hoard;
    const pile = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), a.gold);
    pile.scale.set(6, 1.6, 3.2);
    pile.position.set(x, -0.1, z);
    pile.receiveShadow = true;
    this.group.add(pile);
    this.disposables.push(pile.geometry);
    const coins = [];
    for (let k = 0; k < 260; k++) {
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random());
      const px = x + Math.cos(ang) * rr * 7.5, pz = z + Math.sin(ang) * rr * 4;
      const ex = (px - x) / 6, ez = (pz - z) / 3.2;
      const h = Math.max(0, 1 - ex * ex - ez * ez);
      coins.push({ x: px, z: pz, y: Math.sqrt(h) * 1.6 - 0.05, r1: Math.random() * 3, r2: Math.random() * 3 });
    }
    this.inst(a.geo.coin, a.gold, coins, (o, c) => { o.position.set(c.x, Math.max(0.02, c.y), c.z); o.rotation.set(c.r1, 0, c.r2); }, false);
    // coffres et objets précieux dans le trésor
    const gem = new THREE.MeshStandardMaterial({ color: 0x40ff90, emissive: 0x20ff60, emissiveIntensity: 2.5, roughness: 0.1 });
    const gemR = new THREE.MeshStandardMaterial({ color: 0xff3050, emissive: 0xff2040, emissiveIntensity: 2.5, roughness: 0.1 });
    for (let k = 0; k < 12; k++) {
      const g = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), k % 2 ? gem : gemR);
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * 0.8;
      g.position.set(x + Math.cos(ang) * rr * 5, 0.6 + Math.random() * 0.8, z + Math.sin(ang) * rr * 2.5);
      this.group.add(g);
      this.disposables.push(g.geometry);
    }
    this.lights.push({ x, y: 3, z: z + 2, color: new THREE.Color(1, 0.75, 0.3), base: 70, dist: 16, ph: 0, kind: 'hoard' });
  }

  // ------------------------------------------------------------ Mise à jour (lumières, runes)
  update(dt, px, pz) {
    if (this.rune) this.rune.rotation.y += dt * 0.25;
    this.updateLights(px, pz);
  }

  updateLights(px, pz) {
    const pool = G.lightPool;
    const n = pool.length;
    const L = this.lights;
    for (const l of L) l.d = (l.x - px) ** 2 + (l.z - pz) ** 2;
    if (!this._sorted) this._sorted = L.slice();
    this._sorted.sort((a, b) => a.d - b.d);
    const S = this._sorted;
    const cutoff = S.length > n ? Math.sqrt(S[n].d) : 1e9;
    const t = G.time;
    for (let k = 0; k < n; k++) {
      const light = pool[k];
      const l = S[k];
      if (!l) { light.intensity = 0; continue; }
      const d = Math.sqrt(l.d);
      const fade = cutoff < 1e8 ? smoothstep(cutoff, cutoff * 0.75, d) : 1;
      let fl = 1;
      if (l.kind === 'torch' || l.kind === 'brazier') fl = 0.84 + 0.1 * Math.sin(t * 9.3 + l.ph) + 0.06 * Math.sin(t * 23.7 + l.ph * 2.1);
      else if (l.kind === 'lava') fl = 0.85 + 0.15 * Math.sin(t * 1.3 + l.ph);
      else if (l.kind === 'stairs' || l.kind === 'shrine') fl = 0.85 + 0.15 * Math.sin(t * 2.0);
      light.position.set(l.x, l.y, l.z);
      light.color.copy(l.color);
      light.distance = l.dist;
      light.intensity = l.base * fade * fl * (l.mult ?? 1);
    }
  }

  // ------------------------------------------------------------ Requêtes spatiales
  collide(p, r, ignoreSolids = false) {
    for (let iter = 0; iter < 2; iter++) {
      const ci = this.ci(p.x), cj = this.ci(p.z);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if (this.get(i, j) !== T.FLOOR) {
          const x0 = i * CELL, x1 = x0 + CELL, z0 = j * CELL, z1 = z0 + CELL;
          const qx = Math.max(x0, Math.min(p.x, x1)), qz = Math.max(z0, Math.min(p.z, z1));
          let dx = p.x - qx, dz = p.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2);
              const push = (r - d) / d;
              p.x += dx * push; p.z += dz * push;
            } else {
              // centre à l'intérieur : sortir par l'axe le plus court
              const ex = Math.min(p.x - x0, x1 - p.x), ez = Math.min(p.z - z0, z1 - p.z);
              if (ex < ez) p.x = p.x - x0 < x1 - p.x ? x0 - r : x1 + r;
              else p.z = p.z - z0 < z1 - p.z ? z0 - r : z1 + r;
            }
          }
        }
        if (ignoreSolids) continue;
        const cs = this.circles.get(j * this.W + i);
        if (cs) for (const c of cs) {
          const dx = p.x - c.x, dz = p.z - c.z;
          const d2 = dx * dx + dz * dz, rr = r + c.r;
          if (d2 < rr * rr && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (rr - d); p.z += (dz / d) * (rr - d);
          }
        }
      }
    }
  }

  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.5);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.isWallAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  // distance libre le long d'un rayon horizontal (murs uniquement)
  ray(ox, oz, dx, dz, maxD, step = 0.15) {
    for (let d = step; d <= maxD; d += step) {
      if (this.isWallAt(ox + dx * d, oz + dz * d)) return d - step;
    }
    return maxD;
  }

  bfs(si, sj, useSolid = true) {
    const W = this.W, dist = this.dist, q = this.queue;
    dist.fill(-1);
    if (!this.inb(si, sj)) return;
    let head = 0, tail = 0;
    const s = sj * W + si;
    dist[s] = 0;
    q[tail++] = s;
    while (head < tail) {
      const k = q[head++];
      const i = k % W, j = (k / W) | 0;
      const d = dist[k] + 1;
      const nb = [k - 1, k + 1, k - W, k + W];
      const ok = [i > 0, i < W - 1, j > 0, j < this.H - 1];
      for (let n = 0; n < 4; n++) {
        if (!ok[n]) continue;
        const m = nb[n];
        if (dist[m] !== -1) continue;
        if (this.grid[m] !== T.FLOOR) continue;
        if (useSolid && this.solid[m]) continue;
        dist[m] = d;
        q[tail++] = m;
      }
    }
  }

  computeFlow(x, z) {
    this.bfs(this.ci(x), this.ci(z), true);
  }

  // direction suivante selon le champ de flux (retourne une cible monde ou null)
  flowTarget(x, z, out) {
    const W = this.W;
    const i = this.ci(x), j = this.ci(z);
    let best = -1, bd = 1e9;
    const cur = this.inb(i, j) ? this.dist[j * W + i] : -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (!this.inb(ni, nj)) continue;
      const d = this.dist[nj * W + ni];
      if (d < 0) continue;
      if (di && dj && (!this.pathable(i + di, j) || !this.pathable(i, j + dj))) continue;
      const dd = d + (di && dj ? 0.4 : 0);
      if (dd < bd) { bd = dd; best = nj * W + ni; }
    }
    if (best < 0 || (cur >= 0 && bd >= cur + 0.5)) return null;
    out.x = this.wx(best % W);
    out.z = this.wx((best / W) | 0);
    return out;
  }

  reveal(px, pz, radius = 6) {
    const ci = this.ci(px), cj = this.ci(pz);
    for (let dj = -radius; dj <= radius; dj++) for (let di = -radius; di <= radius; di++) {
      if (di * di + dj * dj > radius * radius) continue;
      const i = ci + di, j = cj + dj;
      if (!this.inb(i, j)) continue;
      const k = j * this.W + i;
      if (this.explored[k]) continue;
      // la case (ou un mur) est visible si une ligne de vue existe jusqu'à son bord le plus proche
      const tx = this.wx(i) - Math.sign(di) * CELL * 0.45, tz = this.wx(j) - Math.sign(dj) * CELL * 0.45;
      if (this.los(px, pz, tx, tz)) this.explored[k] = 1;
    }
  }

  randomCellIn(rm, avoid = []) {
    for (let t = 0; t < 40; t++) {
      const i = rm.x + Math.floor(this.rng() * rm.w), j = rm.y + Math.floor(this.rng() * rm.h);
      if (!this.pathable(i, j)) continue;
      const x = this.wx(i) + (this.rng() - 0.5) * 1.2, z = this.wx(j) + (this.rng() - 0.5) * 1.2;
      if (avoid.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 4)) continue;
      return { x, z };
    }
    return null;
  }

  dispose() {
    G.scene.remove(this.group);
    for (const g of this.disposables) g.dispose();
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    for (const l of G.lightPool) l.intensity = 0;
  }
}
