// Tire marks (instanced decals), dust/smoke puffs (points) and the cheap
// barrel / fisheye post-process.
import * as THREE from '../vendor/three.module.js';

export class TireMarks {
  constructor(scene, max = 900) {
    const geo = new THREE.PlaneGeometry(0.15, 0.42); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    this.max = max; this.i = 0; this.n = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.c = new THREE.Color();
    this.mesh.setColorAt(0, this.c.set(0x000000));
    scene.add(this.mesh);
  }
  add(x, y, z, yaw, color) {
    this.e.set(0, yaw, 0); this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(x, y + 0.015, z), this.q, new THREE.Vector3(1, 1, 1));
    this.mesh.setMatrixAt(this.i, this.m); this.mesh.setColorAt(this.i, this.c.set(color));
    this.i = (this.i + 1) % this.max; this.n = Math.min(this.max, this.n + 1);
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  reset() { this.i = 0; this.n = 0; this.mesh.count = 0; }
}

export class Dust {
  constructor(scene, max = 160) {
    this.max = max; this.i = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.col = new Float32Array(max * 3); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } }, transparent: true, depthWrite: false,
      vertexShader: `attribute float aLife; attribute vec3 aColor; attribute float aSize; uniform float uScale;
        varying float vLife; varying vec3 vCol;
        void main(){ vLife=aLife; vCol=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize = aLife>0.0 ? aSize*(1.0+(1.0-aLife)*2.2)*uScale/max(0.5,-mv.z) : 0.0; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying float vLife; varying vec3 vCol;
        void main(){ vec2 d=gl_PointCoord-0.5; float r=dot(d,d)*4.0; if(r>1.0) discard;
          gl_FragColor=vec4(vCol,(1.0-r)*vLife*0.45); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.geo = g;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vz, color, size = 0.35) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx + (Math.random() - 0.5) * 1.2; this.vel[i * 3 + 1] = 0.6 + Math.random() * 0.8; this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * 1.2;
    const c = new THREE.Color(color);
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.life[i] = 1; this.size[i] = size * (0.7 + Math.random() * 0.6);
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 1.1;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3] *= 0.96; this.vel[i * 3 + 2] *= 0.96; this.vel[i * 3 + 1] *= 0.97;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true;
  }
  reset() { this.life.fill(0); }
}

export const FISHEYE_K = 0.22;
export function makePost() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uK: { value: FISHEYE_K }, uAspect: { value: 1 }, uVignette: { value: 0.22 }, uFlash: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uK; uniform float uAspect; uniform float uVignette; uniform float uFlash; varying vec2 vUv;
      void main(){
        vec2 d = vUv - 0.5; vec2 da = vec2(d.x*uAspect, d.y);
        float r2 = dot(da,da) / (0.25*(uAspect*uAspect+1.0));
        float norm = 1.0 + uK;
        vec2 uv = 0.5 + d * (1.0 + uK*r2) / norm;
        vec3 col = texture2D(tDiffuse, uv).rgb;
        col *= 1.0 - uVignette * r2 * r2;
        col = mix(col, vec3(1.0), uFlash);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false; scene.add(quad);
  return { scene, camera, mat };
}
// Map a pre-distortion NDC-ish offset (from screen centre, in 0..1 uv units) to its on-screen position.
export function fisheyeForward(dx, dy, aspect, k = FISHEYE_K) {
  // solve d*(1+k*r2(d))/(1+k) = s for d (fixed point iterations)
  let x = dx, y = dy;
  const denom = 0.25 * (aspect * aspect + 1);
  for (let i = 0; i < 5; i++) {
    const r2 = (x * x * aspect * aspect + y * y) / denom;
    const f = (1 + k * r2) / (1 + k);
    x = dx / f; y = dy / f;
  }
  return [x, y];
}
