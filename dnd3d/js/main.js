// Point d'entrée : rendu, post-traitement, caméra, boucle de jeu, enchaînement des étages.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G } from './state.js';
import { FX, flameUniforms } from './fx.js';
import { Dungeon, initDungeonAssets, FLOORS, CELL } from './dungeon.js';
import { Player } from './player.js';
import { Enemy, Dragon } from './enemies.js';
import { Chest, Shrine, Trap, Stairs, spawnPickup } from './objects.js';
import { updateProjectiles, clearProjectiles } from './combat.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { animateDragon } from './models.js';
import { clamp, damp, rnd, rndInt, lerp, nextFrame, smoothstep } from './util.js';

const V = THREE.Vector3;
window.G = G;
const canvas = document.getElementById('c');
const I = G.input;
let renderer, composer, bloom, grade, orb, orbMesh, hemi;
const fxLights = [];
const camTarget = new V();
const orbPos = new V();
let titleDragon = null;
let flowT = 0, revealT = 0;

const pref = (k, d) => { try { return localStorage.getItem('crypte_' + k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('crypte_' + k, v); } catch { /* stockage indisponible */ } };

// ---------------------------------------------------------------- Post-traitement final
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uLowHp: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uDamage, uLowHp; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; float r2 = dot(c, c);
      float ca = 0.006 * r2 + uDamage * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.9, 0.98, 1.12), (1.0 - smoothstep(0.0, 0.35, l)) * 0.6);
      col = mix(col, col * vec3(1.06, 1.0, 0.9), smoothstep(0.45, 1.0, l) * 0.5);
      col = (col - 0.5) * 1.07 + 0.5;
      col = mix(col, vec3(l) * vec3(1.15, 0.85, 0.85), uLowHp * 0.55);
      float v = 1.0 - smoothstep(0.18, 0.75, r2 * 1.35);
      col *= mix(0.35, 1.0, v);
      col = mix(col, vec3(0.55, 0.0, 0.0), clamp(uDamage, 0.0, 1.0) * smoothstep(0.08, 0.45, r2) * 0.85);
      col += (hash(uv * uRes + fract(uTime) * 91.7) - 0.5) * 0.04;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

function makeEnvScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x090706);
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.7) });
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const m = new THREE.Mesh(geo, warm);
    m.position.set(Math.cos(a) * 8, 0.5 + (k % 3), Math.sin(a) * 8);
    m.scale.setScalar(0.55);
    s.add(m);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x1c1610 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3;
  s.add(floor);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x0c0e14 }));
  top.rotation.x = Math.PI / 2;
  top.position.y = 6;
  s.add(top);
  return s;
}

// ---------------------------------------------------------------- Initialisation du rendu
function setupRenderer() {
  const hi = G.quality === 'high';
  renderer = G.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, hi ? 1.5 : 1));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  renderer.shadowMap.enabled = hi;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = (G.scene = new THREE.Scene());
  scene.background = new THREE.Color(0x050403);
  scene.fog = new THREE.FogExp2(0x0b0806, 0.028);
  G.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 170);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(makeEnvScene(), 0.04).texture;
  pm.dispose();
  hemi = new THREE.HemisphereLight(0x6a6080, 0x2a1a10, 0.6);
  scene.add(hemi);
  const N = hi ? 8 : 5;
  for (let i = 0; i < N; i++) {
    const l = new THREE.PointLight(0xffaa66, 0, 17, 1.7);
    scene.add(l);
    G.lightPool.push(l);
  }
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xff8833, 0, 10, 1.8);
    scene.add(l);
    fxLights.push(l);
  }
  orb = new THREE.PointLight(0xc4d6ff, 9, 12, 1.6);
  orb.castShadow = hi;
  orb.shadow.mapSize.set(512, 512);
  orb.shadow.bias = -0.004;
  orb.shadow.normalBias = 0.04;
  orb.shadow.camera.near = 0.1;
  orb.shadow.camera.far = 24;
  scene.add(orb);
  G.keyLight = new THREE.PointLight(0xff7a3a, 0, 34, 1.4);
  scene.add(G.keyLight);
  orbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.5, 2.1) }));
  scene.add(orbMesh);
  orb.visible = orbMesh.visible = false;

  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: hi ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, G.camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), hi ? 0.85 : 0.6, 0.55, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  addEventListener('resize', onResize);
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  G.camera.aspect = w / h;
  G.camera.updateProjectionMatrix();
  if (G.fx) G.fx.setScale(h * renderer.getPixelRatio(), G.camera.fov);
  grade.uniforms.uRes.value.set(w, h);
}

