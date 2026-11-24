// effects.js — particle pools (smoke, dust, fire, sparks), tracers, shockwaves, camera shake.
import * as THREE from 'three';
import { makeCanvas } from './utils.js';

function spriteTexture() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Pool {
  constructor(scene, size, pointSize, additive, tex) {
    this.size = size;
    this.cursor = 0;
    this.pos = new Float32Array(size * 3);
    this.vel = new Float32Array(size * 3);
    this.col = new Float32Array(size * 4);
    this.cs = new Float32Array(size * 6);
    this.life = new Float32Array(size);
    this.maxLife = new Float32Array(size).fill(1);
    this.grav = new Float32Array(size);
    this.drag = new Float32Array(size);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const mat = new THREE.PointsMaterial({
      size: pointSize, map: tex, vertexColors: true, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < size; i++) this.pos[i * 3 + 1] = -999;
  }
  emit(x, y, z, vx, vy, vz, life, c0, c1, grav, drag) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.size;
    const p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    const s = i * 6;
    this.cs[s] = c0[0]; this.cs[s + 1] = c0[1]; this.cs[s + 2] = c0[2];
    this.cs[s + 3] = c1[0]; this.cs[s + 4] = c1[1]; this.cs[s + 5] = c1[2];
  }
  update(dt) {
    for (let i = 0; i < this.size; i++) {
      const c = i * 4;
      if (this.life[i] <= 0) { this.col[c + 3] = 0; continue; }
      this.life[i] -= dt;
      const p = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[p] *= k; this.vel[p + 2] *= k; this.vel[p + 1] = this.vel[p + 1] * k + this.grav[i] * dt;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      if (this.life[i] <= 0) { this.col[c + 3] = 0; this.pos[p + 1] = -999; continue; }
      const t = 1 - this.life[i] / this.maxLife[i];
      const s = i * 6;
      this.col[c] = this.cs[s] + (this.cs[s + 3] - this.cs[s]) * t;
      this.col[c + 1] = this.cs[s + 1] + (this.cs[s + 4] - this.cs[s + 1]) * t;
      this.col[c + 2] = this.cs[s + 2] + (this.cs[s + 5] - this.cs[s + 2]) * t;
      this.col[c + 3] = Math.min(1, (1 - t) * 1.6) * (t < 0.08 ? t / 0.08 : 1) * 0.85;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

const GREY = [0.55, 0.55, 0.55];
const DARK = [0.12, 0.12, 0.12];
const SAND = [0.82, 0.72, 0.55];
const FIRE0 = [1.0, 0.85, 0.35];
const FIRE1 = [0.9, 0.2, 0.05];
const SPARK0 = [1.0, 0.95, 0.6];
const SPARK1 = [1.0, 0.4, 0.1];

export function createEffects(G) {
  const scene = G.scene;
  const tex = spriteTexture();
  const q = G.settings.quality;
  const mul = q === 'low' ? 0.5 : 1;
  const smoke = new Pool(scene, Math.floor(260 * mul), 5.5, false, tex);
  const dust = new Pool(scene, Math.floor(180 * mul), 2.6, false, tex);
  const fire = new Pool(scene, Math.floor(160 * mul), 5.5, true, tex);
  const spark = new Pool(scene, Math.floor(240 * mul), 0.6, true, tex);

  // tracers
  const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat);
    m.visible = false;
    scene.add(m);
    tracers.push({ m, life: 0 });
  }
  let tracerIdx = 0;

  // shockwaves
  const waveGeo = new THREE.SphereGeometry(1, 14, 10);
  const waves = [];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(waveGeo, mat);
    m.visible = false;
    scene.add(m);
    waves.push({ m, life: 0, max: 0.5, size: 10 });
  }
  let waveIdx = 0;

  const r = (a, b) => a + Math.random() * (b - a);
  const fx = {
    shake: 0,
    smoke(x, y, z, dark = false, vy = 1.5) {
      smoke.emit(x + r(-0.2, 0.2), y, z + r(-0.2, 0.2), r(-0.4, 0.4), vy + r(0, 0.8), r(-0.4, 0.4), r(1.2, 2.2), dark ? DARK : GREY, GREY, 0.3, 0.6);
    },
    exhaust(x, y, z, vx, vz) {
      smoke.emit(x, y, z, vx * 0.2 + r(-0.2, 0.2), r(0.2, 0.6), vz * 0.2 + r(-0.2, 0.2), r(0.5, 0.9), [0.7, 0.7, 0.72], [0.8, 0.8, 0.8], 0.1, 1.2);
    },
    dust(x, y, z, amount = 2) {
      for (let i = 0; i < amount; i++) dust.emit(x + r(-0.4, 0.4), y + 0.1, z + r(-0.4, 0.4), r(-1.2, 1.2), r(0.3, 1.2), r(-1.2, 1.2), r(0.5, 1.0), SAND, [0.9, 0.85, 0.75], 0.1, 1.5);
    },
    sparks(x, y, z, n = 8) {
      for (let i = 0; i < n; i++) spark.emit(x, y, z, r(-4, 4), r(0.5, 5), r(-4, 4), r(0.2, 0.5), SPARK0, SPARK1, -9, 0.5);
    },
    impact(x, y, z) {
      fx.sparks(x, y, z, 6);
      dust.emit(x, y, z, 0, 0.5, 0, 0.5, [0.8, 0.8, 0.8], [0.9, 0.9, 0.9], 0, 2);
    },
    muzzle(x, y, z) {
      for (let i = 0; i < 4; i++) fire.emit(x, y, z, r(-1, 1), r(-0.5, 1), r(-1, 1), 0.08, FIRE0, FIRE1, 0, 2);
    },
    fire(x, y, z) {
      fire.emit(x + r(-0.4, 0.4), y, z + r(-0.4, 0.4), r(-0.3, 0.3), r(1, 2.4), r(-0.3, 0.3), r(0.4, 0.8), FIRE0, FIRE1, 0.5, 0.5);
    },
    explosion(x, y, z, scale = 1) {
      for (let i = 0; i < 26 * scale; i++) fire.emit(x + r(-1, 1), y + r(0, 1.2), z + r(-1, 1), r(-6, 6) * scale, r(1, 8) * scale, r(-6, 6) * scale, r(0.5, 1.1), FIRE0, FIRE1, 1, 1.4);
      for (let i = 0; i < 22 * scale; i++) smoke.emit(x + r(-1.5, 1.5), y + r(0.5, 2), z + r(-1.5, 1.5), r(-3, 3), r(2, 6), r(-3, 3), r(1.6, 3.2), DARK, GREY, 0.8, 0.7);
      fx.sparks(x, y + 0.5, z, 24);
      const w = waves[waveIdx];
      waveIdx = (waveIdx + 1) % waves.length;
      w.m.position.set(x, y + 0.5, z);
      w.life = w.max = 0.55;
      w.size = 9 * scale;
      w.m.visible = true;
      fx.shake = Math.min(1, fx.shake + 0.6 * scale);
    },
    tracer(x0, y0, z0, x1, y1, z1) {
      const t = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % tracers.length;
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz) || 1;
      t.m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      t.m.scale.set(1, 1, len);
      t.m.lookAt(x1, y1, z1);
      t.m.visible = true;
      t.life = 0.06;
    },
    update(dt) {
      smoke.update(dt);
      dust.update(dt);
      fire.update(dt);
      spark.update(dt);
      for (const t of tracers) {
        if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.m.visible = false; }
      }
      for (const w of waves) {
        if (w.life > 0) {
          w.life -= dt;
          const k = 1 - Math.max(0, w.life) / w.max;
          w.m.scale.setScalar(1 + k * w.size);
          w.m.material.opacity = (1 - k) * 0.5;
          if (w.life <= 0) w.m.visible = false;
        }
      }
      fx.shake = Math.max(0, fx.shake - dt * 1.8);
    },
  };
  return fx;
}
