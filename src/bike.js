// Arcade electric dirt-bike physics + the first-person handlebar rig.
import * as THREE from '../vendor/three.module.js';
import { clamp, damp, lerp } from './util.js';
import { PAVE, DIRT, GRASS } from './world.js';

const SURF = {
  [PAVE]: { grip: 11, max: 16.5, accel: 9.5, drag: 0.22, bump: 0.15, name: 'pavement' },
  [DIRT]: { grip: 4.2, max: 12.8, accel: 7.2, drag: 0.55, bump: 1.0, name: 'dirt' },
  [GRASS]: { grip: 5.2, max: 11.8, accel: 6.8, drag: 0.65, bump: 0.6, name: 'grass' },
};

export class Bike {
  constructor(world) { this.world = world; this.reset(0, 0, 0); }
  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0; this.vf = 0; this.vl = 0;
    this.steer = 0; this.lean = 0; this.y = this.world.heightAt(x, z); this.vy = 0;
    this.pitch = 0; this.odo = 0; this.shake = 0; this.slide = 0; this.drifting = false;
    this.surface = PAVE; this.throttle = 0; this.brake = 0; this.compress = 0;
  }
  get fx() { return -Math.sin(this.yaw); }
  get fz() { return -Math.cos(this.yaw); }
  get speed() { return Math.hypot(this.vx, this.vz); }

  // inp: {throttle 0..1, brake 0..1, steer -1..1 (right +), drift bool}
  update(dt, inp, ev) {
    const w = this.world;
    this.surface = w.surfaceAt(this.x, this.z);
    const S = SURF[this.surface] || SURF[PAVE];
    let fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vf = this.vx * fx + this.vz * fz;
    const vl0 = this.vx * rx + this.vz * rz;
    this.throttle = inp.throttle; this.brake = inp.brake;
    const drifting = inp.drift && Math.abs(vf) > 3;
    this.drifting = drifting;

    if (inp.throttle > 0.01) vf += S.accel * (1 - clamp(vf, 0, 99) / S.max) * inp.throttle * dt * (drifting ? 0.6 : 1);
    if (inp.brake > 0.01) {
      if (vf > 0.4) vf -= 24 * inp.brake * dt;
      else vf = Math.max(vf - 7 * inp.brake * dt, -3.5);
    }
    if (inp.throttle <= 0.01 && inp.brake <= 0.01) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * dt);
    if (drifting) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 3.0 * dt);
    vf -= vf * S.drag * dt * 0.3;
    if (vf > S.max) vf -= (vf - S.max) * 2.2 * dt;
    if (this.assistMax !== undefined && vf > this.assistMax) vf = damp(vf, this.assistMax, 10, dt);

    // steering: tighter at low speed, much tighter with the handbrake
    this.steer = damp(this.steer, inp.steer, 9, dt);
    const sp = Math.abs(vf);
    let turn = lerp(2.7, 1.2, clamp(sp / 16, 0, 1)) * clamp(sp / 1.6, 0, 1);
    if (drifting) turn *= 1.9;
    this.yaw -= this.steer * turn * dt * Math.sign(vf || 1);

    // re-project world velocity on the new heading; lateral part bleeds off by grip
    fx = -Math.sin(this.yaw); fz = -Math.cos(this.yaw); rx = Math.cos(this.yaw); rz = -Math.sin(this.yaw);
    const vxw = fx * vf + rx * vl0, vzw = fz * vf + rz * vl0; // velocity before turning (approx)
    let nvf = vxw * fx + vzw * fz, nvl = vxw * rx + vzw * rz;
    void nvf;
    // keep forward speed (bike points where it goes) but let the rear slide
    const grip = drifting ? (this.surface === PAVE ? 1.6 : 1.1) : S.grip;
    const slideDecay = Math.exp(-grip * dt);
    const turnLat = -this.steer * turn * dt * vf; // lateral velocity induced by the yaw change
    nvl = (vl0 + (drifting ? turnLat * 0.9 : turnLat * 0.15)) * slideDecay;
    const lost = Math.abs(vl0) * (1 - slideDecay);
    vf = vf + Math.sign(vf) * lost * (drifting ? 0.15 : 0.35);
    this.vx = fx * vf + rx * nvl; this.vz = fz * vf + rz * nvl;
    this.vf = vf; this.vl = nvl;
    this.slide = Math.abs(nvl);

    // integrate + collide (front circle and rider circle)
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.odo += Math.hypot(this.vx, this.vz) * dt;
    let hitN = null;
    for (const off of [0.75, -0.15]) {
      const cx = this.x + fx * off, cz = this.z + fz * off;
      const r = w.collide(cx, cz, off > 0 ? 0.36 : 0.42);
      if (r.hit) { this.x += r.x - cx; this.z += r.z - cz; hitN = [r.nx, r.nz]; }
    }
    if (hitN) {
      const vn = this.vx * hitN[0] + this.vz * hitN[1];
      if (vn < 0) {
        const impact = -vn;
        this.vx -= hitN[0] * vn * 1.3; this.vz -= hitN[1] * vn * 1.3;
        const keep = 1 - Math.min(0.55, impact * 0.06);
        this.vx *= keep; this.vz *= keep;
        if (impact > 1.6) { ev.bump = Math.max(ev.bump || 0, impact); this.shake = Math.max(this.shake, Math.min(1, impact / 10)); this.vy += impact * 0.12; }
        if (impact > 8) { ev.crash = true; this.vx *= 0.3; this.vz *= 0.3; this.shake = 1; }
      }
    }

    // suspension: spring towards terrain + speed-dependent bumps on loose ground
    const ground = w.heightAt(this.x, this.z);
    const rough = S.bump * clamp(sp / 10, 0, 1.3);
    const noise = (Math.sin(this.odo * 3.1) * 0.035 + Math.sin(this.odo * 7.7 + 1.3) * 0.022 + Math.sin(this.odo * 13.3) * 0.01) * rough;
    const target = ground + noise;
    const acc = 190 * (target - this.y) - 15 * this.vy;
    this.vy += acc * dt; this.y += this.vy * dt;
    this.compress = clamp(target - this.y, -0.2, 0.2);
    const hf = w.heightAt(this.x + fx * 0.8, this.z + fz * 0.8), hr = w.heightAt(this.x - fx * 0.6, this.z - fz * 0.6);
    this.pitch = damp(this.pitch, Math.atan2(hf - hr, 1.4) - (inp.brake > 0.1 && vf > 2 ? 0.03 : 0) + (inp.throttle > 0.1 && vf < 8 ? 0.015 : 0), 8, dt);
    this.lean = damp(this.lean, -this.steer * clamp(sp / 9, 0, 1) * 0.3 - (drifting ? Math.sign(this.steer) * 0.06 : 0), 6, dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}

