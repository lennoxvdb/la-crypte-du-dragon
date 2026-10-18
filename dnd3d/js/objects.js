// Objets du donjon : coffres, autels, pièges, butin au sol, escalier.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';
import { rnd, rndInt, roll, die, clamp } from './util.js';
import { CELL } from './dungeon.js';

const V = THREE.Vector3;
let M = null;
function mats() {
  if (M) return M;
  M = {
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4022, roughness: 0.75 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x3e2414, roughness: 0.8 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.4, metalness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe8b850, roughness: 0.22, metalness: 1, emissive: 0x4a2a00, emissiveIntensity: 0.6 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.85 }),
    water: new THREE.MeshStandardMaterial({ color: 0x0a2a40, emissive: 0x2a9cff, emissiveIntensity: 2.2, roughness: 0.05, metalness: 0.2 }),
    crystal: new THREE.MeshStandardMaterial({ color: 0x88ccff, emissive: 0x3aa0ff, emissiveIntensity: 3.5, roughness: 0.1 }),
    potion: new THREE.MeshStandardMaterial({ color: 0xff2030, emissive: 0xff1020, emissiveIntensity: 2.2, roughness: 0.1, transparent: true, opacity: 0.9 }),
    cork: new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.9 }),
    trap: new THREE.MeshStandardMaterial({ color: 0x2c2b2e, roughness: 0.5, metalness: 0.8, emissive: 0xff1a00, emissiveIntensity: 0 }),
    spike: new THREE.MeshStandardMaterial({ color: 0xa8acb4, roughness: 0.3, metalness: 1 }),
  };
  M.spikeGeo = mergeGeometries(
    Array.from({ length: 16 }, (_, k) => new THREE.ConeGeometry(0.11, 0.9, 6).translate(((k % 4) - 1.5) * 0.65, 0.45, (Math.floor(k / 4) - 1.5) * 0.65)),
  );
  return M;
}

