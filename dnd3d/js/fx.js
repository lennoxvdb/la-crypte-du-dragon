// Effets visuels : particules, flammes animées, traînées d'arme, télégraphes au sol,
// éclairs lumineux, textes flottants, débris.
import * as THREE from 'three';
import { G } from './state.js';
import { rnd, clamp } from './util.js';

// ------------------------------------------------------------------ Particules
const PVS = /* glsl */ `
attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PFS_ADD = /* glsl */ `
varying vec4 vColor;
void main(){
  vec2 p = gl_PointCoord - 0.5; float d = length(p);
  float a = smoothstep(0.5, 0.0, d); a *= a;
  gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0);
}`;
const PFS_NORM = /* glsl */ `
varying vec4 vColor;
void main(){
  vec2 p = gl_PointCoord - 0.5; float d = length(p);
  float a = smoothstep(0.5, 0.25, d);
  if (a * vColor.a < 0.02) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

export class Particles {
  constructor(max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: PVS,
      fragmentShader: additive ? PFS_ADD : PFS_NORM,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
  }
  // o: {x,y,z, count, spread, vx,vy,vz, vel, life, size, size1, color, color1, alpha, gravity, drag}
  emit(o) {
    const n = o.count || 1;
    for (let k = 0; k < n; k++) {
      let i = this.count < this.max ? this.count++ : Math.floor(Math.random() * this.max);
      const sp = o.spread || 0;
      let dx = 0, dy = 0, dz = 0;
      if (sp) {
        do { dx = rnd(-1, 1); dy = rnd(-1, 1); dz = rnd(-1, 1); } while (dx * dx + dy * dy + dz * dz > 1);
      }
      this.pos[i * 3] = o.x + dx * sp;
      this.pos[i * 3 + 1] = o.y + dy * sp * (o.flat ? 0.1 : 1);
      this.pos[i * 3 + 2] = o.z + dz * sp;
      const vs = o.vel || 0;
      let ux = 0, uy = 0, uz = 0;
      if (vs) {
        do { ux = rnd(-1, 1); uy = rnd(-1, 1); uz = rnd(-1, 1); } while (ux * ux + uy * uy + uz * uz > 1);
      }
      this.vel[i * 3] = (o.vx || 0) + ux * vs;
      this.vel[i * 3 + 1] = (o.vy || 0) + uy * vs * (o.velY ?? 1);
      this.vel[i * 3 + 2] = (o.vz || 0) + uz * vs;
      const life = (o.life || 1) * rnd(0.7, 1.3);
      this.life[i] = life;
      this.maxLife[i] = life;
      const s = (o.size || 0.3) * rnd(0.75, 1.25);
      this.s0[i] = s;
      this.s1[i] = o.size1 !== undefined ? o.size1 * (s / (o.size || 0.3)) : s;
      const c = o.color || [1, 1, 1], c1 = o.color1 || c;
      this.c0[i * 3] = c[0]; this.c0[i * 3 + 1] = c[1]; this.c0[i * 3 + 2] = c[2];
      this.c1[i * 3] = c1[0]; this.c1[i * 3 + 1] = c1[1]; this.c1[i * 3 + 2] = c1[2];
      this.a0[i] = o.alpha ?? 1;
      this.grav[i] = o.gravity || 0;
      this.drag[i] = o.drag || 0;
    }
  }
  swap(i, j) {
    const A = [this.pos, this.vel, this.c0, this.c1];
    for (const a of A) for (let k = 0; k < 3; k++) a[i * 3 + k] = a[j * 3 + k];
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.a0[i] = this.a0[j];
    this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
  }
  update(dt) {
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.count--;
        if (i !== this.count) this.swap(i, this.count);
        i--;
        continue;
      }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
        this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let k = 0; k < 3; k++) this.col[i * 4 + k] = this.c0[i * 3 + k] + (this.c1[i * 3 + k] - this.c0[i * 3 + k]) * t;
      const fadeIn = clamp(t * 8, 0, 1);
      this.col[i * 4 + 3] = this.a0[i] * fadeIn * (1 - t) * (1 - t * 0.3);
    }
    this.points.geometry.setDrawRange(0, this.count);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
  clear() { this.count = 0; }
}

