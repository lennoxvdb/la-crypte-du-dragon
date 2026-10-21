// Monstres : définitions, IA, animations. Inclut le boss dragon.
import * as THREE from 'three';
import { G } from './state.js';
import { buildSkeleton, buildGoblin, buildOgre, buildCube, buildDragon, poseHumanoid, animateDragon } from './models.js';
import { Projectile, explode } from './combat.js';
import { Telegraph } from './fx.js';
import { hasAssets, createCharacter } from './assets.js';
import { FxSet } from './shaderfx.js';
import { roll, rnd, rndInt, clamp, damp, dampAngle, wrapAngle, lerp } from './util.js';

const V = THREE.Vector3;
const _a = new V(), _b = new V();

export const ENEMY_DEFS = {
  gobelin: { name: 'Gobelin', build: buildGoblin, hp: [2, 6, 4], ac: 13, atk: 4, dmg: [1, 6, 2], speed: 5.0, radius: 0.42, height: 1.35, reach: 1.7,
    windup: 0.45, recover: 0.55, cd: [0.5, 1.3], xp: 30, kind: 'flesh', save: 1, sight: 16, arc: 0.9, attack: 'slash' },
  squelette: { name: 'Squelette', build: () => buildSkeleton(false), hp: [3, 8, 3], ac: 13, atk: 4, dmg: [1, 8, 2], speed: 3.7, radius: 0.45, height: 1.8, reach: 2.1,
    windup: 0.58, recover: 0.7, cd: [0.7, 1.5], xp: 45, kind: 'bone', save: 0, sight: 15, arc: 0.85, attack: 'overhead' },
  archer: { name: 'Squelette archer', build: () => buildSkeleton(true), hp: [2, 8, 3], ac: 12, atk: 4, dmg: [1, 8, 2], speed: 3.5, radius: 0.45, height: 1.8,
    ranged: true, range: 18, windup: 0.95, recover: 0.6, cd: [1.4, 2.4], xp: 45, kind: 'bone', save: 1, sight: 19 },
  cube: { name: 'Cube gélatineux', build: buildCube, hp: [6, 10, 12], ac: 6, atk: 5, dmg: [3, 6, 0], speed: 2.1, radius: 1.2, height: 2.3, reach: 1.9,
    windup: 0.85, recover: 1.0, cd: [1, 2], xp: 110, kind: 'slime', save: -2, sight: 12, arc: 1.2, attack: 'engulf', poise: true },
  ogre: { name: 'Ogre', build: buildOgre, hp: [8, 10, 20], ac: 11, atk: 6, dmg: [2, 8, 4], speed: 3.4, radius: 0.85, height: 3.0, reach: 3.1,
    windup: 0.9, recover: 1.05, cd: [1.1, 2.0], xp: 220, kind: 'flesh', save: 2, sight: 16, arc: 0.75, attack: 'overhead', poise: true, telegraph: true },
};

// modèles animés KayKit (CC0) pour les squelettes
function glbSkeleton(type) {
  if (type === 'archer') {
    return createCharacter('Skeleton_Rogue', { anims: 'skeleton', height: 1.85, weapons: [{ model: 'Skeleton_Crossbow', bone: 'handslot.r' }] });
  }
  const minion = type === 'minion' || Math.random() < 0.3;
  const weapons = [{ model: 'Skeleton_Blade', bone: 'handslot.r' }];
  if (!minion && Math.random() < 0.6) weapons.push({ model: 'Skeleton_Shield_Small_A', bone: 'handslot.l' });
  return createCharacter(minion ? 'Skeleton_Minion' : 'Skeleton_Warrior', { anims: 'skeleton', height: minion ? 1.7 : 1.9, weapons });
}

// ---------------------------------------------------------------- Ennemi de base
export class Enemy {
  constructor(type, x, z, floor) {
    const d = (this.def = ENEMY_DEFS[type]);
    this.type = type;
    this.name = d.name;
    this.kind = d.kind;
    const scale = 1 + 0.2 * (floor - 1);
    this.maxHp = Math.round(roll(...d.hp).total * scale);
    this.hp = this.maxHp;
    this.ac = d.ac + (floor >= 4 ? 1 : 0);
    this.atkBonus = d.atk + Math.floor((floor - 1) / 2);
    this.dmgBonus = floor - 1;
    this.saveBonus = d.save + Math.floor(floor / 2);
    this.xp = Math.round(d.xp * (1 + 0.1 * (floor - 1)));
    this.pos = new V(x, 0, z);
    this.home = this.pos.clone();
    this.vel = new V();
    this.knock = new V();
    this.yaw = rnd(0, Math.PI * 2);
    this.radius = d.radius;
    this.height = d.height;
    this.speed = d.speed * (1 + 0.04 * (floor - 1));
    this.alive = true;
    this.removed = false;
    this.aware = false;
    this.alertSoon = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.cooldown = rnd(0.3, 1);
    this.flash = 0;
    this.sneakCD = 0;
    this.losT = Math.random() * 0.2;
    this.hasLos = false;
    this.wanderT = rnd(1, 4);
    this.wander = null;
    this.walkPhase = rnd(0, 6);
    this.deathT = 0;
    this.flowPt = new V();
    const useGlb = hasAssets() && (type === 'squelette' || type === 'archer');
    const M = (this.model = useGlb ? glbSkeleton(type) : d.build());
    this.anim = useGlb ? M.anim : null;
    this.R = useGlb ? null : M.R || null;
    this.root = useGlb ? M.root : M.R ? M.R.root : M.root;
    this.root.position.copy(this.pos);
    G.scene.add(this.root);
    // matériaux pour le flash blanc
    this.mats = [];
    const seen = new Set();
    this.root.traverse((o) => {
      if (o.isMesh && !seen.has(o.material)) {
        seen.add(o.material);
        this.mats.push({ m: o.material, e: o.material.emissive.clone(), i: o.material.emissiveIntensity });
      }
    });
    this.fx = new FxSet(this.root);
    this.pose = {};
  }

