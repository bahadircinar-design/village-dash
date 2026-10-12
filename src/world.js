// Procedural village: street grid with dead ends, white stucco buildings,
// dirt lots / orchards, parked cars, poles, plants, crates and seated people.
// Everything visual is derived from a 1 m occupancy grid that also drives
// collisions and surface types, so what you see is what you hit.
import * as THREE from '../vendor/three.module.js';
import { mulberry32, clamp, smoothstep } from './util.js';

export const PAVE = 0, SOLID = 1, DIRT = 2, GRASS = 3;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

class Batch {
  constructor() { this.mats = []; this.cols = []; }
  add(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
    this.mats.push(new THREE.Matrix4().compose(_p, _q, _s));
    this.cols.push(typeof color === 'number' ? color : new THREE.Color(color).getHex());
  }
  build(geo, mat, cast, receive) {
    const n = this.mats.length;
    if (!n) return null;
    const im = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) { im.setMatrixAt(i, this.mats[i]); _c.setHex(this.cols[i]); im.setColorAt(i, _c); }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast; im.receiveShadow = receive; im.computeBoundingSphere();
    return im;
  }
}

const WALLS = ['#f6f3ec', '#f1ebe0', '#f8f6f1', '#eee5d4', '#f3ede3', '#ebe1cf', '#f5efe4', '#e8dcc6'];
const CARS = ['#ececec', '#9aa3ad', '#2e4a7a', '#c9b48a', '#3f6e4f', '#f4f4f4', '#5a5f66', '#b0c4d8', '#7a8a6a'];
const SHUTTERS = ['#3d7fb5', '#4f8f5f', '#2f6f8f', '#b5643d', '#6f8fa8'];
const AWNINGS = ['#e85d4a', '#f2b134', '#3aa6a0', '#f0f0f0', '#6c8ee0', '#e07a9a'];
const GREENS = ['#5f9a3a', '#6aa843', '#4f8a35', '#78b04c', '#5c9440'];
const SHIRTS = ['#d9534f', '#3b6fb6', '#f0c419', '#ffffff', '#4caf50', '#8e44ad', '#ff8c42', '#2c3e50'];
const SKIN = ['#f1c7a0', '#d9a77c', '#b67d55', '#8a5a3c', '#f5d6b8'];

