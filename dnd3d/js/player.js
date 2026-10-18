// Le héros : classes, caractéristiques, contrôles, combat, progression.
import * as THREE from 'three';
import { G } from './state.js';
import { buildHero, poseHumanoid, animateCape } from './models.js';
import { Trail, Telegraph } from './fx.js';
import { Projectile, playerAttack, explode } from './combat.js';
import { clamp, damp, dampAngle, roll, die, mod, fmtMod, rnd, lerp } from './util.js';

const V = THREE.Vector3;
export const XP_TABLE = [0, 0, 120, 320, 620, 1020, 1520, 2150, 2900, 3800, 4900, 6200, 7700, 9400];

// ---------------------------------------------------------------- Images-clés d'animation
const mir = (keys) => keys.map((k) => ({ ...k, d: [-k.d[0], k.d[1], k.d[2]], z: [-k.z[0], k.z[1], k.z[2]], ty: -(k.ty || 0) }));
const G_REST = { d: [-0.25, -1, 0.3], z: [0, 0.35, 1] };
const R_REST_R = { d: [-0.3, -0.9, 0.35], z: [0, 0.4, 1] };
const M_REST = { d: [-0.3, -0.75, 0.45], z: [0, 1, 0] };
const k = (t, rest, extra = {}) => ({ t, d: rest.d, z: rest.z, ty: 0, ...extra });

const ROGUE_R = [
  k(0, R_REST_R),
  { t: 0.3, d: [-0.75, 0.25, 0.35], z: [0, 0.5, -1], ty: -0.45 },
  { t: 0.52, d: [0.3, 0, 1], z: [1, 0, 0.2], ty: 0.35 },
  k(1, R_REST_R),
];

export const CLASSES = {
  guerrier: {
    name: 'Guerrier', icon: '⚔️', hp: 72, hpLvl: 12, ac: 17, speed: 6.0, main: 'FOR', saves: ['FOR', 'CON'], critMin: 20, mana: 0,
    stats: { FOR: 16, DEX: 12, CON: 16, INT: 8, SAG: 12, CHA: 10 },
    armor: 'Cotte de mailles + bouclier',
    desc: 'Un rempart d’acier. Enchaîne des combos dévastateurs, pare les coups au bouclier et tourbillonne au cœur de la mêlée.',
    slots: [
      { key: 'Clic G', icon: '⚔️', name: 'Épée longue', sub: 'combo ×3' },
      { key: 'Clic D', icon: '🛡️', name: 'Parade', sub: 'maintenir' },
      { key: 'F', icon: '🌀', name: 'Tourbillon', sub: '7 s' },
    ],
    combo: [
      { name: 'Taille', dur: 0.52, hit: 0.42, reach: 2.7, arc: 1.25, dice: [1, 8], cost: 9, knock: 2.5, lunge: 5, arm: 'R', keys: [
        k(0, G_REST), { t: 0.3, d: [-0.9, 0.35, 0.1], z: [-0.1, 0.4, -1], ty: -0.75 }, { t: 0.45, d: [-0.1, 0.05, 1], z: [1, 0.1, 0.25], ty: 0.05 },
        { t: 0.6, d: [0.8, -0.1, 0.45], z: [0.3, 0, 1], ty: 0.7 }, k(1, G_REST)] },
      { name: 'Revers', dur: 0.52, hit: 0.42, reach: 2.7, arc: 1.25, dice: [1, 8], cost: 9, knock: 2.5, lunge: 5, arm: 'R', keys: [
        k(0, G_REST), { t: 0.3, d: [0.6, 0.45, 0.45], z: [0.9, 0.3, -0.4], ty: 0.75 }, { t: 0.45, d: [0.1, 0, 1], z: [-1, 0.1, 0.25], ty: -0.05 },
        { t: 0.6, d: [-0.85, -0.15, 0.35], z: [-0.3, 0, 1], ty: -0.7 }, k(1, G_REST)] },
      { name: 'Coup puissant', dur: 0.72, hit: 0.52, reach: 3.0, arc: 0.85, dice: [2, 8], cost: 15, knock: 7, lunge: 8, arm: 'R', keys: [
        k(0, G_REST), { t: 0.35, d: [-0.1, 1, 0.1], z: [0, 0.1, -1], ty: -0.25, lean: -0.15 }, { t: 0.47, d: [0, 0.6, 0.8], z: [0, 0.8, -0.6], ty: -0.1 },
        { t: 0.56, d: [0, -0.1, 1], z: [0, -1, 0.1], ty: 0, lean: 0.35 }, { t: 0.8, d: [0, -0.15, 1], z: [0, -1, 0.1], ty: 0, lean: 0.3 }, k(1, G_REST)] },
    ],
  },
  magicien: {
    name: 'Magicien', icon: '🔥', hp: 48, hpLvl: 7, ac: 13, speed: 6.0, main: 'INT', saves: ['INT', 'SAG'], critMin: 20, mana: 100,
    stats: { FOR: 8, DEX: 14, CON: 14, INT: 17, SAG: 12, CHA: 10 },
    armor: 'Armure du mage',
    desc: 'Maître des arcanes. Lance des traits de feu à volonté, des projectiles magiques qui ne ratent jamais et d’explosives boules de feu.',
    slots: [
      { key: 'Clic G', icon: '🔥', name: 'Trait de feu', sub: 'tour de magie' },
      { key: 'Clic D', icon: '✨', name: 'Projectile magique', sub: '18 mana' },
      { key: 'F', icon: '☄️', name: 'Boule de feu', sub: '35 mana' },
    ],
    casts: {
      firebolt: { dur: 0.4, release: 0.45, arm: 'R', keys: [k(0, M_REST), { t: 0.35, d: [-0.15, 0.35, 0.9], z: [0, 1, -0.3] }, { t: 0.5, d: [-0.05, 0.1, 1], z: [0, 1, -0.05] }, k(1, M_REST)] },
      fireball: { dur: 0.72, release: 0.58, arm: 'R', keys: [k(0, M_REST), { t: 0.42, d: [-0.2, 0.95, 0.2], z: [0, 0.2, 1] }, { t: 0.58, d: [0, 0.3, 1], z: [0, 1, -0.2] }, k(1, M_REST)] },
      missile: { dur: 0.5, release: 0.5, arm: 'L', keys: [{ t: 0, d: [0.14, -1, 0], z: [0, 0, 1] }, { t: 0.4, d: [0.2, 0.2, 1], z: [0, 1, 0] }, { t: 0.65, d: [0.1, 0.1, 1], z: [0, 1, 0] }, { t: 1, d: [0.14, -1, 0], z: [0, 0, 1] }] },
    },
  },
  roublard: {
    name: 'Roublard', icon: '🗡️', hp: 56, hpLvl: 9, ac: 15, speed: 6.7, main: 'DEX', saves: ['DEX', 'INT'], critMin: 19, mana: 0,
    stats: { FOR: 10, DEX: 17, CON: 14, INT: 12, SAG: 12, CHA: 14 },
    armor: 'Cuir clouté',
    desc: 'Rapide et mortel. Critique sur 19-20, attaques sournoises dans le dos des ennemis, dagues de jet et pas de l’ombre.',
    slots: [
      { key: 'Clic G', icon: '🗡️', name: 'Dagues jumelles', sub: 'combo ×4' },
      { key: 'Clic D', icon: '🔪', name: 'Dague de jet', sub: '3 charges' },
      { key: 'F', icon: '🌑', name: 'Pas de l’ombre', sub: '6 s' },
    ],
    combo: [
      { name: 'Estoc', dur: 0.3, hit: 0.45, reach: 2.2, arc: 1.15, dice: [1, 4], cost: 5, knock: 1, lunge: 4, arm: 'R', keys: ROGUE_R },
      { name: 'Estoc', dur: 0.3, hit: 0.45, reach: 2.2, arc: 1.15, dice: [1, 4], cost: 5, knock: 1, lunge: 4, arm: 'L', keys: mir(ROGUE_R) },
      { name: 'Estoc', dur: 0.3, hit: 0.45, reach: 2.2, arc: 1.15, dice: [1, 4], cost: 5, knock: 1, lunge: 4, arm: 'R', keys: ROGUE_R },
      { name: 'Double lame', dur: 0.44, hit: 0.5, reach: 2.4, arc: 1.2, dice: [2, 4], cost: 9, knock: 4, lunge: 7, arm: 'B', keys: [
        k(0, R_REST_R), { t: 0.3, d: [-0.6, 0.45, 0.2], z: [0, 0.6, -1] }, { t: 0.52, d: [0.35, -0.05, 1], z: [1, 0, 0.3] }, k(1, R_REST_R)] },
    ],
    throwKeys: [k(0, R_REST_R), { t: 0.35, d: [-0.4, 0.8, -0.3], z: [0, 0.3, -1] }, { t: 0.55, d: [-0.1, 0.2, 1], z: [0, 1, 0] }, k(1, R_REST_R)],
  },
};

