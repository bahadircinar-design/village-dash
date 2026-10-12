// The runaway pup: low-poly procedural model + street-graph AI.
// The pup is never hurt: the bike gently auto-brakes near it and a catch is a
// friendly "got you" moment.
import * as THREE from '../vendor/three.module.js';
import { clamp, damp, wrapAngle } from './util.js';

const BROWN = 0xa0612e, DARK = 0x6b3d1c, WHITE = 0xf6f1e8;

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}

export class Dog {
  constructor(world, cfg, rng) {
    this.world = world; this.cfg = cfg; this.rng = rng;
    this.root = new THREE.Group();
    this.build();
    this.state = 'wait';
    this.stamina = cfg.stamina; this.maxStamina = cfg.stamina;
    this.speed = 0; this.phase = 0; this.time = 0; this.barkT = 1; this.wag = 0; this.hop = 0;
    this.goingHome = false; this.path = null; this.corneredT = 0; this.waitT = 0;
    this.events = []; this.runT = 0;
    this.heading = 0; this.rx = 0; this.rz = 0; this.vx = 0; this.vz = 0;
  }
  build() {
    const g = new THREE.Group(); this.model = g; this.root.add(g);
    const body = new THREE.Group(); this.body = body; g.add(body);
    body.add(box(0.32, 0.3, 0.74, BROWN, 0, 0.56, 0));
    body.add(box(0.27, 0.14, 0.52, WHITE, 0, 0.44, 0.06));
    body.add(box(0.28, 0.28, 0.16, WHITE, 0, 0.58, 0.33));
    body.add(box(0.33, 0.08, 0.2, 0xd8322a, 0, 0.7, 0.33)); // collar
    body.add(box(0.06, 0.06, 0.04, 0xf2c94c, 0, 0.64, 0.44)); // tag
    const head = new THREE.Group(); head.position.set(0, 0.78, 0.4); this.head = head; body.add(head);
    head.add(box(0.27, 0.25, 0.28, BROWN, 0, 0, 0));
    head.add(box(0.08, 0.2, 0.02, WHITE, 0, 0.02, 0.145)); // blaze
    head.add(box(0.16, 0.12, 0.2, WHITE, 0, -0.05, 0.2));
    head.add(box(0.07, 0.05, 0.04, 0x1a1a1a, 0, -0.01, 0.31));
    head.add(box(0.04, 0.04, 0.02, 0x1a1a1a, 0.075, 0.05, 0.145));
    head.add(box(0.04, 0.04, 0.02, 0x1a1a1a, -0.075, 0.05, 0.145));
    this.tongue = box(0.06, 0.02, 0.09, 0xe86a7a, 0, -0.11, 0.24); head.add(this.tongue);
    this.ears = [];
    for (const s of [-1, 1]) {
      const ep = new THREE.Group(); ep.position.set(0.12 * s, 0.11, -0.03); head.add(ep);
      ep.add(box(0.07, 0.17, 0.11, DARK, 0.02 * s, -0.07, 0));
      ep.rotation.z = 0.5 * s; this.ears.push(ep);
    }
    this.legs = [];
    for (const [x, z, front] of [[0.11, 0.27, 1], [-0.11, 0.27, 1], [0.11, -0.27, 0], [-0.11, -0.27, 0]]) {
      const p = new THREE.Group(); p.position.set(x, 0.5, z); body.add(p);
      p.add(box(0.09, 0.26, 0.1, BROWN, 0, -0.12, 0));
      p.add(box(0.085, 0.24, 0.09, front ? WHITE : BROWN, 0, -0.36, 0.01));
      p.add(box(0.09, 0.05, 0.13, WHITE, 0, -0.48, 0.03));
      this.legs.push({ p, front, side: x > 0 ? 1 : -1 });
    }
    const tail = new THREE.Group(); tail.position.set(0, 0.64, -0.36); this.tail = tail; body.add(tail);
    tail.add(box(0.06, 0.06, 0.34, BROWN, 0, 0, -0.16));
    tail.add(box(0.065, 0.065, 0.08, WHITE, 0, 0, -0.34));
    g.scale.setScalar(1.2);
  }
  place(fromId, toId, edge, s) {
    const n = this.world.nodes;
    this.from = fromId; this.to = toId; this.edge = edge; this.s = s;
    const A = n[fromId], B = n[toId];
    const t = s / edge.len;
    this.x = A.x + (B.x - A.x) * t; this.z = A.z + (B.z - A.z) * t;
    this.rx = this.x; this.rz = this.z;
    this.heading = Math.atan2(B.x - A.x, B.z - A.z);
  }
  start() { this.state = 'run'; this.bark(); }
  bark() { this.events.push('bark'); this.barkT = 1.5 + this.rng() * 2; }
  say(msg) { this.events.push('msg:' + msg); }