  headPos() { return new V(this.pos.x, this.height + 0.25, this.pos.z); }
  aimPoint() { return new V(this.pos.x, this.height * 0.6, this.pos.z); }
  impactPoint(from) {
    const dx = from.x - this.pos.x, dz = from.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return new V(this.pos.x + (dx / d) * this.radius * 0.8, this.height * 0.6, this.pos.z + (dz / d) * this.radius * 0.8);
  }
  hitDistance(p) {
    const h = Math.hypot(p.x - this.pos.x, p.z - this.pos.z) - this.radius;
    const vy = p.y > this.height + 0.2 ? p.y - this.height - 0.2 : 0;
    return Math.max(h, vy);
  }
  meleeCheck(pp, fx, fz, reach, arc) {
    const dx = this.pos.x - pp.x, dz = this.pos.z - pp.z;
    const d = Math.hypot(dx, dz);
    if (d - this.radius > reach) return false;
    if (d < this.radius + 0.5) return true;
    const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
    return ang <= arc + Math.atan2(this.radius, d);
  }
  solidCircles() { return this.def.poise ? [{ x: this.pos.x, z: this.pos.z, r: this.radius * 0.8 }] : []; }

  alert() {
    if (this.aware || !this.alive) return;
    this.aware = true;
    if (this.state === 'idle') this.state = 'chase';
    G.fx.text(this.headPos(), '!', 'alert', 0.9);
    G.audio.play(this.kind === 'bone' ? 'rattle' : this.kind === 'slime' ? 'slime' : 'grunt', this.pos);
    for (const o of G.enemies) {
      if (o !== this && o.alive && !o.aware && o.pos.distanceToSquared(this.pos) < 100) o.alertSoon = rnd(0.2, 0.7);
    }
  }

  stun(t) {
    if (!this.alive) return;
    this.cancelAttack();
    this.state = 'stagger';
    this.stateT = 0;
    this.staggerDur = t;
    G.fx.text(this.headPos(), 'Étourdi', 'stun', 1);
  }
  cancelAttack() {
    if (this.tele) { this.tele.remove(); this.tele = null; }
  }