// ---------------------------------------------------------------- Coffre
export class Chest {
  constructor(spot, guaranteedItem = false) {
    const m = mats();
    this.pos = new V(spot.x, 0, spot.z);
    this.radius = 2.3;
    this.prompt = 'Ouvrir le coffre';
    this.opened = false;
    this.item = guaranteedItem;
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.rotation.y = spot.yaw;
    const add = (geo, mat, p, parent = this.group) => { const o = new THREE.Mesh(geo, mat); o.position.set(...p); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
    add(new THREE.BoxGeometry(1.3, 0.72, 0.85), m.wood, [0, 0.36, 0]);
    for (const x of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.08, 0.74, 0.88), m.iron, [x, 0.37, 0]);
    this.lid = new THREE.Group();
    this.lid.position.set(0, 0.72, -0.425);
    this.group.add(this.lid);
    const lidGeo = new THREE.CylinderGeometry(0.425, 0.425, 1.3, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.425);
    add(lidGeo, m.woodDark, [0, 0, 0], this.lid);
    for (const x of [-0.5, 0.5]) add(new THREE.CylinderGeometry(0.44, 0.44, 0.09, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.425), m.iron, [x, 0, 0], this.lid);
    add(new THREE.BoxGeometry(0.16, 0.2, 0.06), m.gold, [0, 0.62, 0.44]);
    this.lidT = 0;
    G.scene.add(this.group);
    G.interactables.push(this);
  }
  use() {
    if (this.opened) return;
    this.opened = true;
    this.prompt = null;
    G.audio.play('chest', this.pos);
    const P = G.player;
    const gold = rndInt(12, 30) * G.floor;
    const fwd = new V(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    const out = this.pos.clone().addScaledVector(fwd, 0.9);
    spawnPickup('gold', out.x, out.z, gold, true);
    if (Math.random() < 0.6) spawnPickup('potion', out.x, out.z, 1, true);
    if (this.item || Math.random() < 0.5) {
      const it = P.giveItem();
      if (it) {
        G.ui.banner(`${it.icon} ${it.name}`, it.desc);
        G.ui.log(`🎁 Objet magique trouvé : <span class="crit">${it.name}</span> — ${it.desc}`);
        G.audio.play('item');
      }
    }
    G.fx.add.emit({ x: this.pos.x, y: 0.9, z: this.pos.z, count: 50, spread: 0.4, vy: 3, vel: 1.5, life: 1.2, size: 0.15, size1: 0.02, color: [3, 2.2, 0.8], color1: [1, 0.5, 0.1], gravity: 2 });
    G.fx.flash(new V(this.pos.x, 1.2, this.pos.z), [1, 0.8, 0.4], 25, 7, 0.6);
  }
  update(dt) {
    if (this.opened && this.lidT < 1) {
      this.lidT = Math.min(1, this.lidT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.lidT, 3);
      this.lid.rotation.x = -1.95 * e;
    }
    if (!this.opened && Math.random() < dt * 3) {
      G.fx.add.emit({ x: this.pos.x + rnd(-0.6, 0.6), y: 0.8, z: this.pos.z + rnd(-0.4, 0.4), count: 1, vy: 0.5, life: 1.2, size: 0.06, color: [2, 1.5, 0.5] });
    }
  }
  dispose() { G.scene.remove(this.group); }
}

// ---------------------------------------------------------------- Autel de soin
export class Shrine {
  constructor(spot) {
    const m = mats();
    this.pos = new V(spot.x, 0, spot.z);
    this.radius = 2.6;
    this.prompt = 'Boire à la fontaine sacrée (soins complets)';
    this.used = false;
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    const add = (geo, mat, p) => { const o = new THREE.Mesh(geo, mat); o.position.set(...p); o.castShadow = o.receiveShadow = true; this.group.add(o); return o; };
    add(new THREE.CylinderGeometry(1.0, 1.15, 0.3, 16), m.stone, [0, 0.15, 0]);
    add(new THREE.CylinderGeometry(0.35, 0.5, 0.7, 12), m.stone, [0, 0.65, 0]);
    add(new THREE.CylinderGeometry(0.9, 0.55, 0.35, 18), m.stone, [0, 1.12, 0]);
    this.water = add(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 22), m.water.clone(), [0, 1.26, 0]);
    this.crystal = add(new THREE.OctahedronGeometry(0.28), m.crystal.clone(), [0, 2.1, 0]);
    this.crystal.castShadow = false;
    this.water.castShadow = false;
    G.scene.add(this.group);
    G.interactables.push(this);
  }
  use() {
    if (this.used) return;
    this.used = true;
    this.prompt = null;
    const P = G.player;
    const healed = P.maxHp - P.hp;
    P.hp = P.maxHp;
    P.mana = P.maxMana;
    P.stamina = P.maxStamina;
    G.fx.heal(P.pos);
    G.fx.text(new V(P.pos.x, 2.2, P.pos.z), `+${healed}`, 'heal', 1.2);
    G.audio.play('shrine', this.pos);
    G.ui.log('⛲ La fontaine sacrée vous restaure entièrement.');
    this.water.material.emissiveIntensity = 0.2;
    this.crystal.material.emissiveIntensity = 0.3;
    const l = G.dungeon.lights.find((l) => l.kind === 'shrine');
    if (l) l.mult = 0.15;
  }
  update(dt) {
    this.crystal.rotation.y += dt;
    this.crystal.position.y = 2.1 + Math.sin(G.time * 2) * 0.12;
    if (!this.used && Math.random() < dt * 8) {
      G.fx.add.emit({ x: this.pos.x + rnd(-0.6, 0.6), y: 1.3, z: this.pos.z + rnd(-0.6, 0.6), count: 1, vy: 0.9, life: 1.4, size: 0.08, color: [0.5, 1.4, 3] });
    }
  }
  dispose() { G.scene.remove(this.group); }
}

