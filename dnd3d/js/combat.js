// Résolution des attaques (règles du d20) et projectiles.
import * as THREE from 'three';
import { G } from './state.js';
import { die, roll, fmtMod, rnd } from './util.js';

// ---------------------------------------------------------------- Attaque du joueur sur un ennemi
// a: { atk, dice:[[c,s,b],...], critMin, autoHit, autoCrit, save:{dc}, dir:Vector3, knock, source, label, mult, adv }
export function playerAttack(e, a) {
  if (!e.alive) return false;
  let nat = 0, total = 0, hit = true, crit = !!a.autoCrit;
  const name = e.name;
  if (!a.autoHit && !a.save) {
    nat = die(20);
    if (a.adv) nat = Math.max(nat, die(20));
    total = nat + a.atk;
    crit = crit || nat >= (a.critMin || 20);
    hit = nat !== 1 && (crit || total >= e.ac);
    G.ui.dice(nat, crit, nat === 1);
  }
  if (!hit) {
    G.fx.text(e.headPos(), 'Raté', 'miss', 0.8);
    G.ui.log(`🎲 <b>${nat}</b>${fmtMod(a.atk)} = ${total} contre CA ${e.ac} (${name}) — <span class="miss">raté</span>`);
    G.audio.play('miss', e.pos);
    return false;
  }
  let dmg = 0;
  const parts = [];
  for (const [c, s, b] of a.dice) {
    const n = crit ? c * 2 : c;
    const r = roll(n, s, b || 0);
    dmg += r.total;
    parts.push(`${n}d${s}${b ? fmtMod(b) : ''}`);
  }
  let saveTxt = '';
  if (a.save) {
    const sv = die(20) + (e.saveBonus || 0);
    if (sv >= a.save.dc) { dmg = Math.floor(dmg / 2); saveTxt = ` · sauvegarde ${sv} ≥ DD ${a.save.dc} : moitié`; }
    else saveTxt = ` · sauvegarde ${sv} < DD ${a.save.dc}`;
  }
  dmg = Math.max(1, Math.round(dmg * (a.mult || 1)));
  e.takeDamage(dmg, { crit, dir: a.dir, knock: a.knock || 0, source: a.source || 'melee' });
  G.fx.text(e.headPos(), crit ? `${dmg}!` : `${dmg}`, crit ? 'crit' : 'dmg', crit ? 1.2 : 0.9);
  G.stats.damage += dmg;
  if (crit) {
    G.stats.crits++;
    G.ui.flashCrit();
  }
  const rollTxt = a.autoHit ? 'touche automatiquement' : a.save ? 'jet de sauvegarde' : `🎲 <b>${nat}</b>${fmtMod(a.atk)} = ${total} contre CA ${e.ac}`;
  G.ui.log(`${rollTxt} — ${a.label || ''} <span class="${crit ? 'crit' : 'hit'}">${crit ? 'CRITIQUE ! ' : ''}${dmg} dégâts</span> <small>(${parts.join(' + ')}${saveTxt})</small>`);
  if (a.source === 'melee') {
    G.hitstop = Math.max(G.hitstop, crit ? 0.1 : 0.055);
    G.shake = Math.max(G.shake, crit ? 0.35 : 0.18);
  }
  return true;
}

// ---------------------------------------------------------------- Projectiles
const GEO = {};
function geos() {
  if (GEO.core) return GEO;
  GEO.core = new THREE.SphereGeometry(1, 12, 8);
  GEO.arrow = new THREE.CylinderGeometry(0.015, 0.015, 0.8, 5).rotateX(Math.PI / 2);
  GEO.arrowHead = new THREE.ConeGeometry(0.04, 0.14, 5).rotateX(Math.PI / 2).translate(0, 0, 0.45);
  GEO.dagger = new THREE.BoxGeometry(0.05, 0.012, 0.36).translate(0, 0, 0.14);
  GEO.handle = new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6).rotateX(Math.PI / 2).translate(0, 0, -0.08);
  GEO.rock = new THREE.DodecahedronGeometry(0.7, 0);
  return GEO;
}
const MAT = {};
function mats() {
  if (MAT.fire) return MAT;
  MAT.fire = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.6, 0.4) });
  MAT.magic = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 4) });
  MAT.wood = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.8 });
  MAT.steel = new THREE.MeshStandardMaterial({ color: 0xc8ced8, metalness: 0.95, roughness: 0.25 });
  MAT.booger = new THREE.MeshStandardMaterial({ color: 0x8fd14f, emissive: 0x3a7a10, emissiveIntensity: 0.8, roughness: 0.15 });
  MAT.rock = new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: 0xff4a0a, emissiveIntensity: 2.2, roughness: 0.9 });
  return MAT;
}