function applyAtmosphere(n) {
  const cfg = FLOORS[n];
  G.scene.fog.color.set(cfg.fog);
  G.scene.background.set(cfg.fog).multiplyScalar(0.5);
  G.scene.fog.density = cfg.boss ? 0.012 : 0.026;
  hemi.intensity = cfg.boss ? 1.4 : 1.0;
}

// ---------------------------------------------------------------- Écran titre
function buildTitleScene() {
  disposeWorld();
  if (G.player) { G.player.dispose(); G.player = null; }
  G.floor = 5;
  const D = (G.dungeon = new Dungeon(5, 1234));
  D.build();
  applyAtmosphere(5);
  if (titleDragon) titleDragon.dispose();
  titleDragon = new Dragon(D.dragonSpawn.x, D.dragonSpawn.z);
  titleDragon.state = 'title';
  orb.visible = orbMesh.visible = false;
}

function updateTitle(dt) {
  const D = titleDragon, A = D.anim, t = G.time;
  const cyc = t % 11;
  const fire = cyc > 7.2 && cyc < 9.6;
  const k = 1 - Math.exp(-3 * dt);
  A.t += dt;
  A.headPos.lerp(new V(Math.sin(t * 0.35) * 1.0, fire ? 5.6 : 5.0 + Math.sin(t * 0.6) * 0.3, fire ? 5.0 : 4.4), k);
  A.headPitch = lerp(A.headPitch, fire ? -0.25 : -0.05, k);
  A.jaw = lerp(A.jaw, fire ? 0.85 : 0.05 + Math.max(0, Math.sin(t * 0.9)) * 0.08, 1 - Math.exp(-8 * dt));
  A.glow = lerp(A.glow, fire ? 1 : cyc > 6.2 && cyc < 7.2 ? 0.6 : 0, 1 - Math.exp(-5 * dt));
  A.wingSpread = lerp(A.wingSpread, 0.55 + Math.sin(t * 0.35) * 0.3, k);
  A.flap += dt * 0.9;
  A.lift = lerp(A.lift, 0, k);
  A.tailSwing = Math.sin(t * 0.5) * 0.6;
  A.bodyPitch = 0;
  animateDragon(D.model, A, dt);
  G.keyLight.position.set(D.pos.x + 4, 7, D.pos.z + 11);
  G.keyLight.intensity = 70;
  if (fire) {
    const m = D.model.mouth.getWorldPosition(new V());
    const dir = new V(Math.sin(t * 0.35) * 0.3, 0.55, 1).normalize();
    G.fx.add.emit({ x: m.x, y: m.y, z: m.z, count: 5, spread: 0.2, vx: dir.x * 20, vy: dir.y * 20, vz: dir.z * 20, vel: 4, life: 0.75, size: 0.6, size1: 3, color: [1.8, 0.9, 0.3], color1: [0.7, 0.1, 0.01], alpha: 0.6, drag: 1.3, gravity: -2 });
    G.fx.frameLights.push({ pos: m.clone().addScaledVector(dir, 5), color: [1, 0.45, 0.12], intensity: 80, distance: 22 });
  }
  if (A.glow > 0.05) G.fx.frameLights.push({ pos: D.model.mouth.getWorldPosition(new V()), color: [1, 0.4, 0.1], intensity: 30 * A.glow, distance: 10 });
  // caméra en orbite lente
  const ang = t * 0.06 + 0.3;
  const cx = D.pos.x + Math.sin(ang) * 19, cz = D.pos.z + 5 + Math.cos(ang) * 17;
  G.camera.position.set(cx, 3.6 + Math.sin(t * 0.2) * 0.8, cz);
  G.camera.lookAt(D.pos.x, 4.6, D.pos.z + 2.5);
  G.dungeon.update(dt, D.pos.x, D.pos.z + 6);
  G.fx.update(dt, G.camera);
  updateFxLights(dt);
}

