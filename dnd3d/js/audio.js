// Sons procéduraux (WebAudio) : effets spatialisés, réverbération de crypte, ambiance, musique de boss.
import { G } from './state.js';

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // réverbération
    this.rev = ctx.createConvolver();
    this.rev.buffer = this.impulse(2.8, 2.6);
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.32;
    this.rev.connect(this.revGain).connect(this.master);
    // bruit blanc partagé
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.dist = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3); }
    this.dist.curve = curve;
    this.startAmbient();
  }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  impulse(dur, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * dur);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }
  // sortie spatialisée : gain + panoramique selon la position monde
  out(pos, vol = 1, revAmt = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let v = vol, pan = 0;
    if (pos && G.camera) {
      const cam = G.camera.position;
      const dx = pos.x - cam.x, dz = pos.z - cam.z;
      const d = Math.hypot(dx, dz);
      v *= 1 / (1 + Math.max(0, d - 4) * 0.12);
      const y = G.cam.yaw;
      const rx = -Math.cos(y), rz = Math.sin(y);
      pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.max(4, d)));
    }
    g.gain.value = v;
    let node = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan * 0.8;
      g.connect(p);
      node = p;
    }
    node.connect(this.master);
    if (revAmt > 0) {
      const rg = ctx.createGain();
      rg.gain.value = revAmt;
      node.connect(rg).connect(this.rev);
    }
    return g;
  }
  env(param, t0, a, peak, dcy, end = 0.0001) {
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(peak, t0 + a);
    param.exponentialRampToValueAtTime(end, t0 + a + dcy);
  }
  noise(dest, { t = 0, dur = 0.2, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, vol = 0.5, a = 0.005 } = {}) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    this.env(g.gain, t0, a, vol, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random());
    src.stop(t0 + a + dur + 0.05);
    return g;
  }
  tone(dest, { t = 0, type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.4, a = 0.005, dist = false } = {}) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
    const g = ctx.createGain();
    this.env(g.gain, t0, a, vol, dur);
    if (dist) {
      const ws = this.ctx.createWaveShaper();
      ws.curve = this.dist.curve;
      o.connect(ws).connect(g);
    } else o.connect(g);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + a + dur + 0.05);
    return o;
  }

  play(name, pos = null, o = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const p = o.pitch || 1;
    const R = Math.random;
    switch (name) {
      case 'swing': { const d = this.out(pos, 0.5, 0.4); this.noise(d, { type: 'bandpass', f0: 600 * p, f1: 2600 * p, q: 1.6, dur: 0.17, vol: 0.5, a: 0.03 }); break; }
      case 'hit': {
        const d = this.out(pos, o.crit ? 1 : 0.8);
        this.tone(d, { type: 'sine', f0: 160 * p, f1: 50, dur: 0.16, vol: 0.9 });
        this.noise(d, { type: 'lowpass', f0: 2400, f1: 300, dur: 0.12, vol: 0.6 });
        if (o.crit) this.tone(d, { type: 'triangle', f0: 900, f1: 1800, dur: 0.18, vol: 0.25, t: 0.02 });
        break;
      }
      case 'bone': {
        const d = this.out(pos, 0.8);
        for (let i = 0; i < 3; i++) this.noise(d, { t: i * 0.035 + R() * 0.02, type: 'bandpass', f0: 2200 + R() * 1500, q: 7, dur: 0.05, vol: 0.7 });
        this.tone(d, { type: 'square', f0: 520, f1: 260, dur: 0.06, vol: 0.12 });
        if (o.crit) this.tone(d, { type: 'triangle', f0: 900, f1: 1800, dur: 0.18, vol: 0.25 });
        break;
      }
      case 'collapse': { const d = this.out(pos, 0.7); for (let i = 0; i < 9; i++) this.noise(d, { t: i * 0.06 + R() * 0.05, type: 'bandpass', f0: 1500 + R() * 2500, q: 8, dur: 0.05, vol: 0.5 }); break; }
      case 'slime': { const d = this.out(pos, 0.6); this.tone(d, { type: 'sine', f0: 220 * p, f1: 90, dur: 0.25, vol: 0.6 }); this.noise(d, { type: 'lowpass', f0: 600, f1: 150, dur: 0.25, vol: 0.4 }); break; }
      case 'splat': { const d = this.out(pos, 0.9); this.noise(d, { type: 'lowpass', f0: 1500, f1: 100, dur: 0.5, vol: 0.9 }); this.tone(d, { f0: 120, f1: 40, dur: 0.4, vol: 0.7 }); break; }
      case 'miss': { const d = this.out(pos, 0.3, 0.3); this.noise(d, { type: 'highpass', f0: 2500, f1: 4000, dur: 0.12, vol: 0.25, a: 0.02 }); break; }
      case 'clink': { const d = this.out(pos, 0.5); for (const f of [1800, 2700, 3900]) this.tone(d, { type: 'sine', f0: f, f1: f * 0.98, dur: 0.25, vol: 0.12 }); break; }
      case 'block': {
        const d = this.out(pos, 0.9);
        for (const f of [420, 1130, 1870, 2650]) this.tone(d, { type: 'sine', f0: f, f1: f * 0.97, dur: 0.45, vol: 0.18 });
        this.noise(d, { type: 'highpass', f0: 3000, dur: 0.06, vol: 0.5 });
        break;
      }
      case 'parry': {
        const d = this.out(pos, 1);
        for (const f of [880, 1320, 1980, 2970, 3960]) this.tone(d, { type: 'sine', f0: f, f1: f * 1.01, dur: 0.9, vol: 0.14 });
        this.noise(d, { type: 'highpass', f0: 4000, dur: 0.08, vol: 0.7 });
        break;
      }
      case 'shieldUp': { const d = this.out(pos, 0.3); this.noise(d, { type: 'bandpass', f0: 900, q: 3, dur: 0.08, vol: 0.4 }); break; }
      case 'hurt': { const d = this.out(null, 0.7, 0.3); this.tone(d, { type: 'sawtooth', f0: 240, f1: 110, dur: 0.22, vol: 0.25, dist: true }); this.noise(d, { type: 'lowpass', f0: 1500, f1: 200, dur: 0.15, vol: 0.6 }); break; }
      case 'roll': { const d = this.out(pos, 0.5, 0.3); this.noise(d, { type: 'lowpass', f0: 700, f1: 200, dur: 0.32, vol: 0.5, a: 0.04 }); break; }
      case 'blink': { const d = this.out(pos, 0.5); this.tone(d, { type: 'sine', f0: 400, f1: 1600, dur: 0.2, vol: 0.25 }); this.noise(d, { type: 'bandpass', f0: 3000, f1: 800, q: 2, dur: 0.25, vol: 0.3 }); break; }
      case 'step': { const d = this.out(null, 0.12 * (o.vol || 1), 0.4); this.noise(d, { type: 'lowpass', f0: 380 + R() * 150, f1: 140, dur: 0.07, vol: 0.6 }); break; }
      case 'stomp': { const d = this.out(pos, 1); this.tone(d, { f0: 70, f1: 30, dur: 0.35, vol: 0.9 }); this.noise(d, { type: 'lowpass', f0: 300, f1: 60, dur: 0.3, vol: 0.7 }); break; }
      case 'coin': { const d = this.out(null, 0.4); this.tone(d, { type: 'triangle', f0: 1318, dur: 0.09, vol: 0.3 }); this.tone(d, { type: 'triangle', f0: 1976, dur: 0.18, vol: 0.25, t: 0.07 }); break; }
      case 'pickup': { const d = this.out(null, 0.4); this.tone(d, { type: 'sine', f0: 660, f1: 990, dur: 0.15, vol: 0.4 }); break; }
      case 'potion': {
        const d = this.out(null, 0.5);
        for (let i = 0; i < 6; i++) this.tone(d, { t: i * 0.06, type: 'sine', f0: 300 + R() * 500, f1: 700 + R() * 600, dur: 0.05, vol: 0.25 });
        this.tone(d, { t: 0.42, type: 'sine', f0: 523, f1: 1046, dur: 0.4, vol: 0.2 });
        break;
      }
      case 'levelup': {
        const d = this.out(null, 0.7);
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(d, { t: i * 0.09, type: 'triangle', f0: f, dur: 0.6, vol: 0.25 }));
        this.noise(d, { t: 0.3, type: 'highpass', f0: 6000, dur: 0.8, vol: 0.12, a: 0.2 });
        break;
      }
      case 'item': { const d = this.out(null, 0.6); [392, 523, 659, 784].forEach((f, i) => this.tone(d, { t: i * 0.11, type: 'sine', f0: f, dur: 0.7, vol: 0.22 })); break; }
      case 'firebolt': { const d = this.out(pos, 0.6); this.noise(d, { type: 'bandpass', f0: 500, f1: 3000, q: 1, dur: 0.25, vol: 0.6, a: 0.02 }); this.tone(d, { f0: 200, f1: 600, dur: 0.2, vol: 0.2 }); break; }
      case 'fireHit': { const d = this.out(pos, 0.7); this.noise(d, { type: 'lowpass', f0: 2000, f1: 200, dur: 0.3, vol: 0.7 }); break; }
      case 'charge': { const d = this.out(pos, 0.5); this.noise(d, { type: 'bandpass', f0: 200, f1: 1800, q: 3, dur: 0.6, vol: 0.4, a: 0.3 }); break; }
      case 'fireball': { const d = this.out(pos, 0.8); this.noise(d, { type: 'bandpass', f0: 300, f1: 1500, q: 0.8, dur: 0.5, vol: 0.8, a: 0.03 }); break; }
      case 'explode': {
        const d = this.out(pos, 1.2);
        this.noise(d, { type: 'lowpass', f0: 3000, f1: 80, dur: 1.1, vol: 1, a: 0.005 });
        this.tone(d, { f0: 90, f1: 28, dur: 0.9, vol: 1 });
        this.noise(d, { t: 0.05, type: 'bandpass', f0: 800, f1: 200, q: 0.7, dur: 1.4, vol: 0.4, a: 0.05 });
        break;
      }
      case 'missile': { const d = this.out(pos, 0.5); [880, 1175, 1568].forEach((f, i) => this.tone(d, { t: i * 0.05, type: 'sine', f0: f, f1: f * 1.5, dur: 0.3, vol: 0.18 })); break; }
      case 'throw': { const d = this.out(pos, 0.4, 0.3); this.noise(d, { type: 'bandpass', f0: 1500, f1: 3500, q: 2, dur: 0.12, vol: 0.5 }); break; }
      case 'shadow': { const d = this.out(pos, 0.6); this.noise(d, { type: 'bandpass', f0: 3000, f1: 300, q: 1.5, dur: 0.4, vol: 0.6, a: 0.1 }); this.tone(d, { f0: 300, f1: 80, dur: 0.4, vol: 0.3 }); break; }
      case 'spin': { const d = this.out(pos, 0.6); this.noise(d, { type: 'bandpass', f0: 500, f1: 2500, q: 1.4, dur: 0.6, vol: 0.6, a: 0.1 }); break; }
      case 'arrow': { const d = this.out(pos, 0.5); this.noise(d, { type: 'highpass', f0: 1800, f1: 3500, dur: 0.18, vol: 0.4, a: 0.01 }); this.tone(d, { type: 'triangle', f0: 180, f1: 90, dur: 0.1, vol: 0.3 }); break; }
      case 'bowDraw': { const d = this.out(pos, 0.3); this.noise(d, { type: 'bandpass', f0: 400, f1: 900, q: 6, dur: 0.6, vol: 0.25, a: 0.3 }); break; }
      case 'windup': { const d = this.out(pos, 0.3); this.noise(d, { type: 'bandpass', f0: 300 * p, f1: 700 * p, q: 2, dur: 0.3, vol: 0.3, a: 0.1 }); break; }
      case 'slam': { const d = this.out(pos, 1); this.tone(d, { f0: 110, f1: 35, dur: 0.5, vol: 1 }); this.noise(d, { type: 'lowpass', f0: 1200, f1: 80, dur: 0.5, vol: 0.9 }); break; }
      case 'chest': {
        const d = this.out(pos, 0.7);
        this.tone(d, { type: 'sawtooth', f0: 90, f1: 150, dur: 0.5, vol: 0.12, a: 0.1 });
        this.noise(d, { t: 0.45, type: 'lowpass', f0: 800, f1: 100, dur: 0.15, vol: 0.6 });
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(d, { t: 0.5 + i * 0.07, type: 'triangle', f0: f, dur: 0.4, vol: 0.15 }));
        break;
      }
      case 'shrine': { const d = this.out(pos, 0.7); [261, 329, 392, 523, 659].forEach((f, i) => this.tone(d, { t: i * 0.12, type: 'sine', f0: f, dur: 1.4, vol: 0.18, a: 0.05 })); break; }
      case 'trapClick': { const d = this.out(pos, 0.5); this.tone(d, { type: 'square', f0: 1400, f1: 1200, dur: 0.03, vol: 0.2 }); this.tone(d, { t: 0.2, type: 'square', f0: 1400, f1: 1200, dur: 0.03, vol: 0.2 }); break; }
      case 'trap': { const d = this.out(pos, 0.8); this.noise(d, { type: 'highpass', f0: 2500, f1: 6000, dur: 0.15, vol: 0.6 }); this.tone(d, { type: 'sawtooth', f0: 1500, f1: 700, dur: 0.1, vol: 0.15 }); break; }
      case 'alert': case 'grunt': { const d = this.out(pos, 0.5); this.tone(d, { type: 'sawtooth', f0: (name === 'grunt' ? 180 : 500) * p, f1: (name === 'grunt' ? 120 : 700) * p, dur: 0.18, vol: 0.18, dist: true }); break; }
      case 'rattle': { const d = this.out(pos, 0.5); for (let i = 0; i < 6; i++) this.noise(d, { t: i * 0.04, type: 'bandpass', f0: 2500 + R() * 1500, q: 9, dur: 0.035, vol: 0.4 }); break; }
      case 'enemyDie': { const d = this.out(pos, 0.6); this.tone(d, { type: 'sawtooth', f0: 320 * p, f1: 70 * p, dur: 0.5, vol: 0.2, dist: true }); break; }
      case 'death': {
        const d = this.out(null, 0.8);
        this.tone(d, { type: 'sawtooth', f0: 220, f1: 40, dur: 1.8, vol: 0.3, dist: true });
        [392, 311, 261, 196].forEach((f, i) => this.tone(d, { t: 0.4 + i * 0.35, type: 'triangle', f0: f, dur: 0.9, vol: 0.2 }));
        break;
      }
      case 'stairs': { const d = this.out(null, 0.6); this.noise(d, { type: 'lowpass', f0: 1200, f1: 100, dur: 1.4, vol: 0.5, a: 0.3 }); this.tone(d, { f0: 120, f1: 50, dur: 1.4, vol: 0.4 }); break; }
      case 'fart': {
        const d = this.out(pos, 1.1, 0.6);
        let f = 95 + R() * 30;
        for (let i = 0; i < 14; i++) {
          f *= 0.96 + R() * 0.06;
          this.tone(d, { t: i * 0.045, type: 'sawtooth', f0: f, f1: f * 0.85, dur: 0.05, vol: 0.35 - i * 0.015, dist: true });
        }
        this.noise(d, { type: 'lowpass', f0: 500, f1: 120, q: 2, dur: 0.75, vol: 0.5, a: 0.02 });
        this.tone(d, { t: 0.62, type: 'sawtooth', f0: 160, f1: 260, dur: 0.12, vol: 0.2, dist: true });
        break;
      }
      case 'burp': {
        const d = this.out(pos, 0.9, 0.5);
        for (let i = 0; i < 9; i++) this.tone(d, { t: i * 0.05, type: 'sawtooth', f0: 120 - i * 4 + R() * 10, f1: 90 - i * 3, dur: 0.06, vol: 0.3, dist: true });
        this.noise(d, { type: 'bandpass', f0: 300, f1: 180, q: 3, dur: 0.5, vol: 0.4 });
        break;
      }
      case 'booger': { const d = this.out(pos, 0.5, 0.2); this.tone(d, { type: 'square', f0: 700, f1: 250, dur: 0.06, vol: 0.15 }); this.noise(d, { type: 'bandpass', f0: 1800, f1: 900, q: 2, dur: 0.06, vol: 0.3 }); break; }
      case 'splatSmall': { const d = this.out(pos, 0.6); this.noise(d, { type: 'lowpass', f0: 1200, f1: 200, dur: 0.15, vol: 0.6 }); this.tone(d, { f0: 300, f1: 90, dur: 0.1, vol: 0.3 }); break; }
      case 'ui': { const d = this.out(null, 0.3, 0); this.tone(d, { type: 'sine', f0: 660, f1: 880, dur: 0.06, vol: 0.2 }); break; }
      case 'growl': { const d = this.out(pos, 0.9); this.tone(d, { type: 'sawtooth', f0: 80, f1: 60, dur: 0.6, vol: 0.4, dist: true, a: 0.08 }); this.noise(d, { type: 'lowpass', f0: 500, f1: 200, dur: 0.6, vol: 0.4, a: 0.08 }); break; }
      case 'bite': { const d = this.out(pos, 1); this.noise(d, { type: 'lowpass', f0: 2500, f1: 200, dur: 0.15, vol: 0.9 }); this.tone(d, { f0: 150, f1: 50, dur: 0.2, vol: 0.8 }); break; }
      case 'whoosh': { const d = this.out(pos, 1); this.noise(d, { type: 'bandpass', f0: 200, f1: 1200, q: 0.8, dur: 0.5, vol: 0.9, a: 0.1 }); break; }
      case 'inhale': { const d = this.out(pos, 0.8); this.noise(d, { type: 'bandpass', f0: 300, f1: 2000, q: 1.5, dur: 1.1, vol: 0.5, a: 0.9 }); break; }
      case 'breath': {
        const d = this.out(pos, 1.1);
        const dur = o.dur || 2.2;
        this.noise(d, { type: 'lowpass', f0: 1800, f1: 600, q: 0.5, dur, vol: 0.9, a: 0.08 });
        this.noise(d, { type: 'bandpass', f0: 400, f1: 250, q: 0.7, dur, vol: 0.6, a: 0.1 });
        break;
      }
      case 'roar': {
        const d = this.out(pos, 1.3);
        for (const f of [62, 83, 97, 124]) this.tone(d, { type: 'sawtooth', f0: f * p * 1.3, f1: f * p * 0.8, dur: 2.2, vol: 0.22, a: 0.15, dist: true });
        this.noise(d, { type: 'bandpass', f0: 700, f1: 300, q: 0.8, dur: 2.2, vol: 0.7, a: 0.15 });
        break;
      }
    }
  }

  // ---- Ambiance
  startAmbient() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    for (const fr of [55, 55.6, 82.4]) {
      const o = ctx.createOscillator();
      o.type = fr === 82.4 ? 'triangle' : 'sawtooth';
      o.frequency.value = fr;
      o.connect(f);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 120;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
    f.connect(g).connect(this.master);
    this.ambGain = g;
    // vent
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 380;
    wf.Q.value = 0.8;
    const wg = ctx.createGain();
    wg.gain.value = 0.025;
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.11;
    const wlg = ctx.createGain();
    wlg.gain.value = 0.02;
    wl.connect(wlg).connect(wg.gain);
    wl.start();
    src.connect(wf).connect(wg).connect(this.master);
    src.start();
    // gouttes d'eau
    const drip = () => {
      if (!this.ctx) return;
      const d = this.out(null, 0.12, 2.5);
      const f0 = 1200 + Math.random() * 1200;
      this.tone(d, { type: 'sine', f0, f1: f0 * 0.45, dur: 0.07, vol: 0.5 });
      setTimeout(drip, 1500 + Math.random() * 5000);
    };
    setTimeout(drip, 2000);
  }

  bossMusic(on) {
    if (!this.ctx) return;
    if (!on) { this.bossOn = false; return; }
    if (this.bossOn) return;
    this.bossOn = true;
    const beat = 0.5;
    let n = 0;
    const tick = () => {
      if (!this.bossOn || !this.ctx) return;
      const d = this.out(null, 0.5, 0.6);
      const accent = n % 4 === 0;
      this.tone(d, { type: 'sine', f0: accent ? 75 : 60, f1: 32, dur: 0.35, vol: accent ? 0.9 : 0.55 });
      if (n % 8 === 4) this.noise(d, { type: 'bandpass', f0: 180, q: 1, dur: 0.25, vol: 0.4 });
      if (n % 16 === 0) for (const f of [73.4, 87.3, 103.8]) this.tone(d, { type: 'sawtooth', f0: f, f1: f * 0.99, dur: beat * 7.5, vol: 0.05, a: 0.5 });
      n++;
      setTimeout(tick, beat * 1000);
    };
    tick();
  }
}