export class Projectile {
  // o: { kind, pos, vel, owner, radius, life, target, onHit, onWall, gravity, homing }
  constructor(o) {
    Object.assign(this, { radius: 0.25, life: 3, gravity: 0, homing: 0, t: 0, dead: false }, o);
    this.pos = o.pos.clone();
    this.vel = o.vel.clone();
    const g = geos(), m = mats();
    this.mesh = new THREE.Group();
    switch (this.kind) {
      case 'firebolt': { const s = new THREE.Mesh(g.core, m.fire); s.scale.setScalar(0.13); this.mesh.add(s); break; }
      case 'fireball': { const s = new THREE.Mesh(g.core, m.fire); s.scale.setScalar(0.3); this.mesh.add(s); break; }
      case 'booger': { const s = new THREE.Mesh(g.core, m.booger); s.scale.set(0.11, 0.1, 0.13); this.mesh.add(s); this.rock = s; break; }
      case 'missile': { const s = new THREE.Mesh(g.core, m.magic); s.scale.set(0.07, 0.07, 0.22); this.mesh.add(s); break; }
      case 'arrow': { this.mesh.add(new THREE.Mesh(g.arrow, m.wood), new THREE.Mesh(g.arrowHead, m.steel)); break; }
      case 'dagger': { this.spin = new THREE.Group(); this.spin.add(new THREE.Mesh(g.dagger, m.steel), new THREE.Mesh(g.handle, m.wood)); this.mesh.add(this.spin); break; }
      case 'meteor': { const s = new THREE.Mesh(g.rock, m.rock); this.mesh.add(s); this.rock = s; break; }
    }
    this.mesh.position.copy(this.pos);
    G.scene.add(this.mesh);
    G.projectiles.push(this);
  }
  kill() {
    if (this.dead) return;
    this.dead = true;
    G.scene.remove(this.mesh);
  }
  update(dt) {
    this.t += dt;
    if (this.t > this.life) { this.onExpire ? this.onExpire(this) : null; this.kill(); return; }
    // guidage
    if (this.homing && this.target && this.target.alive) {
      const to = this.target.aimPoint().sub(this.pos).normalize();
      const sp = this.vel.length();
      const cur = this.vel.clone().normalize();
      cur.lerp(to, Math.min(1, this.homing * dt * (1 + this.t * 2))).normalize();
      this.vel.copy(cur.multiplyScalar(sp));
    }
    this.vel.y -= this.gravity * dt;
    const steps = Math.ceil((this.vel.length() * dt) / 0.3);
    const sdt = dt / steps;
    for (let s = 0; s < steps && !this.dead; s++) {
      this.pos.addScaledVector(this.vel, sdt);
      // murs / sol / plafond
      const D = G.dungeon;
      if (this.ghost) {
        if (this.pos.y < 0.05) { if (this.onWall) this.onWall(this); this.kill(); return; }
        continue;
      }
      if (D.isWallAt(this.pos.x, this.pos.z) || this.pos.y < 0.05 || this.pos.y > D.wallH - 0.1) {
        if (this.onWall) this.onWall(this);
        this.kill();
        return;
      }
      const cs = D.circles.get(D.ci(this.pos.z) * D.W + D.ci(this.pos.x));
      if (cs && this.pos.y < 3.5) for (const c of cs) {
        if ((this.pos.x - c.x) ** 2 + (this.pos.z - c.z) ** 2 < c.r * c.r) { if (this.onWall) this.onWall(this); this.kill(); return; }
      }
      if (this.owner === 'player') {
        for (const e of G.enemies) {
          if (!e.alive) continue;
          if (e.hitDistance(this.pos) < this.radius) { this.onHit(e, this); this.kill(); return; }
        }
      } else if (this.owner === 'enemy') {
        const P = G.player;
        if (P && P.alive) {
          const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
          if (dx * dx + dz * dz < (0.5 + this.radius) ** 2 && this.pos.y < 2.1) { this.onHit(P, this); this.kill(); return; }
        }
      }
    }
    this.mesh.position.copy(this.pos);
    if (this.kind === 'arrow' || this.kind === 'missile' || this.kind === 'dagger') {
      this.mesh.lookAt(this.pos.x + this.vel.x, this.pos.y + this.vel.y, this.pos.z + this.vel.z);
    }
    if (this.spin) this.spin.rotation.x += dt * 25;
    if (this.rock) { this.rock.rotation.x += dt * 3; this.rock.rotation.y += dt * 2; }
    this.trail(dt);
  }
  trail(dt) {
    const p = this.pos, F = G.fx;
    switch (this.kind) {
      case 'firebolt':
        F.add.emit({ x: p.x, y: p.y, z: p.z, count: 3, spread: 0.06, vel: 0.6, life: 0.3, size: 0.35, size1: 0.05, color: [3, 1.2, 0.3], color1: [1, 0.15, 0.02] });
        F.frameLights.push({ pos: p, color: [1, 0.45, 0.12], intensity: 14, distance: 9 });
        break;
      case 'fireball':
        F.add.emit({ x: p.x, y: p.y, z: p.z, count: 6, spread: 0.15, vel: 1, life: 0.45, size: 0.8, size1: 0.1, color: [3, 1.3, 0.3], color1: [1, 0.12, 0.02] });
        F.norm.emit({ x: p.x, y: p.y, z: p.z, count: 1, spread: 0.2, vel: 0.3, vy: 0.5, life: 0.9, size: 0.6, size1: 1.2, color: [0.1, 0.08, 0.07], alpha: 0.4 });
        F.frameLights.push({ pos: p, color: [1, 0.45, 0.12], intensity: 30, distance: 13 });
        break;
      case 'missile':
        F.add.emit({ x: p.x, y: p.y, z: p.z, count: 3, spread: 0.04, vel: 0.3, life: 0.35, size: 0.22, size1: 0.02, color: [1.2, 0.7, 3], color1: [0.3, 0.2, 1.5] });
        F.frameLights.push({ pos: p, color: [0.6, 0.4, 1], intensity: 8, distance: 7 });
        break;
      case 'booger':
        if (Math.random() < 0.5) F.norm.emit({ x: p.x, y: p.y, z: p.z, count: 1, spread: 0.03, life: 0.35, size: 0.08, size1: 0.02, color: [0.5, 0.85, 0.25], gravity: 6 });
        break;
      case 'meteor':
        F.add.emit({ x: p.x, y: p.y, z: p.z, count: 8, spread: 0.5, vel: 1.5, life: 0.5, size: 1.2, size1: 0.2, color: [3, 1.2, 0.3], color1: [1, 0.1, 0.02] });
        F.norm.emit({ x: p.x, y: p.y + 0.3, z: p.z, count: 2, spread: 0.4, vel: 0.4, life: 1.2, size: 1, size1: 2.2, color: [0.08, 0.06, 0.05], alpha: 0.5 });
        F.frameLights.push({ pos: p, color: [1, 0.4, 0.1], intensity: 40, distance: 16 });
        break;
    }
  }
}

// ---------------------------------------------------------------- Explosion
export function explode(pos, radius, color = 'fire') {
  G.fx.fireBurst(pos, 70, radius / 3.2);
  G.fx.flash(pos, [1, 0.5, 0.15], 70, radius * 4, 0.45);
  G.audio.play('explode', pos);
  const d = G.player ? G.player.pos.distanceTo(pos) : 10;
  G.shake = Math.max(G.shake, Math.max(0.15, 0.6 - d * 0.03));
}

export function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    if (!p.dead) p.update(dt);
    if (p.dead) G.projectiles.splice(i, 1);
  }
}

export function clearProjectiles() {
  for (const p of G.projectiles) p.kill();
  G.projectiles.length = 0;
}