// ---------------------------------------------------------------- Monde
function disposeWorld() {
  for (const e of G.enemies) e.dispose();
  G.enemies.length = 0;
  for (const p of G.pickups) p.dispose();
  G.pickups.length = 0;
  for (const i of G.interactables) i.dispose && i.dispose();
  G.interactables.length = 0;
  for (const t of G.traps) t.dispose();
  G.traps.length = 0;
  clearProjectiles();
  if (G.fx) G.fx.clearAll();
  if (G.dungeon) { G.dungeon.dispose(); G.dungeon = null; }
  G.boss = null;
  if (G.keyLight) G.keyLight.intensity = 0;
  if (G.ui) G.ui.boss(null, null);
  if (G.audio) G.audio.bossMusic(false);
}

function weightedPick(entries) {
  const tot = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * tot;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

function loadFloor(n) {
  disposeWorld();
  if (titleDragon) { titleDragon.dispose(); titleDragon = null; }
  G.floor = n;
  const D = (G.dungeon = new Dungeon(n));
  const P = G.player;
  if (D.cfg.boss) {
    D.lights.push({ x: 90, y: 2.2, z: 144, color: new THREE.Color(0.35, 0.7, 1.0), base: 32, dist: 12, ph: 0, kind: 'shrine' });
  }
  D.build();
  applyAtmosphere(n);
  const sr = D.startRoom;
  P.pos.set((sr.cx + 1) * CELL, 0, (sr.cy + 1) * CELL);
  if (D.cfg.boss) P.pos.set(90, 0, 157);
  D.collide(P.pos, P.radius);
  P.vel.set(0, 0, 0);
  P.state = 'free';
  P.R.root.visible = true;
  const ex = D.exitRoom;
  G.cam.yaw = D.cfg.boss ? Math.PI : Math.atan2((ex.cx + 1) * CELL - P.pos.x, (ex.cy + 1) * CELL - P.pos.z);
  G.cam.pitch = 0.36;
  P.yaw = G.cam.yaw;
  camTarget.set(P.pos.x, 1.55, P.pos.z);
  G.cam.cur = G.cam.dist;
  orbPos.set(P.pos.x, 2.4, P.pos.z);
  orb.visible = orbMesh.visible = true;

  if (D.cfg.boss) {
    const d = new Dragon(D.dragonSpawn.x, D.dragonSpawn.z);
    G.enemies.push(d);
    G.boss = d;
    new Shrine({ x: 90, z: 144 });
  } else {
    const types = Object.entries(D.cfg.enemies);
    for (const rm of D.rooms) {
      if (rm.type === 'start') continue;
      const count = rndInt(...D.cfg.perRoom) + (rm.w * rm.h > 70 ? 1 : 0);
      const placed = [];
      for (let k = 0; k < count; k++) {
        const p = D.randomCellIn(rm, placed);
        if (!p) continue;
        placed.push(p);
        G.enemies.push(new Enemy(weightedPick(types), p.x, p.z, n));
      }
      if (rm.type === 'exit' && D.cfg.guardian) {
        const p = D.randomCellIn(rm, placed);
        if (p) G.enemies.push(new Enemy(D.cfg.guardian, p.x, p.z, n));
      }
    }
    D.chestSpots.forEach((s, i) => new Chest(s, i === 0));
    if (D.shrineSpot) new Shrine(D.shrineSpot);
    for (const t of D.trapSpots) G.traps.push(new Trap(t, n));
    if (D.stairs) new Stairs(D.stairs);
  }
  D.computeFlow(P.pos.x, P.pos.z);
  D.reveal(P.pos.x, P.pos.z, 8);
  G.ui.floorName(n, D.cfg.name);
  G.ui.banner(`Étage ${n}`, D.cfg.name, 3800);
  G.ui.log(`🕯️ Vous pénétrez dans <b>${D.cfg.name}</b>.`);
  setPref('best', Math.max(+pref('best', 0), n));
}

function startGame(cls) {
  G.audio.init();
  disposeWorld();
  if (G.player) G.player.dispose();
  G.player = new Player(cls);
  G.stats = { kills: 0, crits: 0, damage: 0, gold: 0, startTime: performance.now() };
  G.ui.setupHud(G.player);
  loadFloor(1);
  G.ui.hideAllScreens();
  G.ui.show('hud');
  G.state = 'playing';
  lockPointer();
}

function nextFloor() {
  if (G.state !== 'playing') return;
  G.state = 'transition';
  G.audio.play('stairs');
  document.getElementById('fade').classList.add('on');
  setTimeout(() => {
    loadFloor(G.floor + 1);
    G.state = 'playing';
    document.getElementById('fade').classList.remove('on');
  }, 800);
}
G.nextFloor = nextFloor;
G.spawnPickup = spawnPickup;

G.summonMinions = (n) => {
  const P = G.player, D = G.dungeon;
  for (let k = 0; k < n; k++) {
    for (let tries = 0; tries < 12; tries++) {
      const a = rnd(0, Math.PI * 2), r = rnd(7, 12);
      const x = P.pos.x + Math.cos(a) * r, z = P.pos.z + Math.sin(a) * r;
      if (!D.pathable(D.ci(x), D.ci(z))) continue;
      const e = new Enemy('squelette', x, z, 4);
      e.aware = true;
      e.state = 'chase';
      G.enemies.push(e);
      G.fx.magic(new V(x, 1, z), 50, [2, 0.4, 2.5]);
      G.fx.norm.emit({ x, y: 0.5, z, count: 20, spread: 0.8, vy: 1.5, vel: 1, life: 1.2, size: 0.8, size1: 1.8, color: [0.15, 0.05, 0.2], alpha: 0.6 });
      break;
    }
  }
};

G.onVictory = () => {
  G.state = 'win';
  document.exitPointerLock && document.exitPointerLock();
  G.ui.endStats('winStats', G.player, [['Pyraxis', 'terrassé']]);
  G.ui.show('winScr');
  setPref('won', 1);
  G.audio.bossMusic(false);
  G.audio.play('levelup');
};

function gameOver() {
  G.state = 'dead';
  document.exitPointerLock && document.exitPointerLock();
  G.ui.endStats('deadStats', G.player);
  G.ui.show('deadScr');
  G.audio.bossMusic(false);
}

function backToTitle() {
  G.ui.hideAllScreens();
  G.ui.hide('hud');
  G.ui.hide('bigmap');
  buildTitleScene();
  G.state = 'title';
  G.ui.show('title');
  showBest();
}

function showBest() {
  const b = +pref('best', 0), w = +pref('won', 0);
  document.getElementById('best').textContent = w ? '🏆 Vous avez déjà vaincu Pyraxis.' : b ? `Record : étage ${b} atteint.` : '';
}

// ---------------------------------------------------------------- Montée de niveau / pause / fiche
function openLevelUp() {
  const P = G.player;
  G.state = 'levelup';
  document.exitPointerLock && document.exitPointerLock();
  G.ui.levelUp(P, P.boonChoices(), (b) => {
    P.applyBoon(b);
    P.pendingLevels--;
    G.ui.hide('levelup');
    G.audio.play('ui');
    G.ui.log(`${b.icon} Don acquis : <span class="crit">${b.name}</span>`);
    if (P.pendingLevels > 0) openLevelUp();
    else { G.state = 'playing'; lockPointer(); }
  });
}

function pause() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  G.ui.show('pause');
}
function resume() {
  G.ui.hide('pause');
  G.ui.hide('controlsScr');
  G.state = 'playing';
  lockPointer();
}
function toggleSheet() {
  if (G.state === 'playing') {
    G.state = 'sheet';
    document.exitPointerLock && document.exitPointerLock();
    G.ui.sheet(G.player);
  } else if (G.state === 'sheet') {
    G.ui.hide('sheet');
    G.state = 'playing';
    lockPointer();
  }
}

