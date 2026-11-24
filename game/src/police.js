// police.js — wanted level (1–5 stars), witnessed crimes, patrol cars, foot cops, roadblocks, helicopter, busting, cooling down.
import * as THREE from 'three';
import { clamp, damp, rnd, rndInt, boxPart, cylPart, spherePart, mergeGeos } from './utils.js';
import { S, I_MIN, I_MAX, J_MIN, J_MAX } from './city.js';

const _dir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const THRESH = [0, 18, 50, 90, 140, 200];
const CRIME_VALUE = { carjack: 22, hitPed: 12, assault: 8, shoot: 5, kill: 28, copHit: 22, copKill: 48, hitCar: 3, explode: 15 };
const CRIME_CD = { shoot: 1.0, hitCar: 2.0, assault: 0.8, hitPed: 0.8, carjack: 1.5, copHit: 1.5, kill: 0, copKill: 0, explode: 1 };
const FOOT_CAP = [0, 2, 3, 4, 5, 6];
const CAR_CAP = [0, 1, 2, 3, 4, 5];

function buildHeli() {
  const g = new THREE.Group();
  const body = mergeGeos([
    spherePart(1.5, 12, 8, 0, 0, 0, 0x203a6e, 0.8),
    spherePart(1.1, 10, 8, 0, 0.2, 1.1, 0x1a2c4e, 0.85),
    boxPart(0.35, 0.45, 5.2, 0, 0.35, -3.6, 0x203a6e),
    boxPart(0.1, 1.2, 0.5, 0, 0.9, -6.1, 0x203a6e),
    boxPart(2.2, 0.12, 0.12, 0, -1.2, 0.4, 0x222222),
    boxPart(0.12, 0.7, 0.12, 0.8, -0.85, 0.4, 0x222222),
    boxPart(0.12, 0.7, 0.12, -0.8, -0.85, 0.4, 0x222222),
    boxPart(0.7, 0.4, 0.8, 0, -0.9, 1.6, 0xfafafa),
    boxPart(0.12, 0.12, 2.2, 0.8, -1.2, 0.4, 0x222222),
    boxPart(0.12, 0.12, 2.2, -0.8, -1.2, 0.4, 0x222222),
  ]);
  const bm = new THREE.Mesh(body, new THREE.MeshLambertMaterial({ vertexColors: true }));
  bm.castShadow = false;
  g.add(bm);
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.5, 0);
  const blade = mergeGeos([boxPart(11, 0.05, 0.35, 0, 0, 0, 0x151515), boxPart(0.35, 0.05, 11, 0, 0, 0, 0x151515), boxPart(0.3, 0.3, 0.3, 0, 0.1, 0, 0x555555)]);
  rotor.add(new THREE.Mesh(blade, new THREE.MeshLambertMaterial({ vertexColors: true })));
  g.add(rotor);
  const tail = new THREE.Mesh(mergeGeos([boxPart(0.05, 1.4, 0.2, 0, 0, 0, 0x151515), boxPart(0.05, 0.2, 1.4, 0, 0, 0, 0x151515)]), new THREE.MeshLambertMaterial({ vertexColors: true }));
  tail.position.set(0.2, 0.9, -6.1);
  g.add(tail);
  // searchlight cone (additive, no real light so shaders never recompile)
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(4, 38, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff4c0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
  );
  cone.geometry.translate(0, -19, 0);
  g.add(cone);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffe0 }));
  lamp.position.set(0, -1.1, 1.6);
  g.add(lamp);
  return { group: g, rotor, tail, cone };
}