const L_REST = { d: [-0.35, -0.9, 0.15], z: [0, 0, 1] };
CLASSES.lucas = {
  name: 'Lucas', icon: '😜', hp: 62, hpLvl: 10, ac: 14, speed: 6.6, main: 'CHA', saves: ['CON', 'CHA'], critMin: 20, mana: 0,
  stats: { FOR: 10, DEX: 15, CON: 16, INT: 9, SAG: 8, CHA: 17 },
  armor: 'Bonne humeur naturelle',
  desc: 'Le héros de « Prout Évasion » débarque en 3D ! Il mitraille les monstres de crottes de nez, les asperge de vomi et s’échappe dans un prout dévastateur.',
  slots: [
    { key: 'Clic G', icon: '🟢', name: 'Crotte de nez', sub: 'à volonté' },
    { key: 'Clic D', icon: '🤮', name: 'Gros Vomi', sub: '4 s' },
    { key: 'F', icon: '💨', name: 'Prout', sub: '5 s' },
  ],
  casts: {
    booger: { dur: 0.3, release: 0.55, arm: 'R', keys: [k(0, L_REST), { t: 0.3, d: [-0.15, 0.55, 0.55], z: [0, 1, 0] }, { t: 0.55, d: [-0.1, 0.15, 1], z: [0, 1, 0] }, k(1, L_REST)] },
    vomit: { dur: 0.8, release: 0.3, arm: 'R', keys: [k(0, L_REST), { t: 0.2, d: [-0.3, -0.4, 0.8], z: [0, 1, 0], lean: 0.4 }, { t: 0.85, d: [-0.3, -0.4, 0.8], z: [0, 1, 0], lean: 0.4 }, k(1, L_REST)] },
  },
};

// ---------------------------------------------------------------- Dons (montée de niveau) et objets magiques
export const BOONS = [
  { id: 'robuste', name: 'Robustesse', icon: '❤️', desc: '+18 points de vie maximum.', apply: (p) => { p.maxHp += 18; p.hp += 18; } },
  { id: 'arme', name: 'Maître d’armes', icon: '⚔️', desc: '+2 aux dégâts de toutes vos attaques.', apply: (p) => { p.bonus.dmg += 2; } },
  { id: 'precis', name: 'Œil de faucon', icon: '🎯', desc: '+2 à vos jets d’attaque.', apply: (p) => { p.bonus.atk += 2; } },
  { id: 'crit', name: 'Critique affûté', icon: '✴️', desc: 'Vos coups critiques surviennent sur 1 point de moins au d20.', apply: (p) => { p.bonus.crit += 1; }, max: 2 },
  { id: 'armure', name: 'Peau de fer', icon: '🛡️', desc: '+1 à la Classe d’Armure (CA).', apply: (p) => { p.bonus.ac += 1; } },
  { id: 'vif', name: 'Pied léger', icon: '👢', desc: '+10 % de vitesse, roulades moins coûteuses.', apply: (p) => { p.bonus.speed += 0.1; p.bonus.rollCost -= 5; }, max: 2 },
  { id: 'endur', name: 'Endurance', icon: '💪', desc: '+30 d’endurance maximum, récupération accélérée.', apply: (p) => { p.maxStamina += 30; p.bonus.stRegen += 8; } },
  { id: 'vamp', name: 'Soif de sang', icon: '🩸', desc: 'Chaque ennemi vaincu vous rend 4 PV.', apply: (p) => { p.bonus.lifeOnKill += 4; } },
  { id: 'cdr', name: 'Concentration', icon: '⏳', desc: 'Capacités spéciales rechargées 20 % plus vite.', apply: (p) => { p.bonus.cdr = Math.min(0.6, p.bonus.cdr + 0.2); }, max: 2 },
  { id: 'stat', name: 'Amélioration de caractéristique', icon: '⬆️', desc: '+2 à votre caractéristique principale (toucher, dégâts, DD).', apply: (p) => { p.stats[p.def.main] += 2; } },
  { id: 'herbo', name: 'Herboriste', icon: '🧪', desc: '+2 potions de soins, qui soignent davantage.', apply: (p) => { p.potions += 2; p.bonus.potion += 6; } },
  { id: 'arcane', cls: 'magicien', name: 'Arcanes amplifiées', icon: '🔮', desc: '+25 % de dégâts des sorts et +20 mana max.', apply: (p) => { p.bonus.spell += 0.25; p.maxMana += 20; } },
  { id: 'sneak', cls: 'roublard', name: 'Lame de l’ombre', icon: '🌑', desc: '+1d6 aux attaques sournoises.', apply: (p) => { p.bonus.sneak += 1; } },
  { id: 'shield', cls: 'guerrier', name: 'Maître du bouclier', icon: '🛡️', desc: 'Fenêtre de parade élargie, blocage moins coûteux.', apply: (p) => { p.bonus.parry += 0.12; p.bonus.blockCost -= 7; } },
  { id: 'cleave', cls: 'guerrier', name: 'Fureur martiale', icon: '🔥', desc: 'Le Tourbillon frappe une troisième fois et inflige +1d8.', apply: (p) => { p.bonus.spin += 1; }, max: 1 },
];

export const ITEMS = [
  { id: 'ring', name: 'Anneau de protection', icon: '💍', desc: '+1 CA', apply: (p) => { p.bonus.ac += 1; } },
  { id: 'amulet', name: 'Amulette de santé', icon: '📿', desc: '+15 PV max', apply: (p) => { p.maxHp += 15; p.hp += 15; } },
  { id: 'boots', name: 'Bottes de célérité', icon: '👢', desc: '+12 % de vitesse', apply: (p) => { p.bonus.speed += 0.12; } },
  { id: 'gaunt', name: 'Gantelets de puissance', icon: '🧤', desc: '+2 aux dégâts', apply: (p) => { p.bonus.dmg += 2; } },
  { id: 'weapon', name: 'Arme +1', icon: '⚔️', desc: '+1 au toucher et aux dégâts', apply: (p) => { p.bonus.atk += 1; p.bonus.dmg += 1; } },
  { id: 'cloak', name: 'Cape de déplacement', icon: '🧥', desc: 'Invulnérabilité des esquives prolongée', apply: (p) => { p.bonus.iframe += 0.12; } },
  { id: 'ioun', name: 'Pierre de Ioun', icon: '💎', desc: 'Capacités rechargées 15 % plus vite', apply: (p) => { p.bonus.cdr = Math.min(0.6, p.bonus.cdr + 0.15); } },
  { id: 'periapt', name: 'Périapte de cicatrisation', icon: '🔆', desc: 'Régénère 1 PV toutes les 3 s', apply: (p) => { p.bonus.regen += 0.33; } },
];

