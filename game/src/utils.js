// utils.js — shared math, seeded RNG, formatting, and low-poly geometry helpers.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const distSq = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export const angleDiff = (from, to) => wrapAngle(to - from);
export function dampAngle(a, b, lambda, dt) {
  return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
}

// Mulberry32 seeded RNG with helpers.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}

// Unseeded helpers for runtime randomness.
export const rnd = (a = 0, b = 1) => a + (b - a) * Math.random();
export const rndInt = (a, b) => Math.floor(a + (b - a + 1) * Math.random());
export const rndPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function formatMoney(n) {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + 'Rp ' + s;
}
export function formatClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---------- geometry helpers (all return non-indexed geometry with a color attribute) ----------
export function colorize(geo, color) {
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function boxPart(w, h, d, x, y, z, color, rot) {
  let g = new THREE.BoxGeometry(w, h, d);
  if (rot) {
    if (rot.x) g.rotateX(rot.x);
    if (rot.y) g.rotateY(rot.y);
    if (rot.z) g.rotateZ(rot.z);
  }
  g.translate(x, y, z);
  g = g.toNonIndexed();
  return colorize(g, color);
}

export function cylPart(rt, rb, h, seg, x, y, z, color, rot) {
  let g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rot) {
    if (rot.x) g.rotateX(rot.x);
    if (rot.y) g.rotateY(rot.y);
    if (rot.z) g.rotateZ(rot.z);
  }
  g.translate(x, y, z);
  g = g.toNonIndexed();
  return colorize(g, color);
}

export function spherePart(r, ws, hs, x, y, z, color, sy = 1) {
  let g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(1, sy, 1);
  g.translate(x, y, z);
  g = g.toNonIndexed();
  return colorize(g, color);
}

// Profile points are [z, y] pairs (side silhouette); extruded across x with the given width.
export function extrudePart(points, width, color, cx = 0, cy = 0, cz = 0) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => (i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])));
  let g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 + cx, cy, cz);
  if (g.index) g = g.toNonIndexed();
  return colorize(g, color);
}

// Triangle prism: gable roof. Footprint w (x) by d (z), ridge along z.
export function gablePart(w, h, d, x, y, z, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  let g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(x, y, z - d / 2);
  if (g.index) g = g.toNonIndexed();
  return colorize(g, color);
}

// Horizontal quad on the XZ plane facing up. UV swap lets strips be oriented either way.
export function planeXZ(x0, z0, x1, z1, y, color, uv) {
  const pos = new Float32Array(18);
  const nor = new Float32Array(18);
  const uvs = new Float32Array(12);
  const col = new Float32Array(18);
  const c = new THREE.Color(color);
  const pts = [
    [x0, z0], [x1, z1], [x1, z0],
    [x0, z0], [x0, z1], [x1, z1],
  ];
  for (let i = 0; i < 6; i++) {
    const [px, pz] = pts[i];
    pos[i * 3] = px;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = pz;
    nor[i * 3 + 1] = 1;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    const fx = (px - x0) / (x1 - x0 || 1);
    const fz = (pz - z0) / (z1 - z0 || 1);
    if (uv) {
      const { ua, ub, va, vb, swap } = uv;
      uvs[i * 2] = swap ? ua + (ub - ua) * fz : ua + (ub - ua) * fx;
      uvs[i * 2 + 1] = swap ? va + (vb - va) * fx : va + (vb - va) * fz;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Vertical quad facing direction yaw (normal = (sin yaw, 0, cos yaw)), with atlas UV rect.
export function wallQuad(w, h, x, y, z, yaw, u0, v0, u1, v1) {
  let g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  g.rotateY(yaw);
  g.translate(x, y, z);
  g = g.toNonIndexed();
  return colorize(g, 0xffffff);
}

export function mergeGeos(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  geos.forEach((g) => (total += g.attributes.position.count));
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3).fill(1);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  geos.forEach((g) => g.dispose());
  return out;
}