// ---------------------------------------------------------------- Piège à pointes
export class Trap {
  constructor(spot, floor) {
    const m = mats();
    this.pos = new V(spot.x, 0, spot.z);
    this.dc = 11 + floor;
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.mat = m.trap.clone();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.05, 2.7), this.mat);
    plate.position.y = 0.025;
    plate.receiveShadow = true;
    this.group.add(plate);
    this.spikes = new THREE.Mesh(m.spikeGeo, m.spike);
    this.spikes.position.y = -0.95;
    this.spikes.castShadow = true;
    this.group.add(this.spikes);
    this.t = rnd(0, 3);
    this.phase = 'idle';
    this.hitThisCycle = false;
    G.scene.add(this.group);
  }
  update(dt) {
    const P = G.player;
    const near = P.pos.distanceToSquared(this.pos) < 40 * 40;
    this.t += dt;
    const IDLE = 2.4, WARN = 0.7, UP = 0.9, DOWN = 0.4;
    if (this.phase === 'idle' && this.t > IDLE) { this.phase = 'warn'; this.t = 0; if (near) G.audio.play('trapClick', this.pos); }
    else if (this.phase === 'warn' && this.t > WARN) { this.phase = 'up'; this.t = 0; this.hitThisCycle = false; if (near) G.audio.play('trap', this.pos); }
    else if (this.phase === 'up' && this.t > UP) { this.phase = 'down'; this.t = 0; }
    else if (this.phase === 'down' && this.t > DOWN) { this.phase = 'idle'; this.t = 0; }
    let y = -0.95;
    if (this.phase === 'warn') { y = -0.95 + Math.sin(this.t * 60) * 0.03 + 0.15 * (this.t / WARN); this.mat.emissiveIntensity = 0.6 + Math.sin(this.t * 30) * 0.5; }
    else this.mat.emissiveIntensity = 0;
    if (this.phase === 'up') y = Math.min(0, -0.95 + this.t * 12);
    if (this.phase === 'down') y = -this.t / DOWN * 0.95;
    this.spikes.position.y = y;
    if (this.phase === 'up' && this.t < 0.3 && !this.hitThisCycle && P.alive) {
      if (Math.abs(P.pos.x - this.pos.x) < 1.45 && Math.abs(P.pos.z - this.pos.z) < 1.45) {
        this.hitThisCycle = true;
        P.receiveAttack({ save: { stat: 'DEX', dc: this.dc }, dice: [[2, 8, 0]], type: 'area', label: 'Piège à pointes', unblockable: true });
      }
      for (const e of G.enemies) {
        if (!e.alive || e.kind === 'dragon' || e._trapHit === this.cycleId) continue;
        if (Math.abs(e.pos.x - this.pos.x) < 1.45 && Math.abs(e.pos.z - this.pos.z) < 1.45) {
          e._trapHit = this.cycleId;
          const r = roll(2, 8);
          e.takeDamage(r.total, { crit: false });
          G.fx.text(e.headPos(), `${r.total}`, 'dmg', 0.8);
        }
      }
    }
    if (this.phase === 'warn' && this.t < dt * 1.5) this.cycleId = Math.random();
  }
  dispose() { G.scene.remove(this.group); }
}

// ---------------------------------------------------------------- Butin
const COIN_GEO = new THREE.CylinderGeometry(0.11, 0.11, 0.025, 12);
const BOTTLE_GEO = new THREE.SphereGeometry(0.17, 12, 10);
const NECK_GEO = new THREE.CylinderGeometry(0.05, 0.06, 0.16, 8);
const CORK_GEO = new THREE.CylinderGeometry(0.055, 0.05, 0.06, 8);