function tryLayout(cfg, seed) {
  const rng = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const M = 9;
  const [nx, nz] = cfg.lines;
  const xs = [M], zs = [M];
  for (let i = 1; i < nx; i++) xs.push(xs[i - 1] + rr(cfg.spacing[0], cfg.spacing[1]));
  for (let j = 1; j < nz; j++) zs.push(zs[j - 1] + rr(cfg.spacing[0], cfg.spacing[1]));
  const W = Math.ceil(xs[nx - 1] + M), H = Math.ceil(zs[nz - 1] + M);
  const lineW = () => (rng() < cfg.narrowChance ? rr(2.8, 3.2) : rr(cfg.widths[0], cfg.widths[1]));
  const xw = xs.map(lineW), zw = zs.map(lineW);

  const nodes = [];
  const nid = (i, j) => j * nx + i;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++)
    nodes.push({ id: nodes.length, x: xs[i], z: zs[j], i, j, kind: 'lattice', adj: [] });

  const cand = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx - 1; i++) cand.push({ a: nid(i, j), b: nid(i + 1, j), w: zw[j], axis: 'x' });
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz - 1; j++) cand.push({ a: nid(i, j), b: nid(i, j + 1), w: xw[i], axis: 'z' });

  // Remove some edges while keeping the network connected.
  const removed = new Set();
  const connected = () => {
    const adj = nodes.map(() => []);
    cand.forEach((e, k) => { if (!removed.has(k)) { adj[e.a].push(e.b); adj[e.b].push(e.a); } });
    const seen = new Uint8Array(nodes.length); const st = [0]; seen[0] = 1; let n = 1;
    while (st.length) { const v = st.pop(); for (const u of adj[v]) if (!seen[u]) { seen[u] = 1; n++; st.push(u); } }
    return n === nodes.length;
  };
  const order = cand.map((_, k) => k).sort(() => rng() - 0.5);
  const target = Math.floor(cfg.removeFrac * cand.length);
  for (const k of order) {
    if (removed.size >= target) break;
    removed.add(k);
    if (!connected()) removed.delete(k);
  }

  const edges = [];
  const link = (a, b, props) => {
    const A = nodes[a], B = nodes[b];
    const e = { id: edges.length, a, b, len: Math.hypot(A.x - B.x, A.z - B.z), ...props };
    edges.push(e); A.adj.push({ to: b, e }); B.adj.push({ to: a, e });
    return e;
  };
  cand.forEach((c, k) => { if (!removed.has(k)) link(c.a, c.b, { w: c.w, axis: c.axis, narrow: c.w < 3.3, kind: 'street', dirt: false }); });

  // Dead-end stubs where an edge was removed.
  const stubs = [];
  for (const k of removed) {
    const c = cand[k];
    const A = nodes[c.a], B = nodes[c.b];
    const len = Math.hypot(A.x - B.x, A.z - B.z);
    if (len < 13 || rng() > cfg.stubChance) continue;
    const flip = rng() < 0.5;
    const J = flip ? B : A, O = flip ? A : B;
    const dx = (O.x - J.x) / len, dz = (O.z - J.z) / len;
    const sl = len * rr(0.45, 0.6);
    stubs.push({ junction: J.id, dx, dz, w: c.w, axis: c.axis, len: sl, endX: J.x + dx * sl, endZ: J.z + dz * sl });
  }
  // Pick the red-car cul-de-sac: a long stub.
  const good = stubs.filter((s) => s.len >= 9);
  if (!good.length) return null;
  good.sort((a, b) => b.len - a.len);
  const red = good[Math.floor(rng() * Math.min(2, good.length))];
  red.w = Math.max(red.w, 4.0); red.red = true;

  // Fields (dirt lots and orchards) occupy some lattice blocks.
  const fields = [];
  const blocks = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) blocks.push([i, j]);
  blocks.sort(() => rng() - 0.5);
  for (const [i, j] of blocks) {
    if (fields.length >= cfg.fields) break;
    const x0 = xs[i] + xw[i] / 2, x1 = xs[i + 1] - xw[i + 1] / 2;
    const z0 = zs[j] + zw[j] / 2, z1 = zs[j + 1] - zw[j + 1] / 2;
    if (x1 - x0 < 9 || z1 - z0 < 9) continue;
    // Keep the red car stub's block a normal built-up block.
    const rj = nodes[red.junction];
    const mx = rj.x + red.dx * red.len * 0.5, mz = rj.z + red.dz * red.len * 0.5;
    if (mx > x0 - 6 && mx < x1 + 6 && mz > z0 - 6 && mz < z1 + 6) continue;
    const orchard = fields.length < cfg.orchardFields;
    const diagFlip = rng() < 0.5;
    const a = diagFlip ? nid(i + 1, j) : nid(i, j), b = diagFlip ? nid(i, j + 1) : nid(i + 1, j + 1);
    const mounds = [];
    if (!orchard) for (let k = 0; k < 3; k++) mounds.push({ x: rr(x0 + 3, x1 - 3), z: rr(z0 + 3, z1 - 3), r: rr(2.2, 3.4), h: rr(0.35, 0.6) });
    fields.push({ x0, x1, z0, z1, orchard, a, b, mounds });
  }

  // ---------- paint the grid ----------
  const grid = new Uint8Array(W * H).fill(SOLID);
  const paint = (x0, z0, x1, z1, v) => {
    const cx0 = Math.max(0, Math.floor(x0 - 0.5)), cx1 = Math.min(W - 1, Math.ceil(x1));
    const cz0 = Math.max(0, Math.floor(z0 - 0.5)), cz1 = Math.min(H - 1, Math.ceil(z1));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const px = cx + 0.5, pz = cz + 0.5;
      if (px >= x0 && px < x1 && pz >= z0 && pz < z1) grid[cz * W + cx] = v;
    }
  };
  for (const f of fields) {
    paint(f.x0, f.z0, f.x1, f.z1, f.orchard ? GRASS : DIRT);
    const A = nodes[f.a], B = nodes[f.b];
    // Dirt track along the diagonal.
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    for (let t = 0; t <= L; t += 0.5) {
      const x = A.x + (B.x - A.x) * t / L, z = A.z + (B.z - A.z) * t / L;
      paint(x - 1.6, z - 1.6, x + 1.6, z + 1.6, DIRT);
    }
    link(f.a, f.b, { w: 2.6, axis: 'd', narrow: false, kind: 'field', dirt: true });
  }
  // Some streets are dirt tracks (orchard level).
  for (const e of edges) if (e.kind === 'street' && rng() < cfg.dirtRoads) e.dirt = true;
  for (const e of edges) {
    if (e.kind !== 'street') continue;
    const A = nodes[e.a], B = nodes[e.b];
    if (e.axis === 'x') paint(Math.min(A.x, B.x), A.z - e.w / 2, Math.max(A.x, B.x), A.z + e.w / 2, e.dirt ? DIRT : PAVE);
    else paint(A.x - e.w / 2, Math.min(A.z, B.z), A.x + e.w / 2, Math.max(A.z, B.z), e.dirt ? DIRT : PAVE);
  }
  for (const n of nodes) {
    const allDirt = n.adj.length && n.adj.every((a) => a.e.dirt);
    paint(n.x - xw[n.i] / 2, n.z - zw[n.j] / 2, n.x + xw[n.i] / 2, n.z + zw[n.j] / 2, allDirt ? DIRT : PAVE);
  }
  for (const s of stubs) {
    const J = nodes[s.junction];
    if (s.axis === 'x') paint(Math.min(J.x, s.endX), J.z - s.w / 2, Math.max(J.x, s.endX), J.z + s.w / 2, PAVE);
    else paint(J.x - s.w / 2, Math.min(J.z, s.endZ), J.x + s.w / 2, Math.max(J.z, s.endZ), PAVE);
    // nav node for the dead end
    const back = s.red ? 2.75 : 1.3;
    const node = { id: nodes.length, x: s.endX - s.dx * back, z: s.endZ - s.dz * back, kind: s.red ? 'red' : 'stub', adj: [] };
    nodes.push(node); s.node = node.id;
    s.edge = link(s.junction, node.id, { w: s.w, axis: s.axis, narrow: s.w < 3.3, kind: 'stub', dirt: false, red: !!s.red });
  }

  const cellAt = (x, z) => {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= W || cz >= H) return SOLID;
    return grid[cz * W + cx];
  };

  // ---------- start position ----------
  const redStub = red;
  const redNode = nodes[red.node];
  let start = null, bestD = -1;
  for (const n of nodes) {
    if (n.kind !== 'lattice') continue;
    const streets = n.adj.filter((a) => a.e.kind === 'street' && a.e.len >= 13);
    if (streets.length < 2) continue;
    const d = Math.hypot(n.x - redNode.x, n.z - redNode.z);
    if (d > bestD) { bestD = d; start = n; }
  }
  if (!start) return null;
  const cxm = W / 2, czm = H / 2;
  let startEdge = null, bestDot = -9;
  for (const a of start.adj) {
    if (a.e.kind !== 'street' || a.e.len < 13) continue;
    const T = nodes[a.to];
    if (T.adj.filter((q) => q.to !== start.id && (q.e.kind === 'street' || q.e.kind === 'field')).length < 2) continue;
    const dx = T.x - start.x, dz = T.z - start.z, L = Math.hypot(dx, dz);
    const dot = (dx * (cxm - start.x) + dz * (czm - start.z)) / (L * Math.hypot(cxm - start.x, czm - start.z) + 1e-6);
    if (dot > bestDot) { bestDot = dot; startEdge = a; }
  }
  return { cfg, rng, rr, pick, W, H, grid, nodes, edges, stubs, fields, xs, zs, xw, zw, cellAt, start, startEdge, redStub, M };
}

