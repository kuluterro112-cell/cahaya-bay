// humanoid.js — shared low-poly character model (body, head, swinging arms and legs) used by player, pedestrians, gang, police.
import * as THREE from 'three';
import { boxPart, spherePart, mergeGeos } from './utils.js';

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const gunGeo = mergeGeos([boxPart(0.06, 0.1, 0.12, 0, -0.04, 0, 0x1c1c1f), boxPart(0.05, 0.05, 0.3, 0, 0.02, 0.0, 0x2a2a2e)]);
gunGeo.rotateX(-Math.PI / 2);
const cache = new Map();

export const SKINS = [0xf1c9a5, 0xd9a47c, 0xb97c54, 0x8a5a3a, 0x6b4328];
export const HAIRS = [0x1a1410, 0x2a1e14, 0x4a3320, 0x101010, 0x6a5a40];
export const SHIRTS = [0xe04a3a, 0x2f7fd0, 0xf2c230, 0x3aa86a, 0xf08a2a, 0xd8d8d8, 0x8a4ab0, 0x1fb5c0, 0xf06a9a, 0x4a4a52];
export const PANTS = [0x2a3a5a, 0x3a3a3e, 0x6a5a40, 0x1a1a1a, 0x4a6a8a];

function bodyGeo(shirt, skin, hair, cap) {
  const key = 'b' + shirt + '|' + skin + '|' + hair + '|' + cap;
  let g = cache.get(key);
  if (!g) {
    const parts = [
      boxPart(0.52, 0.64, 0.28, 0, 1.15, 0, shirt),
      boxPart(0.54, 0.08, 0.3, 0, 0.86, 0, 0x2a2a2a),
      spherePart(0.17, 10, 8, 0, 1.62, 0, skin),
      boxPart(0.1, 0.1, 0.1, 0, 1.46, 0, skin),
    ];
    if (cap) {
      parts.push(boxPart(0.36, 0.1, 0.36, 0, 1.76, 0, cap));
      parts.push(boxPart(0.3, 0.03, 0.14, 0, 1.7, 0.24, cap));
    } else {
      parts.push(boxPart(0.35, 0.12, 0.35, 0, 1.76, -0.01, hair));
      parts.push(boxPart(0.35, 0.2, 0.1, 0, 1.64, -0.14, hair));
    }
    parts.push(boxPart(0.03, 0.03, 0.03, 0.06, 1.64, 0.165, 0x101010));
    parts.push(boxPart(0.03, 0.03, 0.03, -0.06, 1.64, 0.165, 0x101010));
    g = mergeGeos(parts);
    cache.set(key, g);
  }
  return g;
}
function armGeo(shirt, skin) {
  const key = 'a' + shirt + '|' + skin;
  let g = cache.get(key);
  if (!g) {
    g = mergeGeos([boxPart(0.17, 0.3, 0.19, 0, -0.15, 0, shirt), boxPart(0.15, 0.32, 0.17, 0, -0.46, 0, skin)]);
    cache.set(key, g);
  }
  return g;
}
function legGeo(pants) {
  const key = 'l' + pants;
  let g = cache.get(key);
  if (!g) {
    g = mergeGeos([boxPart(0.23, 0.78, 0.25, 0, -0.39, 0, pants), boxPart(0.25, 0.1, 0.32, 0, -0.8, 0.03, 0x1c1c1c)]);
    cache.set(key, g);
  }
  return g;
}

// opts: { shirt, pants, skin, hair, cap, scale }
export function createHumanoid(opts = {}) {
  const shirt = opts.shirt !== undefined ? opts.shirt : 0x2f7fd0;
  const pants = opts.pants !== undefined ? opts.pants : 0x2a3a5a;
  const skin = opts.skin !== undefined ? opts.skin : SKINS[0];
  const hair = opts.hair !== undefined ? opts.hair : HAIRS[0];
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const body = new THREE.Mesh(bodyGeo(shirt, skin, hair, opts.cap || 0), MAT);
  body.castShadow = true;
  inner.add(body);
  const armL = new THREE.Mesh(armGeo(shirt, skin), MAT);
  const armR = new THREE.Mesh(armGeo(shirt, skin), MAT);
  armL.position.set(0.35, 1.45, 0);
  armR.position.set(-0.35, 1.45, 0);
  const legL = new THREE.Mesh(legGeo(pants), MAT);
  const legR = new THREE.Mesh(legGeo(pants), MAT);
  legL.position.set(0.13, 0.86, 0);
  legR.position.set(-0.13, 0.86, 0);
  armL.castShadow = armR.castShadow = legL.castShadow = legR.castShadow = true;
  inner.add(armL, armR, legL, legR);
  const gun = new THREE.Mesh(gunGeo, MAT);
  gun.position.set(0, -0.62, 0.05);
  gun.rotation.x = Math.PI / 2;
  gun.visible = false;
  armR.add(gun);
  if (opts.scale) group.scale.setScalar(opts.scale);
  return { group, inner, body, armL, armR, legL, legR, gun, phase: 0, dead: 0 };
}

// speed in m/s drives the swing amplitude. opts: aim, punch (0..1 progress), air.
export function animateHumanoid(h, dt, speed, aim, punch, air) {
  const amp = Math.min(1, speed / 5.5);
  h.phase += dt * (3 + speed * 1.55);
  const s = Math.sin(h.phase) * 0.95 * amp;
  if (air) {
    h.legL.rotation.x = -0.6; h.legR.rotation.x = 0.4;
    h.armL.rotation.x = -2.2; h.armR.rotation.x = -2.0;
  } else {
    h.legL.rotation.x = s;
    h.legR.rotation.x = -s;
    h.armL.rotation.x = -s * 0.85;
    h.armR.rotation.x = s * 0.85;
  }
  h.armL.rotation.z = 0.06;
  h.armR.rotation.z = -0.06;
  if (aim) {
    h.armR.rotation.x = -1.5;
    h.armL.rotation.x = -1.2;
    h.armL.rotation.z = -0.25;
  }
  if (punch > 0) {
    const k = Math.sin(Math.min(1, punch) * Math.PI);
    h.armR.rotation.x = -1.7 * k;
    h.armL.rotation.x = 0.5 * k;
    h.inner.rotation.y = -0.4 * k;
  } else if (h.inner.rotation.y !== 0) h.inner.rotation.y = 0;
}

// k: 0 standing .. 1 lying on its back.
export function setHumanoidDead(h, k) {
  h.dead = k;
  h.inner.rotation.x = -k * 1.5;
  h.inner.position.y = k * 0.22;
  h.inner.position.z = -k * 0.5;
}