// ---------------------------------------------------------------- rig ----
function mesh(geo, color, x, y, z) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}
function tube(p0, p1, r, color) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const len = a.distanceTo(b);
  const m = mesh(new THREE.CylinderGeometry(r, r, len, 10), color, 0, 0, 0);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export function buildRig() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(80, 1, 0.02, 10);
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x8a7a66, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.3); scene.add(sun); scene.add(sun.target);
  const root = new THREE.Group(); scene.add(root);
  const bars = new THREE.Group(); root.add(bars);
  const BLACK = 0x1c1c1c;
  // handlebar with slight sweep
  bars.add(tube([-0.36, 0.03, 0.05], [-0.12, 0.0, 0.0], 0.016, BLACK));
  bars.add(tube([0.36, 0.03, 0.05], [0.12, 0.0, 0.0], 0.016, BLACK));
  bars.add(tube([-0.12, 0.0, 0.0], [0.12, 0.0, 0.0], 0.019, BLACK));
  bars.add(tube([-0.36, 0.03, 0.05], [-0.25, 0.03, 0.035], 0.026, 0x0e0e0e));
  bars.add(tube([0.36, 0.03, 0.05], [0.25, 0.03, 0.035], 0.026, 0x0e0e0e));
  // crossbar pad
  bars.add(tube([-0.1, 0.05, -0.01], [0.1, 0.05, -0.01], 0.022, 0x2f6fd8));
  // stem / clamps / forks
  bars.add(mesh(new THREE.BoxGeometry(0.16, 0.05, 0.09), 0x3a3d42, 0, -0.03, -0.01));
  bars.add(tube([0.085, -0.04, -0.03], [0.09, -0.95, -0.42], 0.03, 0xd8d8d8));
  bars.add(tube([-0.085, -0.04, -0.03], [-0.09, -0.95, -0.42], 0.03, 0xd8d8d8));
  bars.add(tube([0.085, -0.06, -0.04], [0.087, -0.36, -0.17], 0.04, 0xe3a21a));
  bars.add(tube([-0.085, -0.06, -0.04], [-0.087, -0.36, -0.17], 0.04, 0xe3a21a));
  // number plate & fender
  const plate = mesh(new THREE.BoxGeometry(0.24, 0.2, 0.015), 0xf4f4f4, 0, -0.2, -0.13); plate.rotation.x = -0.35; bars.add(plate);
  const stripe = mesh(new THREE.BoxGeometry(0.24, 0.035, 0.017), 0x2f6fd8, 0, -0.13, -0.105); stripe.rotation.x = -0.35; bars.add(stripe);
  const fender = mesh(new THREE.BoxGeometry(0.17, 0.025, 0.55), 0xf4f4f4, 0, -0.78, -0.5); fender.rotation.x = 0.25; bars.add(fender);
  const wheel = mesh(new THREE.TorusGeometry(0.34, 0.075, 8, 22), 0x151515, 0, -1.08, -0.62); wheel.rotation.y = Math.PI / 2; bars.add(wheel);
  // brake levers
  for (const s of [-1, 1]) { const l = tube([0.18 * s, 0.035, -0.02], [0.32 * s, 0.025, -0.06], 0.007, 0x9aa0a6); bars.add(l); }
  // yellow device on a short arm
  bars.add(tube([0, 0.03, -0.01], [0, 0.085, 0.0], 0.008, 0x333333));
  const device = new THREE.Group(); device.position.set(0, 0.115, 0.01); device.rotation.x = -0.75; bars.add(device);
  device.add(mesh(new THREE.BoxGeometry(0.16, 0.1, 0.024), 0xffcf1a, 0, 0, 0));
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 192;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.138, 0.083), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.z = 0.0125; device.add(screen);
  // gloved hands + forearms
  const hands = [];
  for (const s of [-1, 1]) {
    const h = new THREE.Group(); h.position.set(0.305 * s, 0.035, 0.04); bars.add(h);
    h.add(mesh(new THREE.BoxGeometry(0.1, 0.075, 0.085), 0x26282c, 0, 0.012, 0.012));
    h.add(mesh(new THREE.BoxGeometry(0.1, 0.045, 0.06), 0x1e2024, 0, -0.012, -0.045));
    h.add(mesh(new THREE.BoxGeometry(0.085, 0.022, 0.05), 0xff7a1a, 0, 0.052, 0.0));
    const thumb = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), 0x26282c, -0.055 * s, 0.01, -0.02); thumb.rotation.y = 0.4 * s; h.add(thumb);
    const arm = tube([0.0, 0.01, 0.05], [0.13 * s, -0.22, 0.62], 0.05, 0x2b4c7e); h.add(arm);
    h.add(tube([0.0, 0.01, 0.06], [0.0, -0.005, 0.15], 0.047, 0x1e2024)); // glove cuff
    hands.push(h);
  }
  return {
    scene, camera, root, bars, canvas, tex, sun,
    layout(halfV, halfH) {
      const f = clamp(0.8 / Math.tan(halfH), 1, 1.6);
      root.position.set(0, -Math.tan(halfV * 0.74) * 0.6 * f, -0.6 * f);
    },
    update(bike, mainCam, sunDir, dt, t) {
      camera.fov = mainCam.fov; camera.aspect = mainCam.aspect; camera.updateProjectionMatrix();
      bars.rotation.y = damp(bars.rotation.y, -bike.steer * 0.42, 14, dt);
      bars.rotation.z = damp(bars.rotation.z, bike.lean * 0.35, 8, dt);
      bars.position.y = damp(bars.position.y, bike.compress * 0.35 + Math.sin(t * 25) * bike.shake * 0.01, 25, dt);
      bars.position.x = Math.sin(t * 31) * bike.shake * 0.008;
      // sun direction expressed in camera space so the rig is lit like the world
      const d = sunDir.clone().applyQuaternion(mainCam.quaternion.clone().invert());
      sun.position.copy(d.multiplyScalar(5));
    },
  };
}