// ---------------------------------------------------------------- Joueur
const _v = new V(), _dir = new V(), _a = new V(), _b = new V();

export class Player {
  constructor(clsKey) {
    this.clsKey = clsKey;
    this.def = CLASSES[clsKey];
    this.name = this.def.name;
    this.level = 1;
    this.xp = 0;
    this.pendingLevels = 0;
    this.stats = { ...this.def.stats };
    this.bonus = { ac: 0, atk: 0, dmg: 0, speed: 0, crit: 0, cdr: 0, spell: 0, lifeOnKill: 0, sneak: 0, parry: 0, blockCost: 0, rollCost: 0, stRegen: 0, potion: 0, iframe: 0, regen: 0, spin: 0 };
    this.items = [];
    this.boons = [];
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.maxStamina = 100;
    this.stamina = 100;
    this.maxMana = this.def.mana;
    this.mana = this.maxMana;
    this.potions = 3;
    this.gold = 0;
    this.pos = new V();
    this.vel = new V();
    this.yaw = 0;
    this.spinYaw = 0;
    this.radius = 0.45;
    this.alive = true;
    this.state = 'free';
    this.stateT = 0;
    this.stateDur = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.queued = false;
    this.hitDone = false;
    this.iframes = 0;
    this.blocking = false;
    this.blockStart = -10;
    this.riposte = 0;
    this.shadowCrit = 0;
    this.cd = { special: 0, secondary: 0 };
    this.cdMax = { special: 1, secondary: 1 };
    this.daggers = 3;
    this.daggerT = 0;
    this.walkPhase = 0;
    this.speedNow = 0;
    this.deadT = 0;
    this.regenAcc = 0;
    this.lastStep = 0;
    this.rollDir = new V();
    this.model = buildHero(clsKey);
    this.R = this.model.R;
    G.scene.add(this.R.root);
    const tc = clsKey === 'magicien' ? [1.4, 0.6, 0.15] : [0.85, 0.9, 1.15];
    this.trail = new Trail(tc);
    G.scene.add(this.trail.mesh);
    if (this.model.weapons.off) { this.trail2 = new Trail(tc); G.scene.add(this.trail2.mesh); }
    this.pose = {};
    this.kf = { d: new V(), z: new V(), ty: 0, lean: 0 };
    this.kf2 = { d: new V(), z: new V(), ty: 0, lean: 0 };
  }

  // --- caractéristiques dérivées
  get prof() { return 2 + Math.floor((this.level - 1) / 4); }
  get mainMod() { return mod(this.stats[this.def.main]); }
  get atk() { return this.prof + this.mainMod + this.bonus.atk; }
  get ac() { return this.def.ac + this.bonus.ac; }
  get spellDC() { return 8 + this.prof + this.mainMod; }
  get speed() { return this.def.speed * (1 + this.bonus.speed); }
  get critMin() { return Math.max(17, this.def.critMin - this.bonus.crit); }
  get sneakDice() { return Math.ceil(this.level / 2) + this.bonus.sneak; }
  saveBonus(stat) { return mod(this.stats[stat]) + (this.def.saves.includes(stat) ? this.prof : 0); }
  xpNext() { return XP_TABLE[Math.min(XP_TABLE.length - 1, this.level + 1)]; }
  xpPrev() { return XP_TABLE[this.level] || 0; }
  chest() { return _a.set(this.pos.x, 1.3, this.pos.z).clone(); }

  dispose() {
    G.scene.remove(this.R.root, this.trail.mesh);
    if (this.trail2) G.scene.remove(this.trail2.mesh);
  }