function lockPointer() {
  if (I.lockFailed || !canvas.requestPointerLock) return;
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { I.lockFailed = true; });
  } catch { I.lockFailed = true; }
}

// ---------------------------------------------------------------- Commandes tactiles (téléphone / tablette)
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let touchEl = null, touchShown = false;
function releaseTouch() {
  I.stick = null;
  I.mouseL = I.mouseR = false;
  const st = document.getElementById('stick');
  if (st) st.style.display = 'none';
  document.querySelectorAll('#touch .tb.on').forEach((b) => b.classList.remove('on'));
}
function setupTouch() {
  G.touch = IS_TOUCH;
  if (!IS_TOUCH) return;
  document.body.classList.add('touch');
  I.lockFailed = true;
  touchEl = document.getElementById('touch');
  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  const ptrs = new Map();
  const R = 58;
  const act = (a, down) => {
    G.audio.init();
    switch (a) {
      case 'atk': I.mouseL = down; if (down) I.clickL = true; break;
      case 'sec': I.mouseR = down; if (down) I.clickR = true; break;
      case 'spe': if (down) I.pressed.KeyF = true; break;
      case 'dodge': if (down) I.pressed.Space = true; break;
      case 'pot': if (down) I.pressed.KeyR = true; break;
      case 'use': if (down) I.pressed.KeyE = true; break;
      case 'pause': if (down) { releaseTouch(); pause(); } break;
      case 'sheet': if (down) { releaseTouch(); toggleSheet(); } break;
      case 'map': if (down) G.ui.toggleBigmap(); break;
    }
  };
  touchEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const b = e.target.closest('.tb');
    if (b) {
      ptrs.set(e.pointerId, { kind: 'btn', b, a: b.dataset.a });
      b.classList.add('on');
      act(b.dataset.a, true);
    } else if (e.clientX < innerWidth * 0.45 && ![...ptrs.values()].some((p) => p.kind === 'stick')) {
      ptrs.set(e.pointerId, { kind: 'stick', x0: e.clientX, y0: e.clientY });
      stick.style.display = 'block';
      stick.style.left = e.clientX + 'px';
      stick.style.top = e.clientY + 'px';
      knob.style.transform = '';
      I.stick = { x: 0, y: 0 };
    } else {
      ptrs.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
    }
    try { touchEl.setPointerCapture(e.pointerId); } catch { /* sans importance */ }
  });
  touchEl.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') {
      let dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      I.stick = { x: dx / R, y: -dy / R };
    } else if (p.kind === 'look') {
      const k = G.cam.sens / 0.0022;
      G.cam.yaw -= (e.clientX - p.x) * 0.0068 * k;
      G.cam.pitch = clamp(G.cam.pitch + (e.clientY - p.y) * 0.005 * k, -0.3, 1.15);
      p.x = e.clientX;
      p.y = e.clientY;
    }
  });
  const up = (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (p.kind === 'btn') { p.b.classList.remove('on'); act(p.a, false); }
    if (p.kind === 'stick') { stick.style.display = 'none'; I.stick = null; }
  };
  touchEl.addEventListener('pointerup', up);
  touchEl.addEventListener('pointercancel', up);
  touchEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