  takeDamage(dmg, info) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.flash = 0.13;
    if (!this.aware) this.alert();
    if (info.dir && info.knock) this.knock.addScaledVector(info.dir, info.knock * (this.def.poise ? 0.25 : 1));
    if (!this.def.poise || info.crit) {
      if (this.state === 'windup' || this.state !== 'stagger') {
        this.cancelAttack();
        this.state = 'stagger';
        this.stateT = 0;
        this.staggerDur = info.crit ? 0.6 : 0.32;
      }
    }
    G.audio.play(this.kind === 'bone' ? 'bone' : this.kind === 'slime' ? 'slime' : 'hit', this.pos, { crit: info.crit });
    if (this.kind !== 'bone' && Math.random() < 0.45) {
      G.fx.decal(this.pos.x + rnd(-0.6, 0.6), this.pos.z + rnd(-0.6, 0.6), this.kind === 'slime' ? 'slime' : 'blood', rnd(0.5, 1.0) * (this.radius > 0.8 ? 1.6 : 1));
    }
    if (this.hp <= 0) this.die(info);
  }

  die(info) {
    this.alive = false;
    this.state = 'dead';
    this.deathT = 0;
    this.cancelAttack();
    G.stats.kills++;
    G.player.onKill(this);
    G.ui.log(`☠️ ${this.name} vaincu <small>(+${this.xp} XP)</small>`);
    for (const m of this.mats) { m.m.emissive.copy(m.e); m.m.emissiveIntensity = m.i; }
    const dir = info.dir ? info.dir.clone().multiplyScalar(2.5) : new V();
    // butin
    if (Math.random() < 0.65) G.spawnPickup('gold', this.pos.x, this.pos.z, rndInt(3, 9) * G.floor);
    if (Math.random() < 0.09) G.spawnPickup('potion', this.pos.x + 0.4, this.pos.z + 0.3);
    if (this.kind === 'bone' && this.anim) {
      // effondrement animé, puis le squelette s'enfonce dans le sol
      this.anim.play('Death_C_Skeletons', { loop: false, fade: 0.1 });
      G.fx.bones(_a.set(this.pos.x, 1.2, this.pos.z), 14);
      G.audio.play('collapse', this.pos);
    } else if (this.kind === 'bone') {
      G.fx.shatter(this.root, dir);
      G.fx.bones(_a.set(this.pos.x, 1.2, this.pos.z), 20);
      G.audio.play('collapse', this.pos);
      this.removed = true;
    } else if (this.kind === 'slime') {
      G.fx.blood(_a.set(this.pos.x, 1.2, this.pos.z), 50, [0.25, 0.85, 0.35]);
      G.fx.decal(this.pos.x, this.pos.z, 'slime', 3.2);
      G.fx.add.emit({ x: this.pos.x, y: 1, z: this.pos.z, count: 30, spread: 1, vel: 3, life: 0.6, size: 0.4, size1: 0.05, color: [0.4, 1.6, 0.5] });
      G.fx.shatter(this.model.body, dir);
      G.scene.remove(this.root);
      this.removed = true;
      G.audio.play('splat', this.pos);
    } else {
      G.audio.play('enemyDie', this.pos, { pitch: this.type === 'ogre' ? 0.6 : 1.2 });
      G.fx.decal(this.pos.x, this.pos.z, 'blood', this.type === 'ogre' ? 2.6 : 1.5);
    }
  }

  setFlash() {
    const f = this.flash > 0 ? 1 : 0;
    if (f === this._lastFlash) return;
    this._lastFlash = f;
    for (const m of this.mats) {
      if (f) { m.m.emissive.setRGB(1, 1, 1); m.m.emissiveIntensity = 0.8; }
      else { m.m.emissive.copy(m.e); m.m.emissiveIntensity = m.i; }
    }
  }

  updateRim(dt) {
    const want = this.alive && G.target === this ? 0.75 + Math.sin(G.time * 7) * 0.3 : 0;
    this.fx.setRim(this.fx.rim + (want - this.fx.rim) * Math.min(1, dt * 12));
  }

  update(dt) {
    const P = G.player, D = G.dungeon;
    this.updateRim(dt);
    this.flash -= dt;
    this.sneakCD -= dt;
    this.setFlash();
    if (!this.alive) { this.deadUpdate(dt); return; }
    if (this.spawnT > 0) {
      // squelette qui surgit du sol (invocation)
      this.spawnT -= dt;
      this.anim && this.anim.update(dt);
      this.root.position.set(this.pos.x, 0, this.pos.z);
      this.root.rotation.y = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      this.yaw = this.root.rotation.y;
      return;
    }
    this.stateT += dt;
    this.cooldown -= dt;
    if (this.alertSoon > 0) { this.alertSoon -= dt; if (this.alertSoon <= 0) this.alert(); }
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.18 + Math.random() * 0.1;
      this.hasLos = dist < 30 && D.los(this.pos.x, this.pos.z, P.pos.x, P.pos.z);
    }
    if (!this.aware && P.alive) {
      const sight = this.def.sight;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const facing = (dx * fx + dz * fz) / (dist || 1) > -0.2;
      if ((dist < sight && this.hasLos && facing) || (dist < 4.5 && this.hasLos)) this.alert();
    }
    const toYaw = Math.atan2(dx, dz);
    let mx = 0, mz = 0, spd = 0, face = null, turn = 8;
    const gap = dist - P.radius - this.radius;
    switch (this.state) {
      case 'idle': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = rnd(2.5, 5);
          const a = rnd(0, Math.PI * 2), r = rnd(1, 4);
          const wx = this.home.x + Math.cos(a) * r, wz = this.home.z + Math.sin(a) * r;
          this.wander = D.pathable(D.ci(wx), D.ci(wz)) ? new V(wx, 0, wz) : null;
        }
        if (this.wander) {
          const wx = this.wander.x - this.pos.x, wz = this.wander.z - this.pos.z;
          const wd = Math.hypot(wx, wz);
          if (wd > 0.4) { mx = wx / wd; mz = wz / wd; spd = this.speed * 0.3; } else this.wander = null;
        }
        if (this.aware) this.state = 'chase';
        break;
      }
      case 'chase': {
        if (!P.alive) { this.state = 'idle'; this.aware = false; break; }
        face = toYaw;
        if (this.def.ranged) {
          if (dist < 5.5 && this.hasLos) {
            // reculer
            mx = -dx / dist; mz = -dz / dist;
            if (D.isWallAt(this.pos.x + mx * 1.4, this.pos.z + mz * 1.4)) { const t = mx; mx = -mz; mz = t; }
            spd = this.speed * 0.9;
            if (this.cooldown <= 0 && dist > 3) this.startWindup();
          } else if (this.hasLos && dist < this.def.range && this.cooldown <= 0) {
            this.startWindup();
          } else if (!this.hasLos || dist > this.def.range * 0.8) {
            const m = this.moveToward(P, dist);
            mx = m.x; mz = m.z; spd = this.speed;
          } else {
            // strafe léger
            const s = Math.sin(G.time * 0.7 + this.walkPhase) > 0 ? 1 : -1;
            mx = (dz / dist) * s; mz = (-dx / dist) * s; spd = this.speed * 0.35;
          }
        } else {
          if (gap < this.def.reach * 0.8 && this.hasLos) {
            if (this.cooldown <= 0) this.startWindup();
            else if (gap < 0.3) { mx = -dx / dist; mz = -dz / dist; spd = this.speed * 0.3; }
            else { const s = Math.sin(G.time * 0.9 + this.walkPhase) > 0 ? 1 : -1; mx = (dz / dist) * s; mz = (-dx / dist) * s; spd = this.speed * 0.3; }
          } else {
            const m = this.moveToward(P, dist);
            mx = m.x; mz = m.z; spd = this.speed;
          }
        }
        break;
      }
      case 'windup': {
        face = toYaw;
        turn = this.def.poise ? 2.2 : 3.6;
        if (this.type === 'cube' && this.stateT > this.def.windup * 0.5) { mx = dx / dist; mz = dz / dist; spd = this.speed * 0.5; }
        if (this.stateT >= this.def.windup) this.doStrike();
        break;
      }
      case 'strike': {
        if (this.type === 'gobelin' || this.type === 'cube') { mx = Math.sin(this.yaw); mz = Math.cos(this.yaw); spd = this.speed * (this.type === 'cube' ? 2.2 : 1.2); }
        if (this.stateT >= 0.16) { this.state = 'recover'; this.stateT = 0; }
        break;
      }
      case 'recover':
        if (this.stateT >= this.def.recover) { this.state = 'chase'; this.cooldown = rnd(...this.def.cd); }
        break;
      case 'stagger':
        if (this.stateT >= this.staggerDur) { this.state = 'chase'; this.cooldown = Math.max(this.cooldown, 0.3); }
        break;
    }
    // séparation entre monstres
    for (const o of G.enemies) {
      if (o === this || !o.alive || o.kind === 'dragon') continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const rr = this.radius + o.radius;
      const d2 = ox * ox + oz * oz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5;
        this.pos.x += (ox / d) * push;
        this.pos.z += (oz / d) * push;
      }
    }
    const k = 1 - Math.exp(-10 * dt);
    this.vel.x += (mx * spd - this.vel.x) * k;
    this.vel.z += (mz * spd - this.vel.z) * k;
    this.pos.x += (this.vel.x + this.knock.x) * dt;
    this.pos.z += (this.vel.z + this.knock.z) * dt;
    this.knock.multiplyScalar(Math.exp(-7 * dt));
    D.collide(this.pos, this.radius);
    // ne pas pénétrer le joueur
    const px = this.pos.x - P.pos.x, pz = this.pos.z - P.pos.z;
    const pr = this.radius + P.radius;
    const pd2 = px * px + pz * pz;
    if (pd2 < pr * pr && pd2 > 1e-6) {
      const d = Math.sqrt(pd2);
      this.pos.x += (px / d) * (pr - d);
      this.pos.z += (pz / d) * (pr - d);
      D.collide(this.pos, this.radius);
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (face === null && sp > 0.3) face = Math.atan2(this.vel.x, this.vel.z);
    if (face !== null && this.state !== 'strike' && this.state !== 'stagger') this.yaw = dampAngle(this.yaw, face, turn, dt);
    this.walkPhase += sp * dt * 1.7;
    this.animate(dt, sp);
  }

  moveToward(P, dist) {
    const D = G.dungeon;
    if (this.hasLos && dist < 12) return _a.set(P.pos.x - this.pos.x, 0, P.pos.z - this.pos.z).normalize();
    const t = D.flowTarget(this.pos.x, this.pos.z, this.flowPt);
    if (t) {
      _a.set(t.x - this.pos.x, 0, t.z - this.pos.z);
      const l = _a.length();
      if (l > 0.01) return _a.multiplyScalar(1 / l);
    }
    return _a.set(P.pos.x - this.pos.x, 0, P.pos.z - this.pos.z).normalize();
  }

  startWindup() {
    this.state = 'windup';
    this.stateT = 0;
    if (this.def.telegraph) {
      const r = this.def.reach + this.radius + 0.4;
      this.tele = new Telegraph({ x: this.pos.x, z: this.pos.z, radius: r, duration: this.def.windup, halfAngle: this.def.arc + 0.15, yaw: this.yaw });
      this.teleFollow = true;
    }
    if (this.def.ranged) G.audio.play('bowDraw', this.pos);
    else G.audio.play('windup', this.pos, { pitch: this.type === 'ogre' ? 0.6 : 1 });
  }

  doStrike() {
    const P = G.player;
    this.state = 'strike';
    this.stateT = 0;
    if (this.tele) { this.tele.remove(); this.tele = null; }
    const d = this.def;
    const dmg = [[d.dmg[0], d.dmg[1], d.dmg[2] + this.dmgBonus]];
    if (d.ranged) {
      const from = new V(this.pos.x + Math.sin(this.yaw) * 0.5, 1.45, this.pos.z + Math.cos(this.yaw) * 0.5);
      const to = new V(P.pos.x, 1.15, P.pos.z);
      const vel = to.sub(from).normalize().multiplyScalar(24);
      G.audio.play('arrow', this.pos);
      new Projectile({
        kind: 'arrow', owner: 'enemy', pos: from, vel, radius: 0.15, life: 2,
        onHit: () => P.receiveAttack({ attacker: this, atk: this.atkBonus, dice: dmg, type: 'ranged', label: this.name, knock: 1.5 }),
        onWall: (p) => { G.fx.sparks(p.pos, 5, [0.8, 0.7, 0.5]); },
      });
      return;
    }
    G.audio.play('swing', this.pos, { pitch: this.type === 'ogre' ? 0.55 : this.type === 'gobelin' ? 1.3 : 0.9 });
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const gap = dist - P.radius - this.radius;
    const ang = Math.acos(clamp((dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / (dist || 1), -1, 1));
    if (this.type === 'ogre') {
      G.shake = Math.max(G.shake, 0.4);
      G.fx.dust(_a.set(this.pos.x + Math.sin(this.yaw) * 2.5, 0, this.pos.z + Math.cos(this.yaw) * 2.5), 18, 1.2);
      G.audio.play('slam', this.pos);
    }
    if (gap <= d.reach && ang <= d.arc + 0.2) {
      P.receiveAttack({ attacker: this, atk: this.atkBonus, dice: dmg, type: 'melee', label: this.name, knock: this.type === 'ogre' ? 9 : 3 });
    }
  }

  deadUpdate(dt) {
    this.deathT += dt;
    if (this.removed) return;
    if (this.anim) {
      this.anim.update(dt);
      if (this.deathT > 1.7) this.fx.setDissolve(Math.min(1, (this.deathT - 1.7) / 1.3));
      if (this.deathT > 3.05) { G.scene.remove(this.root); this.removed = true; }
      return;
    }
    const R = this.R;
    if (R) {
      const k = Math.min(1, this.deathT * 2.4);
      R.body.rotation.x = -k * Math.PI / 2 * 0.95;
      R.body.position.y = 0.15 * k;
    }
    if (this.deathT > 1.2) this.fx.setDissolve(Math.min(1, (this.deathT - 1.2) / 1.2));
    if (this.deathT > 2.45) { G.scene.remove(this.root); this.removed = true; }
  }

  animate(dt, sp) {
    this.root.position.set(this.pos.x, this.root.position.y, this.pos.z);
    this.root.rotation.y = this.yaw;
    if (this.tele && this.teleFollow) { this.tele.group.position.set(this.pos.x, 0.04, this.pos.z); this.tele.group.rotation.y = this.yaw; }
    if (this.type === 'cube') return this.animateCube(dt, sp);
    if (this.anim) return this.animateGlb(dt, sp);
    const P = this.pose, R = this.R, d = this.def;
    P.walk = this.walkPhase;
    P.amt = clamp(sp / 4, 0, 1.2);
    P.armR = P.armL = null;
    P.sharp = false;
    P.torsoYaw = 0;
    P.lean = this.model.lean || 0;
    P.crouch = 0;
    P.elbowR = 0.35;
    P.elbowL = 0.35;
    P.headPitch = 0;
    P.roll = 0;
    if (this.type === 'archer') {
      P.armL = { d: [0.25, -0.85, 0.4], z: [0, 0, 1] };
    } else {
      P.armR = { d: [-0.25, -0.95, 0.35], z: [0, 0.4, 1] };
      if (this.model.weapons.shield) P.armL = { d: [0.3, -0.8, 0.45], z: [0.5, 0, 1] };
    }
    const t = this.stateT;
    if (this.state === 'windup') {
      const u = clamp(t / d.windup, 0, 1);
      P.sharp = true;
      if (d.ranged) {
        P.armL = { d: [0.05, 0.08, 1], z: [0, 1, 0] };
        P.elbowL = 0;
        P.armR = { d: [0.3, 0.1, 0.7 - u * 0.5], z: [0, 1, 0] };
        P.elbowR = 1.2 + u * 1.2;
        P.torsoYaw = 0.5;
      } else if (d.attack === 'overhead') {
        P.armR = { d: [-0.2, 0.95, -0.15 * u], z: [0, 0.1, -1] };
        P.lean = -0.15 * u + (this.model.lean || 0);
        P.torsoYaw = -0.2 * u;
      } else {
        P.armR = { d: [-0.9, 0.3, -0.2], z: [0, 0.3, -1] };
        P.torsoYaw = -0.6 * u;
        P.crouch = 0.25 * u;
      }
    } else if (this.state === 'strike' || (this.state === 'recover' && t < 0.25)) {
      P.sharp = true;
      if (d.ranged) {
        P.armL = { d: [0.05, 0.08, 1], z: [0, 1, 0] };
        P.elbowL = 0;
        P.armR = { d: [-0.2, 0.0, -0.4], z: [0, 1, 0] };
      } else if (d.attack === 'overhead') {
        P.armR = { d: [0, -0.15, 1], z: [0, -1, 0.1] };
        P.lean = 0.35 + (this.model.lean || 0);
        P.elbowR = 0;
      } else {
        P.armR = { d: [0.6, 0, 1], z: [1, 0, 0.2] };
        P.torsoYaw = 0.6;
        P.elbowR = 0;
      }
    } else if (this.state === 'stagger') {
      P.lean = -0.4;
      P.crouch = 0.15;
      P.headPitch = -0.3;
    }
    poseHumanoid(R, P, dt);
    // tremblement à l'impact
    if (this.flash > 0) this.root.position.x += Math.sin(G.time * 90) * 0.04;
  }

  animateGlb(dt, sp) {
    const A = this.anim, d = this.def;
    const key = this.state + ':' + Math.round((G.time - this.stateT) * 100);
    if (d.ranged) {
      if (this.state === 'windup') A.play('2H_Ranged_Aiming', { fade: 0.15 });
      else if (this.state === 'strike' || (this.state === 'recover' && this.stateT < 0.4)) A.play('2H_Ranged_Shoot', { loop: false, fade: 0.05, key: 'shot' + Math.round((G.time - this.stateT) * 10) });
      else this.locomotion(sp);
    } else if (this.state === 'windup' || this.state === 'strike' || (this.state === 'recover' && this.stateT < 0.5)) {
      // l'impact du clip (~45 %) tombe à la fin de la préparation
      const name = '1H_Melee_Attack_Chop';
      if (this.state === 'windup') A.play(name, { loop: false, fade: 0.08, speed: (A.duration(name) * 0.45) / d.windup, key });
    } else if (this.state === 'stagger') {
      A.play(this.staggerDur > 0.5 ? 'Hit_B' : 'Hit_A', { loop: false, fade: 0.05, speed: 1.3, key });
    } else this.locomotion(sp);
    A.update(dt);
    if (this.flash > 0) this.root.position.x += Math.sin(G.time * 90) * 0.04;
  }
  locomotion(sp) {
    const A = this.anim;
    if (sp > 2.6) A.play('Running_A', { fade: 0.2, speed: sp / 5.5 });
    else if (sp > 0.3) A.play('Walking_D_Skeletons', { fade: 0.2, speed: Math.max(0.6, sp / 1.8) });
    else A.play(this.aware ? 'Idle_Combat' : 'Idle', { fade: 0.3 });
  }

  animateCube(dt, sp) {
    const M = this.model, t = G.time + this.walkPhase;
    let sx = 1 + Math.sin(t * 3) * 0.04, sy = 1 - Math.sin(t * 3) * 0.05, sz = sx;
    if (this.state === 'windup') { const u = clamp(this.stateT / this.def.windup, 0, 1); sy -= 0.2 * u; sx += 0.12 * u; sz += 0.12 * u; }
    if (this.state === 'strike') { sz += 0.3; sy += 0.1; }
    if (this.state === 'stagger') { sx += Math.sin(t * 40) * 0.06; }
    M.body.scale.x = damp(M.body.scale.x, sx, 12, dt);
    M.body.scale.y = damp(M.body.scale.y, sy, 12, dt);
    M.body.scale.z = damp(M.body.scale.z, sz, 12, dt);
  }

  dispose() {
    this.cancelAttack();
    if (!this.removed) G.scene.remove(this.root);
  }
}

