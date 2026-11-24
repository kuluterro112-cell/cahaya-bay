// vehicles.js — four drivable car types (+ patrol car), driving physics, damage, fire, explosions, horn, lights.
import * as THREE from 'three';
import {
  clamp, damp, angleDiff, boxPart, cylPart, extrudePart, mergeGeos, makeCanvas, rnd, rndPick,
} from './utils.js';

export const TYPES = {
  sedan: { label: 'Sedan', L: 4.5, W: 1.85, wb: 2.7, r: 0.34, maxSpeed: 38, accel: 11, brake: 26, grip: 7.5, steerMax: 0.55, hp: 100, mass: 1.0, cOff: [-1.35, 0, 1.35], cr: 1.0, door: { z: 0.55, len: 1.1, y: 0.62, h: 0.5 } },
  taxi: { label: 'Taksi', L: 4.5, W: 1.85, wb: 2.7, r: 0.34, maxSpeed: 36, accel: 10, brake: 26, grip: 7.5, steerMax: 0.55, hp: 110, mass: 1.05, cOff: [-1.35, 0, 1.35], cr: 1.0, door: { z: 0.55, len: 1.1, y: 0.62, h: 0.5 } },
  sport: { label: 'Sport', L: 4.3, W: 1.95, wb: 2.6, r: 0.34, maxSpeed: 58, accel: 19, brake: 34, grip: 9.5, steerMax: 0.5, hp: 90, mass: 0.9, cOff: [-1.3, 0, 1.3], cr: 1.02, door: { z: 0.4, len: 1.0, y: 0.52, h: 0.42 } },
  truck: { label: 'Truk', L: 7.0, W: 2.4, wb: 4.2, r: 0.5, maxSpeed: 27, accel: 6.5, brake: 20, grip: 5.2, steerMax: 0.42, hp: 220, mass: 2.8, cOff: [-2.4, -0.8, 0.8, 2.4], cr: 1.3, door: { z: 3.1, len: 1.5, y: 1.4, h: 1.0 } },
  police: { label: 'Patroli', L: 4.6, W: 1.9, wb: 2.75, r: 0.35, maxSpeed: 46, accel: 15, brake: 30, grip: 8.5, steerMax: 0.55, hp: 130, mass: 1.1, cOff: [-1.4, 0, 1.4], cr: 1.02, door: { z: 0.55, len: 1.1, y: 0.62, h: 0.5 } },
};
export const CAR_COLORS = [0xd9342b, 0x2f6fd0, 0xf2f2f2, 0x24282b, 0x9aa3ab, 0x2e9c5a, 0xf29e1f, 0x7a3fb5, 0x14b5c9];

const MAT = {
  body: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x666666 }),
  headOff: new THREE.MeshBasicMaterial({ color: 0xcfd8dc }),
  headOn: new THREE.MeshBasicMaterial({ color: 0xfff4b8 }),
  tail: [new THREE.MeshBasicMaterial({ color: 0x701010 }), new THREE.MeshBasicMaterial({ color: 0xc01c1c }), new THREE.MeshBasicMaterial({ color: 0xff3a2a })],
  redOff: new THREE.MeshBasicMaterial({ color: 0x6a1010 }),
  redOn: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  blueOff: new THREE.MeshBasicMaterial({ color: 0x102060 }),
  blueOn: new THREE.MeshBasicMaterial({ color: 0x3a6aff }),
};