// bouton « retour » d'Android (appelé par l'appli native)
window.__back = () => {
  if (G.state === 'playing') { releaseTouch(); pause(); return 'paused'; }
  if (G.state === 'paused') { resume(); return 'resumed'; }
  if (G.state === 'sheet') { toggleSheet(); return 'ok'; }
  if (!document.getElementById('controlsScr').classList.contains('hidden')) { document.getElementById('btnBack2').click(); return 'ok'; }
  if (G.state === 'class') { G.ui.hide('classSel'); G.ui.show('title'); G.state = 'title'; return 'ok'; }
  if (G.state === 'title') return 'exit';
  return 'ok';
};

// ---------------------------------------------------------------- Entrées
function setupInput() {
  addEventListener('keydown', (e) => {
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    I.keys[e.code] = true;
    if (e.repeat) return;
    I.pressed[e.code] = true;
    if (e.code === 'Tab') toggleSheet();
    if (e.code === 'KeyM' && G.state === 'playing') G.ui.toggleBigmap();
    if (e.code === 'Escape') {
      if (G.state === 'paused') resume();
      else if (G.state === 'sheet') toggleSheet();
      else if (G.state === 'playing') pause();
    }
  });
  addEventListener('keyup', (e) => { I.keys[e.code] = false; });
  addEventListener('blur', () => { I.keys = {}; I.mouseL = I.mouseR = false; if (G.state === 'playing') pause(); });
  canvas.addEventListener('mousedown', (e) => {
    if (G.state !== 'playing') return;
    G.audio.init();
    if (!I.locked && !I.lockFailed) { lockPointer(); return; }
    if (e.button === 0) { I.mouseL = true; I.clickL = true; }
    if (e.button === 2) { I.mouseR = true; I.clickR = true; }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) I.mouseL = false;
    if (e.button === 2) I.mouseR = false;
  });
  addEventListener('mousemove', (e) => {
    if (G.state !== 'playing') return;
    if (I.locked || (I.lockFailed && e.buttons)) {
      const mx = clamp(e.movementX, -250, 250), my = clamp(e.movementY, -250, 250);
      G.cam.yaw -= mx * G.cam.sens;
      G.cam.pitch = clamp(G.cam.pitch + my * G.cam.sens, -0.3, 1.15);
    }
  });
  addEventListener('wheel', (e) => { if (G.state === 'playing') G.cam.dist = clamp(G.cam.dist + Math.sign(e.deltaY) * 0.6, 3.2, 10); }, { passive: true });
  addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    I.locked = document.pointerLockElement === canvas;
    if (!I.locked && G.state === 'playing') pause();
  });
  document.addEventListener('pointerlockerror', () => { I.lockFailed = true; });

  const $ = (id) => document.getElementById(id);
  $('btnPlay').onclick = () => {
    if (G.state !== 'title') return; G.audio.init(); G.audio.play('ui'); G.ui.hide('title'); G.state = 'class'; G.ui.classSelect((k) => { G.audio.play('ui'); startGame(k); }); };
  $('btnControls').onclick = () => { G.ui.hide('title'); G.ui.show('controlsScr'); G.controlsFrom = 'title'; };
  $('btnControls2').onclick = () => { G.ui.hide('pause'); G.ui.show('controlsScr'); G.controlsFrom = 'pause'; };
  $('btnBack2').onclick = () => { G.ui.hide('controlsScr'); G.ui.show(G.controlsFrom === 'pause' ? 'pause' : 'title'); };
  $('btnBack1').onclick = () => { G.ui.hide('classSel'); G.ui.show('title'); G.state = 'title'; };
  $('btnQuality').textContent = `Qualité graphique : ${G.quality === 'high' ? 'Ultra' : 'Performance'}`;
  $('btnQuality').onclick = () => { setPref('quality', G.quality === 'high' ? 'low' : 'high'); location.reload(); };
  $('btnResume').onclick = resume;
  $('btnQuit').onclick = () => { G.ui.hide('pause'); backToTitle(); };
  $('btnRetry').onclick = () => { const c = G.player.clsKey; G.ui.hideAllScreens(); startGame(c); };
  $('btnMenu1').onclick = backToTitle;
  $('btnAgain').onclick = backToTitle;
  $('vol').value = pref('vol', 0.8);
  $('sens').value = pref('sens', 0.0022);
  G.cam.sens = +$('sens').value;
  G.audio.setVolume(+$('vol').value);
  $('vol').oninput = (e) => { G.audio.setVolume(+e.target.value); setPref('vol', e.target.value); };
  $('sens').oninput = (e) => { G.cam.sens = +e.target.value; setPref('sens', e.target.value); };
}