  // --- visée
  findTarget(range, maxAngle, list = G.enemies) {
    const y = G.cam.yaw, fx = Math.sin(y), fz = Math.cos(y);
    let best = null, bs = 1e9;
    for (const e of list) {
      if (!e.alive) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const dc = Math.hypot(dx, dz);
      const d = dc - e.radius;
      if (d > range) continue;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / Math.max(0.001, dc), -1, 1)) - Math.atan2(e.radius, Math.max(dc, 0.1));
      if (ang > maxAngle) continue;
      if (!G.dungeon.los(this.pos.x, this.pos.z, e.pos.x, e.pos.z)) continue;
      const score = Math.max(0, ang) * 6 + d * 0.12;
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }
  faceAim(range, ang) {
    const e = this.findTarget(range, ang);
    this.yaw = e ? Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z) : G.cam.yaw;
    return e;
  }
  aimDir(e, from) {
    if (e) {
      const p = e.aimPoint();
      return p.sub(from).normalize();
    }
    const y = G.cam.yaw;
    const pitch = clamp(-(G.cam.pitch - 0.38) * 0.5, -0.25, 0.25);
    return new V(Math.sin(y) * Math.cos(pitch), Math.sin(pitch), Math.cos(y) * Math.cos(pitch));
  }

  // --- boucle
  update(dt) {
    const I = G.input;
    if (!this.alive) { this.deadT += dt; this.animate(dt); return; }
    this.stateT += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this.riposte = Math.max(0, this.riposte - dt);
    this.shadowCrit = Math.max(0, this.shadowCrit - dt);
    this.cd.special = Math.max(0, this.cd.special - dt);
    this.cd.secondary = Math.max(0, this.cd.secondary - dt);
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && this.state !== 'attack') this.combo = 0;
    if (this.clsKey === 'roublard' && this.daggers < 3) {
      this.daggerT += dt;
      if (this.daggerT >= 1.6) { this.daggers++; this.daggerT = 0; }
    }
    if (this.bonus.regen) {
      this.regenAcc += this.bonus.regen * dt;
      if (this.regenAcc >= 1) { this.hp = Math.min(this.maxHp, this.hp + 1); this.regenAcc -= 1; }
    }
    this.mana = Math.min(this.maxMana, this.mana + 6.5 * dt);

    // direction voulue relative à la caméra
    const K = I.keys;
    const cy = G.cam.yaw, fx = Math.sin(cy), fz = Math.cos(cy);
    let ix = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    let iz = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
    let analog = 1;
    if (I.stick) {
      // joystick tactile : direction + intensité
      ix = I.stick.x;
      iz = I.stick.y;
      analog = Math.min(1, Math.max(0.35, Math.hypot(ix, iz) * 1.15));
    }
    const dir = _dir.set(fx * iz - fz * ix, 0, fz * iz + fx * ix);
    const moving = dir.lengthSq() > 0.01;
    if (moving) dir.normalize();

    // actions
    const P = I.pressed;
    if (P.Space) this.tryDodge(dir, moving);
    if (P.KeyR || P.Digit1) this.tryPotion();
    if (P.KeyF || P.KeyQ) this.trySpecial();
    if (I.clickL || (I.mouseL && this.state === 'free')) this.tryPrimary();
    if (this.clsKey === 'guerrier') this.updateBlock(I.mouseR);
    else if (I.clickR || (I.mouseR && this.state === 'free')) this.trySecondary();

    // état courant
    let target = 0;
    const sprint = (K.ShiftLeft || K.ShiftRight) && moving && this.state === 'free' && !this.blocking && this.stamina > 3;
    switch (this.state) {
      case 'free': target = moving ? this.speed * (sprint ? 1.55 : 1) * (this.blocking ? 0.45 : 1) * analog : 0; break;
      case 'attack': target = moving ? this.speed * 0.2 : 0; this.updateAttack(dt); break;
      case 'cast': target = moving ? this.speed * 0.4 : 0; this.updateCast(dt); break;
      case 'drink': target = moving ? this.speed * 0.45 : 0; this.updateDrink(); break;
      case 'special': target = moving ? this.speed * 0.55 : 0; this.updateSpecial(dt); break;
      case 'hurt': target = 0; if (this.stateT > this.stateDur) this.state = 'free'; break;
      case 'roll': case 'blink': break;
    }
    // endurance
    if (sprint) this.stamina = Math.max(0, this.stamina - 20 * dt);
    else if (this.blocking) this.stamina = Math.min(this.maxStamina, this.stamina + 6 * dt);
    else if (this.state === 'free') this.stamina = Math.min(this.maxStamina, this.stamina + (32 + this.bonus.stRegen) * dt);
    else this.stamina = Math.min(this.maxStamina, this.stamina + 8 * dt);

    if (this.state === 'roll') {
      const t = this.stateT / this.stateDur;
      const sp = 11.5 * (1 - t * 0.6);
      this.vel.set(this.rollDir.x * sp, 0, this.rollDir.z * sp);
      if (t >= 1) { this.state = 'free'; this.vel.multiplyScalar(0.5); }
    } else if (this.state === 'blink') {
      this.vel.set(0, 0, 0);
      if (this.stateT > 0.12) this.R.root.visible = true;
      if (this.stateT >= this.stateDur) this.state = 'free';
    } else {
      const tx = moving ? dir.x * target : 0, tz = moving ? dir.z * target : 0;
      const acc = moving ? 14 : 10;
      this.vel.x = damp(this.vel.x, tx, acc, dt);
      this.vel.z = damp(this.vel.z, tz, acc, dt);
    }
    if (this.lunge > 0) {
      const f = this.lunge;
      this.vel.x += Math.sin(this.yaw) * f;
      this.vel.z += Math.cos(this.yaw) * f;
      this.lunge = 0;
    }
    this.pos.addScaledVector(this.vel, dt);
    this.collide();

    // orientation
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'free') {
      if (this.blocking) this.yaw = dampAngle(this.yaw, G.cam.yaw, 16, dt);
      else if (this.speedNow > 0.5) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 12, dt);
    } else if (this.state === 'roll') this.yaw = dampAngle(this.yaw, Math.atan2(this.rollDir.x, this.rollDir.z), 25, dt);

    // pas
    this.walkPhase += this.speedNow * dt * 1.55;
    if (this.speedNow > 1 && this.state !== 'roll') {
      const st = Math.floor(this.walkPhase / Math.PI);
      if (st !== this.lastStep) { this.lastStep = st; G.audio.play('step', null, { vol: Math.min(1, this.speedNow / 7) }); }
    }
    this.animate(dt);
  }

  collide() {
    const D = G.dungeon;
    D.collide(this.pos, this.radius);
    for (const e of G.enemies) {
      if (!e.alive || !e.solidCircles) continue;
      for (const c of e.solidCircles()) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const rr = c.r + this.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          this.pos.x += (dx / d) * (rr - d);
          this.pos.z += (dz / d) * (rr - d);
        }
      }
    }
    D.collide(this.pos, this.radius);
  }

  // ---------------------------------------------------------------- Actions
  lateCancel(frac = 0.55) {
    return (this.state === 'attack' || this.state === 'cast') && this.stateT / this.stateDur > frac;
  }

  tryDodge(dir, moving) {
    if (!(this.state === 'free' || this.state === 'hurt' || this.lateCancel(0.45))) return;
    const cost = 22 + this.bonus.rollCost;
    if (this.stamina < cost) { G.ui.flashBar('st'); return; }
    this.stamina -= cost;
    this.blocking = false;
    const d = moving ? dir.clone() : new V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.trail.active = false;
    if (this.trail2) this.trail2.active = false;
    if (this.clsKey === 'magicien') {
      // Foulée brumeuse : téléportation courte
      const D = G.dungeon;
      const dist = Math.min(6.5, D.ray(this.pos.x, this.pos.z, d.x, d.z, 6.5));
      G.fx.magic(_a.set(this.pos.x, 1, this.pos.z), 30, [0.8, 0.9, 2.2]);
      G.fx.norm.emit({ x: this.pos.x, y: 1, z: this.pos.z, count: 14, spread: 0.6, vel: 0.6, life: 1, size: 0.8, size1: 1.8, color: [0.6, 0.65, 0.8], alpha: 0.35 });
      this.pos.addScaledVector(d, Math.max(0, dist - 0.5));
      this.collide();
      G.fx.magic(_a.set(this.pos.x, 1, this.pos.z), 30, [0.8, 0.9, 2.2]);
      this.R.root.visible = false;
      this.state = 'blink';
      this.stateT = 0;
      this.stateDur = 0.22;
      this.iframes = 0.35 + this.bonus.iframe;
      this.yaw = Math.atan2(d.x, d.z);
      G.audio.play('blink', this.pos);
      return;
    }
    this.rollDir.copy(d);
    this.state = 'roll';
    this.stateT = 0;
    this.stateDur = 0.5;
    this.iframes = 0.34 + this.bonus.iframe;
    G.audio.play('roll', this.pos);
    G.fx.dust(this.pos, 6, 0.4);
  }

  tryPotion() {
    if (this.state !== 'free' || this.potions <= 0) { if (this.potions <= 0) G.ui.toast('Plus de potions !'); return; }
    if (this.hp >= this.maxHp) { G.ui.toast('Points de vie au maximum'); return; }
    this.potions--;
    this.state = 'drink';
    this.stateT = 0;
    this.stateDur = 0.75;
    this.drank = false;
    G.audio.play('potion', this.pos);
  }
  updateDrink() {
    if (!this.drank && this.stateT > 0.45) {
      this.drank = true;
      const r = roll(4, 4, 4 + this.level + this.bonus.potion);
      this.heal(r.total);
      G.ui.log(`🧪 Potion de soins : <span class="heal">+${r.total} PV</span> <small>(4d4+${4 + this.level + this.bonus.potion})</small>`);
    }
    if (this.stateT >= this.stateDur) this.state = 'free';
  }
  heal(n) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    G.fx.heal(this.pos);
    G.fx.text(_a.set(this.pos.x, 2.1, this.pos.z), `+${Math.round(this.hp - before)}`, 'heal', 1.1);
  }

  tryPrimary() {
    if (this.state === 'attack') { if (this.stateT / this.stateDur > 0.3) this.queued = true; return; }
    if (this.state === 'cast' && (this.clsKey === 'magicien' || this.clsKey === 'lucas')) { if (this.stateT / this.stateDur > 0.5) this.queued = true; return; }
    if (this.state !== 'free' || this.blocking) return;
    if (this.clsKey === 'magicien') return this.startCast('firebolt');
    if (this.clsKey === 'lucas') return this.startCast('booger');
    this.startAttack();
  }

  startAttack() {
    const list = this.def.combo;
    if (this.combo >= list.length) this.combo = 0;
    const c = list[this.combo];
    this.curAtk = c;
    this.state = 'attack';
    this.stateT = 0;
    this.stateDur = c.dur;
    this.hitDone = false;
    this.queued = false;
    this.stamina = Math.max(0, this.stamina - c.cost);
    this.faceAim(4.5, 1.25);
    G.audio.play('swing', this.pos, { pitch: rnd(0.9, 1.15) * (this.clsKey === 'roublard' ? 1.25 : 1) });
  }

  updateAttack() {
    const c = this.curAtk, t = this.stateT / this.stateDur;
    const active = t > c.hit - 0.16 && t < c.hit + 0.14;
    this.trail.active = active && c.arm !== 'L';
    if (this.trail2) this.trail2.active = active && c.arm !== 'R';
    if (t > c.hit - 0.15 && t < c.hit) this.lunge = c.lunge * 0.06;
    if (!this.hitDone && t >= c.hit) { this.hitDone = true; this.meleeHit(c); }
    if (t >= 1) {
      this.trail.active = false;
      if (this.trail2) this.trail2.active = false;
      this.combo = (this.combo + 1) % this.def.combo.length;
      if (this.queued) this.startAttack();
      else { this.state = 'free'; this.comboTimer = 0.5; }
    }
  }

  isSneak(e) {
    if (this.clsKey !== 'roublard' || e.sneakCD > 0) return false;
    if (!e.aware || e.state === 'stagger' || this.shadowCrit > 0) return true;
    const ex = Math.sin(e.yaw), ez = Math.cos(e.yaw);
    const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * ex + dz * ez) / d < -0.3;
  }

  meleeHit(c, opts = {}) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let any = false;
    for (const e of G.enemies) {
      if (!e.alive) continue;
      if (!e.meleeCheck(this.pos, fx, fz, opts.reach ?? c.reach, opts.arc ?? c.arc)) continue;
      const sneak = this.isSneak(e);
      const dice = [[c.dice[0], c.dice[1], this.mainMod + this.bonus.dmg]];
      if (sneak) dice.push([this.sneakDice, 6, 0]);
      const autoCrit = this.riposte > 0 || this.shadowCrit > 0;
      const dir = _b.set(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z).normalize().clone();
      const hit = playerAttack(e, {
        atk: this.atk, dice, critMin: this.critMin, autoCrit, dir, knock: c.knock, source: 'melee',
        label: sneak ? '<b>Attaque sournoise !</b>' : opts.label || c.name,
      });
      if (hit) {
        any = true;
        if (sneak) { e.sneakCD = 1.4; G.fx.text(e.headPos().add(_a.set(0, 0.4, 0)), 'Sournoise !', 'sneak', 0.9); }
        const ip = e.impactPoint(this.pos);
        if (e.kind === 'bone') G.fx.bones(ip, 8);
        else if (e.kind === 'slime') G.fx.blood(ip, 12, [0.25, 0.8, 0.3]);
        else if (e.kind === 'dragon') G.fx.sparks(ip, 18, [1.5, 0.6, 0.2]);
        else G.fx.blood(ip, 10);
        G.fx.sparks(ip, 8);
      } else {
        G.fx.sparks(e.impactPoint(this.pos), 5, [0.8, 0.8, 0.9]);
      }
    }
    if (any) { this.riposte = 0; this.shadowCrit = 0; }
  }

  // --- secondaire
  trySecondary() {
    if (!(this.state === 'free' || this.lateCancel(0.6))) return;
    if (this.clsKey === 'magicien') {
      if (this.mana < 18) { G.ui.flashBar('mana'); return; }
      if (this.cd.secondary > 0) return;
      this.mana -= 18;
      this.cd.secondary = 0.6;
      this.cdMax.secondary = 0.6;
      this.startCast('missile');
    } else if (this.clsKey === 'lucas') {
      if (this.cd.secondary > 0) return;
      if (this.stamina < 15) { G.ui.flashBar('st'); return; }
      this.stamina -= 15;
      this.cdMax.secondary = this.cd.secondary = 4 * (1 - this.bonus.cdr);
      this.startCast('vomit');
      G.audio.play('burp', this.pos);
    } else if (this.clsKey === 'roublard') {
      if (this.daggers <= 0) return;
      this.daggers--;
      this.state = 'cast';
      this.castKind = 'throw';
      this.castDef = { dur: 0.3, release: 0.5, arm: 'R', keys: this.def.throwKeys };
      this.stateT = 0;
      this.stateDur = 0.3;
      this.released = false;
      this.castTarget = this.faceAim(25, 0.35);
    }
  }

  updateBlock(held) {
    const can = this.state === 'free' && this.stamina > 1;
    if (held && can && !this.blocking) { this.blocking = true; this.blockStart = G.time; G.audio.play('shieldUp', this.pos); }
    if (!held || !can) this.blocking = false;
  }

  // --- sorts / lancers
  startCast(kind) {
    const c = this.def.casts[kind];
    this.state = 'cast';
    this.castKind = kind;
    this.castDef = c;
    this.stateT = 0;
    this.stateDur = c.dur;
    this.released = false;
    this.queued = false;
    const range = kind === 'missile' ? 28 : kind === 'vomit' ? 6 : 30;
    this.castTarget = this.faceAim(range, kind === 'missile' ? 0.9 : kind === 'vomit' ? 0.7 : 0.28);
    if (kind === 'fireball') G.audio.play('charge', this.pos);
  }
  updateCast() {
    const t = this.stateT / this.stateDur;
    if (!this.released && t >= this.castDef.release) {
      this.released = true;
      this.release(this.castKind);
    }
    if (this.castKind === 'vomit' && this.released && t < 0.88) {
      const cp = this.castPoint();
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      G.fx.norm.emit({ x: cp.x, y: cp.y, z: cp.z, count: 6, spread: 0.05, vx: fx * 9, vy: 1.2, vz: fz * 9, vel: 2.2, life: 0.55, size: 0.22, size1: 0.12, color: [0.75, 0.68, 0.12], color1: [0.5, 0.55, 0.08], gravity: 14, drag: 0.6 });
    }
    if (this.castKind !== 'throw' && this.clsKey === 'magicien' && !this.released) {
      const cp = this.castPoint();
      G.fx.add.emit({ x: cp.x, y: cp.y, z: cp.z, count: 2, spread: 0.15, vel: 0.5, life: 0.25, size: 0.25, size1: 0.02, color: this.castKind === 'missile' ? [1, 0.6, 3] : [3, 1.2, 0.3] });
    }
    if (t >= 1) {
      this.state = 'free';
      if (this.queued && this.clsKey === 'magicien') { this.queued = false; this.startCast('firebolt'); }
      if (this.queued && this.clsKey === 'lucas') { this.queued = false; this.startCast('booger'); }
    }
  }
  castPoint() {
    const cp = new V();
    if (this.castKind === 'missile') this.R.handL.getWorldPosition(cp);
    else if (this.castKind === 'throw' || this.castKind === 'booger') this.R.handR.getWorldPosition(cp);
    else this.model.castPoint.getWorldPosition(cp);
    return cp;
  }
  release(kind) {
    const from = this.castPoint();
    const tgt = this.castTarget && this.castTarget.alive ? this.castTarget : this.findTarget(30, 0.3);
    if (kind === 'firebolt') {
      const dir = this.aimDir(tgt, from);
      G.audio.play('firebolt', this.pos);
      new Projectile({
        kind: 'firebolt', owner: 'player', pos: from, vel: dir.multiplyScalar(30), radius: 0.3, life: 1.4,
        onHit: (e, p) => {
          playerAttack(e, { atk: this.atk, dice: [[1, 10, this.mainMod + this.bonus.dmg]], critMin: this.critMin, mult: 1 + this.bonus.spell, dir: p.vel.clone().normalize(), knock: 2, source: 'spell', label: 'Trait de feu' });
          G.fx.fireBurst(p.pos, 14, 0.35);
          G.fx.flash(p.pos, [1, 0.45, 0.12], 25, 8, 0.2);
          G.audio.play('fireHit', p.pos);
        },
        onWall: (p) => { G.fx.fireBurst(p.pos, 10, 0.3); G.audio.play('fireHit', p.pos); },
      });
    } else if (kind === 'fireball') {
      const dir = this.aimDir(tgt, from);
      G.audio.play('fireball', this.pos);
      const boom = (p) => this.fireballBoom(p.pos);
      new Projectile({ kind: 'fireball', owner: 'player', pos: from, vel: dir.multiplyScalar(19), radius: 0.4, life: 1.6, onHit: (e, p) => boom(p), onWall: boom, onExpire: boom });
    } else if (kind === 'missile') {
      G.audio.play('missile', this.pos);
      const targets = G.enemies.filter((e) => e.alive && e.pos.distanceTo(this.pos) < 28 && G.dungeon.los(this.pos.x, this.pos.z, e.pos.x, e.pos.z))
        .sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos));
      const main = tgt || targets[0];
      for (let i = 0; i < 3; i++) {
        const t = i === 0 ? main : targets[i] || main;
        const fwd = new V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const side = new V(fwd.z, 0, -fwd.x).multiplyScalar((i - 1) * 7);
        const vel = fwd.multiplyScalar(10).add(side).add(new V(0, 4 + i, 0));
        new Projectile({
          kind: 'missile', owner: 'player', pos: from, vel, radius: 0.35, life: 2.5, target: t, homing: t ? 6 : 0,
          onHit: (e, p) => {
            playerAttack(e, { autoHit: true, dice: [[1, 4, 1 + Math.floor(this.mainMod / 2)]], mult: 1 + this.bonus.spell, dir: p.vel.clone().normalize(), knock: 1, source: 'spell', label: 'Projectile magique' });
            G.fx.magic(p.pos, 16, [1.2, 0.7, 3]);
          },
          onWall: (p) => G.fx.magic(p.pos, 10, [1.2, 0.7, 3]),
        });
      }
    } else if (kind === 'booger') {
      const dir = this.aimDir(tgt, from);
      dir.y += 0.06;
      G.audio.play('booger', this.pos);
      new Projectile({
        kind: 'booger', owner: 'player', pos: from, vel: dir.normalize().multiplyScalar(26), gravity: 3, radius: 0.3, life: 1.4,
        onHit: (e, p) => {
          playerAttack(e, { atk: this.atk, dice: [[1, 6, this.mainMod + this.bonus.dmg]], critMin: this.critMin, dir: p.vel.clone().normalize(), knock: 2, source: 'ranged', label: 'Crotte de nez' });
          G.fx.blood(p.pos, 10, [0.45, 0.8, 0.2]);
          G.audio.play('splatSmall', p.pos);
        },
        onWall: (p) => { G.fx.blood(p.pos, 8, [0.45, 0.8, 0.2]); G.audio.play('splatSmall', p.pos); },
      });
    } else if (kind === 'vomit') {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      for (const e of G.enemies) {
        if (!e.alive || !e.meleeCheck(this.pos, fx, fz, 5.5, 0.6)) continue;
        if (!G.dungeon.los(this.pos.x, this.pos.z, e.pos.x, e.pos.z)) continue;
        playerAttack(e, { save: { dc: this.spellDC }, dice: [[3, 6, this.mainMod]], mult: 1 + this.bonus.spell, dir: new V(fx, 0, fz), knock: 4, source: 'spell', label: 'Gros Vomi' });
        if (e.alive && e.stun && e.kind !== 'dragon' && Math.random() < 0.5) e.stun(1.2);
      }
    } else if (kind === 'throw') {
      const dir = this.aimDir(tgt, from);
      G.audio.play('throw', this.pos);
      new Projectile({
        kind: 'dagger', owner: 'player', pos: from, vel: dir.multiplyScalar(32), radius: 0.3, life: 1.2,
        onHit: (e, p) => {
          const sneak = this.isSneak(e);
          const dice = [[1, 4, this.mainMod + this.bonus.dmg]];
          if (sneak) dice.push([this.sneakDice, 6, 0]);
          const hit = playerAttack(e, { atk: this.atk, dice, critMin: this.critMin, dir: p.vel.clone().normalize(), knock: 1.5, source: 'ranged', label: sneak ? '<b>Dague sournoise !</b>' : 'Dague de jet' });
          if (hit && sneak) e.sneakCD = 1.4;
          if (hit) G.fx.blood(p.pos, 6, e.kind === 'bone' ? [0.85, 0.82, 0.72] : undefined);
        },
        onWall: (p) => { G.fx.sparks(p.pos, 8, [0.9, 0.9, 1]); G.audio.play('clink', p.pos); },
      });
    }
  }

  fireballBoom(pos) {
    const radius = 4.6;
    explode(pos, radius);
    for (const e of G.enemies) {
      if (!e.alive) continue;
      if (e.hitDistance(pos) > radius) continue;
      if (!G.dungeon.los(pos.x, pos.z, e.pos.x, e.pos.z)) continue;
      const dir = new V(e.pos.x - pos.x, 0, e.pos.z - pos.z).normalize();
      playerAttack(e, { save: { dc: this.spellDC }, dice: [[6, 6, 0]], mult: 1 + this.bonus.spell, dir, knock: 7, source: 'spell', label: 'Boule de feu' });
    }
  }

  // Prout dévastateur : onde de choc + propulsion invulnérable
  prout() {
    const o = this.pos.clone();
    const radius = 4.8;
    G.audio.play('fart', o);
    G.shake = Math.max(G.shake, 0.45);
    G.fx.norm.emit({ x: o.x, y: 0.6, z: o.z, count: 60, spread: 1.4, flat: true, vel: 5, velY: 0.25, life: 1.8, size: 1.1, size1: 3.4, color: [0.55, 0.72, 0.18], color1: [0.4, 0.5, 0.15], alpha: 0.5, drag: 2.2 });
    G.fx.add.emit({ x: o.x, y: 0.7, z: o.z, count: 30, spread: 0.6, vel: 7, life: 0.5, size: 0.3, size1: 0.05, color: [0.8, 1.6, 0.3] });
    new Telegraph({ x: o.x, z: o.z, radius, duration: 0.35, color: [0.5, 1.2, 0.2] });
    for (const e of G.enemies) {
      if (!e.alive || e.hitDistance(o) > radius) continue;
      if (!G.dungeon.los(o.x, o.z, e.pos.x, e.pos.z)) continue;
      const dir = new V(e.pos.x - o.x, 0, e.pos.z - o.z).normalize();
      playerAttack(e, { save: { dc: this.spellDC }, dice: [[2, 8, this.mainMod]], mult: 1 + this.bonus.spell, dir, knock: 12, source: 'spell', label: 'Prout dévastateur' });
    }
    const y = G.cam.yaw;
    this.rollDir.set(Math.sin(y), 0, Math.cos(y));
    this.state = 'roll';
    this.stateT = 0;
    this.stateDur = 0.5;
    this.iframes = 0.7 + this.bonus.iframe;
    this.blocking = false;
  }

  // --- capacité spéciale
  trySpecial() {
    if (this.cd.special > 0) { G.ui.toast('Capacité en recharge…'); return; }
    if (!(this.state === 'free' || this.lateCancel(0.5))) return;
    const cdr = 1 - this.bonus.cdr;
    if (this.clsKey === 'guerrier') {
      if (this.stamina < 20) { G.ui.flashBar('st'); return; }
      this.stamina -= 20;
      this.cdMax.special = this.cd.special = 7 * cdr;
      this.state = 'special';
      this.stateT = 0;
      this.stateDur = 0.62 + this.bonus.spin * 0.25;
      this.spinHits = 0;
      this.blocking = false;
      G.audio.play('spin', this.pos);
    } else if (this.clsKey === 'lucas') {
      this.cdMax.special = this.cd.special = 5 * cdr;
      this.prout();
    } else if (this.clsKey === 'magicien') {
      if (this.mana < 35) { G.ui.flashBar('mana'); return; }
      this.mana -= 35;
      this.cdMax.special = this.cd.special = 4.5 * cdr;
      this.startCast('fireball');
    } else {
      if (this.stamina < 12) { G.ui.flashBar('st'); return; }
      this.stamina -= 12;
      this.cdMax.special = this.cd.special = 6 * cdr;
      const e = this.findTarget(15, 0.7);
      G.fx.norm.emit({ x: this.pos.x, y: 1, z: this.pos.z, count: 30, spread: 0.6, vel: 1.2, life: 0.9, size: 0.7, size1: 1.6, color: [0.05, 0.05, 0.08], alpha: 0.7 });
      if (e) {
        const back = new V(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
        const dest = e.pos.clone().addScaledVector(back, e.radius + 0.9);
        if (G.dungeon.passable(G.dungeon.ci(dest.x), G.dungeon.ci(dest.z))) this.pos.copy(dest);
        else this.pos.copy(e.pos).addScaledVector(new V(this.pos.x - e.pos.x, 0, this.pos.z - e.pos.z).normalize(), e.radius + 0.9);
        this.yaw = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      } else {
        const d = new V(Math.sin(G.cam.yaw), 0, Math.cos(G.cam.yaw));
        const dist = Math.min(7, G.dungeon.ray(this.pos.x, this.pos.z, d.x, d.z, 7));
        this.pos.addScaledVector(d, Math.max(0, dist - 0.6));
        this.yaw = G.cam.yaw;
      }
      this.collide();
      G.fx.norm.emit({ x: this.pos.x, y: 1, z: this.pos.z, count: 30, spread: 0.6, vel: 1.2, life: 0.9, size: 0.7, size1: 1.6, color: [0.05, 0.05, 0.08], alpha: 0.7 });
      G.fx.magic(_a.set(this.pos.x, 1, this.pos.z), 20, [0.4, 1.6, 1.0]);
      this.shadowCrit = 2.5;
      this.iframes = 0.35;
      this.state = 'free';
      G.audio.play('shadow', this.pos);
      G.ui.toast('Prochaine attaque : critique assuré !');
    }
  }
  updateSpecial() {
    const t = this.stateT / this.stateDur;
    const turns = 2 + this.bonus.spin;
    this.spinYaw = t * Math.PI * 2 * turns;
    this.trail.active = t > 0.05 && t < 0.95;
    const hitsDue = Math.floor(t * turns + 0.4);
    if (hitsDue > this.spinHits && this.spinHits < turns) {
      this.spinHits++;
      this.meleeHit({ name: 'Tourbillon', reach: 3.4, arc: Math.PI, dice: [1 + this.bonus.spin, 8], knock: 5 }, { label: 'Tourbillon' });
      G.audio.play('swing', this.pos, { pitch: 0.8 });
    }
    if (t >= 1) { this.state = 'free'; this.spinYaw = 0; this.trail.active = false; }
  }

  // ---------------------------------------------------------------- Dégâts reçus
  // a: { attacker, atk, dice:[[c,s,b]], type:'melee'|'ranged'|'area', save:{stat,dc}, unblockable, knock, label }
  receiveAttack(a) {
    if (!this.alive || G.state !== 'playing') return 'none';
    const chest = _a.set(this.pos.x, 1.6, this.pos.z);
    if (this.iframes > 0) {
      if (!a.silent) G.fx.text(chest, 'Esquivé', 'dodge', 0.7);
      return 'dodge';
    }
    let mult = 1;
    if (this.blocking && !a.unblockable && a.attacker) {
      const dx = a.attacker.pos.x - this.pos.x, dz = a.attacker.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const front = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d;
      if (front > 0.35) {
        if (G.time - this.blockStart < 0.24 + this.bonus.parry && a.type !== 'area') {
          G.fx.text(chest, 'PARADE !', 'parry', 1.1);
          G.fx.sparks(_b.set(this.pos.x + dx / d * 0.6, 1.3, this.pos.z + dz / d * 0.6), 30, [1.5, 1.2, 0.5]);
          G.audio.play('parry', this.pos);
          G.hitstop = 0.12;
          G.shake = 0.25;
          if (a.attacker.stun) a.attacker.stun(a.attacker.kind === 'dragon' ? 1.0 : 1.5);
          this.riposte = 1.6;
          G.ui.log('🛡️ <span class="crit">Parade parfaite !</span> Riposte : prochain coup critique.');
          return 'parry';
        }
        const cost = 18 + this.bonus.blockCost;
        this.stamina -= cost;
        mult = 0.25;
        G.audio.play('block', this.pos);
        G.fx.sparks(_b.set(this.pos.x + dx / d * 0.6, 1.3, this.pos.z + dz / d * 0.6), 14, [1.2, 1.0, 0.6]);
        if (this.stamina <= 0) {
          this.stamina = 0;
          this.blocking = false;
          mult = 0.6;
          this.state = 'hurt'; this.stateT = 0; this.stateDur = 0.7;
          G.fx.text(chest, 'Garde brisée', 'miss', 1);
        }
      }
    }
    const [c, s, b] = a.dice[0];
    let dmg = 0, crit = false;
    if (a.save) {
      const sv = die(20) + this.saveBonus(a.save.stat);
      const ok = sv >= a.save.dc;
      for (const [cc, ss, bb] of a.dice) dmg += roll(cc, ss, bb).total;
      if (ok) dmg = Math.floor(dmg / 2);
      G.ui.log(`${a.label} — sauvegarde ${a.save.stat} : 🎲 ${sv} contre DD ${a.save.dc} <span class="${ok ? 'hit' : 'miss'}">${ok ? 'réussie (moitié)' : 'ratée'}</span>`);
    } else if (a.atk !== undefined) {
      const nat = die(20), total = nat + a.atk;
      crit = nat === 20;
      const hit = nat !== 1 && (crit || total >= this.ac);
      if (!hit) {
        G.fx.text(chest, 'Raté !', 'dodge', 0.8);
        G.ui.log(`${a.label} attaque : 🎲 ${nat}${fmtMod(a.atk)} = ${total} contre votre CA ${this.ac} — <span class="hit">raté</span>`);
        G.audio.play('clink', this.pos);
        return 'miss';
      }
      for (const [cc, ss, bb] of a.dice) dmg += roll(crit ? cc * 2 : cc, ss, bb).total;
      G.ui.log(`${a.label} attaque : 🎲 ${nat}${fmtMod(a.atk)} = ${total} contre CA ${this.ac} — <span class="miss">${crit ? 'CRITIQUE, ' : ''}touché</span>`);
    } else {
      for (const [cc, ss, bb] of a.dice) dmg += roll(cc, ss, bb).total;
    }
    dmg = Math.max(1, Math.round(dmg * mult));
    this.hp -= dmg;
    G.fx.text(chest, `-${dmg}`, 'hurt', 1);
    G.fx.blood(chest, 8);
    G.damageFlash = Math.min(1, G.damageFlash + 0.35 + dmg / this.maxHp);
    G.shake = Math.max(G.shake, 0.2 + Math.min(0.4, dmg / 40));
    G.hitstop = Math.max(G.hitstop, 0.05);
    G.audio.play('hurt', this.pos);
    this.iframes = 0.4;
    if (a.knock && a.attacker) {
      const dx = this.pos.x - a.attacker.pos.x, dz = this.pos.z - a.attacker.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * a.knock;
      this.vel.z += (dz / d) * a.knock;
    }
    if (dmg >= this.maxHp * 0.12 && mult === 1 && (this.state === 'free' || this.state === 'drink')) {
      this.state = 'hurt'; this.stateT = 0; this.stateDur = 0.3;
    }
    if (this.hp <= 0) this.die();
    return 'hit';
  }

  die() {
    this.hp = 0;
    this.alive = false;
    this.state = 'dead';
    this.deadT = 0;
    this.trail.active = false;
    G.audio.play('death', this.pos);
    G.ui.log('<span class="miss">Vous êtes tombé au combat…</span>');
  }

  // ---------------------------------------------------------------- Progression
  onKill(e) {
    this.gainXP(e.xp || 0);
    if (this.bonus.lifeOnKill) this.heal(this.bonus.lifeOnKill);
  }
  gainXP(n) {
    if (!n) return;
    this.xp += n;
    G.fx.text(_a.set(this.pos.x, 2.4, this.pos.z), `+${n} XP`, 'xp', 1);
    while (this.xp >= this.xpNext() && this.level < XP_TABLE.length - 1) {
      this.level++;
      const gain = this.def.hpLvl + mod(this.stats.CON);
      this.maxHp += gain;
      this.hp = this.maxHp;
      this.mana = this.maxMana;
      this.pendingLevels++;
      G.fx.levelUp(this.pos);
      G.audio.play('levelup');
      G.ui.log(`✨ <span class="crit">Niveau ${this.level} !</span> +${gain} PV max, PV restaurés.`);
    }
  }
  boonChoices() {
    const pool = BOONS.filter((b) => (!b.cls || b.cls === this.clsKey) && (!b.max || this.boons.filter((x) => x === b.id).length < b.max));
    const out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  }
  applyBoon(b) {
    b.apply(this);
    this.boons.push(b.id);
  }
  giveItem() {
    const owned = new Set(this.items.map((i) => i.id));
    const pool = ITEMS.filter((i) => !owned.has(i.id));
    if (!pool.length) return null;
    const it = pool[Math.floor(Math.random() * pool.length)];
    it.apply(this);
    this.items.push(it);
    return it;
  }

  // ---------------------------------------------------------------- Animation
  animate(dt) {
    const R = this.R, P = this.pose;
    P.walk = this.walkPhase;
    P.amt = clamp(this.speedNow / 6.2, 0, 1.3);
    P.armR = P.armL = null;
    P.sharp = false;
    P.torsoYaw = 0;
    P.lean = this.speedNow > 7.5 ? 0.18 : 0;
    P.crouch = 0;
    P.roll = 0;
    P.rollZ = 0;
    P.pivot = 0;
    P.bodyY = 0;
    P.elbowR = 0.3;
    P.elbowL = 0.3;
    P.headPitch = 0;
    const cls = this.clsKey;
    // repos par classe
    if (cls === 'guerrier') {
      P.armR = G_REST;
      P.armL = this.blocking ? { d: [-0.55, 0.15, 0.8], z: [0, 0, 1] } : { d: [0.3, -0.9, 0.3], z: [0.6, 0, 1] };
      if (this.blocking) { P.elbowL = 0.5; P.crouch = 0.15; P.sharp = true; }
    } else if (cls === 'lucas') {
      P.armR = null;
      P.armL = null;
      P.elbowR = P.elbowL = 0.6;
    } else if (cls === 'magicien') {
      P.armR = M_REST;
      P.elbowR = 0.5;
    } else {
      P.armR = R_REST_R;
      P.armL = { d: [0.3, -0.9, 0.35], z: [0, 0.4, 1] };
    }
    const t = this.stateDur ? clamp(this.stateT / this.stateDur, 0, 1) : 0;
    switch (this.state) {
      case 'attack': {
        const c = this.curAtk;
        this.sampleKF(c.keys, t, this.kf);
        P.sharp = true;
        P.torsoYaw = this.kf.ty;
        P.lean = this.kf.lean;
        P.elbowR = 0.1;
        if (c.arm === 'R' || c.arm === 'B') P.armR = this.kf;
        if (c.arm === 'L') { P.armL = this.kf; P.elbowL = 0.1; }
        if (c.arm === 'B') { this.sampleKF(mir(c.keys), t, this.kf2); P.armL = this.kf2; P.torsoYaw = 0; P.elbowL = 0.1; }
        P.crouch = 0.1;
        break;
      }
      case 'cast': {
        const c = this.castDef;
        this.sampleKF(c.keys, t, this.kf);
        P.sharp = true;
        if (c.arm === 'L') P.armL = this.kf;
        else P.armR = this.kf;
        P.torsoYaw = this.kf.ty || 0;
        P.elbowR = 0.15;
        break;
      }
      case 'special':
        P.armR = { d: [-1, 0.05, 0.25], z: [0, 0, 1] };
        P.armL = { d: [1, 0.1, 0.1], z: [0.3, 0, 1] };
        P.crouch = 0.3;
        P.sharp = true;
        P.elbowR = 0.05;
        break;
      case 'roll': {
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        P.crouch = Math.sin(Math.PI * t) * 0.9;
        P.pivot = 0.6;
        P.roll = e * Math.PI * 2;
        P.armR = { d: [-0.2, -0.5, 1], z: [0, 1, 0] };
        P.armL = { d: [0.2, -0.5, 1], z: [0, 1, 0] };
        P.elbowR = P.elbowL = 1.4;
        P.sharp = true;
        break;
      }
      case 'drink':
        P.armL = { d: [0.15, -0.3, 0.6], z: [0, 1, 0] };
        P.elbowL = 2.1;
        P.headPitch = t > 0.35 ? -0.35 : 0;
        break;
      case 'hurt':
        P.lean = -0.35;
        P.crouch = 0.2;
        break;
      case 'dead': {
        const k2 = Math.min(1, this.deadT * 2.2);
        P.pivot = 0.0;
        P.roll = -k2 * Math.PI / 2 * 0.98;
        P.crouch = 0.3 * k2;
        P.armR = { d: [-0.9, 0.2, 0.2], z: [0, 0, 1] };
        P.armL = { d: [0.9, 0.3, 0.2], z: [0, 0, 1] };
        P.bodyY = 0.12 * k2;
        break;
      }
    }
    poseHumanoid(R, P, dt);
    if (cls === 'lucas') this.animateLucas(t);
    R.root.position.copy(this.pos);
    R.root.rotation.y = this.yaw + this.spinYaw;
    animateCape(this.model.cape, this.state === 'roll' ? 2 : this.speedNow, G.time, dt);
    // traînées d'arme
    const W = this.model.weapons;
    R.root.updateMatrixWorld(true);
    if (W.main && W.main.tip) this.trail.update(dt, W.main.base.getWorldPosition(_a), W.main.tip.getWorldPosition(_b));
    if (this.trail2 && W.off) this.trail2.update(dt, W.off.base.getWorldPosition(_a), W.off.tip.getWorldPosition(_b));
    if (W.crystal) W.crystal.material.emissiveIntensity = 3 + Math.sin(G.time * 4) * 0.8 + (this.state === 'cast' ? 4 : 0);
  }

  // Lucas : rebond élastique et crotte de nez qui balance
  animateLucas(t) {
    const W = this.model.weapons, R = this.R;
    let sq = Math.sin(this.walkPhase * 2) * 0.05 * Math.min(1, this.speedNow / 6);
    if (this.state === 'roll') sq = -0.15 * Math.sin(Math.PI * t);
    if (this.state === 'cast' && this.castKind === 'vomit') sq = 0.08;
    if (this.state === 'hurt') sq = 0.12;
    R.torso.scale.set(1 + sq, 1 - sq, 1 + sq);
    W.snot.rotation.x = Math.sin(G.time * 7) * 0.4 - Math.min(0.8, this.speedNow * 0.1);
    W.snot.rotation.z = Math.sin(G.time * 5.3) * 0.3;
    W.snot.visible = !(this.state === 'cast' && this.castKind === 'booger' && t > 0.3 && t < 0.7);
  }

  sampleKF(keys, t, out) {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    let u = clamp((t - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
    u = u * u * (3 - 2 * u);
    out.d.set(lerp(a.d[0], b.d[0], u), lerp(a.d[1], b.d[1], u), lerp(a.d[2], b.d[2], u));
    out.z.set(lerp(a.z[0], b.z[0], u), lerp(a.z[1], b.z[1], u), lerp(a.z[2], b.z[2], u));
    out.ty = lerp(a.ty || 0, b.ty || 0, u);
    out.lean = lerp(a.lean || 0, b.lean || 0, u);
    return out;
  }
}