  chooseNext(atId, prevId, bx, bz) {
    const nodes = this.world.nodes, n = nodes[atId], rng = this.rng, cfg = this.cfg;
    if (this.goingHome && this.path && this.path.length) {
      const nxt = this.path.shift();
      const a = n.adj.find((q) => q.to === nxt);
      if (a) return a;
    }
    const bd = Math.hypot(bx - n.x, bz - n.z);
    let opts = n.adj.filter((a) => a.to !== prevId && !a.e.red);
    opts = opts.filter((a) => a.e.kind !== 'stub' || (rng() < cfg.deadEnd && bd > 20 && this.runT > 8));
    if (!opts.length) opts = n.adj.filter((a) => !a.e.red && a.e.kind !== 'stub');
    if (!opts.length) opts = n.adj.filter((a) => !a.e.red);
    if (!opts.length) opts = n.adj.slice();
    let best = null, bs = -1e9;
    for (const a of opts) {
      const T = nodes[a.to];
      let sc = Math.hypot(bx - T.x, bz - T.z) - bd;
      const ex = (T.x - n.x) / a.e.len, ez = (T.z - n.z) / a.e.len;
      const tbx = (bx - n.x) / (bd || 1), tbz = (bz - n.z) / (bd || 1);
      if (ex * tbx + ez * tbz > 0.7 && bd < 22) sc -= 30;
      if (a.e.narrow && bd < 20) sc += 6;
      if (a.e.kind === 'field') sc += 4;
      if (a.to === prevId) sc -= 15;
      sc += rng() * cfg.erratic * 34;
      if (sc > bs) { bs = sc; best = a; }
    }
    return best;
  }
  planHome() {
    const nodes = this.world.nodes, goal = this.world.redCar.node;
    const prev = new Map([[this.to, -1]]); const q = [this.to];
    while (q.length) {
      const v = q.shift(); if (v === goal) break;
      for (const a of nodes[v].adj) if (!prev.has(a.to)) { prev.set(a.to, v); q.push(a.to); }
    }
    const path = []; let v = goal;
    while (v !== undefined && v !== -1 && v !== this.to) { path.unshift(v); v = prev.get(v); }
    this.path = path;
  }
  advanceEdge(next) {
    const nodes = this.world.nodes;
    this.from = this.to; this.to = next.to; this.edge = next.e; this.s = 0;
    void nodes;
  }