// ---------------------------------------------------------------- Le dragon
export class Dragon {
  constructor(x, z) {
    this.type = 'dragon';
    this.kind = 'dragon';
    this.name = 'Pyraxis';
    this.maxHp = 620;
    this.hp = this.maxHp;
    this.ac = 17;
    this.atkBonus = 9;
    this.saveBonus = 6;
    this.xp = 0;
    this.pos = new V(x, 0, z);
    this.yaw = 0;
    this.radius = 3.0;
    this.height = 6;
    this.alive = true;
    this.aware = false;
    this.state = 'sleep';
    this.stateT = 0;
    this.flash = 0;
    this.sneakCD = 0;
    this.phase = 1;
    this.cds = { breath: 3, tail: 0, meteor: 6, claw: 0 };
    this.model = buildDragon();
    this.root = this.model.root;
    this.root.position.copy(this.pos);
    G.scene.add(this.root);
    this.mats = [];
    const seen = new Set();
    this.root.traverse((o) => {
      if (o.isMesh && !seen.has(o.material)) { seen.add(o.material); this.mats.push({ m: o.material, e: o.material.emissive.clone(), i: o.material.emissiveIntensity }); }
    });
    this.fx = new FxSet(this.root);
    this.fx.setRim(0, new THREE.Color(1, 0.6, 0.2));
    this.anim = {
      t: 0, headPos: new V(0, 1.1, 5.2), headPitch: 0.2, jaw: 0, glow: 0, tailSwing: 0, walk: 0, phase: 0,
      wingSpread: 0, flap: 0, lift: -1.1, bodyPitch: 0.05,
    };
    this.target = { headPos: new V(0, 1.1, 5.2), headPitch: 0.2, jaw: 0, glow: 0, tailSwing: 0, wingSpread: 0, lift: -1.1, bodyPitch: 0.05 };
    this.walkSpeed = 0;
    this.mouthW = new V();
    animateDragon(this.model, this.anim, 0);
  }

