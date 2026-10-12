// Village Dash: bootstrap, game state machine, rendering pipeline, HUD.
import * as THREE from '../vendor/three.module.js';
import { LEVELS, starsFor } from './levels.js';
import { buildWorld, PAVE, DIRT, GRASS } from './world.js';
import { Bike, buildRig } from './bike.js';
import { Dog } from './dog.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { TireMarks, Dust, makePost, fisheyeForward } from './fx.js';
import { drawDevice } from './hud.js';
import { clamp, damp, lerp, mulberry32, fmtTime, wrapAngle } from './util.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------------------------------------------------------------- setup ----
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('#nogl').hidden = false; throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
$('#game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xdcebf5);
scene.fog = new THREE.Fog(FOG, 50, 175);
const camera = new THREE.PerspectiveCamera(80, 1, 0.08, 700);
camera.rotation.order = 'YXZ';

const sunDir = new THREE.Vector3(-0.45, 0.8, 0.38).normalize();
const hemi = new THREE.HemisphereLight(0xdcefff, 0xc4b394, 1.5); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.35);
sun.castShadow = true; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun); scene.add(sun.target);

// sky dome with a soft sun glow
const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uSun: { value: sunDir } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying vec3 vDir; uniform vec3 uSun;
    void main(){ float h = clamp(vDir.y,0.0,1.0);
      vec3 col = mix(vec3(0.86,0.92,0.96), vec3(0.24,0.55,0.92), pow(h,0.55));
      float s = max(dot(normalize(vDir), uSun),0.0);
      col += vec3(1.0,0.92,0.75)*(pow(s,600.0)*2.0 + pow(s,12.0)*0.18);
      gl_FragColor = vec4(col,1.0);
      #include <colorspace_fragment>
    }`,
}));
sky.material.uniforms.uSun.value = sunDir;
sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);
// a few puffy clouds
const clouds = new THREE.Group();
{
  const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa7b5, fog: false });
  const cg = new THREE.IcosahedronGeometry(1, 1);
  const r = mulberry32(5);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const a = r() * Math.PI * 2, d = 260 + r() * 180;
    g.position.set(Math.cos(a) * d, 70 + r() * 60, Math.sin(a) * d);
    for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(cg, cm); m.position.set((k - 2) * 9 + r() * 4, r() * 4, r() * 6); m.scale.set(10 + r() * 6, 5 + r() * 3, 8 + r() * 4); g.add(m); }
    clouds.add(g);
  }
  scene.add(clouds);
}

const rig = buildRig();
const post = makePost();
const marks = new TireMarks(scene);
const dust = new Dust(scene);
const audio = new AudioEngine();
const input = new Input();
input.bindTouch(document);

// ---------------------------------------------------------------- quality ----
let quality = localStorage.getItem('vd.quality') || (isTouch ? 'low' : 'high');
let rt = null;
let baseVfov = 80;
function applyQuality() {
  const hi = quality === 'high';
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(dpr, hi ? 2 : 1.25));
  sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  $('#qBtn').textContent = hi ? 'HQ' : 'LQ';
  localStorage.setItem('vd.quality', quality);
  resize(true);
}
function resize(force) {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (!rt || force || rt.width !== db.x || rt.height !== db.y) {
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(db.x, db.y, { samples: quality === 'high' ? 4 : 0, colorSpace: THREE.SRGBColorSpace, type: THREE.UnsignedByteType });
  }
  const aspect = w / h;
  camera.aspect = aspect;
  const hf = THREE.MathUtils.degToRad(105);
  let v = 2 * Math.atan(Math.tan(hf / 2) / aspect);
  v = clamp(v, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(100));
  baseVfov = THREE.MathUtils.radToDeg(v);
  camera.fov = baseVfov; camera.updateProjectionMatrix();
  const halfH = Math.atan(Math.tan(v / 2) * aspect);
  rig.layout(v / 2, halfH);
  post.mat.uniforms.uAspect.value = aspect;
  dust.mat.uniforms.uScale.value = db.y / (2 * Math.tan(v / 2));
  document.body.classList.toggle('portrait', aspect < 0.9);
}
window.addEventListener('resize', () => resize(false));

// ---------------------------------------------------------------- game state ----
const G = {
  state: 'menu', levelIdx: 0, world: null, bike: null, dog: null, timer: 0, penalty: 0, crashes: 0,
  catchT: 0, stateT: 0, caughtHow: '', lastMark: null, msgCooldown: 0, deviceT: 0, hudT: 0, contactMsgT: 0,
};
window.__vd = G;

function loadLevel(idx) {
  if (G.world) G.world.dispose();
  if (G.dog) G.dog.dispose();
  marks.reset(); dust.reset();
  G.levelIdx = idx;
  const cfg = LEVELS[idx];
  const world = buildWorld(cfg, { lowQuality: quality !== 'high' });
  scene.add(world.group);
  G.world = world;
  G.bike = new Bike(world);
  G.dog = new Dog(world, cfg.dog, mulberry32(cfg.seed * 7 + 3));
  scene.add(G.dog.root);
  const st = world.start, se = world.startEdge;
  const T = world.nodes[se.to];
  const yaw = Math.atan2(-(T.x - st.x), -(T.z - st.z));
  G.bike.reset(st.x, st.z, yaw);
  G.dog.place(st.id, se.to, se.e, Math.min(14, se.e.len * 0.6));
  G.caughtHow = ''; G.timer = 0; G.penalty = 0; G.crashes = 0; G.catchT = 0; G.lastMark = null;
  $('#hudLevel').textContent = cfg.name;
  $('#hudPar').textContent = 'Par ' + fmtTime(cfg.par);
}

function setState(s) {
  G.state = s; G.stateT = 0;
  document.body.dataset.state = s;
  $('#menu').hidden = s !== 'menu';
  $('#pause').hidden = s !== 'paused';
  $('#results').hidden = s !== 'results';
  $('#hud').hidden = !['countdown', 'play', 'caught', 'paused'].includes(s);
  $('#touch').hidden = !['countdown', 'play'].includes(s);
  audio.setMusic(['countdown', 'play', 'caught'].includes(s));
  if (s !== 'caught' && s !== 'paused') { $('#catchBanner').hidden = true; $('#hearts').innerHTML = ''; }
  if (s !== 'countdown' && s !== 'play' && s !== 'paused') $('#count').hidden = true;
  if (s === 'caught') $('#catchMeter').hidden = true;
}

function startLevel(idx) {
  audio.init();
  loadLevel(idx);
  $('#catchBanner').hidden = true; $('#hearts').innerHTML = '';
  setState('countdown');
  toast('A pup slipped its leash! Bring it home safely.', 2600);
}

// ---------------------------------------------------------------- UI ----
function bestOf(id) { const v = parseFloat(localStorage.getItem('vd.best.' + id)); return isFinite(v) ? v : null; }
function renderMenu() {
  const list = $('#levels'); list.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const best = bestOf(L.id);
    const stars = best ? starsFor(best, L.par) : 0;
    const b = document.createElement('button');
    b.className = 'level' + (i === G.levelIdx ? ' sel' : '');
    b.innerHTML = `<div class="lnum">${i + 1}</div><div class="linfo"><b>${L.name}</b><span>${L.blurb}</span></div>
      <div class="lstat"><div class="stars">${'★'.repeat(stars)}<i>${'★'.repeat(3 - stars)}</i></div><small>${best ? 'Best ' + fmtTime(best) : 'Par ' + fmtTime(L.par)}</small></div>`;
    b.onclick = () => { G.levelIdx = i; renderMenu(); };
    b.ondblclick = () => startLevel(i);
    list.appendChild(b);
  });
}
$('#playBtn').onclick = () => startLevel(G.levelIdx);
$('#resumeBtn').onclick = () => togglePause();
$('#restartBtn').onclick = () => startLevel(G.levelIdx);
$('#menuBtn').onclick = () => goMenu();
$('#rRetry').onclick = () => startLevel(G.levelIdx);
$('#rMenu').onclick = () => goMenu();
$('#rNext').onclick = () => startLevel(Math.min(LEVELS.length - 1, G.levelIdx + 1));
$('#pauseBtn').onclick = () => togglePause();
$('#muteBtn').onclick = () => toggleMute();
$('#qBtn').onclick = () => { quality = quality === 'high' ? 'low' : 'high'; applyQuality(); };
$('#menuMute').onclick = () => toggleMute();
$('#menuQ').onclick = () => { quality = quality === 'high' ? 'low' : 'high'; applyQuality(); $('#menuQ').textContent = 'Quality: ' + (quality === 'high' ? 'High' : 'Low'); };
function syncMuteUI() { const t = audio.muted ? '🔇' : '🔊'; $('#muteBtn').textContent = t; $('#menuMute').textContent = (audio.muted ? '🔇 Sound off' : '🔊 Sound on'); }
function toggleMute() { audio.init(); audio.setMuted(!audio.muted); syncMuteUI(); }
function goMenu() { setState('menu'); renderMenu(); }
function togglePause() {
  if (G.state === 'play' || G.state === 'countdown') { G.resumeTo = G.state; setState('paused'); }
  else if (G.state === 'paused') setState(G.resumeTo || 'play');
}
input.on('pause', togglePause);
input.on('mute', toggleMute);
input.on('reset', () => { if (G.state === 'play') resetBike(); });
input.on('enter', () => {
  if (G.state === 'menu') startLevel(G.levelIdx);
  else if (G.state === 'results') $('#rNext').hidden ? startLevel(G.levelIdx) : startLevel(G.levelIdx + 1);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && (G.state === 'play' || G.state === 'countdown')) togglePause(); });

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function resetBike() {
  const w = G.world, b = G.bike, d = G.dog;
  const n = w.nearestNode(b.x, b.z, (q) => q.kind === 'lattice');
  const dx = d.x - n.x, dz = d.z - n.z, L = Math.hypot(dx, dz) || 1;
  let best = null, bd = -9;
  for (const a of n.adj) {
    const T = w.nodes[a.to]; const ex = (T.x - n.x) / a.e.len, ez = (T.z - n.z) / a.e.len;
    const dot = (ex * dx + ez * dz) / L; if (dot > bd) { bd = dot; best = [ex, ez]; }
  }
  b.reset(n.x, n.z, Math.atan2(-best[0], -best[1]));
  toast('Back on track!', 1200);
}

function onCatch(how) {
  G.caughtHow = how;
  G.dog.state = 'caught';
  setState('caught');
  audio.jingle(); audio.bark(3);
  const banner = $('#catchBanner'); banner.hidden = false;
  $('#catchSub').textContent = how === 'redcar' ? 'Found under the red car. Time to go home!' : how === 'cornered' ? 'Cornered gently in a dead end. Good pup!' : 'Matched speed and scooped up the pup!';
  const hearts = $('#hearts'); hearts.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('span'); s.textContent = ['❤', '🐾', '💛'][i % 3];
    s.style.left = 30 + Math.random() * 40 + '%'; s.style.animationDelay = Math.random() * 0.8 + 's'; s.style.fontSize = 20 + Math.random() * 22 + 'px';
    hearts.appendChild(s);
  }
}

function showResults() {
  const L = LEVELS[G.levelIdx];
  const t = G.timer;
  const stars = starsFor(t, L.par);
  const prev = bestOf(L.id);
  const isBest = prev === null || t < prev;
  if (isBest) localStorage.setItem('vd.best.' + L.id, t.toFixed(2));
  $('#rTitle').textContent = 'Got you, buddy!';
  $('#rLevel').textContent = L.name;
  $('#rTime').textContent = fmtTime(t);
  $('#rStars').innerHTML = '★'.repeat(stars) + '<i>' + '★'.repeat(3 - stars) + '</i>';
  $('#rPar').textContent = fmtTime(L.par);
  $('#rBest').textContent = fmtTime(isBest ? t : prev) + (isBest ? '  · New best!' : '');
  $('#rCrash').textContent = G.crashes ? `${G.crashes} (+${G.penalty}s)` : 'None, smooth riding!';
  $('#rHow').textContent = G.caughtHow === 'redcar' ? 'Under the red car' : G.caughtHow === 'cornered' ? 'Cornered in a dead end' : 'Matched speed and caught';
  $('#rNext').hidden = G.levelIdx >= LEVELS.length - 1;
  setState('results');
}

// ---------------------------------------------------------------- simulation ----
const NO_INPUT = { throttle: 0, brake: 0, steer: 0, drift: false };
const BRAKE_INPUT = { throttle: 0, brake: 1, steer: 0, drift: false };
function simulate(dt) {
  const b = G.bike, d = G.dog, w = G.world;
  G.stateT += dt;
  let inp = NO_INPUT;
  if (G.state === 'play') inp = G.botInput || input.state;
  else if (G.state === 'caught') inp = BRAKE_INPUT;

  if (G.state === 'countdown') {
    const n = 3 - Math.floor(G.stateT / 0.75);
    $('#count').textContent = n > 0 ? n : 'GO!';
    $('#count').hidden = false;
    if (G.stateT >= 2.25) { setState('play'); d.start(); setTimeout(() => { if (G.state !== 'countdown') $('#count').hidden = true; }, 600); }
  }

  // gentle auto-brake near the pup: never bump into it
  const fx = b.fx, fz = b.fz;
  const fpx = b.x + fx * 0.9, fpz = b.z + fz * 0.9;
  const dFront = Math.hypot(d.x - fpx, d.z - fpz);
  b.assistMax = dFront < 2.2 && G.state === 'play' ? Math.max(d.speed * 0.95, 1.5) : undefined;

  const ev = {};
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  for (let i = 0; i < steps; i++) b.update(dt / steps, inp, ev);
  if (dFront < 0.9 && d.state === 'run') {
    d.hop = 1;
    const away = Math.hypot(b.x - d.x, b.z - d.z) || 1;
    b.x += (b.x - d.x) / away * 0.05; b.z += (b.z - d.z) / away * 0.05;
    if (G.contactMsgT <= 0) { toast('Easy! Gentle with the pup.', 1200); G.contactMsgT = 4; }
  }
  G.contactMsgT -= dt;
  if (ev.bump) { audio.bump(ev.bump); }
  if (ev.crash && G.state === 'play') {
    G.crashes++; G.penalty += 3; G.timer += 3; toast('Oof! Heavy bump: +3s', 1500);
  }

  d.update(dt, b);
  for (const e of d.events) {
    if (e === 'bark') audio.bark(d.dist);
    else if (e.startsWith('msg:') && G.state === 'play') toast(e.slice(4), 2600);
  }
  d.events.length = 0;

  if (G.state === 'play') {
    G.timer += dt;
    const rvx = b.vx - d.vx, rvz = b.vz - d.vz, rel = Math.hypot(rvx, rvz);
    if (dFront < 2.5 && rel < 4 && d.state !== 'wait') G.catchT += dt; else G.catchT = Math.max(0, G.catchT - dt * 1.5);
    if (G.catchT >= 1) onCatch('chase');
    else if (d.state === 'cornered' && dFront < 4 && b.speed < 7) onCatch('cornered');
    else if (d.state === 'hiding' && dFront < 7) onCatch('redcar');
  }
  if (G.state === 'caught' && G.stateT > 2.8) showResults();

  // tire marks + dust
  const sp = b.speed;
  const skidding = (b.slide > 2.2 || (b.drifting && sp > 5)) && G.state !== 'menu';
  const rxp = b.x - fx * 0.75, rzp = b.z - fz * 0.75;
  const surf = b.surface;
  if (skidding) {
    if (!G.lastMark || Math.hypot(rxp - G.lastMark[0], rzp - G.lastMark[1]) > 0.33) {
      const yaw = Math.atan2(b.vx, b.vz);
      marks.add(rxp, w.heightAt(rxp, rzp), rzp, yaw, surf === PAVE ? 0x202020 : surf === DIRT ? 0x6b4a2a : 0x3d5a22);
      G.lastMark = [rxp, rzp];
    }
  } else G.lastMark = null;
  if ((surf === DIRT && sp > 4 && Math.random() < sp * dt * 2.2) || (skidding && Math.random() < dt * 30)) {
    const c = surf === PAVE ? 0xd9d9d9 : surf === DIRT ? 0xcfae80 : 0xb7c690;
    dust.spawn(rxp, w.heightAt(rxp, rzp) + 0.15, rzp, -b.vx * 0.2, -b.vz * 0.2, c, surf === PAVE ? 0.35 : 0.5);
  }
  dust.update(dt);

  audio.update({ speed: sp, throttle: inp.throttle, skid: skidding ? Math.max(b.slide, 3) : 0, onDirt: surf === DIRT || surf === GRASS, active: G.state !== 'paused' && G.state !== 'menu' && G.state !== 'results' });
}

// ---------------------------------------------------------------- camera ----
let camT = 0;
function updateCamera(dt) {
  const b = G.bike, d = G.dog;
  camT += dt;
  if (G.state === 'menu' || G.state === 'results') {
    const w = G.world, cx = w.W / 2, cz = w.H / 2, R = Math.max(w.W, w.H) * 0.55;
    const a = camT * 0.06;
    camera.position.set(cx + Math.cos(a) * R, Math.max(w.W, w.H) * 0.42, cz + Math.sin(a) * R);
    camera.fov = Math.min(baseVfov, 70); camera.updateProjectionMatrix();
    camera.lookAt(cx, 0, cz);
    return;
  }
  const sp = b.speed;
  const bobA = clamp(sp / 16, 0, 1);
  const bob = Math.sin(b.odo * 1.9) * 0.012 * bobA;
  const sh = b.shake;
  let yaw = b.yaw, pitch = -0.1 + b.pitch - b.compress * 0.3, roll = b.lean;
  let y = b.y + 1.42 + bob - b.compress * 0.25;
  if (G.state === 'caught') {
    // turn to look at the pup and "get off" the bike
    const k = clamp(G.stateT / 1.2, 0, 1);
    const want = Math.atan2(-(d.rx - b.x), -(d.rz - b.z));
    yaw = b.yaw + wrapAngle(want - b.yaw) * k;
    const dist = Math.hypot(d.rx - b.x, d.rz - b.z);
    pitch = lerp(pitch, -Math.atan2(1.6, Math.max(1, dist)), k);
    roll = lerp(roll, 0, k);
    y += 0.25 * k;
    rig.root.visible = G.stateT < 1.3;
  } else rig.root.visible = true;
  camera.position.set(b.x + b.fx * 0.1 + (Math.random() - 0.5) * sh * 0.08, y + (Math.random() - 0.5) * sh * 0.06, b.z + b.fz * 0.1);
  camera.rotation.set(pitch + (Math.random() - 0.5) * sh * 0.02, yaw, roll + (Math.random() - 0.5) * sh * 0.03);
  camera.fov = baseVfov + clamp(sp / 16.5, 0, 1) * 6;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- HUD ----
const _v = new THREE.Vector3();
function updateHud(dt) {
  const b = G.bike, d = G.dog;
  if (!b || !['countdown', 'play', 'caught', 'paused'].includes(G.state)) { $('#arrow').hidden = true; $('#marker').hidden = true; return; }
  const dist = Math.hypot(d.x - b.x, d.z - b.z);
  G.hudT -= dt;
  if (G.hudT <= 0) {
    G.hudT = 0.08;
    $('#hudTime').textContent = fmtTime(G.timer);
    $('#hudDist').textContent = Math.round(dist) + ' m';
    $('#hudSpeed').textContent = Math.round(b.speed * 3.6);
    const st = { run: d.goingHome ? 'Heading to hide' : 'Running', rest: 'Waiting for you', deadend: 'In a dead end!', cornered: 'Cornered!', hiding: 'Hiding under the red car', caught: 'Caught!', wait: 'Ready...' }[d.state] || '';
    $('#hudStatus').textContent = st;
    const L = LEVELS[G.levelIdx];
    const s = starsFor(G.timer, L.par);
    $('#hudStars').innerHTML = '★'.repeat(s) + '<i>' + '★'.repeat(3 - s) + '</i>';
    const pct = clamp(G.catchT, 0, 1);
    $('#catchMeter').style.setProperty('--p', pct);
    $('#catchMeter').hidden = pct <= 0.02 || G.state !== 'play';
  }
  G.deviceT -= dt;
  if (G.deviceT <= 0) {
    G.deviceT = 0.1;
    const want = Math.atan2(-(d.x - b.x), -(d.z - b.z));
    drawDevice(rig.canvas, { speed: b.speed, dist, time: G.timer, rel: -wrapAngle(want - b.yaw), drift: b.drifting, status: d.state === 'hiding' ? 'UNDER RED CAR' : d.state === 'rest' ? 'WAITING' : d.state === 'cornered' ? 'CORNERED' : 'TRACKING' });
    rig.tex.needsUpdate = true;
  }
  // off-screen indicator / on-screen marker (accounts for the fisheye warp)
  _v.set(d.rx, d.root.position.y + 1.0, d.rz).applyMatrix4(camera.matrixWorldInverse);
  const behind = _v.z > -0.5;
  _v.applyMatrix4(camera.projectionMatrix);
  const W = window.innerWidth, H = window.innerHeight;
  let [sx, sy] = fisheyeForward(_v.x * 0.5, _v.y * 0.5, W / H);
  const onScreen = !behind && Math.abs(sx) < 0.46 && Math.abs(sy) < 0.44;
  const arrow = $('#arrow'), marker = $('#marker');
  if (onScreen) {
    arrow.hidden = true;
    marker.hidden = !(dist > 9 && G.state !== 'caught');
    marker.style.transform = `translate(${(0.5 + sx) * W}px, ${(0.5 - sy) * H}px)`;
  } else {
    marker.hidden = true; arrow.hidden = G.state === 'caught';
    // direction in camera space
    _v.set(d.rx, 0.5, d.rz).applyMatrix4(camera.matrixWorldInverse);
    let ax = _v.x, ay = -_v.z; // ay: forward
    const ang = Math.atan2(ax, ay);
    const ex = Math.sin(ang), ey = -Math.cos(ang);
    const rx = W / 2 - 46, ry = H / 2 - 70;
    const t = Math.min(rx / Math.max(1e-3, Math.abs(ex)), ry / Math.max(1e-3, Math.abs(ey)));
    arrow.style.transform = `translate(${W / 2 + ex * t}px, ${H / 2 + ey * t}px)`;
    arrow.querySelector('.tip').style.transform = `rotate(${ang}rad)`;
    arrow.querySelector('.ad').textContent = Math.round(dist) + 'm';
  }
}

// ---------------------------------------------------------------- render loop ----
let last = performance.now(), fpsAcc = 0, fpsN = 0;
G.fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0.016;
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { G.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  dt = Math.min(dt, 0.05);
  if (G.frozen) { return; }
  input.update();
  if (G.world) {
    if (G.simPaused) { /* test hook: render only */ }
    else if (G.state === 'countdown' || G.state === 'play' || G.state === 'caught') simulate(dt);
    else if (G.state === 'menu' || G.state === 'results') { G.dog.update(dt, G.bike); G.dog.events.length = 0; audio.update({ speed: 0, throttle: 0, skid: 0, onDirt: false, active: false }); }
    updateCamera(dt);
    updateHud(dt);
  }
  // shadows follow the camera (or cover the whole map in the menu)
  const overview = G.state === 'menu' || G.state === 'results';
  const sc = sun.shadow.camera;
  if (G.world) {
    if (overview) {
      const w = G.world, half = Math.max(w.W, w.H) * 0.75;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sun.target.position.set(w.W / 2, 0, w.H / 2);
    } else {
      const half = quality === 'high' ? 42 : 32;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      const b = G.bike;
      sun.target.position.set(b.x + b.fx * 16, 0, b.z + b.fz * 16);
    }
    sc.near = 1; sc.far = 400; sc.updateProjectionMatrix();
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 150);
  }
  sky.position.copy(camera.position);
  clouds.position.set(camera.position.x, 0, camera.position.z);
  scene.fog.far = overview ? 600 : 175; scene.fog.near = overview ? 200 : 50;

  renderer.setRenderTarget(rt);
  renderer.setClearColor(FOG, 1);
  renderer.clear();
  renderer.render(scene, camera);
  if (G.bike && !overview) {
    rig.update(G.bike, camera, sunDir, dt, now / 1000);
    renderer.clearDepth();
    renderer.render(rig.scene, rig.camera);
  }
  renderer.setRenderTarget(null);
  post.mat.uniforms.tDiffuse.value = rt.texture;
  post.mat.uniforms.uK.value = overview ? 0.05 : 0.22;
  post.mat.uniforms.uFlash.value = G.bike && G.bike.shake > 0.6 ? (G.bike.shake - 0.6) * 0.5 : 0;
  renderer.clear();
  renderer.render(post.scene, post.camera);
}

// ---------------------------------------------------------------- boot ----
applyQuality();
syncMuteUI();
$('#menuQ').textContent = 'Quality: ' + (quality === 'high' ? 'High' : 'Low');
loadLevel(0);
renderMenu();
setState('menu');
requestAnimationFrame(frame);

// debug/test helpers (used by the automated tests)
G.marksCount = () => marks.n;
G.debug = {
  start: (i = 0) => startLevel(i),
  teleportBehindDog(dist = 8) {
    const d = G.dog, b = G.bike, nodes = G.world.nodes;
    const A = nodes[d.from], B = nodes[d.to];
    const ex = (B.x - A.x) / d.edge.len, ez = (B.z - A.z) / d.edge.len;
    const back = Math.min(dist, d.s);
    b.reset(d.x - ex * back, d.z - ez * back, Math.atan2(-ex, -ez));
  },
  reset: () => resetBike(),
  marksCount: () => marks.n,
  setBikeSpeed(v) { const b = G.bike; b.vx = b.fx * v; b.vz = b.fz * v; },
  levels: LEVELS,
  // advance the simulation deterministically without rendering (for tests on slow software GL)
  step(seconds, h = 1 / 60) {
    const n = Math.round(seconds / h);
    for (let i = 0; i < n; i++) {
      input.update();
      if (G.state === 'countdown' || G.state === 'play' || G.state === 'caught') simulate(h);
      updateCamera(h); updateHud(h);
    }
    return { state: G.state, timer: G.timer, bike: [G.bike.x, G.bike.z, G.bike.speed], dog: [G.dog.x, G.dog.z, G.dog.state, G.dog.speed] };
  },
};