export function createPolice(G) {
  const scene = G.scene;
  const V = G.vehicles;
  const city = G.city;
  const POL = {
    stars: 0, heat: 0, lostTimer: 0, seen: false, arrest: 0, cars: [], roadblocks: [], heli: null,
    cooldown: {}, searching: false, lastRoadblock: -99, spawnT: 0, footT: 0, calmT: 0,
  };
  let heliState = null;
  const loc = { fd: 0, ld: 0 };

  function starsFromHeat(h) {
    let s = 0;
    for (let i = 1; i < THRESH.length; i++) if (h >= THRESH[i]) s = i;
    return s;
  }
  function applyStars(prev) {
    POL.stars = starsFromHeat(POL.heat);
    if (POL.stars > prev) {
      POL.lostTimer = 0;
      G.audio.ui('wanted');
      G.hud.message('Tingkat buronan ' + '★'.repeat(POL.stars), 'warn', 2.2);
    }
  }

  function witnessed(x, z) {
    for (const e of G.combat.enemies) if (e.team === 'police' && e.state !== 'dead' && Math.hypot(e.x - x, e.z - z) < 65) return true;
    for (const c of POL.cars) if (!c.v.removed && Math.hypot(c.v.x - x, c.v.z - z) < 75) return true;
    if (POL.heli && POL.heli.active && Math.hypot(POL.heli.x - x, POL.heli.z - z) < 120) return true;
    for (const p of G.traffic.peds) if (p.state !== 'dead' && Math.hypot(p.x - x, p.z - z) < 38) return true;
    return false;
  }

  POL.crime = (type, x, z, opts = {}) => {
    const now = performance.now() / 1000;
    const cd = CRIME_CD[type] || 0;
    if (POL.cooldown[type] && now - POL.cooldown[type] < cd) return;
    if (G.missions && G.missions.noWanted) return;
    if (!opts.auto && !opts.force && !witnessed(x, z)) return;
    POL.cooldown[type] = now;
    const prev = POL.stars;
    POL.heat = clamp(POL.heat + (CRIME_VALUE[type] || 5), 0, 260);
    applyStars(prev);
  };
  POL.setStars = (n) => {
    const prev = POL.stars;
    POL.heat = Math.max(POL.heat, THRESH[clamp(n, 0, 5)] + 1);
    if (n === 0) POL.heat = 0;
    applyStars(prev);
    POL.stars = starsFromHeat(POL.heat);
    POL.lostTimer = 0;
  };
  POL.clear = () => {
    POL.heat = 0;
    POL.stars = 0;
    POL.arrest = 0;
    POL.lostTimer = 0;
  };
  POL.vehicleCollision = (a, b, sp) => {
    const pv = G.player.vehicle;
    if (!pv || sp < 5) return;
    const other = a === pv ? b : b === pv ? a : null;
    if (!other) return;
    if (other.isPolice) POL.crime('copHit', other.x, other.z);
    else if (other.isNPC || other.parked) POL.crime('hitCar', other.x, other.z);
  };

  // ---------- spawning ----------
  function visibleToCamera(x, z) {
    const cam = G.camera;
    const fwd = cam.getWorldDirection(G.tmpV);
    const d = Math.hypot(x - cam.position.x, z - cam.position.z);
    return d < 130 && ((x - cam.position.x) * fwd.x + (z - cam.position.z) * fwd.z) > 0;
  }
  function spawnCopCar() {
    const P = G.player;
    for (let t = 0; t < 12; t++) {
      const ai = rndInt(I_MIN, I_MAX), aj = rndInt(J_MIN, J_MAX);
      const A = city.node(ai, aj);
      const d = Math.hypot(A.x - P.x, A.z - P.z);
      if (d < 100 || d > 210) continue;
      // face along the road that leads closest to the player
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => city.hasNode(ai + di, aj + dj));
      if (!opts.length) continue;
      opts.sort((p, q) => Math.hypot(A.x + p[0] * S - P.x, A.z + p[1] * S - P.z) - Math.hypot(A.x + q[0] * S - P.x, A.z + q[1] * S - P.z));
      const [di, dj] = opts[0];
      const x = A.x + di * 14 + dj * 3.4, z = A.z + dj * 14 - di * 3.4;
      if (visibleToCamera(x, z)) continue;
      let clash = false;
      for (const v of V.list) if (Math.abs(v.x - x) < 7 && Math.abs(v.z - z) < 7) { clash = true; break; }
      if (clash) continue;
      const v = V.spawn('police', x, z, Math.atan2(di, dj), { driver: { cop: true }, lights: false });
      v.isNPC = false;
      v.vx = di * 10; v.vz = dj * 10;
      POL.cars.push({ v, stuckT: 0, reverseT: 0, path: null, pathI: 0, pathT: 0, unloaded: false, offT: 0 });
      return true;
    }
    return false;
  }
  function spawnFootCop(x, z) {
    return G.combat.spawnEnemy({ team: 'police', x, z, hp: 75, armed: POL.stars >= 2, speed: 5.0, aggro: true, dmg: 6, acc: 0.38, range: 14, guard: 0, tag: 'cop' });
  }
  const dp = { x: 0, z: 0 };

  function footCount() { return G.combat.countAlive((e) => e.team === 'police'); }

  // ---------- roadblock ----------
  function placeRoadblock() {
    const P = G.player;
    const v = P.vehicle;
    if (!v) return;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const alongZ = Math.abs(fz) >= Math.abs(fx);
    let cx, cz, yaw;
    if (alongZ) {
      const rx = Math.round(P.x / S) * S;
      if (Math.abs(P.x - rx) > 8) return;
      const zAhead = P.z + Math.sign(fz) * 130;
      cz = Math.floor(zAhead / S) * S + S / 2;
      cx = rx; yaw = Math.PI / 2;
    } else {
      const rz = Math.round(P.z / S) * S;
      if (Math.abs(P.z - rz) > 8) return;
      const xAhead = P.x + Math.sign(fx) * 130;
      cx = Math.floor(xAhead / S) * S + S / 2;
      cz = rz; yaw = 0;
    }
    if (cx < I_MIN * S + 20 || cx > I_MAX * S - 20 || cz < J_MIN * S + 20 || cz > J_MAX * S - 20) return;
    const rb = { cars: [], cops: [], t: 0 };
    for (const off of [-4.6, 0, 4.6]) {
      const x = alongZ ? cx + off : cx, z = alongZ ? cz : cz + off;
      const car = V.spawn('police', x, z, yaw, { driver: null, lights: true });
      car.static = true;
      car.parked = false;
      car.sirenOn = true;
      rb.cars.push(car);
    }
    for (const off of [-3, 3]) {
      const sx = alongZ ? cx + off : cx - Math.sign(fx) * 0, sz = alongZ ? cz - Math.sign(fz) * 4 : cz + off;
      const bx = alongZ ? sx : cx - Math.sign(fx) * 4, bz = alongZ ? sz : sz;
      rb.cops.push(G.combat.spawnEnemy({ team: 'police', x: bx, z: bz, hp: 75, armed: true, speed: 5, aggro: false, dmg: 6, acc: 0.38, range: 15, guard: 1, tag: 'roadblock' }));
    }
    POL.roadblocks.push(rb);
    POL.lastRoadblock = performance.now() / 1000;
  }
  function clearRoadblocks(all) {
    const P = G.player;
    for (let i = POL.roadblocks.length - 1; i >= 0; i--) {
      const rb = POL.roadblocks[i];
      const far = Math.hypot(rb.cars[0].x - P.x, rb.cars[0].z - P.z) > 260;
      if (all || far || rb.t > 120) {
        for (const c of rb.cars) V.remove(c);
        for (const e of rb.cops) G.combat.removeEnemy(e);
        POL.roadblocks.splice(i, 1);
      }
    }
  }

  // ---------- helicopter ----------
  function ensureHeli() {
    if (POL.heli) return POL.heli;
    const m = buildHeli();
    m.group.visible = false;
    scene.add(m.group);
    const spot = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff4c0, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    );
    spot.rotation.x = -Math.PI / 2;
    spot.visible = false;
    scene.add(spot);
    POL.heli = { m, spot, x: 0, y: 70, z: 0, yaw: 0, ang: 0, active: false, spotX: 0, spotZ: 0 };
    return POL.heli;
  }
  function updateHeli(dt) {
    const P = G.player;
    const want = POL.stars >= 5;
    if (!want && (!POL.heli || !POL.heli.active)) { G.audio.setHeli(0); return; }
    const h = ensureHeli();
    if (want && !h.active) {
      h.active = true;
      const a = Math.random() * Math.PI * 2;
      h.x = P.x + Math.cos(a) * 320; h.z = P.z + Math.sin(a) * 320; h.y = 60;
      h.spotX = P.x; h.spotZ = P.z;
      h.m.group.visible = true;
      h.spot.visible = true;
    }
    if (!h.active) return;
    h.ang += dt * 0.45;
    let tx, tz, ty;
    if (want) {
      tx = P.x + Math.cos(h.ang) * 24; tz = P.z + Math.sin(h.ang) * 24; ty = 36;
    } else {
      tx = h.x + 200; tz = h.z + 200; ty = 90;
    }
    const dx = tx - h.x, dz = tz - h.z;
    const d = Math.hypot(dx, dz) || 1;
    const sp = Math.min(d * 0.9, want ? 42 : 55);
    h.x += (dx / d) * sp * dt; h.z += (dz / d) * sp * dt;
    h.y = damp(h.y, ty, 1.2, dt);
    const tyaw = Math.atan2(P.x - h.x, P.z - h.z);
    let dyaw = tyaw - h.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    h.yaw += dyaw * Math.min(1, dt * 1.5);
    h.m.group.position.set(h.x, h.y, h.z);
    h.m.group.rotation.set(0.08, h.yaw, Math.sin(h.ang * 3) * 0.04);
    h.m.rotor.rotation.y += dt * 38;
    h.m.tail.rotation.x += dt * 38;
    h.spotX = damp(h.spotX, P.x, 2.6, dt);
    h.spotZ = damp(h.spotZ, P.z, 2.6, dt);
    h.spot.position.set(h.spotX, city.groundY(h.spotX, h.spotZ) + 0.2, h.spotZ);
    h.spot.visible = want;
    h.m.cone.visible = want;
    // aim the searchlight cone from the lamp to the spot
    const lx = h.x, ly = h.y - 1.1, lz = h.z;
    const vx = h.spotX - lx, vy = 0.2 - ly, vz = h.spotZ - lz;
    const L = Math.hypot(vx, vy, vz);
    h.m.cone.rotation.set(0, 0, 0);
    h.m.cone.position.set(0, -1.1, 1.6);
    _dir.set(vx, vy, vz).normalize();
    _q.setFromUnitVectors(_down, _dir);
    _inv.copy(h.m.group.quaternion).invert();
    h.m.cone.quaternion.copy(_inv.multiply(_q));
    h.m.cone.scale.set(1, L / 38, 1);
    G.audio.setHeli(clamp(1 - Math.hypot(h.x - P.x, h.z - P.z) / 300, 0, 1));
    if (!want && Math.hypot(h.x - P.x, h.z - P.z) > 380) {
      h.active = false;
      h.m.group.visible = false;
      h.spot.visible = false;
      G.audio.setHeli(0);
    }
  }

  // ---------- cop car AI ----------
  function updateCopCar(c, dt) {
    const P = G.player;
    const v = c.v;
    const driving = P.mode === 'driving' && P.vehicle;
    let tx = P.x, tz = P.z;
    if (driving) { tx += P.vehicle.vx * 0.5; tz += P.vehicle.vz * 0.5; }
    const dx = tx - v.x, dz = tz - v.z;
    const d = Math.hypot(dx, dz);
    let gx = tx, gz = tz;
    const clear = G.city.raycast(v.x, 1, v.z, dx, 0, dz, d) >= d;
    if (!(clear && d < 70)) {
      c.pathT -= dt;
      if (!c.path || c.pathT <= 0) {
        c.pathT = 1.4;
        const a = city.nearestNode(v.x, v.z), b = city.nearestNode(tx, tz);
        c.path = city.findPath(a.i, a.j, b.i, b.j);
        c.pathI = 0;
      }
      while (c.path && c.pathI < c.path.length) {
        const n = city.node(c.path[c.pathI].i, c.path[c.pathI].j);
        if (Math.hypot(n.x - v.x, n.z - v.z) < 12) c.pathI++; else { gx = n.x; gz = n.z; break; }
      }
    }
    let speed = 22 + POL.stars * 3.2;
    if (driving && d < 40) speed = Math.max(speed, Math.abs(P.vehicle.speed) + 7);
    if (!driving) {
      if (d < 22) speed = clamp((d - 9) * 1.6, 0, 16);
      if (d < 15 && Math.abs(v.speed) < 3 && !c.unloaded) {
        c.unloaded = true;
        const cap = FOOT_CAP[POL.stars] - footCount();
        for (let k = 0; k < Math.min(2, cap); k++) {
          G.vehicles.doorPos(v, dp);
          spawnFootCop(dp.x - Math.cos(v.yaw) * k * 1.2, dp.z + Math.sin(v.yaw) * k * 1.2);
        }
        c.offT = 6;
      }
      if (c.unloaded) {
        c.offT -= dt;
        if (d > 32 || c.offT <= 0) c.unloaded = false;
        else speed = 0;
      }
    }
    if (c.reverseT > 0) {
      c.reverseT -= dt;
      V.steerTo(v, gx, gz, 8, { reverse: true });
      v.ctrl.steer = -v.ctrl.steer;
    } else {
      V.steerTo(v, gx, gz, speed);
      if (Math.abs(v.speed) < 1.2 && speed > 3) c.stuckT += dt; else c.stuckT = 0;
      if (c.stuckT > 1.5) { c.stuckT = 0; c.reverseT = 1.2; }
    }
    v.lightsOn = G.gameHour < 6.3 || G.gameHour > 18.6 || POL.stars > 0;
  }

  // ---------- arrest ----------
  function updateArrest(dt) {
    const P = G.player;
    let near = false;
    const driving = P.mode === 'driving' && P.vehicle;
    if (POL.stars > 0 && !P.dead) {
      const slow = !driving || Math.abs(P.vehicle.speed) < 2.8;
      const reach = driving ? 3.4 : 1.9;
      if (slow) {
        for (const e of G.combat.enemies) {
          if (e.team !== 'police' || e.state === 'dead') continue;
          if (Math.hypot(e.x - P.x, e.z - P.z) < reach) { near = true; break; }
        }
        if (!near && driving) {
          for (const c of POL.cars) if (Math.hypot(c.v.x - P.x, c.v.z - P.z) < 4.6) { near = true; break; }
        }
      }
    }
    if (near) POL.arrest += dt; else POL.arrest = Math.max(0, POL.arrest - dt * 1.4);
    G.hud.setArrest(POL.arrest / 2.4);
    if (POL.arrest >= 2.4) { POL.arrest = 0; G.onBusted(); }
  }

  // ---------- main update ----------
  POL.update = (dt) => {
    const P = G.player;
    const now = performance.now() / 1000;
    // cooling down
    let seen = false;
    if (POL.stars > 0) {
      for (const c of POL.cars) if (!c.v.removed && Math.hypot(c.v.x - P.x, c.v.z - P.z) < 60) { seen = true; break; }
      if (!seen) for (const e of G.combat.enemies) if (e.team === 'police' && e.state !== 'dead' && e.los && Math.hypot(e.x - P.x, e.z - P.z) < 50) { seen = true; break; }
      if (!seen && POL.heli && POL.heli.active && Math.hypot(POL.heli.x - P.x, POL.heli.z - P.z) < 85) seen = true;
    }
    POL.seen = seen;
    if (POL.stars > 0) {
      if (seen) POL.lostTimer = 0; else POL.lostTimer += dt;
      if (POL.lostTimer > 7) {
        const prev = POL.stars;
        POL.heat = Math.max(0, POL.heat - (6 + POL.stars * 1.5) * dt);
        POL.stars = starsFromHeat(POL.heat);
        if (POL.stars < prev) G.hud.message(POL.stars === 0 ? 'Kamu berhasil kabur!' : 'Buronan turun ke ' + '★'.repeat(POL.stars), 'good', 2.5);
      }
    }
    POL.searching = POL.stars > 0 && POL.lostTimer > 1.5;
    if (G.missions && G.missions.noWanted && POL.stars > 0) POL.clear();

    const stars = POL.stars;
    // patrol cars
    POL.spawnT -= dt;
    if (stars > 0 && POL.cars.length < CAR_CAP[stars] && POL.spawnT <= 0) { POL.spawnT = 2.2; spawnCopCar(); }
    // lone foot cop for on-foot chases
    POL.footT -= dt;
    if (stars > 0 && P.mode !== 'driving' && POL.footT <= 0 && footCount() < Math.min(FOOT_CAP[stars], 2 + stars) && POL.cars.length === 0) {
      POL.footT = 4;
      const a = Math.random() * Math.PI * 2, r = 55 + Math.random() * 25;
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      const rr = city.groundY(x, z);
      if (rr < 1 && !visibleToCamera(x, z)) spawnFootCop(x, z);
    }
    for (let i = POL.cars.length - 1; i >= 0; i--) {
      const c = POL.cars[i];
      if (c.v.removed) { POL.cars.splice(i, 1); continue; }
      const d = Math.hypot(c.v.x - P.x, c.v.z - P.z);
      if (c.v.wreck) { POL.cars.splice(i, 1); continue; }
      if (stars === 0) {
        c.v.ctrl.throttle = 0; c.v.ctrl.handbrake = true; c.v.sirenOn = false;
        if (d > 45 && !visibleToCamera(c.v.x, c.v.z)) { V.remove(c.v); POL.cars.splice(i, 1); }
        else if (d > 80) { V.remove(c.v); POL.cars.splice(i, 1); }
        continue;
      }
      if (d > 330) { V.remove(c.v); POL.cars.splice(i, 1); continue; }
      c.v.sirenOn = true;
      updateCopCar(c, dt);
    }
    // roadblocks
    if (stars >= 4 && P.mode === 'driving' && P.vehicle && Math.abs(P.vehicle.speed) > 8 && POL.roadblocks.length < 1 && now - POL.lastRoadblock > 30) placeRoadblock();
    for (const rb of POL.roadblocks) {
      rb.t += dt;
      if (stars >= 4) for (const e of rb.cops) if (e.state !== 'dead' && Math.hypot(e.x - P.x, e.z - P.z) < 45) e.aggro = true;
    }
    if (stars < 4 || POL.roadblocks.length) clearRoadblocks(stars < 4);
    updateHeli(dt);
    // retire foot cops once the heat is off
    if (stars === 0) {
      POL.calmT += dt;
      if (POL.calmT > 3) {
        for (const e of G.combat.enemies.slice()) {
          if (e.team !== 'police') continue;
          e.calm = true; e.aggro = false;
          if (e.state !== 'dead' && Math.hypot(e.x - P.x, e.z - P.z) > 35) G.combat.removeEnemy(e);
        }
      }
    } else POL.calmT = 0;
    updateArrest(dt);
    // sirens
    let nearest = 999;
    if (stars > 0) for (const c of POL.cars) nearest = Math.min(nearest, Math.hypot(c.v.x - P.x, c.v.z - P.z));
    G.audio.setSiren(stars > 0 ? clamp(1 - nearest / 190, 0, 1) : 0, dt);
  };

  // Demo helper: drop n patrol cars close behind the player's vehicle for instant chase scenes.
  POL.debugSpawn = (n) => {
    const P = G.player;
    const v0 = P.vehicle;
    const yaw = v0 ? v0.yaw : P.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (let k = 0; k < n; k++) {
      const back = 18 + k * 11;
      const side = (k % 2 ? 1 : -1) * 2.2;
      const x = P.x - fx * back + fz * side, z = P.z - fz * back - fx * side;
      const v = V.spawn('police', x, z, yaw, { driver: { cop: true }, lights: true });
      v.vx = fx * 20; v.vz = fz * 20;
      POL.cars.push({ v, stuckT: 0, reverseT: 0, path: null, pathI: 0, pathT: 0, unloaded: false, offT: 0 });
    }
  };

  POL.reset = () => {
    for (const c of POL.cars) V.remove(c.v);
    POL.cars.length = 0;
    clearRoadblocks(true);
    for (const e of G.combat.enemies.slice()) if (e.team === 'police') G.combat.removeEnemy(e);
    if (POL.heli) { POL.heli.active = false; POL.heli.m.group.visible = false; POL.heli.spot.visible = false; }
    G.audio.setHeli(0);
    G.audio.setSiren(0, 0.016);
    POL.clear();
    POL.cooldown = {};
  };

  return POL;
}