// ---------------------------------------------------------------- Caméra
const _c = new V();
function updateCamera(dt) {
  const P = G.player, C = G.cam, D = G.dungeon, cam = G.camera;
  camTarget.x = damp(camTarget.x, P.pos.x, 16, dt);
  camTarget.z = damp(camTarget.z, P.pos.z, 16, dt);
  camTarget.y = damp(camTarget.y, 1.55, 10, dt);
  const cp = Math.cos(C.pitch), sp = Math.sin(C.pitch);
  const bx = -Math.sin(C.yaw), bz = -Math.cos(C.yaw);
  const rx = -Math.cos(C.yaw), rz = Math.sin(C.yaw);
  let sh = 0.55;
  sh = Math.min(sh, D.ray(camTarget.x, camTarget.z, rx, rz, sh + 0.4) - 0.4);
  sh = Math.max(0, sh);
  const px = camTarget.x + rx * sh, pz = camTarget.z + rz * sh;
  let want = C.dist;
  if (cp > 0.05) want = Math.min(want, (D.ray(px, pz, bx, bz, C.dist * cp + 0.5, 0.1) - 0.35) / cp);
  if (sp > 0.05) want = Math.min(want, (D.wallH - 0.5 - camTarget.y) / sp);
  if (sp < -0.05) want = Math.min(want, (camTarget.y - 0.35) / -sp);
  want = Math.max(0.8, want);
  C.cur = want < C.cur ? damp(C.cur, want, 30, dt) : damp(C.cur, want, 3.5, dt);
  cam.position.set(px + bx * cp * C.cur, camTarget.y + sp * C.cur, pz + bz * cp * C.cur);
  _c.set(px, camTarget.y + 0.2, pz);
  cam.lookAt(_c);
  if (G.shake > 0.001) {
    const s = G.shake * 0.22;
    cam.position.x += (Math.random() - 0.5) * s;
    cam.position.y += (Math.random() - 0.5) * s;
    cam.position.z += (Math.random() - 0.5) * s;
    G.shake *= Math.exp(-7 * dt);
  }
  // le personnage devient translucide si la caméra est trop proche
  const close = C.cur < 1.5;
  if (close !== P._faded) {
    P._faded = close;
    P.R.root.traverse((o) => { if (o.isMesh) { o.material.transparent = close; o.material.opacity = close ? 0.18 : 1; o.material.depthWrite = !close; o.material.needsUpdate = true; } });
  }
  P.R.root.visible = C.cur > 0.95 && P.state !== 'blink';
}