function coneTexture() {
  const c = makeCanvas(64, 128);
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,244,190,0.9)');
  grd.addColorStop(1, 'rgba(255,244,190,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(20, 0); g.lineTo(44, 0); g.lineTo(64, 128); g.lineTo(0, 128); g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const coneGeo = new THREE.PlaneGeometry(6, 14);
coneGeo.rotateX(-Math.PI / 2);
coneGeo.translate(0, 0, 7);
let coneMat = null;

const geoCache = new Map();
function cached(key, build) {
  let g = geoCache.get(key);
  if (!g) { g = build(); geoCache.set(key, g); }
  return g;
}

function bodyGeometry(type, color, wreck) {
  return cached('body|' + type + '|' + color + '|' + (wreck ? 1 : 0), () => {
    const T = TYPES[type];
    const L = T.L, W = T.W;
    const col = wreck ? 0x1b1b1b : color;
    const glass = wreck ? 0x0a0a0a : 0x1f3044;
    const dark = 0x2a2c30;
    const P = [];
    if (type === 'truck') {
      P.push(boxPart(W - 0.3, 0.32, L - 0.3, 0, 0.62, 0, 0x202225));
      P.push(boxPart(W, 1.5, 2.0, 0, 1.55, L / 2 - 1.15, col));
      P.push(boxPart(W - 0.3, 0.6, 0.05, 0, 1.95, L / 2 - 0.13, glass));
      P.push(boxPart(W + 0.02, 0.5, 1.0, 0, 1.95, L / 2 - 1.3, glass));
      P.push(boxPart(W, 2.4, 4.3, 0, 2.15, -1.2, wreck ? 0x222222 : 0xe8e6e0));
      P.push(boxPart(W + 0.03, 0.32, 4.3, 0, 1.55, -1.2, col));
      P.push(boxPart(W, 0.3, 0.22, 0, 0.58, L / 2 - 0.05, dark));
      P.push(boxPart(W, 0.3, 0.22, 0, 0.58, -L / 2 + 0.05, dark));
      P.push(boxPart(0.7, 0.4, 0.05, 0, 1.12, L / 2 + 0.01, 0x1a1a1a));
    } else if (type === 'sport') {
      P.push(extrudePart([[-2.15, 0.3], [2.15, 0.3], [2.15, 0.58], [1.5, 0.74], [0.8, 0.78], [-1.4, 0.78], [-2.15, 0.7]], W, col));
      P.push(extrudePart([[-1.05, 0.76], [0.75, 0.76], [0.3, 1.14], [-0.75, 1.14]], W - 0.3, glass));
      P.push(boxPart(W - 0.34, 0.05, 1.0, 0, 1.16, -0.22, col));
      P.push(boxPart(0.5, 0.02, L * 0.92, 0, 0.8, 0, wreck ? 0x222222 : 0xf4f4f4));
      P.push(boxPart(W - 0.2, 0.07, 0.5, 0, 1.0, -1.95, 0x151515));
      P.push(boxPart(0.1, 0.25, 0.1, 0.6, 0.88, -1.9, 0x151515));
      P.push(boxPart(0.1, 0.25, 0.1, -0.6, 0.88, -1.9, 0x151515));
      P.push(boxPart(W + 0.04, 0.2, 0.22, 0, 0.36, L / 2 - 0.04, dark));
      P.push(boxPart(W - 0.2, 0.15, 0.2, 0, 0.34, -L / 2 + 0.05, dark));
      P.push(boxPart(W - 0.3, 0.16, L - 0.5, 0, 0.28, 0, 0x101010));
      P.push(boxPart(0.12, 0.1, 0.35, W / 2 + 0.05, 0.86, 0.6, col));
      P.push(boxPart(0.12, 0.1, 0.35, -W / 2 - 0.05, 0.86, 0.6, col));
    } else {
      const police = type === 'police';
      P.push(boxPart(W, 0.5, L, 0, 0.6, 0, col));
      P.push(boxPart(W - 0.1, 0.12, L * 0.34, 0, 0.9, L * 0.31, col));
      P.push(boxPart(W - 0.1, 0.12, L * 0.2, 0, 0.9, -L * 0.4, col));
      P.push(extrudePart([[-1.4, 0.85], [0.95, 0.85], [0.55, 1.38], [-1.0, 1.38]], W - 0.18, glass));
      P.push(boxPart(W - 0.22, 0.08, 1.6, 0, 1.42, -0.22, col));
      P.push(boxPart(W + 0.06, 0.26, 0.22, 0, 0.42, L / 2 - 0.05, dark));
      P.push(boxPart(W + 0.06, 0.26, 0.22, 0, 0.42, -L / 2 + 0.05, dark));
      P.push(boxPart(W - 0.3, 0.18, L - 0.5, 0, 0.3, 0, 0x111111));
      P.push(boxPart(W * 0.5, 0.14, 0.05, 0, 0.62, L / 2 + 0.01, 0x1a1a1a));
      P.push(boxPart(0.5, 0.14, 0.03, 0, 0.5, -L / 2 - 0.02, 0xf0f0f0));
      P.push(boxPart(0.12, 0.1, 0.3, W / 2 + 0.05, 1.0, 0.6, col));
      P.push(boxPart(0.12, 0.1, 0.3, -W / 2 - 0.05, 1.0, 0.6, col));
      if (type === 'taxi') {
        P.push(boxPart(0.75, 0.2, 0.32, 0, 1.58, -0.22, wreck ? 0x222222 : 0xfff6c0));
        P.push(boxPart(W + 0.02, 0.1, L * 0.8, 0, 0.74, 0, 0x151515));
      }
      if (police) {
        P.push(boxPart(W + 0.02, 0.34, 1.9, 0, 0.62, -0.1, wreck ? 0x111111 : 0x14213d));
        P.push(boxPart(W - 0.22, 0.09, 0.8, 0, 1.43, -0.2, wreck ? 0x111111 : 0x14213d));
      }
    }
    return mergeGeos(P);
  });
}
function doorGeometry(type, color, wreck) {
  return cached('door|' + type + '|' + color + '|' + (wreck ? 1 : 0), () => {
    const d = TYPES[type].door;
    const col = wreck ? 0x1b1b1b : (type === 'police' ? 0xf4f4f4 : color);
    return mergeGeos([boxPart(0.06, d.h, d.len, 0, d.y, -d.len / 2, col), boxPart(0.07, 0.05, d.len * 0.7, 0.01, d.y + d.h * 0.25, -d.len / 2, 0x20252b)]);
  });
}
function lightGeometry(type, rear) {
  return cached('light|' + type + '|' + rear, () => {
    const T = TYPES[type];
    const y = type === 'truck' ? 0.95 : type === 'sport' ? 0.55 : 0.72;
    const z = (rear ? -1 : 1) * (T.L / 2 + 0.02);
    const xo = T.W / 2 - 0.32;
    const w = rear ? 0.4 : 0.34;
    return mergeGeos([boxPart(w, 0.16, 0.06, xo, y, z, 0xffffff), boxPart(w, 0.16, 0.06, -xo, y, z, 0xffffff)]);
  });
}
function wheelGeometry(T, pair) {
  return cached('wheel|' + T.r + '|' + T.W + '|' + pair, () => {
    const mk = (x) => [
      cylPart(T.r, T.r, 0.3, 14, x, 0, 0, 0x151515, { z: Math.PI / 2 }),
      cylPart(T.r * 0.62, T.r * 0.62, 0.32, 10, x, 0, 0, 0xc9cfd6, { z: Math.PI / 2 }),
    ];
    const xo = T.W / 2 - 0.16;
    return mergeGeos(pair ? [...mk(xo), ...mk(-xo)] : mk(0));
  });
}
const barGeo = new THREE.BoxGeometry(0.5, 0.14, 0.3);

export function createVehicles(G) {
  const scene = G.scene;
  const list = [];
  let nextId = 1;
  let flashT = 0;
  if (!coneMat) {
    coneMat = new THREE.MeshBasicMaterial({ map: coneTexture(), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  }
  const V = { list, TYPES, CAR_COLORS };

  V.randomColor = () => rndPick(CAR_COLORS);

  V.spawn = (type, x, z, yaw, opts = {}) => {
    const T = TYPES[type];
    const color = opts.color !== undefined ? opts.color : (type === 'taxi' ? 0xf6c21c : type === 'police' ? 0xf4f4f4 : rndPick(CAR_COLORS));
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry(type, color, false), MAT.body);
    body.castShadow = true;
    group.add(body);
    const bodyPivot = new THREE.Group(); // body roll/pitch container lives on the body mesh itself
    group.add(bodyPivot);
    // wheels
    const frontL = new THREE.Group(), frontR = new THREE.Group();
    const wm = new THREE.Mesh(wheelGeometry(T, false), MAT.body);
    const wmR = new THREE.Mesh(wheelGeometry(T, false), MAT.body);
    const xo = T.W / 2 - 0.16;
    frontL.position.set(xo, T.r, T.wb / 2);
    frontR.position.set(-xo, T.r, T.wb / 2);
    frontL.add(wm);
    frontR.add(wmR);
    const rear = new THREE.Mesh(wheelGeometry(T, true), MAT.body);
    rear.position.set(0, T.r, -T.wb / 2);
    group.add(frontL, frontR, rear);
    // lights
    const head = new THREE.Mesh(lightGeometry(type, false), MAT.headOff);
    const tail = new THREE.Mesh(lightGeometry(type, true), MAT.tail[0]);
    group.add(head, tail);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(0, 0.14, T.L / 2);
    cone.visible = false;
    group.add(cone);
    // driver-side door (left side = +x)
    const doorPivot = new THREE.Group();
    doorPivot.position.set(T.W / 2 + 0.02, 0, T.door.z);
    const door = new THREE.Mesh(doorGeometry(type, color, false), MAT.body);
    doorPivot.add(door);
    group.add(doorPivot);
    // police light bar
    let redMesh = null, blueMesh = null;
    if (type === 'police' || opts.siren) {
      redMesh = new THREE.Mesh(barGeo, MAT.redOff);
      blueMesh = new THREE.Mesh(barGeo, MAT.blueOff);
      redMesh.position.set(0.28, 1.56, -0.2);
      blueMesh.position.set(-0.28, 1.56, -0.2);
      group.add(redMesh, blueMesh);
    }
    scene.add(group);
    const v = {
      id: nextId++, type, T, color, x, y: 0, z, yaw, vx: 0, vz: 0, speed: 0, lat: 0, steerAngle: 0, steerIn: 0,
      hp: T.hp, maxHp: T.hp, alive: true, wreck: false, exploded: false, burning: false, burnT: 0, smokeT: 0, fireT: 0,
      driver: opts.driver || null, ctrl: { throttle: 0, steer: 0, handbrake: false },
      lightsOn: !!opts.lights, hornOn: false, doorOpen: 0, doorTarget: 0, spin: 0, pitch: 0, roll: 0, prevFwd: 0, yawRate: 0,
      isPolice: type === 'police', isNPC: false, isRacer: false, isMission: false, static: false, parked: !!opts.parked,
      yv: 0, hitCd: 0, removeAt: 0, age: 0, braking: false, tag: opts.tag || '',
      group, body, door, doorPivot, frontL, frontR, wm, wmR, rear, head, tail, cone, redMesh, blueMesh,
    };
    v.y = G.city.groundY(x, z);
    group.position.set(x, v.y, z);
    group.rotation.y = yaw;
    list.push(v);
    return v;
  };

  V.remove = (v) => {
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1);
    scene.remove(v.group);
    v.removed = true;
    if (G.player && G.player.vehicle === v) G.player.vehicle = null;
  };
  V.clear = (pred) => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (!pred || pred(list[i])) { const v = list[i]; list.splice(i, 1); scene.remove(v.group); v.removed = true; }
    }
  };

  V.nearestEnterable = (x, z, maxD) => {
    let best = null, bd = maxD * maxD;
    for (const v of list) {
      if (!v.alive || v.wreck || v.static || v.driver === 'player') continue;
      if (Math.abs(v.speed) > 9) continue;
      const dx = v.x - x, dz = v.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };
  // Door position in world space (left side of the car).
  V.doorPos = (v, out) => {
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const lx = fz, lz = -fx;
    const off = v.T.W / 2 + 0.9;
    out.x = v.x + lx * off + fx * (v.T.door.z - v.T.door.len * 0.5);
    out.z = v.z + lz * off + fz * (v.T.door.z - v.T.door.len * 0.5);
    return out;
  };

  V.damage = (v, amt, src) => {
    if (!v.alive || v.hp <= 0 || amt <= 0) return;
    v.hp -= amt;
    if (v.hp <= 0) { V.explode(v); return; }
    if (v.hp < 35) v.smokeT = Math.max(v.smokeT, 0.01);
    if (v.hp < 18 && !v.burning) { v.burning = true; v.burnT = 0; }
  };

  V.explode = (v) => {
    if (v.exploded) return;
    v.exploded = true;
    v.alive = false;
    v.wreck = true;
    v.hp = 0;
    v.burning = true;
    v.burnT = 0;
    v.lightsOn = false;
    v.removeAt = performance.now() / 1000 + 50;
    G.fx.explosion(v.x, 0.8, v.z, v.type === 'truck' ? 1.5 : 1.1);
    const cam = G.camera.position;
    if (Math.hypot(cam.x - v.x, cam.z - v.z) < 160) G.audio.explosion();
    // swap to charred meshes
    v.body.geometry = bodyGeometry(v.type, v.color, true);
    v.door.geometry = doorGeometry(v.type, v.color, true);
    v.yv = 7;
    v.vx *= 0.4; v.vz *= 0.4;
    v.yawRate = rnd(-2.5, 2.5);
    v.ctrl.throttle = 0; v.ctrl.steer = 0;
    const drv = v.driver;
    v.driver = null;
    if (drv === 'player') {
      G.player.exitVehicleInstant(v);
      G.player.damage(1000, 'explosion');
    } else if (drv && G.traffic) {
      G.traffic.killDriver(v, drv);
    }
    if (G.explosionAt) G.explosionAt(v.x, v.z, 10, 80, v);
  };

  function impactDamage(v, impact, kind) {
    if (impact < 3.2 || v.hitCd > 0) return;
    v.hitCd = 0.12;
    const dmg = (impact - 3) * (kind === 'prop' ? 1.2 : 2.6);
    V.damage(v, dmg);
    G.fx.sparks(v.x, 0.7, v.z, Math.min(10, 2 + impact));
    const cam = G.camera.position;
    const near = Math.hypot(cam.x - v.x, cam.z - v.z) < 70;
    if (near) G.audio.crash(impact);
    if (v.driver === 'player') G.fx.shake = Math.min(1, G.fx.shake + impact / 40);
    if (impact > 7 && G.traffic) G.traffic.alarm(v.x, v.z, 28);
  }

  function collideStatic(v) {
    const T = v.T;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const r = T.cr;
    for (let k = 0; k < T.cOff.length; k++) {
      const o = T.cOff[k];
      let cx = v.x + fx * o, cz = v.z + fz * o;
      const l = G.city.query(cx, cz, r + 1);
      for (let n = 0; n < l.length; n++) {
        const c = l[n];
        const px = clamp(cx, c.x0, c.x1), pz = clamp(cz, c.z0, c.z1);
        const dx = cx - px, dz = cz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx, nz, pen;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; pen = r - d;
        } else {
          const a = cx - c.x0, b = c.x1 - cx, t = cz - c.z0, e = c.z1 - cz;
          const m = Math.min(a, b, t, e);
          if (m === a) { nx = -1; nz = 0; pen = a + r; } else if (m === b) { nx = 1; nz = 0; pen = b + r; } else if (m === t) { nx = 0; nz = -1; pen = t + r; } else { nx = 0; nz = 1; pen = e + r; }
        }
        v.x += nx * pen; v.z += nz * pen;
        cx += nx * pen; cz += nz * pen;
        const vn = v.vx * nx + v.vz * nz;
        if (vn < 0) {
          v.vx -= 1.2 * vn * nx;
          v.vz -= 1.2 * vn * nz;
          // glancing blows scrub speed sideways too
          v.vx *= 0.97; v.vz *= 0.97;
          impactDamage(v, -vn, c.kind);
          if (c.kind !== 'prop' && Math.abs(o) > 0.5) v.yaw += -Math.sign(o) * (nx * fz - nz * fx) * 0.03 * Math.min(1, -vn / 6);
        }
      }
    }
  }

  function collidePair(a, b) {
    const ra = a.T.cr, rb = b.T.cr;
    const fax = Math.sin(a.yaw), faz = Math.cos(a.yaw), fbx = Math.sin(b.yaw), fbz = Math.cos(b.yaw);
    const wa = a.static ? 0 : 1 / a.T.mass, wb = b.static ? 0 : 1 / b.T.mass;
    if (wa + wb === 0) return;
    for (let i = 0; i < a.T.cOff.length; i++) {
      const ax = a.x + fax * a.T.cOff[i], az = a.z + faz * a.T.cOff[i];
      for (let j = 0; j < b.T.cOff.length; j++) {
        const bx = b.x + fbx * b.T.cOff[j], bz = b.z + fbz * b.T.cOff[j];
        const dx = bx - ax, dz = bz - az;
        const rr = ra + rb - 0.05;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, nz = dz / d, pen = rr - d;
        const s = wa + wb;
        a.x -= nx * pen * wa / s; a.z -= nz * pen * wa / s;
        b.x += nx * pen * wb / s; b.z += nz * pen * wb / s;
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rv < 0) {
          const jn = -(1 + 0.35) * rv / s;
          a.vx -= jn * wa * nx; a.vz -= jn * wa * nz;
          b.vx += jn * wb * nx; b.vz += jn * wb * nz;
          const sp = -rv;
          if (sp > 3 && a.hitCd <= 0 && b.hitCd <= 0) {
            const dmgA = (sp - 2.5) * 2.2 * Math.sqrt(b.T.mass / a.T.mass) * (wa ? 1 : 0);
            const dmgB = (sp - 2.5) * 2.2 * Math.sqrt(a.T.mass / b.T.mass) * (wb ? 1 : 0);
            a.hitCd = b.hitCd = 0.15;
            V.damage(a, dmgA, b);
            V.damage(b, dmgB, a);
            G.fx.sparks((ax + bx) / 2, 0.7, (az + bz) / 2, 8);
            const cam = G.camera.position;
            if (Math.hypot(cam.x - ax, cam.z - az) < 70) G.audio.crash(sp);
            if (a.driver === 'player' || b.driver === 'player') G.fx.shake = Math.min(1, G.fx.shake + sp / 40);
            if (sp > 6 && G.traffic) G.traffic.alarm(ax, az, 30);
            if (G.police) G.police.vehicleCollision(a, b, sp);
          }
        }
        return;
      }
    }
  }

  function stepVehicle(v, dt) {
    const T = v.T;
    const inp = G.input;
    let throttle = v.ctrl.throttle, steer = v.ctrl.steer, hb = v.ctrl.handbrake;
    if (v.driver === 'player') {
      throttle = (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0);
      const s = (inp.isDown('KeyA') ? 1 : 0) - (inp.isDown('KeyD') ? 1 : 0);
      v.steerIn = damp(v.steerIn, s, 9, dt);
      steer = v.steerIn;
      hb = inp.isDown('Space');
      if (inp.wasPressed('KeyL')) { v.lightsOn = !v.lightsOn; G.audio.ui('click'); }
      v.hornOn = inp.isDown('KeyH');
      G.audio.setHorn(v.hornOn);
    } else if (!v.driver || v.wreck) {
      throttle = 0; steer = 0; hb = true;
    }
    if (v.static) { v.vx = v.vz = 0; hb = true; }
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const lx = fz, lz = -fx;
    let fwd = v.vx * fx + v.vz * fz;
    let lat = v.vx * lx + v.vz * lz;
    const maxF = T.maxSpeed * (v.hp < 30 ? 0.7 : 1);
    v.braking = false;
    if (throttle > 0.01) {
      if (fwd < -0.5) { fwd += T.brake * throttle * dt; v.braking = true; } else fwd += T.accel * throttle * Math.max(0, 1 - Math.max(0, fwd) / maxF) * dt;
    } else if (throttle < -0.01) {
      if (fwd > 0.5) { fwd += T.brake * throttle * dt; v.braking = true; } else fwd += T.accel * 0.6 * throttle * Math.max(0, 1 + fwd / (maxF * 0.32)) * dt;
    } else {
      const eb = Math.min(Math.abs(fwd), 3.2 * dt);
      fwd -= Math.sign(fwd) * eb;
    }
    fwd = Math.max(fwd, -maxF * 0.32);
    fwd -= fwd * (0.05 + 0.0018 * Math.abs(fwd)) * dt;
    if (hb) {
      const eb = Math.min(Math.abs(fwd), 24 * dt);
      fwd -= Math.sign(fwd) * eb;
      if (Math.abs(fwd) > 3) v.braking = true;
    }
    const g = hb ? (v.driver === 'player' ? 1.5 : 6) : T.grip;
    lat *= Math.exp(-g * dt);
    const maxS = T.steerMax / (1 + Math.abs(fwd) / 16);
    v.steerAngle = damp(v.steerAngle, steer * maxS, 10, dt);
    let yawRate = (fwd / T.wb) * Math.tan(v.steerAngle);
    if (hb && Math.abs(fwd) > 4 && v.driver === 'player') yawRate *= 1.7;
    yawRate = clamp(yawRate, -2.6, 2.6);
    if (v.wreck) yawRate = v.yawRate * Math.max(0, 1 - v.age * 0.5);
    v.yawRate = yawRate;
    v.vx = fx * fwd + lx * lat;
    v.vz = fz * fwd + lz * lat;
    v.yaw += yawRate * dt;
    v.x += v.vx * dt;
    v.z += v.vz * dt;
    v.speed = fwd;
    v.lat = lat;
    const acc = (fwd - v.prevFwd) / Math.max(dt, 1e-3);
    v.prevFwd = fwd;
    v.accel = acc;
    // drift dust / tire smoke
    if (!v.wreck && Math.abs(lat) > 3.5 && Math.abs(fwd) > 7 && Math.random() < 0.7) {
      const rx = v.x - fx * T.wb / 2, rz = v.z - fz * T.wb / 2;
      G.fx.dust(rx + lx * 0.8, v.y, rz + lz * 0.8, 1);
      G.fx.dust(rx - lx * 0.8, v.y, rz - lz * 0.8, 1);
      if (v.driver === 'player' && Math.random() < 0.3) G.audio.step(true);
    }
    // exhaust
    if (!v.wreck && v.driver && Math.random() < 0.18 && Math.abs(throttle) > 0.2) {
      G.fx.exhaust(v.x - fx * (T.L / 2 + 0.1) + lx * 0.5, 0.35, v.z - fz * (T.L / 2 + 0.1) + lz * 0.5, v.vx * 0.2, v.vz * 0.2);
    }
  }

  V.update = (dt) => {
    if (dt <= 0) return;
    flashT += dt;
    const now = performance.now() / 1000;
    const cam = G.camera.position;
    const steps = dt > 0.034 ? 2 : 1;
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        v.age += sdt;
        if (v.hitCd > 0) v.hitCd -= sdt;
        if (v.wreck && v.yv === 0 && Math.abs(v.vx) + Math.abs(v.vz) < 0.2 && v.age > 0) { /* settled */ }
        stepVehicle(v, sdt);
        collideStatic(v);
        G.city.clampToWorld(v);
        if (v.z > 388) { v.z = 388; v.vz = Math.min(0, v.vz); }
      }
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          const dx = a.x - b.x, dz = a.z - b.z;
          const lim = (a.T.L + b.T.L) * 0.5 + 0.5;
          if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
          collidePair(a, b);
        }
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i];
      const T = v.T;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      // vertical: follow terrain; wrecks hop
      const gy = G.city.groundY(v.x, v.z);
      if (v.yv !== 0 || v.y > gy + 0.01) {
        v.yv -= 22 * dt;
        v.y += v.yv * dt;
        if (v.y <= gy) { v.y = gy; v.yv = 0; }
      } else v.y = damp(v.y, gy, 18, dt);
      const dist = Math.hypot(cam.x - v.x, cam.z - v.z);
      v.group.visible = dist < 420;
      if (!v.group.visible) continue;
      v.group.position.set(v.x, v.y, v.z);
      v.group.rotation.y = v.yaw;
      // body motion
      const rollT = clamp(-v.yawRate * v.speed * 0.0035, -0.08, 0.08);
      const pitchT = clamp(-(v.accel || 0) * 0.004, -0.05, 0.05);
      v.roll = damp(v.roll, rollT, 6, dt);
      v.pitch = damp(v.pitch, pitchT, 6, dt);
      v.body.rotation.z = v.roll;
      v.body.rotation.x = v.pitch;
      // wheels
      v.spin += (v.speed * dt) / T.r;
      v.frontL.rotation.y = v.steerAngle;
      v.frontR.rotation.y = v.steerAngle;
      v.wm.rotation.x = v.spin;
      v.wmR.rotation.x = v.spin;
      v.rear.rotation.x = v.spin;
      // door
      v.doorOpen = damp(v.doorOpen, v.doorTarget, 9, dt);
      v.doorPivot.rotation.y = -v.doorOpen * 1.05;
      // lights
      const braking = v.braking && !v.wreck;
      v.head.material = v.lightsOn ? MAT.headOn : MAT.headOff;
      v.tail.material = braking ? MAT.tail[2] : v.lightsOn ? MAT.tail[1] : MAT.tail[0];
      v.cone.visible = v.lightsOn && !v.wreck && dist < 140;
      if (v.redMesh) {
        const active = (v.isPolice && (G.police && G.police.stars > 0)) || v.sirenOn;
        const ph = active ? Math.floor(flashT * 6) % 2 : -1;
        v.redMesh.material = ph === 0 ? MAT.redOn : MAT.redOff;
        v.blueMesh.material = ph === 1 ? MAT.blueOn : MAT.blueOff;
      }
      // damage effects
      if (!v.wreck) {
        if (v.hp < 35 && dist < 120) {
          v.smokeT -= dt;
          if (v.smokeT <= 0) { v.smokeT = 0.07; G.fx.smoke(v.x + fx * 1.7, 1.1, v.z + fz * 1.7, v.hp < 18, 1.8); }
        }
        if (v.burning) {
          v.burnT += dt;
          if (dist < 120) { v.fireT -= dt; if (v.fireT <= 0) { v.fireT = 0.05; G.fx.fire(v.x + fx * 1.6, 0.9, v.z + fz * 1.6); } }
          if (v.burnT > 8 && v.hp > 0) V.explode(v);
        }
      } else if (dist < 140) {
        v.fireT -= dt;
        if (v.fireT <= 0 && v.age < 60) {
          v.fireT = 0.08;
          if (now < v.removeAt - 30) G.fx.fire(v.x + (Math.random() - 0.5) * 1.5, 0.7, v.z + (Math.random() - 0.5) * 2);
          G.fx.smoke(v.x, 1.2, v.z, true, 2.2);
        }
      }
      if (v.wreck && now > v.removeAt && dist > 25 && v.driver !== 'player') V.remove(v);
    }
  };

  // Steering helper for AI drivers (traffic, police, racers): head to (tx,tz) at about speedTarget (m/s).
  V.steerTo = (v, tx, tz, speedTarget, opts) => {
    const dx = tx - v.x, dz = tz - v.z;
    const desired = Math.atan2(dx, dz);
    let err = angleDiff(v.yaw, desired);
    const rev = opts && opts.reverse;
    if (rev) err = angleDiff(v.yaw + Math.PI, desired);
    let steer = clamp(err * 2.0, -1, 1);
    if (rev) steer = -steer;
    let tgt = speedTarget;
    if (tgt > 0) tgt = Math.max(4, tgt * (1 - Math.min(0.72, Math.abs(err) * 0.85)));
    const c = v.ctrl;
    if (rev) {
      c.throttle = -clamp((6 - -v.speed) * 0.5, 0, 1);
      c.handbrake = false;
    } else if (tgt <= 0.01) {
      c.throttle = v.speed > 0.6 ? -1 : 0;
      c.handbrake = v.speed < 1.2;
    } else {
      c.throttle = clamp((tgt - v.speed) * 0.45, -1, 1);
      c.handbrake = false;
    }
    c.steer = steer;
    return Math.hypot(dx, dz);
  };

  // Local-frame helper: where is point (x,z) relative to vehicle? returns {fd, ld} (forward, left distances).
  V.local = (v, x, z, out) => {
    const dx = x - v.x, dz = z - v.z;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    out.fd = dx * fx + dz * fz;
    out.ld = dx * fz - dz * fx;
    return out;
  };

  return V;
}
