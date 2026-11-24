// traffic.js — NPC cars that follow lanes and traffic lights, pedestrians on sidewalks, fear reactions, spawn/despawn.
import { clamp, damp, dampAngle, rnd, rndPick, rndInt } from './utils.js';
import { createHumanoid, animateHumanoid, setHumanoidDead, SKINS, HAIRS, SHIRTS, PANTS } from './humanoid.js';
import { S, HALF, I_MIN, I_MAX, J_MIN, J_MAX } from './city.js';
import { rayCyl } from './combat.js';

const LANE = 3.4;
const CLEAR = HALF + 1.2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function createTraffic(G) {
  const city = G.city;
  const V = G.vehicles;
  const scene = G.scene;
  const cars = [];
  const peds = [];
  const T = { cars, peds };
  const loc = { fd: 0, ld: 0 };
  const q = G.settings.quality;
  const maxCars = q === 'low' ? 10 : q === 'high' ? 24 : 17;
  const maxPeds = q === 'low' ? 14 : q === 'high' ? 34 : 24;
  let spawnT = 0;
  let pedSpawnT = 0;

  // ---------- NPC cars ----------
  function laneEntry(ax, az, bx, bz) {
    // returns lane line from node A towards node B: start (after leaving A) and end (stop line before B)
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const fx = dx / len, fz = dz / len;
    const lx = fz, lz = -fx;
    return {
      fx, fz,
      sx: ax + fx * CLEAR + lx * LANE, sz: az + fz * CLEAR + lz * LANE,
      ex: bx - fx * CLEAR + lx * LANE, ez: bz - fz * CLEAR + lz * LANE,
    };
  }
  function neighbors(i, j, exclude) {
    const out = [];
    for (const [di, dj] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (!city.hasNode(ni, nj)) continue;
      if (exclude && exclude.i === ni && exclude.j === nj) continue;
      out.push({ i: ni, j: nj, di, dj });
    }
    return out;
  }

  function spawnCar() {
    const P = G.player;
    const cam = G.camera;
    for (let tries = 0; tries < 8; tries++) {
      const ai = rndInt(I_MIN, I_MAX), aj = rndInt(J_MIN, J_MAX);
      const nb = neighbors(ai, aj);
      if (!nb.length) continue;
      const b = rndPick(nb);
      const A = city.node(ai, aj), B = city.node(b.i, b.j);
      const lane = laneEntry(A.x, A.z, B.x, B.z);
      const s = rnd(0.1, 0.9);
      const x = lane.sx + (lane.ex - lane.sx) * s, z = lane.sz + (lane.ez - lane.sz) * s;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d < 70 || d > 300) continue;
      const cdx = x - cam.position.x, cdz = z - cam.position.z;
      const fwd = cam.getWorldDirection(G.tmpV);
      if (d < 150 && (cdx * fwd.x + cdz * fwd.z) > 0) continue;
      let clash = false;
      for (const v of V.list) if (Math.abs(v.x - x) < 9 && Math.abs(v.z - z) < 9) { clash = true; break; }
      if (clash) continue;
      const r = Math.random();
      const type = r < 0.42 ? 'sedan' : r < 0.62 ? 'taxi' : r < 0.74 ? 'sport' : 'truck';
      const yaw = Math.atan2(lane.fx, lane.fz);
      const n = {
        v: null, from: { i: ai, j: aj }, to: { i: b.i, j: b.j }, phase: 'lane', fx: lane.fx, fz: lane.fz,
        sx: lane.sx, sz: lane.sz, ex: lane.ex, ez: lane.ez, xx: 0, xz: 0, next: null, turn: false,
        cruise: type === 'truck' ? rnd(8, 10) : type === 'sport' ? rnd(13, 17) : rnd(10.5, 14.5), panic: 0, stuck: 0, honk: 0,
      };
      const v = V.spawn(type, x, z, yaw, { driver: { npc: true, car: n }, lights: false });
      v.isNPC = true;
      v.vx = lane.fx * 8; v.vz = lane.fz * 8;
      n.v = v;
      cars.push(n);
      return true;
    }
    return false;
  }

  function pickNext(n) {
    const opts = neighbors(n.to.i, n.to.j, n.from);
    if (!opts.length) return { i: n.from.i, j: n.from.j };
    // prefer straight
    const straight = opts.find((o) => o.di === Math.round(n.fx) && o.dj === Math.round(n.fz));
    if (straight && Math.random() < 0.55) return straight;
    return rndPick(opts);
  }

  function updateCar(n, dt) {
    const v = n.v;
    const P = G.player;
    const c = v.ctrl;
    n.panic = Math.max(0, n.panic - dt);
    let target = n.cruise * (n.panic > 0 ? 1.45 : 1);
    let tx, tz;
    if (n.phase === 'lane') {
      const sdx = n.ex - n.sx, sdz = n.ez - n.sz;
      const seg = Math.hypot(sdx, sdz);
      const ux = sdx / seg, uz = sdz / seg;
      const t = (v.x - n.sx) * ux + (v.z - n.sz) * uz;
      const look = Math.min(seg, t + 7 + Math.abs(v.speed) * 0.35);
      tx = n.sx + ux * look; tz = n.sz + uz * look;
      const distEnt = seg - t;
      const moveAxisZ = Math.abs(n.fz) > 0.5;
      const st = city.lightState(n.to.i, n.to.j, moveAxisZ ? 1 : 0);
      let mustStop = false;
      if (st === 2) mustStop = true;
      else if (st === 1 && distEnt > Math.abs(v.speed) * 1.1 + 4) mustStop = true;
      if (mustStop && distEnt < 40) {
        const vmax = Math.sqrt(Math.max(0, 2 * 5 * (distEnt - 3.0)));
        target = Math.min(target, vmax);
      }
      if (distEnt < 3.2 && !(mustStop && distEnt > -2)) {
        // enter the intersection
        n.next = pickNext(n);
        const Bp = city.node(n.to.i, n.to.j);
        const Cp = city.node(n.next.i, n.next.j);
        const out = laneEntry(Bp.x, Bp.z, Cp.x, Cp.z);
        n.xx = out.sx; n.xz = out.sz;
        n.turn = !(Math.abs(out.fx - n.fx) < 0.1 && Math.abs(out.fz - n.fz) < 0.1);
        n.nextLane = out;
        n.phase = 'cross';
      } else if (mustStop && distEnt < 3.2) target = 0;
    }
    if (n.phase === 'cross') {
      tx = n.xx; tz = n.xz;
      if (n.turn) target = Math.min(target, 7.5);
      if (Math.hypot(v.x - tx, v.z - tz) < 4.2) {
        const out = n.nextLane;
        n.from = n.to;
        n.to = { i: n.next.i, j: n.next.j };
        const Cp = city.node(n.to.i, n.to.j);
        const dd = laneEntry(city.node(n.from.i, n.from.j).x, city.node(n.from.i, n.from.j).z, Cp.x, Cp.z);
        n.fx = dd.fx; n.fz = dd.fz;
        n.sx = dd.sx; n.sz = dd.sz; n.ex = dd.ex; n.ez = dd.ez;
        n.phase = 'lane';
        tx = n.sx + n.fx * 8; tz = n.sz + n.fz * 8;
      }
    }
    // obstacle ahead: other vehicles, pedestrians, the player on foot
    const look = 7 + Math.abs(v.speed) * 0.9;
    let allowed = 999;
    const vs = V.list;
    for (let i = 0; i < vs.length; i++) {
      const w = vs[i];
      if (w === v) continue;
      const dx = w.x - v.x, dz = w.z - v.z;
      if (dx > look + 4 || dx < -look - 4 || dz > look + 4 || dz < -look - 4) continue;
      V.local(v, w.x, w.z, loc);
      const half = (v.T.W + w.T.W) * 0.5 * 0.5 + 1.0 + (n.phase === 'cross' && n.turn ? 0.8 : 0);
      if (loc.fd > 0.5 && loc.fd < look + w.T.L * 0.5 && Math.abs(loc.ld) < half) {
        const gap = loc.fd - (v.T.L + w.T.L) * 0.5;
        const a = Math.max(0, (gap - 2.8) * 1.0);
        if (a < allowed) allowed = a;
      }
    }
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p.state === 'dead') continue;
      const dx = p.x - v.x, dz = p.z - v.z;
      if (dx > look || dx < -look || dz > look || dz < -look) continue;
      V.local(v, p.x, p.z, loc);
      if (loc.fd > 0.5 && loc.fd < look && Math.abs(loc.ld) < 1.7) allowed = Math.min(allowed, Math.max(0, (loc.fd - 3.5) * 1.0));
    }
    if (!P.dead && P.mode !== 'driving') {
      V.local(v, P.x, P.z, loc);
      if (loc.fd > 0.5 && loc.fd < look && Math.abs(loc.ld) < 1.7) allowed = Math.min(allowed, Math.max(0, (loc.fd - 3.5) * 1.0));
    }
    if (allowed < target) {
      target = allowed;
      if (allowed < 1 && v.speed < 1) { n.honk -= dt; }
    }
    V.steerTo(v, tx, tz, target);
    c.handbrake = target < 0.2 && Math.abs(v.speed) < 1.5;
    // stuck handling
    if (Math.abs(v.speed) < 0.6 && target > 1) n.stuck += dt; else n.stuck = Math.max(0, n.stuck - dt);
    v.lightsOn = G.gameHour < 6.3 || G.gameHour > 18.6;
  }

  function dropCar(n, instantRemoveVehicle) {
    const i = cars.indexOf(n);
    if (i >= 0) cars.splice(i, 1);
    if (instantRemoveVehicle && n.v && !n.v.removed) V.remove(n.v);
  }

  // ---------- parked cars ----------
  T.spawnParked = (type, x, z, yaw, color) => {
    const v = V.spawn(type, x, z, yaw, { parked: true, color });
    v.parked = true;
    return v;
  };
  T.seedParked = () => {
    const spots = [
      ['sedan', -165.3, 198, 0], ['taxi', -154.7, 208, Math.PI], ['sport', -122, 165.4, Math.PI / 2],
    ];
    for (const s of spots) T.spawnParked(s[0], s[1], s[2], s[3]);
    const rng = (a, b) => a + Math.random() * (b - a);
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < 13; tries++) {
      const alongX = Math.random() < 0.5;
      const i = rndInt(I_MIN, I_MAX - 1), j = rndInt(J_MIN, J_MAX - 1);
      const side = Math.random() < 0.5 ? -1 : 1;
      const dirSign = Math.random() < 0.5 ? 1 : -1;
      let x, z, yaw;
      if (alongX) { x = i * S + rng(HALF + 6, S - HALF - 6); z = j * S + side * 5.3; yaw = dirSign > 0 ? Math.PI / 2 : -Math.PI / 2; } else { x = i * S + side * 5.3; z = j * S + rng(HALF + 6, S - HALF - 6); yaw = dirSign > 0 ? 0 : Math.PI; }
      if (Math.hypot(x + 200, z - 8) < 18) continue;
      let clash = false;
      for (const v of V.list) if (Math.abs(v.x - x) < 7 && Math.abs(v.z - z) < 7) { clash = true; break; }
      if (clash) continue;
      const r = Math.random();
      T.spawnParked(r < 0.5 ? 'sedan' : r < 0.7 ? 'taxi' : r < 0.85 ? 'sport' : 'truck', x, z, yaw);
      placed++;
    }
  };

  // ---------- pedestrians ----------
  function ringFor(bi, bj) { return city.ringCorners(clamp(bi, I_MIN, I_MAX - 1), clamp(bj, J_MIN, J_MAX - 1)); }
  function spawnPed() {
    const P = G.player;
    const cam = G.camera;
    for (let tries = 0; tries < 8; tries++) {
      const bi = rndInt(I_MIN, I_MAX - 1), bj = rndInt(J_MIN, J_MAX - 1);
      const ring = ringFor(bi, bj);
      const c = rndInt(0, 3);
      const a = ring[c], b = ring[(c + 1) % 4];
      const t = Math.random();
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d < 18 || d > 150) continue;
      const fwd = cam.getWorldDirection(G.tmpV);
      if (d < 60 && ((x - cam.position.x) * fwd.x + (z - cam.position.z) * fwd.z) > 0) continue;
      const h = createHumanoid({ shirt: rndPick(SHIRTS), pants: rndPick(PANTS), skin: rndPick(SKINS), hair: rndPick(HAIRS) });
      h.group.traverse((o) => { o.frustumCulled = false; });
      scene.add(h.group);
      const p = {
        h, x, z, y: city.groundY(x, z), yaw: 0, bi, bj, c: (c + 1) % 4, dir: 1, jx: rnd(-0.8, 0.8), jz: rnd(-0.8, 0.8),
        speed: rnd(1.1, 1.8), state: 'walk', hp: 30, fleeT: 0, fx: 0, fz: 0, deadT: 0, waitT: 0, vx: 0, vz: 0, hurtBy: null,
      };
      p.dir = Math.random() < 0.5 ? 1 : -1;
      p.c = (c + (p.dir > 0 ? 1 : 0)) % 4;
      peds.push(p);
      return true;
    }
    return false;
  }
  function removePed(p) {
    const i = peds.indexOf(p);
    if (i >= 0) peds.splice(i, 1);
    scene.remove(p.h.group);
  }
  function snapPedToRing(p) {
    const bi = clamp(Math.floor(p.x / S), I_MIN, I_MAX - 1), bj = clamp(Math.floor(p.z / S), J_MIN, J_MAX - 1);
    const ring = ringFor(bi, bj);
    let best = 0, bd = 1e9;
    for (let k = 0; k < 4; k++) { const d = Math.hypot(ring[k].x - p.x, ring[k].z - p.z); if (d < bd) { bd = d; best = k; } }
    p.bi = bi; p.bj = bj; p.c = best;
  }

  function updatePed(p, dt) {
    const h = p.h;
    if (p.state === 'dead') {
      p.deadT += dt;
      setHumanoidDead(h, Math.min(1, p.deadT * 3));
      h.group.position.set(p.x, p.y, p.z);
      if (p.deadT > 10) h.group.position.y -= (p.deadT - 10) * 1.0;
      if (p.deadT > 12) removePed(p);
      return;
    }
    let spd = 0;
    if (p.state === 'flee') {
      p.fleeT -= dt;
      const ang = Math.atan2(p.fx, p.fz);
      spd = 6.2;
      G.combat.moveActor(p, Math.sin(ang) * spd * dt, Math.cos(ang) * spd * dt, 0.35);
      p.yaw = dampAngle(p.yaw, ang, 12, dt);
      if (p.fleeT <= 0) { p.state = 'walk'; snapPedToRing(p); }
    } else if (p.state === 'hit') {
      p.fleeT -= dt;
      if (p.fleeT <= 0) { p.state = 'flee'; p.fleeT = rnd(4, 7); }
    } else {
      if (p.waitT > 0) { p.waitT -= dt; } else {
        const ring = ringFor(p.bi, p.bj);
        const tgt = ring[p.c];
        const dx = tgt.x + p.jx - p.x, dz = tgt.z + p.jz - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) {
          p.c = (p.c + (p.dir > 0 ? 1 : 3)) % 4;
          if (Math.random() < 0.06) p.waitT = rnd(2, 6);
          if (Math.random() < 0.04) p.dir = -p.dir;
        } else {
          spd = p.speed;
          G.combat.moveActor(p, (dx / d) * spd * dt, (dz / d) * spd * dt, 0.3);
          p.yaw = dampAngle(p.yaw, Math.atan2(dx, dz), 8, dt);
        }
      }
    }
    p.y = city.groundY(p.x, p.z);
    h.group.position.set(p.x, p.y, p.z);
    h.group.rotation.y = p.yaw;
    animateHumanoid(h, dt, spd, false, 0, false);
  }

  // vehicles run pedestrians over
  function pedVehicleHits() {
    const vs = V.list;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p.state === 'dead') continue;
      for (let k = 0; k < vs.length; k++) {
        const v = vs[k];
        if (v.removed || !v.driver) continue;
        const sp = Math.hypot(v.vx, v.vz);
        if (sp < 2.6) continue;
        const dx = p.x - v.x, dz = p.z - v.z;
        if (dx > 4 || dx < -4 || dz > 4 || dz < -4) continue;
        V.local(v, p.x, p.z, loc);
        if (Math.abs(loc.fd) < v.T.L / 2 + 0.3 && Math.abs(loc.ld) < v.T.W / 2 + 0.4) {
          T.damagePed(p, sp * 5 + 12, v);
          p.vx = v.vx * 0.5; p.vz = v.vz * 0.5;
          G.combat.moveActor(p, v.vx * 0.15, v.vz * 0.15, 0.3);
          break;
        }
      }
    }
  }

  // ---------- public API ----------
  T.alarm = (x, z, r) => {
    const r2 = r * r;
    for (const p of peds) {
      if (p.state === 'dead' || p.state === 'flee') continue;
      const dx = p.x - x, dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      const a = Math.atan2(dx / d, dz / d) + rnd(-0.6, 0.6);
      p.fx = Math.sin(a); p.fz = Math.cos(a);
      p.state = 'flee';
      p.fleeT = rnd(4, 8);
    }
    for (const n of cars) if (Math.hypot(n.v.x - x, n.v.z - z) < r * 0.8) n.panic = 4;
  };

  T.damagePed = (p, dmg, source) => {
    if (p.state === 'dead') return;
    p.hp -= dmg;
    const byPlayerCar = source && source.driver === 'player';
    const byPlayer = source === true || source === 'melee' || byPlayerCar;
    if (p.hp <= 0) {
      p.state = 'dead';
      p.deadT = 0;
      if (byPlayer && G.police) G.police.crime('kill', p.x, p.z, { ped: p });
      T.alarm(p.x, p.z, 26);
      G.fx.impact(p.x, 1, p.z);
    } else {
      p.state = 'hit';
      p.fleeT = 0.5;
      p.fx = rnd(-1, 1); p.fz = rnd(-1, 1);
      if (byPlayer && G.police) G.police.crime(byPlayerCar ? 'hitPed' : 'assault', p.x, p.z, { ped: p });
      T.alarm(p.x, p.z, 20);
    }
  };

  T.meleeHit = (P, dmg) => {
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    let best = null, bd = 2.0;
    for (const p of peds) {
      if (p.state === 'dead') continue;
      const dx = p.x - P.x, dz = p.z - P.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || (dx * fx + dz * fz) / (d || 1) < 0.2) continue;
      best = p; bd = d;
    }
    if (!best) return false;
    T.damagePed(best, dmg * 1.5, 'melee');
    G.combat.moveActor(best, fx * 0.6, fz * 0.6, 0.3);
    G.fx.impact(best.x, 1.3, best.z);
    G.hud.hitMarker();
    return true;
  };

  T.rayHit = (ox, oy, oz, dx, dy, dz, maxT) => {
    let bestT = maxT, bp = null;
    for (const p of peds) {
      if (p.state === 'dead') continue;
      if (Math.abs(p.x - ox) > maxT || Math.abs(p.z - oz) > maxT) continue;
      const t = rayCyl(ox, oy, oz, dx, dy, dz, p.x, p.z, 0.4, p.y, p.y + 1.85, bestT);
      if (t < bestT) { bestT = t; bp = p; }
    }
    return bp ? { t: bestT, ped: bp } : null;
  };

  function spawnPedAt(x, z, state) {
    const h = createHumanoid({ shirt: rndPick(SHIRTS), pants: rndPick(PANTS), skin: rndPick(SKINS), hair: rndPick(HAIRS) });
    h.group.traverse((o) => { o.frustumCulled = false; });
    scene.add(h.group);
    const p = {
      h, x, z, y: city.groundY(x, z), yaw: rnd(0, 6.28), bi: 0, bj: 0, c: 0, dir: 1, jx: 0, jz: 0, speed: 1.4, state,
      hp: 30, fleeT: rnd(5, 8), fx: rnd(-1, 1), fz: rnd(-1, 1), deadT: 0, waitT: 0, vx: 0, vz: 0,
    };
    peds.push(p);
    return p;
  }

  const dpos = { x: 0, z: 0 };
  T.ejectDriver = (v) => {
    const n = cars.find((c) => c.v === v);
    V.doorPos(v, dpos);
    const p = spawnPedAt(dpos.x, dpos.z, 'flee');
    p.fleeT = rnd(6, 9);
    p.fx = Math.sin(v.yaw + 1.5); p.fz = Math.cos(v.yaw + 1.5);
    if (n) dropCar(n, false);
    v.driver = null;
    v.isNPC = false;
    v.doorTarget = 1;
    setTimeout(() => { v.doorTarget = 0; }, 700);
    T.alarm(v.x, v.z, 25);
  };
  T.killDriver = (v) => {
    const n = cars.find((c) => c.v === v);
    if (n) dropCar(n, false);
    V.doorPos(v, dpos);
    const p = spawnPedAt(dpos.x, dpos.z, 'dead');
    p.deadT = 0.5;
    T.alarm(v.x, v.z, 40);
  };
  T.panicDriver = (v) => {
    const n = cars.find((c) => c.v === v);
    if (n) n.panic = 6;
  };
  T.explosion = (x, z, r, dmg) => {
    for (const p of peds) {
      if (p.state === 'dead') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < r) T.damagePed(p, dmg * (1 - d / r) + 5, 'explosion');
    }
    T.alarm(x, z, 60);
  };

  // Remove NPC traffic within r metres of the player (used before street races).
  T.clearNearby = (r) => {
    const P = G.player;
    for (let i = cars.length - 1; i >= 0; i--) {
      const n = cars[i];
      if (Math.hypot(n.v.x - P.x, n.v.z - P.z) < r) dropCar(n, true);
    }
  };

  T.reset = () => {
    for (let i = peds.length - 1; i >= 0; i--) removePed(peds[i]);
    for (let i = cars.length - 1; i >= 0; i--) dropCar(cars[i], true);
    cars.length = 0;
  };

  T.populate = () => {
    const P = G.player;
    for (let i = 0; i < Math.floor(maxCars * 0.7); i++) spawnCar();
    for (let i = 0; i < Math.floor(maxPeds * 0.7); i++) spawnPed();
    // snap initial population close enough to be visible around the player
    void P;
  };

  T.update = (dt) => {
    const P = G.player;
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = 0.35;
      if (cars.length < maxCars && !T.suspend) spawnCar();
    }
    pedSpawnT -= dt;
    if (pedSpawnT <= 0) {
      pedSpawnT = 0.3;
      if (peds.length < maxPeds) spawnPed();
    }
    for (let i = cars.length - 1; i >= 0; i--) {
      const n = cars[i];
      const v = n.v;
      if (v.removed) { cars.splice(i, 1); continue; }
      if (!v.alive || v.wreck || v.driver !== n.v.driver || (v.driver && v.driver.car !== n)) { cars.splice(i, 1); v.isNPC = false; continue; }
      const d = Math.hypot(v.x - P.x, v.z - P.z);
      if (d > 320 || (n.stuck > 22 && d > 45)) { dropCar(n, true); continue; }
      updateCar(n, dt);
    }
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      if (p.state !== 'dead' && Math.hypot(p.x - P.x, p.z - P.z) > 190) { removePed(p); continue; }
      updatePed(p, dt);
    }
    pedVehicleHits();
  };

  return T;
}