  update(dt, bike) {
    this.time += dt;
    const cfg = this.cfg, nodes = this.world.nodes;
    const bx = bike.x, bz = bike.z;
    const dist = Math.hypot(bx - this.x, bz - this.z);
    this.dist = dist;
    let targetSpeed = 0;
    this.barkT -= dt;

    switch (this.state) {
      case 'wait': this.wag = 1; break;
      case 'caught': this.wag = 1; break;
      case 'run': {
        this.runT += dt;
        if (dist > 46) { this.state = 'rest'; this.bark(); this.say('The pup stopped to wait for you. It wants to play!'); break; }
        const close = dist < 14;
        const tired = this.stamina < this.maxStamina * 0.3;
        targetSpeed = cfg.speed * (close ? cfg.sprint : 1) * (tired ? 0.82 : 1) * (dist > 30 ? 0.85 : 1) * (this.goingHome ? 0.85 : 1);
        this.stamina -= (close ? 2.0 : 0.75) * dt;
        if (this.stamina <= 0 && !this.goingHome) {
          this.goingHome = true; this.planHome();
          this.say('The pup is tired. It is heading for a hiding spot!');
        }
        if (close && this.barkT < 0) this.bark();
        this.wag = 0.4;
        break;
      }
      case 'rest': {
        this.stamina = Math.min(this.maxStamina, this.stamina + 0.35 * dt);
        if (this.barkT < 0) this.bark();
        this.wag = 1;
        if (dist < 24) { this.state = 'run'; this.bark(); }
        break;
      }
      case 'deadend': {
        this.waitT -= dt; this.wag = 0.6;
        if (this.inCorridor(bx, bz)) { this.state = 'cornered'; this.corneredT = 0; this.bark(); this.say('Cornered! Ease in gently...'); break; }
        if (this.waitT <= 0) {
          const J = this.edge.a === this.to ? this.edge.b : this.edge.a;
          const back = nodes[this.to].adj.find((a) => a.to === J);
          this.advanceEdge(back); this.state = 'run';
        }
        break;
      }
      case 'cornered': {
        this.corneredT += dt; this.wag = 1;
        if (!this.inCorridor(bx, bz, 1.2)) { this.state = 'deadend'; this.waitT = 0.4; }
        break;
      }
      case 'hiding': this.wag = 0.8; if (this.barkT < 0 && dist < 30) this.bark(); break;
    }

    this.speed = damp(this.speed, targetSpeed, targetSpeed > this.speed ? 3.5 : 6, dt);
    if (this.state === 'run') {
      this.s += this.speed * dt;
      let guard = 0;
      while (this.s >= this.edge.len && guard++ < 4) {
        const over = this.s - this.edge.len;
        const at = nodes[this.to];
        if (at.kind === 'red' && this.goingHome) { this.s = this.edge.len; this.state = 'hiding'; this.say('The pup is hiding under the red car! Go get it.'); this.bark(); break; }
        if (at.kind === 'stub') { this.s = this.edge.len; this.state = 'deadend'; this.waitT = 1.6 + this.rng() * 1.8; break; }
        const next = this.chooseNext(this.to, this.from, bx, bz);
        this.advanceEdge(next); this.s = over;
      }
    }
    // logical position
    const A = nodes[this.from], Bn = nodes[this.to];
    const t = clamp(this.s / this.edge.len, 0, 1);
    const ex = (Bn.x - A.x) / this.edge.len, ez = (Bn.z - A.z) / this.edge.len;
    const endFade = Math.min(this.s, this.edge.len - this.s, 3) / 3;
    const weave = this.state === 'run' ? Math.sin(this.time * 1.9) * 0.35 * endFade * this.cfg.erratic * 1.6 : 0;
    this.x = A.x + (Bn.x - A.x) * t + ez * weave; this.z = A.z + (Bn.z - A.z) * t - ex * weave;
    // smoothed render position cuts corners naturally
    const px = this.rx, pz = this.rz;
    this.rx = damp(this.rx, this.x, 9, dt); this.rz = damp(this.rz, this.z, 9, dt);
    this.vx = (this.rx - px) / Math.max(dt, 1e-4); this.vz = (this.rz - pz) / Math.max(dt, 1e-4);
    const mv = Math.hypot(this.vx, this.vz);
    let wantH = this.heading;
    if (mv > 0.6) wantH = Math.atan2(this.vx, this.vz);
    else wantH = Math.atan2(bx - this.rx, bz - this.rz); // face the rider
    this.heading += wrapAngle(wantH - this.heading) * (1 - Math.exp(-10 * dt));
    this.animate(dt, mv);
  }
  inCorridor(bx, bz, extra = 0) {
    const nodes = this.world.nodes, e = this.edge;
    const D = nodes[this.to], J = nodes[e.a === this.to ? e.b : e.a];
    const L = e.len, dx = (D.x - J.x) / L, dz = (D.z - J.z) / L;
    const t = ((bx - J.x) * dx + (bz - J.z) * dz) / L;
    const lat = Math.abs((bx - J.x) * dz - (bz - J.z) * dx);
    return t > -0.15 - extra * 0.2 && t < 1.05 && lat < e.w / 2 + 0.9 + extra;
  }
  animate(dt, mv) {
    const st = this.state;
    const run = st === 'run' && mv > 0.5;
    this.phase += dt * (run ? 4.5 + mv * 0.75 : 0);
    const amp = run ? clamp(mv / 6, 0.3, 1) : 0;
    const sit = st === 'rest' || st === 'wait' || st === 'caught' || st === 'cornered' || st === 'deadend';
    const crouch = st === 'hiding';
    for (const L of this.legs) {
      const off = L.front ? 0 : Math.PI * 0.85;
      const sideOff = L.side > 0 ? 0 : 0.35;
      let r = Math.sin(this.phase + off + sideOff) * 0.95 * amp;
      if (sit && !L.front) r = -1.25;
      if (sit && L.front) r = 0.08;
      if (crouch) r = L.front ? -1.35 : 1.35;
      L.p.rotation.x = damp(L.p.rotation.x, r, 18, dt);
    }
    const bob = run ? Math.abs(Math.sin(this.phase)) * 0.07 * amp : 0;
    const bodyY = crouch ? -0.34 : sit ? -0.12 : bob;
    const bodyPitch = sit ? -0.45 : crouch ? 0 : Math.sin(this.phase * 2) * 0.06 * amp;
    this.body.position.y = damp(this.body.position.y, bodyY, 12, dt);
    this.body.position.z = damp(this.body.position.z, sit ? -0.1 : 0, 10, dt);
    this.body.rotation.x = damp(this.body.rotation.x, bodyPitch, 10, dt);
    this.head.rotation.x = sit ? 0.35 + Math.sin(this.time * 3) * 0.05 : Math.sin(this.phase) * 0.1 * amp;
    this.head.rotation.z = st === 'caught' || st === 'wait' ? Math.sin(this.time * 2.2) * 0.18 : 0;
    const wagSpd = 10 + this.wag * 12;
    this.tail.rotation.y = Math.sin(this.time * wagSpd) * (0.3 + this.wag * 0.5);
    this.tail.rotation.x = run ? -0.25 : -0.7;
    for (const e of this.ears) e.rotation.x = run ? -0.5 - Math.sin(this.phase) * 0.25 : 0;
    this.tongue.visible = st !== 'hiding';
    this.hop = Math.max(0, this.hop - dt * 2.5);
    const hy = Math.sin(this.hop * Math.PI) * 0.35;
    this.root.position.set(this.rx, this.world.heightAt(this.rx, this.rz) + hy, this.rz);
    this.root.rotation.y = this.heading;
  }
  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}
