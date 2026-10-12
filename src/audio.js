// All sound is synthesized live with WebAudio: motor whine, skids, dirt crunch,
// bumps, barks, and a procedural upbeat electronic loop. No audio files.
export class AudioEngine {
  constructor() { this.ctx = null; this.muted = localStorage.getItem('vd.muted') === '1'; this.musicOn = false; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    // noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    // motor: electric whine (two sines + a soft saw hum)
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    const mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 2400;
    this.motorGain.connect(mlp); mlp.connect(this.sfx);
    this.o1 = ctx.createOscillator(); this.o1.type = 'sine';
    this.o2 = ctx.createOscillator(); this.o2.type = 'triangle';
    this.o3 = ctx.createOscillator(); this.o3.type = 'sawtooth';
    const g3 = ctx.createGain(); g3.gain.value = 0.25; const g2 = ctx.createGain(); g2.gain.value = 0.45;
    this.o1.connect(this.motorGain); this.o2.connect(g2); g2.connect(this.motorGain); this.o3.connect(g3); g3.connect(this.motorGain);
    [this.o1, this.o2, this.o3].forEach((o) => o.start());
    // looping noise beds: skid + dirt crunch
    const loopNoise = (type, f, q) => {
      const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; src.connect(flt); flt.connect(g); g.connect(this.sfx); src.start();
      return { g, flt };
    };
    this.skid = loopNoise('bandpass', 1500, 2.5);
    this.dirt = loopNoise('lowpass', 520, 0.8);
    this.wind = loopNoise('highpass', 900, 0.5);
    this.nextStep = 0; this.step = 0;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  setMuted(m) {
    this.muted = m; localStorage.setItem('vd.muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sp = s.speed;
    const active = s.active ? 1 : 0;
    this.o1.frequency.setTargetAtTime(180 + sp * 52, t, 0.05);
    this.o2.frequency.setTargetAtTime(360 + sp * 104, t, 0.05);
    this.o3.frequency.setTargetAtTime(48 + sp * 6, t, 0.05);
    this.motorGain.gain.setTargetAtTime(active * (0.015 + s.throttle * 0.05 + Math.min(sp, 16) * 0.0025), t, 0.06);
    this.skid.g.gain.setTargetAtTime(active * Math.min(0.35, s.skid * 0.08), t, 0.04);
    this.skid.flt.frequency.setTargetAtTime(s.onDirt ? 700 : 1500, t, 0.1);
    this.dirt.g.gain.setTargetAtTime(active * (s.onDirt ? Math.min(0.5, sp * 0.035) : 0), t, 0.08);
    this.dirt.flt.frequency.setTargetAtTime(380 + Math.random() * 400, t, 0.03);
    this.wind.g.gain.setTargetAtTime(active * Math.min(0.08, sp * sp * 0.0003), t, 0.2);
  }
  bump(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, a = Math.min(1, strength / 9);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    g.gain.setValueAtTime(0.6 * a + 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.3);
    const n = ctx.createBufferSource(); n.buffer = this.noise; const ng = ctx.createGain(); const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    ng.gain.setValueAtTime(0.4 * a, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(f); f.connect(ng); ng.connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.2);
  }
  bark(dist = 10) {
    if (!this.ctx) return;
    const ctx = this.ctx, vol = Math.max(0.08, Math.min(0.55, 6 / (dist + 3)));
    const woof = (t0, pitch) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
      const g = ctx.createGain();
      o.frequency.setValueAtTime(pitch * 1.25, t0); o.frequency.exponentialRampToValueAtTime(pitch * 0.62, t0 + 0.14);
      f.frequency.setValueAtTime(1300, t0); f.frequency.exponentialRampToValueAtTime(600, t0 + 0.14);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
      o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t0); o.stop(t0 + 0.2);
    };
    const t = ctx.currentTime, p = 420 + Math.random() * 120;
    woof(t, p); if (Math.random() < 0.7) woof(t + 0.2, p * 1.05);
  }
  jingle() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.11); g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.11 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.11 + 0.4);
      o.frequency.value = f; o.connect(g); g.connect(this.sfx); o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.45);
    });
  }
  setMusic(on) {
    this.musicOn = on;
    if (this.ctx && on) this.nextStep = Math.max(this.nextStep, this.ctx.currentTime + 0.05);
  }
  // ---- procedural loop: 124 bpm, kick / hat / clap / bass arp / pluck ----
  schedule() {
    if (!this.ctx || !this.musicOn) return;
    const ctx = this.ctx, spb = 60 / 124 / 4;
    while (this.nextStep < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextStep);
      this.nextStep += spb; this.step = (this.step + 1) % 64;
    }
  }
  playStep(step, t) {
    const ctx = this.ctx, s = step % 16, bar = Math.floor(step / 16);
    const roots = [57, 53, 48, 55]; // A F C G (MIDI)
    const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
    if (s % 4 === 0) { // kick
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.25);
    }
    if (s % 2 === 1 || s % 4 === 2) { // hats
      const n = ctx.createBufferSource(); n.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ctx.createGain(); const v = s % 4 === 2 ? 0.22 : 0.09;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(f); f.connect(g); g.connect(this.music); n.start(t, Math.random() * 1.5); n.stop(t + 0.06);
    }
    if (s === 4 || s === 12) { // clap
      const n = ctx.createBufferSource(); n.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      n.connect(f); f.connect(g); g.connect(this.music); n.start(t, Math.random()); n.stop(t + 0.15);
    }
    // bass arpeggio
    const root = roots[bar] - 12;
    const arp = [0, 12, 7, 12, 0, 12, 10, 12, 0, 12, 7, 12, 3, 12, 7, 15];
    {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
      const g = ctx.createGain();
      o.frequency.value = mf(root + arp[s]);
      f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.11);
      g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(f); f.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.13);
    }
    // pluck melody (pentatonic, fixed pattern so it's catchy)
    const mel = [12, -1, 15, -1, 19, -1, 17, 15, -1, 12, -1, 10, 12, -1, -1, 7];
    const m = mel[(s + bar * 3) % 16];
    if (m >= 0 && step % 2 === 0) {
      const o = ctx.createOscillator(); o.type = 'square'; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
      const g = ctx.createGain(); o.frequency.value = mf(57 + m);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(f); f.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.25);
    }
  }
}