export function generateLayout(cfg) {
  for (let k = 0; k < 40; k++) {
    const L = tryLayout(cfg, cfg.seed + k * 101);
    if (L) return L;
  }
  throw new Error('Could not generate level');
}

function makeGroundTexture(L, ppm) {
  const { W, H, grid } = L;
  const cw = W * ppm, ch = H * ppm;
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const rnd = mulberry32(99);
  const solidAt = (cx, cz) => (cx < 0 || cz < 0 || cx >= W || cz >= H) ? true : grid[cz * W + cx] === SOLID;
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const v = grid[cz * W + cx];
    let r, g, b;
    if (v === PAVE) {
      const curb = solidAt(cx - 1, cz) || solidAt(cx + 1, cz) || solidAt(cx, cz - 1) || solidAt(cx, cz + 1);
      [r, g, b] = curb ? [176, 173, 166] : [152, 150, 146];
    } else if (v === DIRT) [r, g, b] = [190, 150, 104];
    else if (v === GRASS) [r, g, b] = [128, 172, 82];
    else [r, g, b] = [200, 193, 180];
    const cellJ = (rnd() - 0.5) * 8;
    for (let py = 0; py < ppm; py++) for (let px = 0; px < ppm; px++) {
      const X = cx * ppm + px, Y = cz * ppm + py;
      let n = (rnd() - 0.5) * (v === DIRT ? 34 : v === GRASS ? 30 : 14) + cellJ;
      if (v === PAVE && (X % (ppm * 2) === 0 || Y % (ppm * 2) === 0)) n -= 10; // slab joints
      const i = (Y * cw + X) * 4;
      d[i] = clamp(r + n, 0, 255); d[i + 1] = clamp(g + n * (v === GRASS ? 1.2 : 0.95), 0, 255); d[i + 2] = clamp(b + n * 0.85, 0, 255); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // stains, pebbles and grass tufts
  for (let k = 0; k < W * H * 0.05; k++) {
    const x = rnd() * W, z = rnd() * H, v = grid[Math.floor(z) * W + Math.floor(x)];
    if (v === SOLID) continue;
    ctx.globalAlpha = 0.08 + rnd() * 0.08;
    ctx.fillStyle = v === PAVE ? '#5c5a56' : v === DIRT ? '#7a5a35' : '#4c7a2e';
    ctx.beginPath(); ctx.arc(x * ppm, z * ppm, (0.3 + rnd() * 0.9) * ppm, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function buildWorld(cfg, opts = {}) {
  const L = generateLayout(cfg);
  const { W, H, grid, nodes, edges, stubs, fields, cellAt, rr, pick } = L;
  const rng = L.rng;
  const group = new THREE.Group();
  const disposables = [];

  // ---------- height field (dirt lots / orchards are bumpy) ----------
  const heightAt = (x, z) => {
    for (const f of fields) {
      if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      const edge = Math.min(x - f.x0, f.x1 - x, z - f.z0, f.z1 - z);
      const fall = smoothstep(0, 2.5, edge);
      let h = (0.1 * Math.sin(x * 1.27) * Math.sin(z * 1.13) + 0.06 * Math.sin(x * 2.9 + z * 1.7) + 0.1) * (f.orchard ? 0.6 : 1);
      for (const m of f.mounds) { const dd = ((x - m.x) ** 2 + (z - m.z) ** 2) / (m.r * m.r); if (dd < 1) h += m.h * (1 - dd) * (1 - dd); }
      return h * fall;
    }
    return 0;
  };

  // ---------- ground mesh ----------
  const ppm = opts.lowQuality ? 3 : 6;
  const tex = makeGroundTexture(L, ppm);
  const gGeo = new THREE.BufferGeometry();
  const vx = W + 1, vz = H + 1;
  const pos = new Float32Array(vx * vz * 3), uv = new Float32Array(vx * vz * 2);
  for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
    const k = j * vx + i;
    pos[k * 3] = i; pos[k * 3 + 1] = heightAt(i, j); pos[k * 3 + 2] = j;
    uv[k * 2] = i / W; uv[k * 2 + 1] = 1 - j / H;
  }
  const idx = new Uint32Array(W * H * 6);
  let t = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1;
    idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
  }
  gGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  gGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  gGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  gGeo.computeVertexNormals();
  const gMat = new THREE.MeshLambertMaterial({ map: tex });
  const ground = new THREE.Mesh(gGeo, gMat);
  ground.receiveShadow = true;
  group.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(W + 800, H + 800), new THREE.MeshLambertMaterial({ color: 0xa8c47e }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(W / 2, -0.03, H / 2);
  group.add(outer);
  disposables.push(gGeo, gMat, tex, outer.geometry, outer.material);

  // ---------- batches ----------
  const B = { bld: new Batch(), det: new Batch(), prop: new Batch(), cyl: new Batch(), sph: new Batch() };
  const colliders = [];
  const addBox = (x0, z0, x1, z1) => colliders.push({ t: 'b', x0, z0, x1, z1 });
  const addCircle = (x, z, r) => colliders.push({ t: 'c', x, z, r });
  // Local-space placement helper (rot about Y).
  const place = (batch, ox, oz, rot, lx, ly, lz, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    batch.add(ox + lx * c + lz * s, ly, oz - lx * s + lz * c, sx, sy, sz, color, rot + ry, rx, rz);
  };

  // ---------- buildings (greedy rectangle decomposition of solid cells) ----------
  const assigned = new Uint8Array(W * H);
  const solid = (cx, cz) => cx < 0 || cz < 0 || cx >= W || cz >= H || grid[cz * W + cx] === SOLID;
  const boxes = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const k = z * W + x;
    if (grid[k] !== SOLID || assigned[k]) continue;
    const maxW = 4 + Math.floor(rng() * 8), maxD = 4 + Math.floor(rng() * 8);
    let w = 1;
    while (x + w < W && w < maxW && grid[k + w] === SOLID && !assigned[k + w]) w++;
    let d = 1;
    outer2: while (z + d < H && d < maxD) {
      for (let i = 0; i < w; i++) { const kk = (z + d) * W + x + i; if (grid[kk] !== SOLID || assigned[kk]) break outer2; }
      d++;
    }
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) assigned[(z + j) * W + x + i] = 1;
    boxes.push({ x, z, w, d });
  }
  for (const b of boxes) {
    const border = b.x === 0 || b.z === 0 || b.x + b.w >= W || b.z + b.d >= H;
    const r = rng();
    const floors = border ? 3 + (rng() < 0.4 ? 1 : 0) : r < 0.3 ? 1 : r < 0.75 ? 2 : 3;
    const h = floors * 3 + 0.5;
    const col = new THREE.Color(pick(WALLS)).offsetHSL(0, 0, (rng() - 0.5) * 0.03);
    const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
    B.bld.add(cx, h / 2, cz, b.w, h, b.d, col.getHex());
    B.bld.add(cx, h + 0.12, cz, b.w + 0.14, 0.26, b.d + 0.14, col.clone().offsetHSL(0, 0, -0.04).getHex()); // parapet ledge
    if (b.w >= 3 && b.d >= 3 && rng() < 0.22) B.cyl.add(cx + rr(-b.w / 4, b.w / 4), h + 0.8, cz + rr(-b.d / 4, b.d / 4), 0.55, 1.1, 0.55, '#e6e6e2');
    if (b.w >= 4 && b.d >= 4 && rng() < 0.15) B.bld.add(cx - b.w / 4, h + 1.1, cz - b.d / 4, 1.8, 2.2, 1.8, col.getHex()); // stair hut
    // facades
    const shutters = rng() < 0.4 ? pick(SHUTTERS) : null;
    const door = pick(['#7a4a2a', '#2f5e8a', '#3c7a4a', '#5b3a24', '#8a2f2f']);
    const sides = [
      { n: [0, -1], along: 'x', fixed: b.z, a0: b.x, a1: b.x + b.w, out: (u) => !solid(u, b.z - 1) },
      { n: [0, 1], along: 'x', fixed: b.z + b.d, a0: b.x, a1: b.x + b.w, out: (u) => !solid(u, b.z + b.d) },
      { n: [-1, 0], along: 'z', fixed: b.x, a0: b.z, a1: b.z + b.d, out: (u) => !solid(b.x - 1, u) },
      { n: [1, 0], along: 'z', fixed: b.x + b.w, a0: b.z, a1: b.z + b.d, out: (u) => !solid(b.x + b.w, u) },
    ];
    for (const sd of sides) {
      let u = sd.a0;
      while (u < sd.a1) {
        if (!sd.out(u)) { u++; continue; }
        let e = u; while (e < sd.a1 && sd.out(e)) e++;
        const len = e - u;
        if (len >= 2) {
          const count = Math.max(1, Math.floor(len / 2.6)), sp = len / count;
          for (let k = 0; k < count; k++) {
            const c = u + sp * (k + 0.5);
            for (let f = 0; f < floors; f++) {
              const roll = rng();
              const at = (off, y, sx, sy, sz, color) => {
                const o = 0.03 + sz / 2;
                if (sd.along === 'x') B.det.add(c + off, y, sd.fixed + sd.n[1] * o, sx, sy, sz, color);
                else B.det.add(sd.fixed + sd.n[0] * o, y, c + off, sz, sy, sx, color);
              };
              if (f === 0 && roll < 0.24) {
                at(0, 1.08, 1.1, 2.16, 0.1, door);
                if (cfg.market && rng() < 0.7) {
                  const aw = pick(AWNINGS), oo = 0.7;
                  if (sd.along === 'x') B.det.add(c, 2.55, sd.fixed + sd.n[1] * oo, 2.3, 0.08, 1.3, aw, 0, sd.n[1] * 0.28, 0);
                  else B.det.add(sd.fixed + sd.n[0] * oo, 2.55, c, 1.3, 0.08, 2.3, aw, 0, 0, -sd.n[0] * 0.28);
                }
              } else if (roll < (f === 0 ? 0.7 : 0.85)) {
                const y = f === 0 ? 1.5 : f * 3 + 1.6;
                at(0, y, 0.95, 1.2, 0.08, '#3e4c5a');
                at(0, y - 0.66, 1.15, 0.1, 0.18, '#d8d2c6'); // sill
                if (shutters) { at(-0.68, y, 0.36, 1.25, 0.06, shutters); at(0.68, y, 0.36, 1.25, 0.06, shutters); }
                if (f > 0 && rng() < 0.16) at(0, y - 1.15, 0.8, 0.5, 0.42, '#d9dcdf'); // AC unit
              }
            }
          }
        }
        u = e;
      }
    }
  }

  // ---------- street props ----------
  const nodeHalf = (n, axis) => (n.kind === 'lattice' ? (axis === 'x' ? L.xw[n.i] : L.zw[n.j]) / 2 : 0);
  // scan from centre line outward to the first solid cell -> wall coordinate (or null)
  const wallAt = (axis, c, u, s) => {
    for (let k = 0; k < 6; k++) {
      const q = c + s * (k + 0.01);
      const cell = axis === 'x' ? cellAt(u, q) : cellAt(q, u);
      if (cell === SOLID) {
        const qi = Math.floor(q);
        return s < 0 ? qi + 1 : qi;
      }
      if (cell !== PAVE && cell !== DIRT) return null;
    }
    return null;
  };
  const poles = [];
  const propTypes = (market) => {
    const r = rng();
    if (market) return r < 0.14 ? 'car' : r < 0.22 ? 'pole' : r < 0.3 ? 'bush' : r < 0.42 ? 'plant' : r < 0.6 ? 'crate' : r < 0.68 ? 'person' : r < 0.84 ? 'stall' : 'none';
    return r < 0.26 ? 'car' : r < 0.38 ? 'pole' : r < 0.52 ? 'bush' : r < 0.64 ? 'plant' : r < 0.72 ? 'crate' : r < 0.8 ? 'person' : 'none';
  };
  const addCar = (x, z, rot, color, clearance = 0.32) => {
    const bodyH = 0.62;
    place(B.prop, x, z, rot, 0, clearance + bodyH / 2, 0, 1.76, bodyH, 4.1, color);
    place(B.prop, x, z, rot, 0, clearance + bodyH + 0.27, -0.15, 1.56, 0.54, 2.05, '#33404c');
    place(B.prop, x, z, rot, 0, clearance + bodyH + 0.58, -0.15, 1.5, 0.08, 1.85, color);
    place(B.det, x, z, rot, 0.6, clearance + 0.42, 2.06, 0.32, 0.14, 0.04, '#fff6d8');
    place(B.det, x, z, rot, -0.6, clearance + 0.42, 2.06, 0.32, 0.14, 0.04, '#fff6d8');
    place(B.det, x, z, rot, 0.62, clearance + 0.45, -2.06, 0.3, 0.14, 0.04, '#c0302a');
    place(B.det, x, z, rot, -0.62, clearance + 0.45, -2.06, 0.3, 0.14, 0.04, '#c0302a');
    for (const [wx, wz] of [[0.8, 1.3], [-0.8, 1.3], [0.8, -1.3], [-0.8, -1.3]])
      place(B.cyl, x, z, rot, wx, 0.33, wz, 0.33, 0.24, 0.33, '#222222', 0, 0, Math.PI / 2);
    const vert = Math.abs(Math.sin(rot)) < 0.5; // length along z
    const hx = vert ? 0.9 : 2.08, hz = vert ? 2.08 : 0.9;
    addBox(x - hx, z - hz, x + hx, z + hz);
  };
  const addPerson = (x, z, rot) => {
    const chair = rng() < 0.5 ? '#f2f2f2' : '#6b4a2f';
    place(B.prop, x, z, rot, 0, 0.45, 0, 0.5, 0.08, 0.5, chair);
    place(B.prop, x, z, rot, 0, 0.72, -0.24, 0.5, 0.55, 0.06, chair);
    place(B.prop, x, z, rot, 0, 0.22, 0, 0.44, 0.44, 0.44, chair);
    const shirt = pick(SHIRTS), pants = pick(['#2c3e50', '#5d4037', '#37474f', '#1f3a5f']);
    place(B.prop, x, z, rot, 0, 0.84, -0.04, 0.42, 0.56, 0.26, shirt);
    place(B.prop, x, z, rot, 0, 0.55, 0.2, 0.38, 0.16, 0.46, pants);
    place(B.prop, x, z, rot, 0, 0.27, 0.42, 0.34, 0.46, 0.14, pants);
    place(B.prop, x, z, rot, 0.26, 0.86, 0.06, 0.1, 0.42, 0.12, shirt, 0, -0.5);
    place(B.prop, x, z, rot, -0.26, 0.86, 0.06, 0.1, 0.42, 0.12, shirt, 0, -0.5);
    place(B.sph, x, z, rot, 0, 1.28, -0.02, 0.15, 0.17, 0.15, pick(SKIN));
    if (rng() < 0.5) place(B.cyl, x, z, rot, 0, 1.42, -0.02, 0.2, 0.06, 0.2, pick(['#f5f0e1', '#2c3e50', '#c0392b']));
    else place(B.sph, x, z, rot, 0, 1.34, -0.05, 0.155, 0.13, 0.155, pick(['#2b1d14', '#5a3b22', '#cfcfcf']));
    addCircle(x, z, 0.45);
  };
  const addStall = (x, z, rot) => {
    place(B.prop, x, z, rot, 0, 0.42, 0, 1.8, 0.84, 0.8, '#e9d8b4');
    const prod = ['#e74c3c', '#f39c12', '#27ae60', '#f1c40f', '#8e44ad'];
    for (let k = 0; k < 4; k++) place(B.det, x, z, rot, -0.65 + k * 0.43, 0.92, 0.05, 0.36, 0.14, 0.5, pick(prod));
    place(B.det, x, z, rot, 0, 2.25, 0.2, 2.3, 0.07, 1.5, pick(AWNINGS), 0, 0.25);
    for (const lx of [-1.05, 1.05]) place(B.cyl, x, z, rot, lx, 1.1, 0.75, 0.04, 2.3, 0.04, '#8b6b4a');
    const vert = Math.abs(Math.sin(rot)) > 0.5;
    const hx = vert ? 0.45 : 0.95, hz = vert ? 0.95 : 0.45;
    addBox(x - hx, z - hz, x + hx, z + hz);
  };

  const propEdges = [...edges.filter((e) => e.kind === 'street' || e.kind === 'stub')];
  for (const e of propEdges) {
    const A = nodes[e.a], Bn = nodes[e.b];
    const axis = e.axis;
    const c = axis === 'x' ? A.z : A.x;
    let ua = axis === 'x' ? A.x : A.z, ub = axis === 'x' ? Bn.x : Bn.z;
    let ha = nodeHalf(A, axis === 'x' ? 'x' : 'z'), hb = nodeHalf(Bn, axis === 'x' ? 'x' : 'z');
    // crossing street half width is the perpendicular line's width
    ha = A.kind === 'lattice' ? (axis === 'x' ? L.xw[A.i] : L.zw[A.j]) / 2 : 0;
    hb = Bn.kind === 'lattice' ? (axis === 'x' ? L.xw[Bn.i] : L.zw[Bn.j]) / 2 : 0;
    let u0, u1;
    if (ua < ub) { u0 = ua + ha + 1.4; u1 = ub - hb - (e.kind === 'stub' ? (e.red ? 6.5 : -0.5) : 1.4); }
    else { u0 = ub + hb + (e.kind === 'stub' ? (e.red ? 6.5 : -0.5) : 1.4); u1 = ua - ha - 1.4; }
    if (e.kind === 'stub' && e.red) continue; // keep the red car cul-de-sac clean
    const placed = [];
    const EXT = { car: 1.95, pole: 0.5, bush: 1.4, plant: 0.8, crate: 0.95, person: 1.0, stall: 0.95, none: 0 };
    const SPAN = { car: 4.4, pole: 0.4, bush: 1.7, plant: 0.8, crate: 0.9, person: 0.9, stall: 2.3, none: 0 };
    const fits = (s, a, b, ext, width) => placed.every((p) => p.s === s || p.b < a - 0.6 || p.a > b + 0.6 || width - ext - p.ext >= 2.5);
    for (const s of [-1, 1]) {
      let u = u0 + rr(0.3, 2.5);
      let lastPole = -99;
      while (u < u1 - 0.6) {
        const wall = wallAt(axis, c, u, s);
        const other = wallAt(axis, c, u, -s);
        if (wall === null) { u += 2; continue; }
        const width = other === null ? 99 : Math.abs(wall - other);
        const rot = axis === 'x' ? (s < 0 ? 0 : Math.PI) : (s < 0 ? Math.PI / 2 : -Math.PI / 2);
        const P = (off) => { const q = wall - s * off; return axis === 'x' ? [u, q] : [q, u]; };
        let type = propTypes(cfg.market);
        if (type === 'car' && (width < 4.4 || u + 4.4 > u1)) type = rng() < 0.5 ? 'plant' : 'none';
        if (type === 'stall' && (width < 4.0 || u + 2.4 > u1)) type = 'crate';
        if (type === 'pole' && u - lastPole < 9) type = 'plant';
        if (width < 3.6 && (type === 'person' || type === 'stall' || type === 'bush')) type = 'plant';
        if (width - EXT[type] < 2.5) type = width - 0.8 >= 2.5 ? 'plant' : 'none';
        // keep a clear lane of at least 2.5 m between props on opposite walls
        if (!fits(s, u, u + SPAN[type], EXT[type], width)) type = fits(s, u, u + 0.8, 0.8, width) ? 'plant' : 'none';
        if (type !== 'none') placed.push({ s, a: u, b: u + SPAN[type], ext: EXT[type] });
        if (type === 'car') {
          u += 2.2; const [x, z] = P(1.05);
          addCar(x, z, axis === 'x' ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI), pick(CARS));
          u += 3.2;
        } else if (type === 'pole') {
          const [x, z] = P(0.3);
          B.cyl.add(x, 3.3, z, 0.09, 6.6, 0.09, '#8a8178');
          place(B.det, x, z, rot, 0, 6.3, 0, 1.3, 0.08, 0.08, '#6d655c');
          addCircle(x, z, 0.2); poles.push({ x, z, side: s, e: e.id }); lastPole = u; u += rr(2, 4);
        } else if (type === 'bush') {
          const r = rr(0.5, 0.85); const [x, z] = P(r * 0.85);
          B.sph.add(x, r * 0.75, z, r, r * 0.9, r, pick(GREENS)); addCircle(x, z, r * 0.8); u += rr(1.8, 3.5);
        } else if (type === 'plant') {
          const [x, z] = P(0.42);
          B.cyl.add(x, 0.25, z, 0.3, 0.5, 0.3, '#c46a3c');
          B.sph.add(x, 0.82, z, 0.42, 0.46, 0.42, pick(GREENS));
          if (rng() < 0.3) B.sph.add(x + 0.12, 1.0, z, 0.12, 0.12, 0.12, pick(['#e84a7a', '#f2c94c', '#ff6b4a']));
          addCircle(x, z, 0.35); u += rr(1.2, 3);
        } else if (type === 'crate') {
          const [x, z] = P(0.5);
          const n = 1 + Math.floor(rng() * 3);
          for (let k = 0; k < n; k++) B.prop.add(x + (k === 1 ? 0.05 : 0), 0.4 + k * 0.8, z, 0.8, 0.8, 0.8, pick(['#b8894e', '#a8783e', '#c79a5c']), rr(-0.2, 0.2));
          addBox(x - 0.45, z - 0.45, x + 0.45, z + 0.45); u += rr(1.4, 3);
        } else if (type === 'person') {
          const [x, z] = P(0.55); addPerson(x, z, rot); u += rr(2, 4);
        } else if (type === 'stall') {
          u += 1.1; const [x, z] = P(0.5); addStall(x, z, rot); u += 2.4;
        } else u += rr(2, 4.5);
      }
    }
  }
  // overhead wires between consecutive poles on the same street side
  const wirePts = [];
  const byKey = {};
  for (const p of poles) (byKey[p.e + ':' + p.side] ||= []).push(p);
  for (const k in byKey) {
    const arr = byKey[k];
    for (let i = 0; i + 1 < arr.length; i++) {
      const a = arr[i], b = arr[i + 1];
      const segs = 6;
      for (let sgi = 0; sgi < segs; sgi++) {
        const t0 = sgi / segs, t1 = (sgi + 1) / segs;
        const y0 = 6.25 - Math.sin(t0 * Math.PI) * 0.45, y1 = 6.25 - Math.sin(t1 * Math.PI) * 0.45;
        wirePts.push(a.x + (b.x - a.x) * t0, y0, a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, y1, a.z + (b.z - a.z) * t1);
      }
    }
  }
  if (wirePts.length) {
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    const wm = new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.7 });
    group.add(new THREE.LineSegments(wg, wm)); disposables.push(wg, wm);
  }

  // ---------- the red car at the end of its cul-de-sac ----------
  const rs = L.redStub;
  const carX = rs.endX - rs.dx * 2.75, carZ = rs.endZ - rs.dz * 2.75;
  const carRot = rs.axis === 'x' ? Math.PI / 2 : 0;
  addCar(carX, carZ, carRot, '#d8322a', 0.5);
  // lone plant + crate near the end wall for flavor
  const redCar = { x: carX, z: carZ, rot: carRot, node: rs.node, junction: rs.junction, dx: rs.dx, dz: rs.dz, edge: rs.edge };

  // ---------- fields ----------
  for (const f of fields) {
    const A = nodes[f.a], Bn = nodes[f.b];
    const segD = (x, z) => {
      const vx2 = Bn.x - A.x, vz2 = Bn.z - A.z, l2 = vx2 * vx2 + vz2 * vz2;
      const tt = clamp(((x - A.x) * vx2 + (z - A.z) * vz2) / l2, 0, 1);
      return Math.hypot(x - (A.x + vx2 * tt), z - (A.z + vz2 * tt));
    };
    if (f.orchard) {
      for (let x = f.x0 + 2.2; x < f.x1 - 1.5; x += 4.2) for (let z = f.z0 + 2.2; z < f.z1 - 1.5; z += 4.2) {
        const tx = x + rr(-0.5, 0.5), tz = z + rr(-0.5, 0.5);
        if (segD(tx, tz) < 2.8 || rng() < 0.12) continue;
        const gy = heightAt(tx, tz);
        B.cyl.add(tx, gy + 0.8, tz, 0.15, 1.6, 0.15, '#7a5a3a');
        const r = rr(1.1, 1.5);
        B.sph.add(tx, gy + 2.3, tz, r, r * 0.85, r, pick(GREENS));
        if (rng() < 0.5) for (let k = 0; k < 3; k++) B.sph.add(tx + rr(-0.9, 0.9), gy + 2.0 + rr(-0.3, 0.4), tz + rr(-0.9, 0.9), 0.11, 0.11, 0.11, pick(['#ff8c1a', '#ffb02e', '#e8541c']));
        addCircle(tx, tz, 0.3);
      }
    } else {
      for (let k = 0; k < 7; k++) {
        const x = rr(f.x0 + 1.5, f.x1 - 1.5), z = rr(f.z0 + 1.5, f.z1 - 1.5);
        if (segD(x, z) < 2.5 || f.mounds.some((m) => Math.hypot(m.x - x, m.z - z) < m.r)) continue;
        const r = rr(0.5, 0.9);
        B.sph.add(x, heightAt(x, z) + r * 0.7, z, r, r * 0.85, r, pick(GREENS)); addCircle(x, z, r * 0.8);
      }
      for (let k = 0; k < 2; k++) {
        const x = rr(f.x0 + 2, f.x1 - 2), z = rr(f.z0 + 2, f.z1 - 2);
        if (segD(x, z) < 2.5 || f.mounds.some((m) => Math.hypot(m.x - x, m.z - z) < m.r)) continue;
        B.cyl.add(x, heightAt(x, z) + 0.55, z, 0.55, 1.2, 0.55, '#e3c167', rng() * 3, 0, Math.PI / 2);
        addCircle(x, z, 0.75);
      }
    }
  }

  // ---------- build instanced meshes ----------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const sphGeo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  disposables.push(boxGeo, cylGeo, sphGeo, mat);
  const meshes = [
    B.bld.build(boxGeo, mat, true, true),
    B.det.build(boxGeo, mat, false, true),
    B.prop.build(boxGeo, mat, true, true),
    B.cyl.build(cylGeo, mat, true, true),
    B.sph.build(sphGeo, mat, true, true),
  ];
  for (const m of meshes) if (m) { group.add(m); disposables.push(m); }

  // ---------- collider spatial hash ----------
  const HC = 4, hash = new Map();
  const hk = (i, j) => i * 4096 + j;
  for (const c of colliders) {
    const x0 = c.t === 'c' ? c.x - c.r : c.x0, x1 = c.t === 'c' ? c.x + c.r : c.x1;
    const z0 = c.t === 'c' ? c.z - c.r : c.z0, z1 = c.t === 'c' ? c.z + c.r : c.z1;
    for (let i = Math.floor(x0 / HC); i <= Math.floor(x1 / HC); i++) for (let j = Math.floor(z0 / HC); j <= Math.floor(z1 / HC); j++) {
      const k = hk(i, j); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(c);
    }
  }

  const res = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
  function collide(px, pz, r) {
    let hit = false, ax = 0, az = 0;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      const cx0 = Math.floor(px - r), cx1 = Math.floor(px + r), cz0 = Math.floor(pz - r), cz1 = Math.floor(pz + r);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        if (!solid(cx, cz)) continue;
        const qx = clamp(px, cx, cx + 1), qz = clamp(pz, cz, cz + 1);
        const dx = px - qx, dz = pz - qz, d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-10) {
          const d = Math.sqrt(d2), pen = r - d;
          px += (dx / d) * pen; pz += (dz / d) * pen; ax += dx / d; az += dz / d; any = hit = true;
        }
      }
      const list = hash.get(hk(Math.floor(px / HC), Math.floor(pz / HC)));
      if (list) for (const c of list) {
        let dx, dz, d2, rr2;
        if (c.t === 'c') { dx = px - c.x; dz = pz - c.z; d2 = dx * dx + dz * dz; rr2 = (r + c.r) ** 2; if (d2 < rr2 && d2 > 1e-10) { const d = Math.sqrt(d2), pen = r + c.r - d; px += dx / d * pen; pz += dz / d * pen; ax += dx / d; az += dz / d; any = hit = true; } }
        else {
          const qx = clamp(px, c.x0, c.x1), qz = clamp(pz, c.z0, c.z1);
          dx = px - qx; dz = pz - qz; d2 = dx * dx + dz * dz;
          if (d2 < r * r && d2 > 1e-10) { const d = Math.sqrt(d2), pen = r - d; px += dx / d * pen; pz += dz / d * pen; ax += dx / d; az += dz / d; any = hit = true; }
          else if (d2 <= 1e-10) { // inside the box: push out along the shortest axis
            const opts2 = [[c.x0 - r - px, 0], [c.x1 + r - px, 0], [0, c.z0 - r - pz], [0, c.z1 + r - pz]];
            opts2.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
            px += opts2[0][0]; pz += opts2[0][1]; ax += Math.sign(opts2[0][0]); az += Math.sign(opts2[0][1]); any = hit = true;
          }
        }
      }
      if (!any) break;
    }
    const l = Math.hypot(ax, az) || 1;
    res.x = px; res.z = pz; res.hit = hit; res.nx = ax / l; res.nz = az / l;
    return res;
  }

  const surfaceAt = (x, z) => cellAt(x, z);
  const nearestNode = (x, z, filter) => {
    let best = null, bd = 1e9;
    for (const n of nodes) { if (filter && !filter(n)) continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  };

  return {
    group, W, H, grid, nodes, edges, stubs, fields, redCar, colliders, heightAt, surfaceAt, collide, nearestNode,
    isSolid: (x, z) => cellAt(x, z) === SOLID,
    start: L.start, startEdge: L.startEdge,
    stats: { buildings: boxes.length, colliders: colliders.length, instances: meshes.reduce((a, m) => a + (m ? m.count : 0), 0) },
    dispose() { group.removeFromParent(); for (const d of disposables) d.dispose && d.dispose(); },
  };
}