  get S() { return 1.3; }
  fwd(out = _b) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  local(x, z, out = new V()) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return out.set(this.pos.x + (x * c + z * s) * this.S, 0, this.pos.z + (-x * s + z * c) * this.S);
  }
  circles() {
    const c = [];
    c.push({ ...this.local(0, 0.1), r: 2.3 });
    c.push({ ...this.local(0, 1.9), r: 1.8 });
    c.push({ ...this.local(0, -2.0), r: 1.7 });
    return c.map((o) => ({ x: o.x, z: o.z, r: o.r }));
  }
  solidCircles() { return this.circles(); }
  headWorld() { return this.model.head.getWorldPosition(new V()); }
  headPos() { const h = this.headWorld(); h.y += 1.2; return h; }
  aimPoint() {
    const h = this.headWorld();
    if (h.y < 4.5) return h;
    return new V(this.pos.x, 3.4, this.pos.z);
  }
  impactPoint(from) {
    let best = null, bd = 1e9;
    for (const c of this.circles()) {
      const d = Math.hypot(from.x - c.x, from.z - c.z) - c.r;
      if (d < bd) { bd = d; best = c; }
    }
    const dx = from.x - best.x, dz = from.z - best.z, d = Math.hypot(dx, dz) || 1;
    return new V(best.x + (dx / d) * best.r, 2.2, best.z + (dz / d) * best.r);
  }
  hitDistance(p) {
    let best = 1e9;
    for (const c of this.circles()) best = Math.min(best, Math.hypot(p.x - c.x, p.z - c.z) - c.r);
    if (p.y > 5.5) best = Math.max(best, p.y - 5.5);
    const h = this.headWorld();
    best = Math.min(best, h.distanceTo(p) - 1.3);
    return best;
  }
  meleeCheck(pp, fx, fz, reach, arc) {
    const list = this.circles();
    const h = this.headWorld();
    if (h.y < 3.2) list.push({ x: h.x, z: h.z, r: 1.2 });
    for (const c of list) {
      const dx = c.x - pp.x, dz = c.z - pp.z;
      const d = Math.hypot(dx, dz);
      if (d - c.r > reach) continue;
      if (d < c.r + 0.5) return true;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
      if (ang <= arc + Math.atan2(c.r, d)) return true;
    }
    return false;
  }

  alert() { this.wake(); }
  wake() {
    if (this.state !== 'sleep') return;
    this.aware = true;
    this.setState('roar', 3.2);
    G.ui.boss('Pyraxis, le Fléau Écarlate', 1);
    G.ui.banner('Pyraxis s’éveille !', 'Dragon rouge vénérable — CA 17');
    G.audio.play('roar');
    G.audio.bossMusic(true);
  }
  setState(s, dur = 0) { this.state = s; this.stateT = 0; this.stateDur = dur; this.hitDone = false; }
  stun(t) {
    if (!this.alive || this.state === 'fly' || this.state === 'meteors') return;
    this.cancel();
    this.setState('stagger', t);
    G.fx.text(this.headPos(), 'Étourdi', 'stun', 1);
  }
  cancel() { if (this.tele) { this.tele.remove(); this.tele = null; } }

  takeDamage(dmg, info) {
    if (!this.alive) return;
    if (this.state === 'sleep') this.wake();
    this.hp -= dmg;
    this.flash = 0.1;
    G.audio.play('hit', this.pos, { pitch: 0.6, crit: info.crit });
    G.ui.boss(null, Math.max(0, this.hp / this.maxHp));
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      this.cancel();
      this.setState('roar', 2.6);
      G.audio.play('roar');
      G.ui.banner('Pyraxis entre en furie !', 'Il invoque ses serviteurs…');
      G.summonMinions && G.summonMinions(3);
      this.cds.meteor = 2;
    }
    if (this.hp <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.cancel();
    this.setState('dead', 6);
    G.audio.play('roar', null, { pitch: 0.7 });
    G.ui.boss(null, 0);
    G.stats.kills++;
    G.shake = 1;
    G.ui.log('🐉 <span class="crit">Pyraxis s’effondre dans un dernier rugissement !</span>');
  }

  update(dt) {
    const P = G.player;
    const wantRim = this.alive && G.target === this ? 0.5 + Math.sin(G.time * 7) * 0.2 : 0;
    this.fx.setRim(this.fx.rim + (wantRim - this.fx.rim) * Math.min(1, dt * 10));
    this.flash -= dt;
    const f = this.flash > 0 ? 1 : 0;
    if (f !== this._lf) {
      this._lf = f;
      for (const m of this.mats) {
        if (m.m === this.model.m.glow || m.m === this.model.m.eye) continue;
        if (f) { m.m.emissive.setRGB(0.6, 0.4, 0.3); m.m.emissiveIntensity = 0.7; } else { m.m.emissive.copy(m.e); m.m.emissiveIntensity = m.i; }
      }
    }
    this.stateT += dt;
    for (const k in this.cds) this.cds[k] -= dt;
    const T = this.target, A = this.anim;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toYaw = Math.atan2(dx, dz);
    const rel = wrapAngle(toYaw - this.yaw);
    const enraged = this.phase === 2;
    const sp = enraged ? 1.25 : 1;
    let walk = 0;
    // valeurs cibles par défaut
    T.headPos.set(0, 4.6, 4.5);
    T.headPitch = 0.1;
    T.jaw = 0.05;
    T.glow = 0;
    T.tailSwing = Math.sin(G.time * 0.6) * 0.3;
    T.wingSpread = 0.05;
    T.lift = 0;
    T.bodyPitch = 0;
    // tête qui suit le joueur
    const look = clamp(rel, -0.7, 0.7);
    T.headPos.x = Math.sin(look) * 2.2;

    switch (this.state) {
      case 'sleep':
        T.headPos.set(0, 1.1, 5.2);
        T.headPitch = 0.15;
        T.lift = -1.1;
        T.bodyPitch = 0.05;
        T.tailSwing = 0.6;
        if (P.alive && dist < 24 && G.dungeon.roomAt(P.pos.x, P.pos.z) === G.dungeon.bossRoom) this.wake();
        if (Math.random() < dt * 0.6) G.fx.norm.emit({ x: this.headWorld().x, y: 1.3, z: this.headWorld().z, count: 2, spread: 0.2, vy: 0.6, vel: 0.2, life: 2, size: 0.5, size1: 1.4, color: [0.15, 0.12, 0.1], alpha: 0.4 });
        break;
      case 'roar': {
        const u = this.stateT / this.stateDur;
        T.headPos.set(0, 6.0, 4.0);
        T.headPitch = -0.55;
        T.jaw = u > 0.2 && u < 0.85 ? 0.75 : 0.1;
        T.wingSpread = u > 0.15 && u < 0.9 ? 1 : 0.2;
        A.flap += dt * 3;
        T.glow = u > 0.2 && u < 0.85 ? 0.5 : 0;
        if (u > 0.2 && u < 0.85) G.shake = Math.max(G.shake, 0.25);
        this.yaw = dampAngle(this.yaw, toYaw, 1.5, dt);
        if (this.stateT >= this.stateDur) this.setState('idle');
        break;
      }
      case 'idle': {
        if (!P.alive) { this.yaw = dampAngle(this.yaw, toYaw, 0.5, dt); break; }
        this.yaw = dampAngle(this.yaw, toYaw, 1.4 * sp, dt);
        const absRel = Math.abs(rel);
        if (this.stateT < (enraged ? 0.35 : 0.6)) break;
        if (enraged && this.cds.meteor <= 0 && dist > 6) { this.startMeteors(); break; }
        if (absRel > 1.9 && dist < 11 && this.cds.tail <= 0) { this.startTail(); break; }
        if (absRel < 0.5 && dist < 7.5) {
          if (Math.random() < 0.55) this.startBite(); else this.startClaw();
          break;
        }
        if (absRel < 0.45 && dist > 7 && dist < 22 && this.cds.breath <= 0) { this.startBreath(); break; }
        if (dist > 7) { walk = 1; }
        else if (absRel > 0.5) walk = 0.4;
        break;
      }
      case 'bite': {
        const u = this.stateT;
        const wind = 0.7 / sp;
        if (u < wind) { T.headPos.set(0, 5.8, 3.2); T.headPitch = -0.3; T.jaw = 0.6; this.yaw = dampAngle(this.yaw, toYaw, 2.2, dt); }
        else if (u < wind + 0.3) {
          T.headPos.set(0, 1.9, 7.2); T.headPitch = 0.3; T.jaw = u < wind + 0.12 ? 0.8 : 0.0;
          if (!this.hitDone && u > wind + 0.1) {
            this.hitDone = true;
            G.audio.play('bite', this.pos);
            const hp = this.local(0, 7.0);
            const d = Math.hypot(P.pos.x - hp.x, P.pos.z - hp.z);
            if (d < 2.8) P.receiveAttack({ attacker: this, atk: this.atkBonus, dice: [[2, 10, 6]], type: 'melee', label: 'Morsure du dragon', knock: 6 });
          }
        } else if (u > wind + 1.0) this.setState('idle');
        break;
      }
      case 'claw': {
        const u = this.stateT;
        const wind = 1.0 / sp;
        T.bodyPitch = u < wind ? -0.22 : 0.08;
        T.headPos.set(0, 5.2, 4.0);
        if (u >= wind && !this.hitDone) {
          this.hitDone = true;
          const c = this.clawPt;
          G.fx.dust(c, 30, 2);
          G.fx.sparks(_a.set(c.x, 0.3, c.z), 20, [1, 0.6, 0.3]);
          G.shake = Math.max(G.shake, 0.7);
          G.audio.play('slam', c);
          if (Math.hypot(P.pos.x - c.x, P.pos.z - c.z) < 4.2) {
            P.receiveAttack({ attacker: this, save: { stat: 'DEX', dc: 15 }, dice: [[3, 8, 3]], type: 'area', label: 'Griffes du dragon', knock: 10, unblockable: true });
          }
        }
        if (u > wind + 0.9) this.setState('idle');
        break;
      }
      case 'tail': {
        const u = this.stateT;
        const wind = 0.95 / sp;
        if (u < wind) { T.tailSwing = -1.3; T.bodyPitch = 0.05; }
        else {
          T.tailSwing = 2.6;
          if (!this.hitDone && u > wind + 0.12) {
            this.hitDone = true;
            G.audio.play('whoosh', this.pos);
            G.shake = Math.max(G.shake, 0.4);
            const back = this.yaw + Math.PI;
            const a = Math.abs(wrapAngle(toYaw - back));
            if (dist < 11 && a < 2.0) P.receiveAttack({ attacker: this, atk: this.atkBonus, dice: [[3, 8, 4]], type: 'melee', label: 'Coup de queue', knock: 12 });
          }
        }
        if (u > wind + 1.0) { this.setState('idle'); this.cds.tail = 3; }
        break;
      }
      case 'breath': this.updateBreath(dt, T, toYaw); break;
      case 'fly':
      case 'meteors': this.updateMeteors(dt, T, A); break;
      case 'stagger':
        T.headPos.set(0, 2.8, 4.6);
        T.headPitch = 0.4;
        T.jaw = 0.3;
        T.lift = -0.4;
        if (this.stateT >= this.stateDur) this.setState('idle');
        break;
      case 'dead': {
        const u = Math.min(1, this.stateT / 2.5);
        T.headPos.set(1.5, 0.9, 5.4);
        T.headPitch = 0.3;
        T.jaw = 0.4;
        T.lift = -1.6 * u;
        T.wingSpread = 0.6 * (1 - u);
        T.tailSwing = 0.8;
        T.bodyPitch = 0.1;
        if (this.stateT > 1.5) for (const m of this.mats) if (m.m === this.model.m.eye) m.m.emissiveIntensity = Math.max(0, 9 * (1 - (this.stateT - 1.5) / 2));
        if (Math.random() < 0.3) G.fx.norm.emit({ x: this.pos.x + rnd(-3, 3), y: 1.5, z: this.pos.z + rnd(-3, 3), count: 3, spread: 1, vy: 1.2, life: 2.5, size: 1.5, size1: 3, color: [0.1, 0.08, 0.07], alpha: 0.35 });
        if (this.stateT > 4.5 && !this.winCalled) { this.winCalled = true; G.onVictory && G.onVictory(); }
        break;
      }
    }

    // déplacement
    this.walkSpeed = damp(this.walkSpeed, walk * 3.6 * sp, 3, dt);
    if (this.walkSpeed > 0.05) {
      this.pos.x += Math.sin(this.yaw) * this.walkSpeed * dt;
      this.pos.z += Math.cos(this.yaw) * this.walkSpeed * dt;
      G.dungeon.collide(this.pos, 2.4, true);
      A.phase += this.walkSpeed * dt * 1.1;
      if (Math.floor(A.phase / Math.PI) !== this._step) { this._step = Math.floor(A.phase / Math.PI); G.shake = Math.max(G.shake, 0.12); G.audio.play('stomp', this.pos); }
    }
    A.walk = damp(A.walk, Math.min(1, this.walkSpeed / 3), 6, dt);
    // interpolation de l'animation
    const k = 1 - Math.exp(-(this.state === 'bite' || this.state === 'tail' ? 14 : 5) * dt);
    A.t += dt;
    A.headPos.lerp(T.headPos, k);
    A.headPitch = lerp(A.headPitch, T.headPitch, k);
    A.jaw = lerp(A.jaw, T.jaw, 1 - Math.exp(-12 * dt));
    A.glow = lerp(A.glow, T.glow, 1 - Math.exp(-6 * dt));
    A.tailSwing = lerp(A.tailSwing, T.tailSwing, 1 - Math.exp(-(this.state === 'tail' ? 9 : 3) * dt));
    A.wingSpread = lerp(A.wingSpread, T.wingSpread, 1 - Math.exp(-4 * dt));
    A.lift = lerp(A.lift, T.lift, 1 - Math.exp(-3 * dt));
    A.bodyPitch = lerp(A.bodyPitch, T.bodyPitch, 1 - Math.exp(-6 * dt));
    if (A.wingSpread > 0.5) A.flap += dt * 4;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    animateDragon(this.model, A, dt);
    if (G.keyLight) {
      G.keyLight.position.set(this.pos.x + Math.sin(this.yaw) * 10, 8, this.pos.z + Math.cos(this.yaw) * 10);
      G.keyLight.intensity = this.alive ? 60 : 25;
    }
    if (this.tele && this.teleFollow) { this.tele.group.position.set(this.pos.x, 0.04, this.pos.z); this.tele.group.rotation.y = this.yaw + Math.PI; }
    // lueur des naseaux / gueule
    if (A.glow > 0.05) {
      this.model.mouth.getWorldPosition(this.mouthW);
      G.fx.frameLights.push({ pos: this.mouthW, color: [1, 0.4, 0.1], intensity: 40 * A.glow, distance: 12 });
    }
  }

  startBite() { this.setState('bite'); G.audio.play('growl', this.pos); }
  startClaw() {
    this.setState('claw');
    this.clawPt = this.local(0, 5.2);
    this.teleFollow = false;
    this.tele = new Telegraph({ x: this.clawPt.x, z: this.clawPt.z, radius: 4.2, duration: 1.0 / (this.phase === 2 ? 1.25 : 1) });
    G.audio.play('growl', this.pos);
  }
  startTail() {
    this.setState('tail');
    this.tele = new Telegraph({ x: this.pos.x, z: this.pos.z, radius: 11, duration: 0.95 / (this.phase === 2 ? 1.25 : 1), halfAngle: 2.0, yaw: this.yaw + Math.PI, inner: 0.2 });
    this.teleFollow = true;
  }
  startBreath() {
    this.setState('breath');
    this.cds.breath = this.phase === 2 ? 7 : 9;
    this.breathYaw = this.yaw;
    const o = this.local(0, 4.5);
    this.breathOrigin = o;
    this.tele = new Telegraph({ x: o.x, z: o.z, radius: 18, duration: 1.15, halfAngle: 0.45, yaw: this.yaw });
    this.teleFollow = false;
    this.tick = 0;
    G.audio.play('inhale', this.pos);
  }
  updateBreath(dt, T, toYaw) {
    const P = G.player;
    const u = this.stateT;
    const wind = 1.15, dur = 2.3;
    if (u < wind) {
      T.headPos.set(0, 6.2, 3.4);
      T.headPitch = -0.6;
      T.jaw = 0.25;
      T.glow = u / wind;
      T.wingSpread = 0.4;
      return;
    }
    if (!this.breathing) { this.breathing = true; G.audio.play('breath', this.pos, { dur }); }
    T.headPos.set(0, 3.4, 5.6);
    T.headPitch = 0.35;
    T.jaw = 0.85;
    T.glow = 1;
    // jets de flammes
    this.model.mouth.getWorldPosition(this.mouthW);
    const m = this.mouthW;
    const fx = Math.sin(this.breathYaw), fz = Math.cos(this.breathYaw);
    for (let i = 0; i < 2; i++) {
      const tx = this.breathOrigin.x + fx * 12, tz = this.breathOrigin.z + fz * 12;
      const dir = _a.set(tx - m.x, 0.6 - m.y, tz - m.z).normalize();
      G.fx.add.emit({ x: m.x, y: m.y, z: m.z, count: 4, spread: 0.2, vx: dir.x * 24, vy: dir.y * 24, vz: dir.z * 24, vel: 4.5, life: 0.7, size: 0.6, size1: 2.8, color: [1.8, 0.9, 0.3], color1: [0.7, 0.1, 0.01], alpha: 0.5, drag: 1.3, gravity: -2 });
    }
    G.fx.norm.emit({ x: this.breathOrigin.x + fx * 8, y: 1.5, z: this.breathOrigin.z + fz * 8, count: 2, spread: 3, vy: 2, vel: 1, life: 1.6, size: 1.8, size1: 3.5, color: [0.1, 0.08, 0.07], alpha: 0.35 });
    G.fx.frameLights.push({ pos: _b.set(this.breathOrigin.x + fx * 7, 1.6, this.breathOrigin.z + fz * 7).clone(), color: [1, 0.45, 0.1], intensity: 50, distance: 20 });
    G.shake = Math.max(G.shake, 0.15);
    // dégâts par impulsions
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.3;
      const bd = rnd(4, 15), ba = rnd(-0.35, 0.35);
      G.fx.decal(this.breathOrigin.x + Math.sin(this.breathYaw + ba) * bd, this.breathOrigin.z + Math.cos(this.breathYaw + ba) * bd, 'scorch', rnd(1.5, 2.6));
      const ox = P.pos.x - this.breathOrigin.x, oz = P.pos.z - this.breathOrigin.z;
      const d = Math.hypot(ox, oz);
      const ang = Math.acos(clamp((ox * fx + oz * fz) / (d || 1), -1, 1));
      if ((d < 18 && ang < 0.5) || d < 2) {
        P.receiveAttack({ attacker: this, save: { stat: 'DEX', dc: 15 }, dice: [[2, 6, 2]], type: 'area', label: 'Souffle de feu', unblockable: true, silent: true });
      }
    }
    if (u > wind + dur) { this.breathing = false; this.setState('idle'); }
  }

  startMeteors() {
    this.setState('fly');
    this.cds.meteor = 14;
    this.meteorsLeft = 9;
    this.meteorT = 0;
    G.audio.play('roar', this.pos, { pitch: 1.2 });
    G.ui.toast('Pyraxis s’envole : esquivez la pluie de feu !');
  }
  updateMeteors(dt, T, A) {
    const P = G.player;
    T.wingSpread = 1;
    A.flap += dt * 6;
    T.headPos.set(0, 5.6, 4.6);
    T.headPitch = -0.15;
    T.jaw = 0.4;
    T.glow = 0.6;
    if (this.state === 'fly') {
      T.lift = 3.5;
      if (this.stateT > 1.0) { this.setState('meteors'); }
      return;
    }
    T.lift = 3.8;
    this.meteorT -= dt;
    if (this.meteorT <= 0 && this.meteorsLeft > 0) {
      this.meteorsLeft--;
      this.meteorT = 0.38;
      const r = this.meteorsLeft % 3 === 0 ? 0 : rnd(1, 5);
      const a = rnd(0, Math.PI * 2);
      const tx = P.pos.x + Math.cos(a) * r + P.vel.x * 0.5, tz = P.pos.z + Math.sin(a) * r + P.vel.z * 0.5;
      const D = G.dungeon;
      if (!D.passable(D.ci(tx), D.ci(tz))) return;
      const fall = 1.3;
      new Telegraph({ x: tx, z: tz, radius: 3.2, duration: fall });
      const start = new V(tx + rnd(-3, 3), G.dungeon.wallH - 0.5, tz + rnd(-3, 3));
      const vel = new V(tx, 0, tz).sub(start).divideScalar(fall);
      const boom = (p) => {
        explode(_a.set(tx, 0.4, tz).clone(), 3.2);
        if (Math.hypot(P.pos.x - tx, P.pos.z - tz) < 3.4) {
          P.receiveAttack({ attacker: { pos: new V(tx, 0, tz) }, save: { stat: 'DEX', dc: 15 }, dice: [[4, 6, 0]], type: 'area', label: 'Météore', unblockable: true, knock: 8 });
        }
      };
      new Projectile({ kind: 'meteor', owner: 'none', ghost: true, pos: start, vel, radius: 0.5, life: fall + 0.3, onWall: boom, onExpire: boom });
    }
    if (this.meteorsLeft <= 0 && this.meteorT <= -1.2) this.setState('idle');
  }

  dispose() {
    this.cancel();
    G.scene.remove(this.root);
  }
}