function updateOrb(dt) {
  const P = G.player, t = G.time;
  const rx = -Math.cos(P.yaw), rz = Math.sin(P.yaw);
  const tx = P.pos.x - rx * 0.75 - Math.sin(P.yaw) * 0.35, tz = P.pos.z - rz * 0.75 - Math.cos(P.yaw) * 0.35;
  const k = 1 - Math.exp(-5 * dt);
  orbPos.x += (tx - orbPos.x) * k;
  orbPos.z += (tz - orbPos.z) * k;
  orbPos.y += (2.35 + Math.sin(t * 2.1) * 0.12 - orbPos.y) * k;
  orb.position.copy(orbPos);
  orbMesh.position.copy(orbPos);
  orb.intensity = 6.5 + Math.sin(t * 5.3) * 0.5;
  if (Math.random() < dt * 14) G.fx.add.emit({ x: orbPos.x, y: orbPos.y, z: orbPos.z, count: 1, spread: 0.06, vel: 0.25, life: 0.7, size: 0.06, size1: 0.0, color: [1.4, 1.7, 3] });
}

function updateFxLights(dt) {
  const F = G.fx;
  const cands = [];
  for (let i = F.flashes.length - 1; i >= 0; i--) {
    const f = F.flashes[i];
    f.t += dt;
    if (f.t >= f.duration) { F.flashes.splice(i, 1); continue; }
    const k = 1 - f.t / f.duration;
    cands.push({ pos: f.pos, color: f.color, intensity: f.intensity * k * k, distance: f.distance });
  }
  for (const l of F.frameLights) cands.push(l);
  F.frameLights.length = 0;
  const ref = G.camera.position;
  cands.sort((a, b) => b.intensity / (1 + a.pos.distanceToSquared(ref) * 0.002) - a.intensity / (1 + b.pos.distanceToSquared(ref) * 0.002));
  for (let i = 0; i < fxLights.length; i++) {
    const L = fxLights[i], c = cands[i];
    if (!c) { L.intensity = 0; continue; }
    L.position.copy(c.pos);
    if (Array.isArray(c.color)) L.color.setRGB(c.color[0], c.color[1], c.color[2]);
    else L.color.copy(c.color);
    L.intensity = c.intensity;
    L.distance = c.distance;
  }
}

// ---------------------------------------------------------------- Boucle de jeu
function updateGame(dt) {
  let gdt = dt;
  if (G.hitstop > 0) { G.hitstop -= dt; gdt = dt * 0.12; }
  const P = G.player, D = G.dungeon;
  P.update(gdt);
  flowT -= dt;
  if (flowT <= 0) { flowT = 0.25; D.computeFlow(P.pos.x, P.pos.z); }
  for (const e of G.enemies) e.update(gdt);
  for (let i = G.enemies.length - 1; i >= 0; i--) if (!G.enemies[i].alive && G.enemies[i].removed) G.enemies.splice(i, 1);
  updateProjectiles(gdt);
  for (let i = G.pickups.length - 1; i >= 0; i--) { const p = G.pickups[i]; p.update(gdt); if (p.dead) G.pickups.splice(i, 1); }
  for (const t of G.traps) t.update(gdt);
  let best = null, bd = 1e9;
  for (const it of G.interactables) {
    it.update && it.update(gdt);
    if (!it.prompt) continue;
    const d = Math.hypot(it.pos.x - P.pos.x, it.pos.z - P.pos.z);
    if (d < it.radius && d < bd) { bd = d; best = it; }
  }
  G.ui.prompt(P.alive && best ? best.prompt : null);
  if (best && I.pressed.KeyE && P.alive) best.use();
  D.update(dt, P.pos.x, P.pos.z);
  revealT -= dt;
  if (revealT <= 0) { revealT = 0.2; D.reveal(P.pos.x, P.pos.z, 7); }
  updateOrb(dt);
  updateCamera(dt);
  G.fx.update(gdt, G.camera);
  updateFxLights(dt);
  G.ui.hud(P);
  G.ui.minimap(dt);
  if (P.pendingLevels > 0 && P.alive && P.state === 'free' && G.state === 'playing') openLevelUp();
  if (!P.alive && P.deadT > 2.8 && G.state === 'playing') gameOver();
}

