// Interface : HUD, journal, mini-carte, écrans et menus.
import { G } from './state.js';
import { CLASSES, BOONS } from './player.js';
import { T } from './dungeon.js';
import { mod, fmtMod } from './util.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'hpFill', 'hpGhost', 'hpText', 'manaBar', 'manaFill', 'manaText', 'stBar', 'stFill', 'xpFill', 'lvl', 'picon', 'hname', 'acv',
      'minimap', 'floorName', 'goldv', 'boss', 'bossName', 'bossFill', 'bossGhost', 'log', 'abilities', 'dice', 'diceN', 'prompt', 'banner', 'bannerT', 'bannerS',
      'toast', 'critflash', 'bigmap', 'bigmapC', 'crosshair']) this.el[id] = $(id);
    this.mctx = this.el.minimap.getContext('2d');
    this.bctx = this.el.bigmapC.getContext('2d');
    this.mapT = 0;
    this.slots = [];
  }

  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }
  hideAllScreens() { for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden'); }

  // ---------------------------------------------------------------- HUD
  setupHud(P) {
    const d = P.def;
    this.el.picon.textContent = d.icon;
    this.el.hname.textContent = d.name;
    this.el.manaBar.classList.toggle('hidden', !P.maxMana);
    this.el.log.innerHTML = '';
    const ab = this.el.abilities;
    ab.innerHTML = '';
    this.slots = [];
    const defs = [...d.slots, { key: 'Espace', icon: P.clsKey === 'magicien' ? '💨' : '🤸', name: P.clsKey === 'magicien' ? 'Foulée' : 'Roulade' }, { key: 'R', icon: '🧪', name: 'Potion' }];
    for (const s of defs) {
      const div = document.createElement('div');
      div.className = 'slot';
      div.innerHTML = `<div class="cd"></div><span class="key">${s.key}</span>${s.icon}<span class="cnt"></span><span class="nm">${s.name}</span>`;
      ab.appendChild(div);
      this.slots.push({ div, cd: div.querySelector('.cd'), cnt: div.querySelector('.cnt'), wasCd: false });
    }
    this.boss(null, null);
    // boutons tactiles aux icônes de la classe
    this.tb = {};
    document.querySelectorAll('#touch .tb').forEach((b) => { this.tb[b.dataset.a] = b; });
    if (this.tb.atk) {
      this.tb.atk.querySelector('span').textContent = d.slots[0].icon;
      this.tb.sec.querySelector('span').textContent = d.slots[1].icon;
      this.tb.spe.querySelector('span').textContent = d.slots[2].icon;
      this.tb.dodge.querySelector('span').textContent = P.clsKey === 'magicien' ? '💨' : '🤸';
    }
  }

  hud(P) {
    const e = this.el;
    const hpP = Math.max(0, P.hp / P.maxHp) * 100;
    e.hpFill.style.width = hpP + '%';
    e.hpGhost.style.width = hpP + '%';
    e.hpText.textContent = `${Math.max(0, Math.ceil(P.hp))} / ${P.maxHp}`;
    if (P.maxMana) {
      e.manaFill.style.width = (P.mana / P.maxMana) * 100 + '%';
      e.manaText.textContent = `${Math.floor(P.mana)} / ${P.maxMana}`;
    }
    e.stFill.style.width = (P.stamina / P.maxStamina) * 100 + '%';
    const x0 = P.xpPrev(), x1 = P.xpNext();
    e.xpFill.style.width = Math.min(100, ((P.xp - x0) / Math.max(1, x1 - x0)) * 100) + '%';
    e.lvl.textContent = P.level;
    e.acv.textContent = P.ac;
    e.goldv.textContent = P.gold;
    // emplacements de capacités
    const s = this.slots;
    if (!s.length) return;
    const setCd = (slot, frac, off, count) => {
      slot.cd.style.setProperty('--p', `${Math.max(0, Math.min(1, frac)) * 100}%`);
      slot.div.classList.toggle('off', !!off);
      slot.cnt.textContent = count ?? '';
      const onCd = frac > 0.001;
      if (slot.wasCd && !onCd) { slot.div.classList.remove('ready'); void slot.div.offsetWidth; slot.div.classList.add('ready'); }
      slot.wasCd = onCd;
    };
    const cls = P.clsKey;
    setCd(s[0], P.state === 'attack' ? 0 : 0, false);
    if (cls === 'magicien') {
      setCd(s[1], P.cd.secondary / P.cdMax.secondary, P.mana < 18);
      setCd(s[2], P.cd.special / P.cdMax.special, P.mana < 35);
    } else if (cls === 'lucas') {
      setCd(s[1], P.cd.secondary / P.cdMax.secondary, P.stamina < 15);
      setCd(s[2], P.cd.special / P.cdMax.special, false);
    } else if (cls === 'roublard') {
      setCd(s[1], P.daggers < 3 ? 1 - P.daggerT / 1.6 : 0, P.daggers <= 0, P.daggers);
      setCd(s[2], P.cd.special / P.cdMax.special, false);
    } else {
      setCd(s[1], 0, P.stamina < 5);
      setCd(s[2], P.cd.special / P.cdMax.special, P.stamina < 20);
    }
    setCd(s[3], 0, P.stamina < 22 + P.bonus.rollCost);
    setCd(s[4], 0, P.potions <= 0, P.potions);
    if (G.touch && this.tb && this.tb.atk) {
      for (const [a, i] of [['sec', 1], ['spe', 2], ['dodge', 3], ['pot', 4]]) {
        const b = this.tb[a];
        b.classList.toggle('off', s[i].div.classList.contains('off'));
        const cd = b.querySelector('.tcd');
        if (cd) cd.style.setProperty('--p', s[i].cd.style.getPropertyValue('--p'));
      }
      this.tb.pot.querySelector('.tcnt').textContent = P.potions;
    }
  }

  flashBar(which) {
    const el = which === 'mana' ? this.el.manaBar : this.el.stBar;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  log(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    this.el.log.appendChild(d);
    while (this.el.log.children.length > 7) this.el.log.removeChild(this.el.log.firstChild);
    setTimeout(() => { d.style.opacity = '0'; }, 7000);
    setTimeout(() => { d.remove(); }, 8200);
  }

  dice(n, crit, fumble) {
    const d = this.el.dice;
    this.el.diceN.textContent = n;
    d.classList.remove('roll', 'crit', 'fumble');
    void d.offsetWidth;
    d.classList.add('show', 'roll');
    if (crit) d.classList.add('crit');
    if (fumble) d.classList.add('fumble');
    clearTimeout(this._diceT);
    this._diceT = setTimeout(() => d.classList.remove('show'), 1600);
  }
  flashCrit() {
    const c = this.el.critflash;
    c.classList.add('show');
    setTimeout(() => c.classList.remove('show'), 60);
  }
  toast(msg) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1800);
  }
  banner(title, sub = '', dur = 3200) {
    this.el.bannerT.textContent = title;
    this.el.bannerS.textContent = sub;
    this.el.banner.classList.add('show');
    clearTimeout(this._banT);
    this._banT = setTimeout(() => this.el.banner.classList.remove('show'), dur);
  }
  prompt(text) {
    const p = this.el.prompt;
    if (this.tb && this.tb.use) this.tb.use.classList.toggle('hidden', !text);
    if (!text) { p.classList.add('hidden'); this._prompt = null; return; }
    if (this._prompt === text) return;
    this._prompt = text;
    p.innerHTML = G.touch ? `✋ ${text}` : `<kbd>E</kbd>${text}`;
    p.classList.remove('hidden');
  }
  boss(name, frac) {
    const b = this.el.boss;
    if (frac === null || frac === undefined) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    if (name) this.el.bossName.textContent = name;
    this.el.bossFill.style.width = frac * 100 + '%';
    this.el.bossGhost.style.width = frac * 100 + '%';
  }
  floorName(n, name) {
    this.el.floorName.innerHTML = `Étage ${n} / ${G.maxFloor}<small>${name}</small>`;
  }

  // ---------------------------------------------------------------- Cartes
  minimap(dt) {
    this.mapT -= dt;
    if (this.mapT > 0) return;
    this.mapT = 0.08;
    const D = G.dungeon, P = G.player, ctx = this.mctx;
    const S = 380, R = 21, cs = S / (R * 2);
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,6,4,0.85)';
    ctx.fillRect(0, 0, S, S);
    ctx.translate(S / 2, S / 2);
    const yaw = G.cam.yaw;
    ctx.rotate(-Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw)));
    const pcx = P.pos.x / 3, pcz = P.pos.z / 3;
    const ci = Math.floor(pcx), cj = Math.floor(pcz);
    for (let j = cj - R - 4; j <= cj + R + 4; j++) for (let i = ci - R - 4; i <= ci + R + 4; i++) {
      if (!D.inb(i, j) || !D.explored[j * D.W + i]) continue;
      const t = D.get(i, j);
      const x = (i - pcx) * cs, y = (j - pcz) * cs;
      if (t === T.WALL) ctx.fillStyle = '#4a3a28';
      else if (t === T.LAVA) ctx.fillStyle = '#c4400c';
      else if (t === T.PIT) ctx.fillStyle = '#3a8cff';
      else ctx.fillStyle = D.roomOf[j * D.W + i] >= 0 ? '#a08a68' : '#857155';
      ctx.fillRect(x, y, cs + 0.6, cs + 0.6);
    }
    const dot = (wx, wz, r, col) => {
      const x = (wx / 3 - pcx) * cs, y = (wz / 3 - pcz) * cs;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const it of G.interactables) {
      if (!D.explored[D.ci(it.pos.z) * D.W + D.ci(it.pos.x)]) continue;
      if (it.prompt === null) continue;
      dot(it.pos.x, it.pos.z, it.constructor.name === 'Stairs' ? 9 : 6, it.constructor.name === 'Chest' ? '#ffd040' : it.constructor.name === 'Stairs' ? '#60b0ff' : '#60e0ff');
    }
    for (const e of G.enemies) {
      if (!e.alive) continue;
      if (!D.explored[D.ci(e.pos.z) * D.W + D.ci(e.pos.x)]) continue;
      if (!e.aware && e.pos.distanceTo(P.pos) > 22) continue;
      dot(e.pos.x, e.pos.z, e.kind === 'dragon' ? 14 : 5, e.aware ? '#ff3020' : '#c06050');
    }
    // joueur
    ctx.save();
    ctx.rotate(-P.yaw + Math.PI);
    ctx.fillStyle = '#fff2c0';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
    ctx.restore();
    // bord
    ctx.strokeStyle = 'rgba(226,183,92,0.7)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.stroke();
    if (!this.el.bigmap.classList.contains('hidden')) this.bigmap();
  }

  bigmap() {
    const D = G.dungeon, P = G.player, ctx = this.bctx;
    const S = 900, cs = S / D.W;
    ctx.clearRect(0, 0, S, S);
    for (let j = 0; j < D.H; j++) for (let i = 0; i < D.W; i++) {
      if (!D.explored[j * D.W + i]) continue;
      const t = D.get(i, j);
      ctx.fillStyle = t === T.WALL ? '#4a3a28' : t === T.LAVA ? '#c4400c' : t === T.PIT ? '#3a8cff' : '#a08a68';
      ctx.fillRect(i * cs, j * cs, cs + 0.5, cs + 0.5);
    }
    for (const it of G.interactables) {
      if (it.prompt === null || !D.explored[D.ci(it.pos.z) * D.W + D.ci(it.pos.x)]) continue;
      ctx.fillStyle = it.constructor.name === 'Chest' ? '#ffd040' : '#60b0ff';
      ctx.beginPath(); ctx.arc(it.pos.x / 3 * cs, it.pos.z / 3 * cs, 7, 0, 7); ctx.fill();
    }
    ctx.save();
    ctx.translate(P.pos.x / 3 * cs, P.pos.z / 3 * cs);
    ctx.rotate(-P.yaw + Math.PI);
    ctx.fillStyle = '#fff2c0';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  toggleBigmap() {
    this.el.bigmap.classList.toggle('hidden');
    if (!this.el.bigmap.classList.contains('hidden')) this.bigmap();
  }

  // ---------------------------------------------------------------- Écrans
  classSelect(onPick) {
    const wrap = $('classCards');
    wrap.innerHTML = '';
    for (const [key, c] of Object.entries(CLASSES)) {
      const card = document.createElement('div');
      card.className = 'card';
      const st = Object.entries(c.stats).map(([k, v]) => `<div>${k}<b>${v}</b><small>${fmtMod(mod(v))}</small></div>`).join('');
      card.innerHTML = `<div class="icon">${c.icon}</div><h3>${c.name}</h3><div class="tag">${c.armor}</div>
        <p>${c.desc}</p><div class="stats">${st}</div>
        <div class="kv"><span>Points de vie</span><b>${c.hp}</b></div>
        <div class="kv"><span>Classe d’armure</span><b>${c.ac}</b></div>
        <div class="kv"><span>Critique</span><b>${c.critMin === 20 ? '20' : c.critMin + '–20'}</b></div>
        ${c.slots.map((s) => `<div class="ab"><span>${s.key}</span> ${s.icon} ${s.name}</div>`).join('')}`;
      card.onclick = () => onPick(key);
      wrap.appendChild(card);
    }
    this.show('classSel');
  }

  levelUp(P, choices, onPick) {
    $('luTitle').textContent = `Niveau ${P.level - P.pendingLevels + 1} !`;
    const wrap = $('boonCards');
    wrap.innerHTML = '';
    for (const b of choices) {
      const card = document.createElement('div');
      card.className = 'card boon';
      card.innerHTML = `<div class="icon">${b.icon}</div><h3>${b.name}</h3><p>${b.desc}</p>`;
      card.onclick = () => onPick(b);
      wrap.appendChild(card);
    }
    this.show('levelup');
  }

  sheet(P) {
    const st = Object.entries(P.stats).map(([k, v]) => `<li><b>${k}</b> ${v} (${fmtMod(mod(v))})${P.def.saves.includes(k) ? ' ★' : ''}</li>`).join('');
    const items = P.items.length ? P.items.map((i) => `<li>${i.icon} <b>${i.name}</b> — ${i.desc}</li>`).join('') : '<li><i>Aucun objet magique</i></li>';
    const boons = P.boons.length ? P.boons.map((id) => { const b = BOONS.find((x) => x.id === id); return `<li>${b.icon} <b>${b.name}</b></li>`; }).join('') : '<li><i>Aucun don</i></li>';
    $('sheetPanel').innerHTML = `
      <h2>${P.def.icon} ${P.def.name} — niveau ${P.level}</h2>
      <div style="color:#a8977a;font-style:italic">${P.def.armor} · Bonus de maîtrise ${fmtMod(P.prof)} · ★ = sauvegarde maîtrisée</div>
      <div class="grid2">
        <div><h4>Caractéristiques</h4><ul>${st}</ul>
          <h4>Combat</h4><ul>
            <li><b>Points de vie</b> ${Math.ceil(P.hp)} / ${P.maxHp}</li>
            <li><b>Classe d’armure</b> ${P.ac}</li>
            <li><b>Bonus d’attaque</b> ${fmtMod(P.atk)}</li>
            <li><b>Dégâts bonus</b> ${fmtMod(P.mainMod + P.bonus.dmg)}</li>
            <li><b>Critique</b> sur ${P.critMin}–20</li>
            ${P.clsKey === 'magicien' ? `<li><b>DD des sorts</b> ${P.spellDC}</li>` : ''}
            ${P.clsKey === 'roublard' ? `<li><b>Attaque sournoise</b> ${P.sneakDice}d6</li>` : ''}
            <li><b>Expérience</b> ${P.xp} / ${P.xpNext()}</li>
          </ul></div>
        <div><h4>Objets magiques</h4><ul>${items}</ul><h4>Dons</h4><ul>${boons}</ul>
          <h4>Inventaire</h4><ul><li>🧪 <b>${P.potions}</b> potion(s) de soins</li><li>💰 <b>${P.gold}</b> pièces d’or</li></ul></div>
      </div>
      <div style="text-align:center;margin-top:16px">${G.touch
        ? '<button class="btn small" id="sheetClose">Fermer</button>'
        : '<span style="color:#8f7d5d;font-style:italic">Appuyez sur Tab (ou cliquez) pour fermer</span>'}</div>`;
    // un toucher / clic n'importe où sur la fiche la ferme
    const opened = performance.now();
    $('sheet').onclick = () => { if (performance.now() - opened > 400 && G.toggleSheet) G.toggleSheet(); };
    this.show('sheet');
  }

  endStats(id, P, extra = []) {
    const t = Math.floor((performance.now() - G.stats.startTime) / 1000);
    const rows = [
      ['Héros', `${P.def.name} niv. ${P.level}`],
      ['Étage atteint', `${G.floor} / ${G.maxFloor}`],
      ['Ennemis vaincus', G.stats.kills],
      ['Coups critiques', G.stats.crits],
      ['Dégâts infligés', G.stats.damage],
      ['Or amassé', `${P.gold} po`],
      ['Durée', `${Math.floor(t / 60)} min ${String(t % 60).padStart(2, '0')} s`],
      ...extra,
    ];
    $(id).innerHTML = rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
  }
}