// ------------------------------------------------------------------ Flammes
const NOISE_GLSL = /* glsl */ `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;

export const flameUniforms = { uTime: { value: 0 } };

export function makeFlameMaterial(colA, colB, intensity = 3) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: flameUniforms.uTime,
      uColA: { value: new THREE.Color(...colA) },
      uColB: { value: new THREE.Color(...colB) },
      uInt: { value: intensity },
    },
    vertexShader: /* glsl */ `
      attribute float aRand; attribute float aScale;
      uniform float uTime; varying vec2 vUv; varying float vRand;
      void main(){
        vUv = uv; vRand = aRand;
        vec4 center = modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
        vec4 mv = viewMatrix * center;
        float fl = 1.0 + 0.1*sin(uTime*13.0 + aRand*40.0) + 0.06*sin(uTime*23.0 + aRand*17.0);
        mv.xy += position.xy * vec2(0.62, 1.0) * aScale * vec2(1.0, fl);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uInt; uniform vec3 uColA, uColB; varying vec2 vUv; varying float vRand;
      ${NOISE_GLSL}
      void main(){
        vec2 uv = vUv;
        float n = fbm(vec2(uv.x*3.0 + vRand*10.0, uv.y*2.2 - uTime*2.6 - vRand*5.0));
        float n2 = fbm(vec2(uv.x*6.0 - vRand*3.0, uv.y*4.0 - uTime*4.0));
        float x = uv.x - 0.5 + (n - 0.5) * 0.28 * uv.y;
        float w = 0.36 * pow(1.0 - uv.y, 0.8) * (0.7 + 0.6*n) + 0.02;
        float shape = 1.0 - smoothstep(w*0.45, w, abs(x));
        shape *= smoothstep(0.0, 0.1, uv.y) * (1.0 - smoothstep(0.35, 0.95, uv.y + (n2-0.5)*0.5));
        float core = (1.0 - smoothstep(0.0, w*0.55, abs(x))) * (1.0 - smoothstep(0.05, 0.5, uv.y));
        vec3 col = mix(uColA, uColB, clamp(core*1.4, 0.0, 1.0));
        float a = clamp(shape, 0.0, 1.0);
        gl_FragColor = vec4(col * a * uInt, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// list: [{x,y,z,s}]
export function makeFlames(list, colA, colB, intensity = 3) {
  const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const n = Math.max(1, list.length);
  const rand = new Float32Array(n), scale = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(geo, makeFlameMaterial(colA, colB, intensity), n);
  const m = new THREE.Matrix4();
  list.forEach((f, i) => {
    m.makeTranslation(f.x, f.y, f.z);
    mesh.setMatrixAt(i, m);
    rand[i] = Math.random();
    scale[i] = f.s || 1;
  });
  if (!list.length) mesh.count = 0;
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 1));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  return mesh;
}

// ------------------------------------------------------------------ Télégraphes
const TELE_FS = /* glsl */ `
uniform float uProgress, uHalf, uInner, uTime; uniform vec3 uColor; varying vec2 vUv;
void main(){
  vec2 p = vUv*2.0 - 1.0; float r = length(p);
  if (r > 1.0 || r < uInner) discard;
  float ang = abs(atan(p.x, -p.y));
  if (ang > uHalf) discard;
  float rim = smoothstep(0.9, 0.97, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float side = uHalf < 3.1 ? smoothstep(uHalf - 0.05, uHalf, ang) : 0.0;
  float fill = (r < uProgress ? 0.32 : 0.06);
  float pulse = 0.75 + 0.25*sin(uTime*18.0);
  float a = max(max(rim, side) * pulse, fill);
  gl_FragColor = vec4(uColor * a * 1.6, a);
}`;
const TELE_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

export class Telegraph {
  // kind: 'circle' | 'cone' ; halfAngle en radians
  constructor({ x, z, radius, duration, halfAngle = Math.PI, yaw = 0, color = [1, 0.15, 0.05], inner = 0 }) {
    this.group = new THREE.Group();
    this.group.position.set(x, 0.04, z);
    this.group.rotation.y = yaw;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 }, uHalf: { value: halfAngle }, uInner: { value: inner },
        uTime: flameUniforms.uTime, uColor: { value: new THREE.Color(...color) },
      },
      vertexShader: TELE_VS,
      fragmentShader: TELE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(radius);
    m.renderOrder = 8;
    this.group.add(m);
    this.t = 0;
    this.duration = duration;
    this.done = false;
    G.scene.add(this.group);
    G.fx.telegraphs.push(this);
  }
  update(dt) {
    this.t += dt;
    this.mat.uniforms.uProgress.value = clamp(this.t / this.duration, 0, 1);
    if (this.t >= this.duration) this.remove();
  }
  remove() {
    if (this.done) return;
    this.done = true;
    G.scene.remove(this.group);
    this.group.children[0].geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ Traînée d'arme
export class Trail {
  constructor(color, maxAge = 0.11) {
    this.maxAge = maxAge;
    this.samples = [];
    this.max = 24;
    this.posArr = new Float32Array(this.max * 2 * 3);
    this.alphaArr = new Float32Array(this.max * 2);
    const idx = [];
    for (let i = 0; i < this.max - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(...color) } },
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor*vA*vA*0.55, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.active = false;
  }
  update(dt, base, tip) {
    for (const s of this.samples) s.age += dt;
    if (this.active && base && tip) this.samples.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
    while (this.samples.length > this.max || (this.samples.length && this.samples[this.samples.length - 1].age > this.maxAge)) this.samples.pop();
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const a = clamp(1 - s.age / this.maxAge, 0, 1) * (1 - i / Math.max(1, n));
      this.posArr.set([s.b.x, s.b.y, s.b.z], i * 6);
      this.posArr.set([s.t.x, s.t.y, s.t.z], i * 6 + 3);
      this.alphaArr[i * 2] = 0.0;
      this.alphaArr[i * 2 + 1] = a;
    }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ Décalcomanies au sol
// taches et brûlures plaquées sur le sol, qui s'estompent avec le temps
function decalTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  if (kind === 'scorch') {
    const grd = g.createRadialGradient(0, 0, 4, 0, 0, 62);
    grd.addColorStop(0, 'rgba(0,0,0,0.95)');
    grd.addColorStop(0.55, 'rgba(10,6,4,0.75)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2, r = 46 + Math.random() * 16;
      i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.fill();
  } else {
    g.fillStyle = '#fff';
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.arc(rnd(-16, 16), rnd(-16, 16), rnd(12, 24), 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(28, 58);
      g.beginPath();
      g.arc(Math.cos(a) * r, Math.sin(a) * r, rnd(2, 6), 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DECAL_KINDS = {
  scorch: { color: 0xffffff, rough: 1, tex: 'scorch' },
  blood: { color: 0x5a0606, rough: 0.25, tex: 'splat' },
  slime: { color: 0x3c9a2a, rough: 0.15, tex: 'splat' },
  vomit: { color: 0x9a8a1c, rough: 0.2, tex: 'splat' },
  snot: { color: 0x6aa83a, rough: 0.15, tex: 'splat' },
  gas: { color: 0x4a5a18, rough: 0.9, tex: 'scorch' },
};

export class Decals {
  constructor(scene, max = 70) {
    this.scene = scene;
    this.max = max;
    this.list = [];
    this.geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.tex = {};
  }
  add(x, z, kind = 'blood', size = 1.2) {
    const D = G.dungeon;
    if (!D || !D.passable(D.ci(x), D.ci(z))) return;
    const k = DECAL_KINDS[kind];
    if (!this.tex[k.tex]) this.tex[k.tex] = decalTexture(k.tex);
    let d = this.list.length >= this.max ? this.list.shift() : null;
    if (!d) {
      const mat = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      d = { mesh: new THREE.Mesh(this.geo, mat) };
      d.mesh.receiveShadow = true;
      d.mesh.renderOrder = 2;
    }
    const m = d.mesh.material;
    m.map = this.tex[k.tex];
    m.color.set(k.color);
    m.roughness = k.rough;
    m.opacity = kind === 'gas' ? 0.55 : 0.92;
    m.needsUpdate = true;
    d.base = m.opacity;
    d.t = 0;
    d.life = kind === 'gas' ? 12 : 45;
    d.mesh.position.set(x, 0.015 + this.list.length * 0.0002, z);
    d.mesh.rotation.y = Math.random() * Math.PI * 2;
    d.mesh.scale.set(size * rnd(0.85, 1.15), 1, size * rnd(0.85, 1.15));
    this.scene.add(d.mesh);
    this.list.push(d);
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.t += dt;
      const fade = clamp((d.life - d.t) / 5, 0, 1);
      d.mesh.material.opacity = d.base * fade;
      if (d.t >= d.life) { this.scene.remove(d.mesh); this.list.splice(i, 1); }
    }
  }
  clear() {
    for (const d of this.list) this.scene.remove(d.mesh);
    this.list.length = 0;
  }
}

// ------------------------------------------------------------------ Gestionnaire global
export class FX {
  constructor(scene) {
    this.add = new Particles(4000, true);
    this.norm = new Particles(2000, false);
    scene.add(this.add.points, this.norm.points);
    this.telegraphs = [];
    this.debris = [];
    this.flashes = []; // lumières temporaires
    this.frameLights = []; // lumières demandées pour cette image (projectiles...)
    this.floaters = [];
    this.floatLayer = document.getElementById('floaters');
    this.floatPool = [];
    this.decals = new Decals(scene);
    this._v = new THREE.Vector3();
  }
  setScale(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.add.mat.uniforms.uScale.value = s;
    this.norm.mat.uniforms.uScale.value = s;
  }
  // ---- Préréglages
  sparks(p, n = 14, color = [1, 0.7, 0.3]) {
    this.add.emit({ x: p.x, y: p.y, z: p.z, count: n, vel: 7, vy: 2, life: 0.35, size: 0.12, size1: 0.02, color, color1: [1, 0.2, 0.05], gravity: 14, drag: 2 });
  }
  blood(p, n = 10, color = [0.35, 0.02, 0.02]) {
    this.norm.emit({ x: p.x, y: p.y, z: p.z, count: n, vel: 4, vy: 2, life: 0.6, size: 0.16, size1: 0.08, color, gravity: 16, drag: 1 });
  }
  bones(p, n = 12) {
    this.norm.emit({ x: p.x, y: p.y, z: p.z, count: n, vel: 5, vy: 3, life: 0.9, size: 0.13, size1: 0.1, color: [0.85, 0.82, 0.72], gravity: 18, drag: 0.5 });
  }
  dust(p, n = 10, r = 0.6) {
    this.norm.emit({ x: p.x, y: p.y + 0.1, z: p.z, count: n, spread: r, flat: true, vel: 1.5, velY: 0.3, life: 0.9, size: 0.5, size1: 1.4, color: [0.35, 0.32, 0.28], alpha: 0.35, drag: 2.5 });
  }
  fireBurst(p, n = 60, scale = 1) {
    this.add.emit({ x: p.x, y: p.y, z: p.z, count: n, vel: 9 * scale, life: 0.5, size: 0.7 * scale, size1: 0.15, color: [1.6, 0.7, 0.2], color1: [0.7, 0.1, 0.01], alpha: 0.7, drag: 3.5, gravity: -3 });
    this.add.emit({ x: p.x, y: p.y, z: p.z, count: Math.floor(n / 2), vel: 14 * scale, vy: 3, life: 0.8, size: 0.1, size1: 0.02, color: [2.5, 1.6, 0.6], color1: [1, 0.3, 0.05], gravity: 10, drag: 1 });
    this.norm.emit({ x: p.x, y: p.y + 0.5, z: p.z, count: Math.floor(n / 3), spread: scale, vel: 2, vy: 2.5, life: 1.6, size: 1.2 * scale, size1: 2.6 * scale, color: [0.12, 0.1, 0.09], alpha: 0.5, drag: 1.5 });
  }
  magic(p, n = 20, color = [0.5, 0.7, 2.5]) {
    this.add.emit({ x: p.x, y: p.y, z: p.z, count: n, vel: 4, life: 0.6, size: 0.25, size1: 0.02, color, color1: [0.2, 0.2, 1], drag: 3 });
  }
  heal(p) {
    this.add.emit({ x: p.x, y: p.y + 0.3, z: p.z, count: 40, spread: 0.7, vy: 2.2, vel: 0.6, life: 1.1, size: 0.18, size1: 0.02, color: [0.6, 2.4, 0.8], color1: [1.6, 2, 0.6], drag: 1 });
  }
  levelUp(p) {
    this.add.emit({ x: p.x, y: p.y + 0.2, z: p.z, count: 120, spread: 1.2, flat: true, vy: 4, vel: 1, life: 1.4, size: 0.2, size1: 0.02, color: [3, 2.2, 0.8], color1: [1, 0.6, 0.2], drag: 0.8 });
  }
  // ---- Lumières temporaires (piochées dans le pool)
  flash(pos, color, intensity, distance, duration) {
    this.flashes.push({ pos: pos.clone(), color: new THREE.Color(...color), intensity, distance, duration, t: 0 });
  }
  // ---- Texte flottant
  text(pos, str, cls = '', life = 1.0) {
    let el = this.floatPool.pop();
    if (!el) {
      el = document.createElement('div');
      this.floatLayer.appendChild(el);
    }
    el.className = 'floater ' + cls;
    el.textContent = str;
    el.style.display = 'block';
    this.floaters.push({ el, pos: pos.clone(), life, maxLife: life, vx: rnd(-0.4, 0.4) });
  }
  // ---- Débris (squelettes qui s'effondrent, etc.)
  shatter(root, impulse) {
    root.updateMatrixWorld(true);
    const list = [];
    root.traverse((o) => { if (o.isMesh) list.push(o); });
    for (const m of list) {
      const piece = new THREE.Mesh(m.geometry, m.material);
      m.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
      piece.castShadow = true;
      G.scene.add(piece);
      this.debris.push({
        mesh: piece,
        vel: new THREE.Vector3(rnd(-2.5, 2.5) + impulse.x, rnd(1, 4.5) + impulse.y, rnd(-2.5, 2.5) + impulse.z),
        ang: new THREE.Vector3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)),
        t: 0,
      });
    }
    root.parent && root.parent.remove(root);
  }
  // tache ou brûlure au sol
  decal(x, z, kind, size) { this.decals.add(x, z, kind, size); }
  update(dt, camera) {
    this.decals.update(dt);
    this.add.update(dt);
    this.norm.update(dt);
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      if (!t.done) t.update(dt);
      if (t.done) this.telegraphs.splice(i, 1);
    }
    // débris
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      if (d.t < 2.5) {
        d.vel.y -= 18 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        if (d.mesh.position.y < 0.06) {
          d.mesh.position.y = 0.06;
          d.vel.y *= -0.3;
          d.vel.x *= 0.6; d.vel.z *= 0.6;
          d.ang.multiplyScalar(0.6);
        }
        e.set(d.ang.x * dt, d.ang.y * dt, d.ang.z * dt);
        q.setFromEuler(e);
        d.mesh.quaternion.multiply(q);
      } else {
        d.mesh.position.y -= dt * 0.25;
      }
      if (d.t > 5) {
        G.scene.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
    // textes flottants
    const w = innerWidth, h = innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.pos.y += dt * 1.1;
      f.pos.x += f.vx * dt;
      if (f.life <= 0) {
        f.el.style.display = 'none';
        this.floatPool.push(f.el);
        this.floaters.splice(i, 1);
        continue;
      }
      this._v.copy(f.pos).project(camera);
      if (this._v.z > 1) { f.el.style.opacity = 0; continue; }
      const x = (this._v.x * 0.5 + 0.5) * w, y = (-this._v.y * 0.5 + 0.5) * h;
      const t = 1 - f.life / f.maxLife;
      const sc = t < 0.12 ? 0.6 + t / 0.12 * 0.6 : 1.2 - Math.min(0.2, (t - 0.12));
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${sc})`;
      f.el.style.opacity = Math.min(1, f.life * 2.5);
    }
  }
  clearAll() {
    this.decals.clear();
    this.add.clear();
    this.norm.clear();
    for (const t of this.telegraphs) t.remove();
    this.telegraphs.length = 0;
    for (const d of this.debris) G.scene.remove(d.mesh);
    this.debris.length = 0;
    this.flashes.length = 0;
    for (const f of this.floaters) { f.el.style.display = 'none'; this.floatPool.push(f.el); }
    this.floaters.length = 0;
  }
}