let last = performance.now();
// résolution dynamique : garde ~60 i/s sur les GPU modestes
const perf = { acc: 0, n: 0, good: 0 };
function adaptResolution(raw) {
  if (G.state !== 'playing' && G.state !== 'title') { perf.acc = perf.n = 0; return; }
  perf.acc += raw;
  perf.n++;
  if (perf.acc < 1500) return;
  const avg = perf.acc / perf.n;
  perf.acc = perf.n = 0;
  const max = Math.min(devicePixelRatio, G.quality === 'high' ? 1.5 : 1);
  let pr = renderer.getPixelRatio();
  if (avg > 19.5 && pr > 0.55) { pr = Math.max(0.55, pr - (avg > 28 ? 0.2 : 0.1)); perf.good = 0; }
  else if (avg < 17.6 && pr < max) { if (++perf.good >= 3) { pr = Math.min(max, pr + 0.05); perf.good = 0; } }
  else return;
  if (Math.abs(pr - renderer.getPixelRatio()) < 0.01) return;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  onResize();
}
function frame(now) {
  requestAnimationFrame(frame);
  adaptResolution(now - last);
  tick(now);
}
// débogage : avancer la simulation de n images (utile quand l'onglet est en arrière-plan)
G.debugStep = (n = 1, step = 1 / 60) => { for (let i = 0; i < n; i++) tick(last + step * 1000); };
function tick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  G.time += dt;
  flameUniforms.uTime.value = G.time;
  if (touchEl && touchShown !== (G.state === 'playing')) {
    touchShown = G.state === 'playing';
    touchEl.classList.toggle('hidden', !touchShown);
    if (!touchShown) releaseTouch();
  }
  if (titleDragon && (G.state === 'title' || G.state === 'class')) updateTitle(dt);
  else if (G.state === 'playing') updateGame(dt);
  else if (G.state === 'transition') { G.fx.update(dt, G.camera); }
  // post-traitement
  G.damageFlash = Math.max(0, G.damageFlash - dt * 1.6);
  grade.uniforms.uTime.value = G.time;
  grade.uniforms.uDamage.value = G.damageFlash;
  const P = G.player;
  grade.uniforms.uLowHp.value = P && G.state !== 'title' ? smoothstep(0.35, 0.08, P.hp / P.maxHp) : 0;
  composer.render();
  I.pressed = {};
  I.clickL = I.clickR = false;
}

// ---------------------------------------------------------------- Démarrage
function setLoad(p, msg) {
  document.getElementById('loadFill').style.width = p * 100 + '%';
  if (msg) document.getElementById('loadMsg').textContent = msg;
}

async function boot() {
  G.quality = pref('quality', IS_TOUCH ? 'low' : 'high');
  setLoad(0.05, 'Allumage des torches…');
  await nextFrame();
  setupRenderer();
  G.ui = new UI();
  G.audio = new AudioSys();
  G.fx = new FX(G.scene);
  onResize();
  setupInput();
  setupTouch();
  setLoad(0.2, 'Taille des pierres du donjon…');
  await nextFrame();
  initDungeonAssets();
  setLoad(0.7, 'Réveil du dragon…');
  await nextFrame();
  buildTitleScene();
  updateTitle(0.016);
  setLoad(0.9, 'Compilation des sortilèges…');
  await nextFrame();
  renderer.compile(G.scene, G.camera);
  setLoad(1, 'Prêt.');
  await nextFrame();
  G.ui.hide('loading');
  if (G.state === 'loading') {
    G.ui.show('title');
    showBest();
    G.state = 'title';
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('loadMsg').textContent = 'Erreur : ' + err.message;
});
