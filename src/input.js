// Keyboard, touch (left steering pad + right throttle/brake/drift) and gamepad.
import { clamp } from './util.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { steer: 0, throttle: 0, brake: 0, drift: false, padId: null, padX: 0 };
    this.handlers = {};
    this.state = { throttle: 0, brake: 0, steer: 0, drift: false };
    this.prevPad = {};
    this.usedTouch = false;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.emit('pause');
      if (e.code === 'KeyR') this.emit('reset');
      if (e.code === 'KeyM') this.emit('mute');
      if (e.code === 'Enter') this.emit('enter');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name) { this.handlers[name] && this.handlers[name](); }

  bindTouch(root) {
    const pad = root.querySelector('#tPad'), knob = root.querySelector('#tKnob');
    const bind = (el, key) => {
      const down = (e) => { e.preventDefault(); this.usedTouch = true; this.touch[key] = key === 'drift' ? true : 1; el.classList.add('on'); el.setPointerCapture?.(e.pointerId); };
      const up = (e) => { e.preventDefault(); this.touch[key] = key === 'drift' ? false : 0; el.classList.remove('on'); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    };
    bind(root.querySelector('#tGas'), 'throttle');
    bind(root.querySelector('#tBrake'), 'brake');
    bind(root.querySelector('#tDrift'), 'drift');
    const move = (e) => {
      if (e.pointerId !== this.touch.padId) return;
      const r = pad.getBoundingClientRect();
      const dx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.38), -1, 1);
      this.touch.steer = Math.sign(dx) * Math.pow(Math.abs(dx), 1.3);
      knob.style.transform = `translate(${dx * r.width * 0.32}px, 0)`;
    };
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); this.usedTouch = true; this.touch.padId = e.pointerId; pad.setPointerCapture?.(e.pointerId); move(e); });
    pad.addEventListener('pointermove', move);
    const end = (e) => { if (e.pointerId !== this.touch.padId) return; this.touch.padId = null; this.touch.steer = 0; knob.style.transform = ''; };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  }

  update() {
    const k = this.keys, t = this.touch;
    let throttle = (k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0;
    let brake = (k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0;
    let steer = ((k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0) - ((k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0);
    let drift = k.has('Space') || k.has('ShiftLeft');
    throttle = Math.max(throttle, t.throttle); brake = Math.max(brake, t.brake);
    if (Math.abs(t.steer) > Math.abs(steer)) steer = t.steer;
    drift = drift || t.drift;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.15 && Math.abs(ax) > Math.abs(steer)) steer = ax;
      const b = (i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
      throttle = Math.max(throttle, b(7), b(0));
      brake = Math.max(brake, b(6), b(1));
      if (b(2) > 0.5 || b(5) > 0.5) drift = true;
      if (b(13) > 0.5 || (gp.axes[1] || 0) > 0.6) brake = Math.max(brake, 1);
      const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      if (pressed(9) && !this.prevPad[9]) this.emit('pause');
      if (pressed(3) && !this.prevPad[3]) this.emit('reset');
      if (pressed(0) && !this.prevPad[0]) this.emit('enter');
      this.prevPad = { 9: pressed(9), 3: pressed(3), 0: pressed(0) };
    }
    this.state.throttle = throttle; this.state.brake = brake; this.state.steer = clamp(steer, -1, 1); this.state.drift = drift;
    return this.state;
  }
}