export class Pickup {
  constructor(kind, x, z, amount = 1, pop = false) {
    const m = mats();
    this.kind = kind;
    this.amount = amount;
    this.pos = new V(x, 0.6, z);
    this.vel = pop ? new V(rnd(-2.5, 2.5), rnd(4, 6), rnd(-2.5, 2.5)) : new V(rnd(-1.5, 1.5), rnd(3, 5), rnd(-1.5, 1.5));
    this.group = new THREE.Group();
    if (kind === 'gold') {
      const n = clamp(Math.ceil(amount / 6), 2, 6);
      for (let i = 0; i < n; i++) {
        const c = new THREE.Mesh(COIN_GEO, m.gold);
        c.position.set(rnd(-0.12, 0.12), i * 0.03, rnd(-0.12, 0.12));
        c.rotation.set(rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2));
        this.group.add(c);
      }
    } else {
      const b = new THREE.Mesh(BOTTLE_GEO, m.potion);
      this.group.add(b);
      const n = new THREE.Mesh(NECK_GEO, m.potion); n.position.y = 0.2; this.group.add(n);
      const c = new THREE.Mesh(CORK_GEO, m.cork); c.position.y = 0.3; this.group.add(c);
    }
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.position.copy(this.pos);
    this.t = 0;
    this.dead = false;
    G.scene.add(this.group);
    G.pickups.push(this);
  }
  update(dt) {
    const P = G.player;
    this.t += dt;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (this.t > 0.6 && d < 3.5 && P.alive) {
      const pull = 14 * (1 - d / 3.5) + 4;
      this.pos.x += (dx / d) * pull * dt;
      this.pos.z += (dz / d) * pull * dt;
      this.pos.y += (1.0 - this.pos.y) * Math.min(1, dt * 8);
      if (d < 0.7) return this.collect();
    } else {
      this.vel.y -= 18 * dt;
      this.pos.addScaledVector(this.vel, dt);
      const base = this.kind === 'gold' ? 0.05 : 0.18;
      if (this.pos.y < base) { this.pos.y = base; this.vel.y *= -0.35; this.vel.x *= 0.6; this.vel.z *= 0.6; }
      const D = G.dungeon;
      const before = this.pos.clone();
      D.collide(this.pos, 0.2, true);
      if (before.x !== this.pos.x) this.vel.x *= -0.5;
      if (before.z !== this.pos.z) this.vel.z *= -0.5;
    }
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(this.t * 3) * 0.05 + 0.05;
    this.group.rotation.y += dt * 2;
    if (Math.random() < dt * 2) G.fx.add.emit({ x: this.pos.x, y: this.pos.y + 0.2, z: this.pos.z, count: 1, vy: 0.4, life: 0.8, size: 0.07, color: this.kind === 'gold' ? [2.5, 1.8, 0.5] : [2.5, 0.3, 0.3] });
  }
  collect() {
    const P = G.player;
    this.dead = true;
    G.scene.remove(this.group);
    if (this.kind === 'gold') {
      P.gold += this.amount;
      G.stats.gold += this.amount;
      G.fx.text(new V(P.pos.x, 2.0, P.pos.z), `+${this.amount} po`, 'gold', 0.9);
      G.audio.play('coin');
    } else {
      P.potions++;
      G.fx.text(new V(P.pos.x, 2.0, P.pos.z), '+1 potion', 'heal', 0.9);
      G.audio.play('pickup');
    }
  }
  dispose() { if (!this.dead) G.scene.remove(this.group); this.dead = true; }
}

export function spawnPickup(kind, x, z, amount, pop) {
  return new Pickup(kind, x, z, amount, pop);
}

// ---------------------------------------------------------------- Escalier
export class Stairs {
  constructor(st) {
    this.pos = new V(st.x, 0, st.z);
    this.radius = 4.3;
    this.prompt = 'Descendre vers les profondeurs';
    G.interactables.push(this);
  }
  use() { G.nextFloor(); }
  update() {
    if (Math.random() < 0.3) G.fx.add.emit({ x: this.pos.x + rnd(-2.6, 2.6), y: -1.5, z: this.pos.z + rnd(-2.6, 2.6), count: 1, vy: 2.2, life: 1.6, size: 0.1, color: [0.5, 1.4, 3] });
  }
  dispose() {}
}
