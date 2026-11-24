// combat.js — pistol (hitscan raycast), ammo/reload, gang + police foot enemies with AI and health bars, pickups.
import * as THREE from 'three';
import { clamp, dampAngle, angleDiff, rnd, boxPart, cylPart, mergeGeos, TAU } from './utils.js';
import { createHumanoid, animateHumanoid, setHumanoidDead, SKINS, HAIRS } from './humanoid.js';

export function rayCyl(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1, maxT) {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return Infinity;
  const ex = ox - cx, ez = oz - cz;
  const b = 2 * (ex * dx + ez * dz);
  const c = ex * ex + ez * ez - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) { t = (-b + sq) / (2 * a); if (t < 0) return Infinity; }
  if (t > maxT) return Infinity;
  const y = oy + dy * t;
  if (y < y0 || y > y1) return Infinity;
  return t;
}

export function rayVehicle(v, ox, oy, oz, dx, dy, dz, maxT) {
  const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
  const rx = ox - v.x, rz = oz - v.z;
  const of = rx * fx + rz * fz, ol = rx * fz - rz * fx;
  const df = dx * fx + dz * fz, dl = dx * fz - dz * fx;
  const hl = v.T.L / 2, hw = v.T.W / 2;
  const H = v.type === 'truck' ? 3.1 : v.type === 'sport' ? 1.2 : 1.5;
  let tmin = 0, tmax = maxT;
  const slab = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };
  if (!slab(of, df, -hl, hl) || !slab(ol, dl, -hw, hw) || !slab(oy, dy, 0.2, H)) return Infinity;
  return tmin;
}

const barGeo = new THREE.PlaneGeometry(1, 0.11);
const barBg = new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false });
const barRed = new THREE.MeshBasicMaterial({ color: 0xe0413a, depthTest: false, depthWrite: false });
const barBlue = new THREE.MeshBasicMaterial({ color: 0x4a8cff, depthTest: false, depthWrite: false });

const pickupGeos = {};
function pickupGeo(kind) {
  if (pickupGeos[kind]) return pickupGeos[kind];
  let g;
  if (kind === 'ammo') g = mergeGeos([boxPart(0.55, 0.36, 0.34, 0, 0, 0, 0xe0b030), boxPart(0.57, 0.1, 0.36, 0, 0.0, 0, 0x3a3a3a), boxPart(0.2, 0.08, 0.2, 0, 0.22, 0, 0xffe070)]);
  else if (kind === 'health') g = mergeGeos([boxPart(0.5, 0.4, 0.3, 0, 0, 0, 0xf4f4f4), boxPart(0.32, 0.1, 0.32, 0, 0, 0, 0xe02828), boxPart(0.1, 0.32, 0.32, 0, 0, 0, 0xe02828)]);
  else g = mergeGeos([boxPart(0.5, 0.5, 0.26, 0, 0, 0, 0x2e6fd8), boxPart(0.3, 0.1, 0.28, 0, 0.12, 0, 0x9ac4ff), boxPart(0.54, 0.08, 0.3, 0, -0.2, 0, 0x1a3a7a)]);
  pickupGeos[kind] = g;
  return g;
}
const pickupMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x555555 });
const ringGeo = new THREE.RingGeometry(0.5, 0.75, 20);
ringGeo.rotateX(-Math.PI / 2);

export function createCombat(G) {
  const scene = G.scene;
  const enemies = [];
  const pickups = [];
  const C = { enemies, pickups, fireCd: 0, reloadT: 0, lastEnemySound: 0 };
  const dir = new THREE.Vector3();
  const org = new THREE.Vector3();

  // ---------- generic actor movement with wall collision ----------
  C.moveActor = (a, mx, mz, r = 0.4) => {
    const x0 = a.x, z0 = a.z;
    a.x += mx; a.z += mz;
    const l = G.city.query(a.x, a.z, r + 1);
    for (let n = 0; n < l.length; n++) {
      const c = l[n];
      const px = clamp(a.x, c.x0, c.x1), pz = clamp(a.z, c.z0, c.z1);
      const dx = a.x - px, dz = a.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); a.x += (dx / d) * (r - d); a.z += (dz / d) * (r - d); } else {
        const q0 = a.x - c.x0, q1 = c.x1 - a.x, q2 = a.z - c.z0, q3 = c.z1 - a.z;
        const m = Math.min(q0, q1, q2, q3);
        if (m === q0) a.x = c.x0 - r; else if (m === q1) a.x = c.x1 + r; else if (m === q2) a.z = c.z0 - r; else a.z = c.z1 + r;
      }
    }
    G.city.clampToWorld(a);
    return Math.hypot(a.x - x0, a.z - z0) / Math.max(1e-6, Math.hypot(mx, mz));
  };

  // ---------- enemies ----------
  function makeBar(team) {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(barGeo, barBg);
    const fg = new THREE.Mesh(barGeo, team === 'police' ? barBlue : barRed);
    bg.renderOrder = 20; fg.renderOrder = 21;
    bg.scale.set(1.1, 1.1, 1);
    g.add(bg, fg);
    g.visible = false;
    return { g, fg };
  }

  // opts: team, x, z, hp, armed, speed, shirt, pants, cap, aggro, scale, name, boss, dmg, acc, onDeath, tag, range, guard
  C.spawnEnemy = (opts) => {
    const team = opts.team || 'gang';
    const police = team === 'police';
    const h = createHumanoid({
      shirt: opts.shirt !== undefined ? opts.shirt : police ? 0x1d3a7a : rnd(0, 1) < 0.5 ? 0x24242a : 0xe07a1f,
      pants: opts.pants !== undefined ? opts.pants : police ? 0x14203a : 0x2a2a2e,
      skin: SKINS[Math.floor(Math.random() * SKINS.length)],
      hair: HAIRS[Math.floor(Math.random() * HAIRS.length)],
      cap: opts.cap !== undefined ? opts.cap : police ? 0x14203a : 0,
      scale: opts.scale,
    });
    h.group.traverse((o) => { o.frustumCulled = false; });
    scene.add(h.group);
    const bar = makeBar(team);
    scene.add(bar.g);
    const e = {
      team, x: opts.x, z: opts.z, y: G.city.groundY(opts.x, opts.z), yaw: opts.yaw || 0,
      hp: opts.hp || 60, maxHp: opts.hp || 60, armed: !!opts.armed, speed: opts.speed || 4.6, runSpeed: (opts.speed || 4.6) * 1.55,
      h, bar, state: 'idle', aggro: !!opts.aggro, atkCd: rnd(0.2, 1), shootCd: rnd(0.4, 1.4), deadT: 0, dmg: opts.dmg || (police ? 6 : 7),
      acc: opts.acc !== undefined ? opts.acc : 0.4, range: opts.range || 13, name: opts.name || '', boss: !!opts.boss, onDeath: opts.onDeath || null,
      tag: opts.tag || '', home: { x: opts.x, z: opts.z }, wanderT: rnd(1, 4), tx: opts.x, tz: opts.z, punch: 0, speedNow: 0,
      losT: 0, los: true, path: null, pathI: 0, pathT: 0, stuckT: 0, sideT: 0, sideDir: 1, hitT: 0, guard: opts.guard !== undefined ? opts.guard : 4, alive: true,
      strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: rnd(1, 3), calm: false, hold: !!opts.hold,
    };
    h.group.position.set(e.x, e.y, e.z);
    enemies.push(e);
    return e;
  };

  C.removeEnemy = (e) => {
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    scene.remove(e.h.group);
    scene.remove(e.bar.g);
    e.alive = false;
  };
  C.removeByTag = (tag) => {
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].tag === tag) C.removeEnemy(enemies[i]);
  };
  C.countAlive = (pred) => enemies.reduce((n, e) => n + (e.state !== 'dead' && (!pred || pred(e)) ? 1 : 0), 0);

  C.damageEnemy = (e, amt, byPlayer) => {
    if (e.state === 'dead') return;
    e.hp -= amt;
    e.hitT = 0.12;
    if (!e.aggro && !e.calm) e.aggro = true;
    e.state = e.state === 'idle' ? 'chase' : e.state;
    if (byPlayer && e.team === 'police' && G.police) G.police.crime(e.hp <= 0 ? 'copKill' : 'copHit', e.x, e.z, { auto: true });
    if (e.hp <= 0) C.killEnemy(e, byPlayer);
  };
  C.killEnemy = (e, byPlayer) => {
    e.hp = 0;
    e.state = 'dead';
    e.deadT = 0;
    e.h.gun.visible = false;
    e.bar.g.visible = false;
    if (e.team === 'gang' && Math.random() < 0.6) C.spawnPickup('ammo', e.x + rnd(-0.5, 0.5), e.z + rnd(-0.5, 0.5), { respawn: false, life: 40 });
    if (e.boss) C.spawnPickup('health', e.x, e.z + 1, { respawn: false, life: 60 });
    if (e.onDeath) e.onDeath(e);
    if (byPlayer && e.team === 'gang' && G.traffic) G.traffic.alarm(e.x, e.z, 30);
  };

  C.meleeHit = (P, dmg) => {
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    let best = null, bd = 2.1;
    for (const e of enemies) {
      if (e.state === 'dead') continue;
      const dx = e.x - P.x, dz = e.z - P.z;
      const d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.25) continue;
      best = e; bd = d;
    }
    if (!best) return false;
    C.damageEnemy(best, dmg, true);
    const k = 0.6 / (bd || 1);
    C.moveActor(best, (best.x - P.x) * k, (best.z - P.z) * k);
    G.fx.impact(best.x, 1.3, best.z);
    G.hud.hitMarker();
    return true;
  };

  C.explosion = (x, z, r, dmg) => {
    for (const e of enemies) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < r) C.damageEnemy(e, dmg * (1 - d / r), true);
    }
  };

  function enemyShoot(e, tx, ty, tz, hitChance, inVehicle) {
    const now = performance.now() / 1000;
    const ox = e.x + Math.sin(e.yaw) * 0.5, oy = 1.45, oz = e.z + Math.cos(e.yaw) * 0.5;
    const P = G.player;
    const hit = Math.random() < hitChance;
    let ex = tx, ey = ty, ez = tz;
    if (!hit) { ex += rnd(-1.6, 1.6); ey = rnd(0, 1.6); ez += rnd(-1.6, 1.6); }
    G.fx.tracer(ox, oy, oz, ex, ey, ez);
    G.fx.muzzle(ox, oy, oz);
    if (now - C.lastEnemySound > 0.12) { C.lastEnemySound = now; G.audio.enemyShot(); }
    if (hit) {
      if (inVehicle && P.vehicle) { G.vehicles.damage(P.vehicle, e.dmg * 0.8); P.damage(e.dmg * 0.35, 'bullet'); } else P.damage(e.dmg, 'bullet');
    } else G.fx.impact(ex, 0.2, ez);
    e.h.armR.rotation.x = -1.5;
  }

  function updateEnemy(e, dt, P, now) {
    const h = e.h;
    if (e.state === 'dead') {
      e.deadT += dt;
      setHumanoidDead(h, Math.min(1, e.deadT * 3));
      h.group.position.set(e.x, e.y, e.z);
      if (e.deadT > (e.team === 'police' ? 7 : 12)) { h.group.position.y -= (e.deadT - (e.team === 'police' ? 7 : 12)) * 1.2; if (e.deadT > (e.team === 'police' ? 9 : 14)) C.removeEnemy(e); }
      return;
    }
    if (e.hitT > 0) e.hitT -= dt;
    const dxp = P.x - e.x, dzp = P.z - e.z;
    const d = Math.hypot(dxp, dzp);
    const police = e.team === 'police';
    if (police) e.armed = G.police.stars >= 2;
    h.gun.visible = e.armed && e.aggro;
    const playerAlive = !P.dead;
    if (!e.aggro && !e.calm && !e.hold && playerAlive) {
      if (d < 14 || (d < 26 && e.los)) e.aggro = true;
      else if (police && G.police.stars > 0) e.aggro = true;
    }
    if (e.calm) e.aggro = false;
    e.losT -= dt;
    if (e.losT <= 0 && d < 60) {
      e.losT = 0.25 + Math.random() * 0.1;
      e.los = G.city.raycast(e.x, 1.4, e.z, dxp, 1.1 - 1.4, dzp, d) >= d - 0.5;
    }
    let mvx = 0, mvz = 0, spd = 0;
    let attackAnim = 0;
    if (!e.aggro || !playerAlive) {
      // idle: loiter near home
      e.state = 'idle';
      e.wanderT -= dt;
      if (e.wanderT <= 0 && e.guard > 0) {
        e.wanderT = rnd(3, 7);
        e.tx = e.home.x + rnd(-e.guard, e.guard);
        e.tz = e.home.z + rnd(-e.guard, e.guard);
      }
      const dx = e.tx - e.x, dz = e.tz - e.z, dd = Math.hypot(dx, dz);
      if (dd > 0.6) { mvx = dx / dd; mvz = dz / dd; spd = 1.4; e.yaw = dampAngle(e.yaw, Math.atan2(dx, dz), 8, dt); }
    } else {
      e.state = 'chase';
      const hold = e.armed ? e.range : 1.4;
      let tx = P.x, tz = P.z;
      const inVeh = P.mode === 'driving' && P.vehicle;
      if (inVeh) { tx = P.vehicle.x; tz = P.vehicle.z; }
      const dx = tx - e.x, dz = tz - e.z;
      const dist = Math.hypot(dx, dz);
      const canShoot = e.armed && dist < e.range + 5 && e.los;
      // movement: direct when close with line of sight, otherwise follow the road graph
      let gx = tx, gz = tz;
      if (!e.los && dist > 10) {
        e.pathT -= dt;
        if (!e.path || e.pathT <= 0) {
          e.pathT = 1.6;
          const a = G.city.nearestNode(e.x, e.z), b = G.city.nearestNode(tx, tz);
          e.path = G.city.findPath(a.i, a.j, b.i, b.j);
          e.pathI = 0;
        }
        while (e.path && e.pathI < e.path.length) {
          const n = G.city.node(e.path[e.pathI].i, e.path[e.pathI].j);
          if (Math.hypot(n.x - e.x, n.z - e.z) < 5) e.pathI++; else { gx = n.x; gz = n.z; break; }
        }
      }
      const gdx = gx - e.x, gdz = gz - e.z, gd = Math.hypot(gdx, gdz) || 1;
      const want = Math.atan2(dx, dz);
      e.yaw = dampAngle(e.yaw, e.armed && canShoot ? want : Math.atan2(gdx, gdz), 10, dt);
      if (dist > hold + (e.armed ? 0.5 : 0)) {
        mvx = gdx / gd; mvz = gdz / gd;
        spd = dist > 9 ? e.runSpeed : e.speed;
      } else if (e.armed && canShoot) {
        // strafe while shooting
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafeT = rnd(1, 2.6); e.strafeDir = -e.strafeDir; }
        mvx = (dz / (dist || 1)) * e.strafeDir; mvz = (-dx / (dist || 1)) * e.strafeDir; spd = 1.8;
      }
      // attack
      e.atkCd -= dt;
      e.shootCd -= dt;
      if (!e.armed && dist < 1.9 && e.atkCd <= 0) {
        e.atkCd = police ? 0.9 : 1.1;
        e.punch = 0.001;
        if (inVeh) {
          G.vehicles.damage(P.vehicle, 3);
          G.fx.sparks(P.vehicle.x, 1, P.vehicle.z, 3);
          G.audio.punch();
        } else {
          P.damage(e.dmg, 'melee');
          G.audio.punch();
          G.fx.impact(P.x, 1.3, P.z);
        }
      } else if (canShoot && e.shootCd <= 0) {
        e.shootCd = police ? rnd(0.9, 1.6) : rnd(0.8, 1.5);
        const fall = clamp(1.25 - dist / 32, 0.15, 1);
        const moving = P.speed > 4 || inVeh ? 0.75 : 1;
        enemyShoot(e, tx, inVeh ? 1 : 1.2, tz, e.acc * fall * moving, inVeh);
        attackAnim = 1;
      }
      if (e.punch > 0) { e.punch += dt; if (e.punch > 0.4) e.punch = 0; }
    }
    // apply movement with collision and stuck handling
    if (spd > 0) {
      let ang = Math.atan2(mvx, mvz);
      if (e.sideT > 0) { e.sideT -= dt; ang += e.sideDir * 1.1; }
      const sx = Math.sin(ang) * spd * dt, sz = Math.cos(ang) * spd * dt;
      const eff = C.moveActor(e, sx, sz);
      if (eff < 0.4) {
        e.stuckT += dt;
        if (e.stuckT > 0.5) { e.stuckT = 0; e.sideT = 0.7; e.sideDir = Math.random() < 0.5 ? -1 : 1; }
      } else e.stuckT = Math.max(0, e.stuckT - dt);
      if (!e.aggro) e.yaw = dampAngle(e.yaw, ang, 8, dt);
      else if (!(e.armed && e.los)) e.yaw = dampAngle(e.yaw, ang, 10, dt);
    }
    e.speedNow = spd;
    e.y = G.city.groundY(e.x, e.z);
    h.group.position.set(e.x, e.y, e.z);
    h.group.rotation.y = e.yaw;
    animateHumanoid(h, dt, spd, e.armed && e.aggro, e.punch > 0 ? e.punch / 0.4 : 0, false);
    if (attackAnim || (e.armed && e.aggro && e.shootCd > 0.5)) h.armR.rotation.x = -1.5;
  }

  const ENEMY_SEP = 0.8;
  function separate() {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (b.state === 'dead') continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        if (dx > ENEMY_SEP || dx < -ENEMY_SEP || dz > ENEMY_SEP || dz < -ENEMY_SEP) continue;
        const d = Math.hypot(dx, dz) || 0.01;
        if (d < ENEMY_SEP) { const p = (ENEMY_SEP - d) * 0.5; a.x -= dx / d * p; a.z -= dz / d * p; b.x += dx / d * p; b.z += dz / d * p; }
      }
    }
  }

  // ---------- pickups ----------
  C.spawnPickup = (kind, x, z, opts = {}) => {
    const m = new THREE.Mesh(pickupGeo(kind), pickupMat);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: kind === 'ammo' ? 0xffd04a : kind === 'health' ? 0xff5a5a : 0x5aa0ff, transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.set(x, 0.9, z);
    ring.position.set(x, 0.14, z);
    scene.add(m, ring);
    const p = { kind, x, z, mesh: m, ring, active: true, respawn: opts.respawn !== false, cool: 0, life: opts.life || 0, t: Math.random() * 6, amount: opts.amount };
    pickups.push(p);
    return p;
  };
  function removePickup(p) {
    const i = pickups.indexOf(p);
    if (i >= 0) pickups.splice(i, 1);
    scene.remove(p.mesh, p.ring);
    p.ring.material.dispose();
  }
  C.clearPickups = () => { for (let i = pickups.length - 1; i >= 0; i--) removePickup(pickups[i]); };
  C.seedPickups = () => {
    const kinds = ['health', 'ammo', 'armor', 'ammo', 'health'];
    G.city.pickupSpots.forEach((s, i) => C.spawnPickup(kinds[i % kinds.length], s.x, s.z, { respawn: true }));
  };
  function updatePickups(dt, P) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      if (p.life > 0) { p.life -= dt; if (p.life <= 0) { removePickup(p); continue; } }
      if (!p.active) {
        p.cool -= dt;
        if (p.cool <= 0) { p.active = true; p.mesh.visible = true; p.ring.visible = true; }
        continue;
      }
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.9 + Math.sin(p.t * 3) * 0.12;
      const dx = P.x - p.x, dz = P.z - p.z;
      if (dx * dx + dz * dz < 2.6) {
        let ok = true;
        if (p.kind === 'ammo') {
          if (!P.hasPistol) ok = false;
          else { const n = p.amount || 24; P.ammoReserve = Math.min(240, P.ammoReserve + n); G.hud.message('+' + n + ' amunisi', 'good', 1.6); }
        } else if (p.kind === 'health') {
          if (P.health >= P.maxHealth - 1) ok = false;
          else { P.heal(45); G.hud.message('+ Health', 'good', 1.6); }
        } else { if (P.armor >= 100) ok = false; else { P.addArmor(60); G.hud.message('+ Armor', 'good', 1.6); } }
        if (ok) {
          G.audio.pickup();
          if (p.respawn) { p.active = false; p.cool = 75; p.mesh.visible = false; p.ring.visible = false; } else removePickup(p);
        }
      }
    }
  }

  // ---------- player pistol ----------
  function shoot(P) {
    const cam = G.camera;
    P.ammoClip--;
    C.fireCd = 0.2;
    cam.getWorldDirection(dir);
    dir.x += rnd(-0.008, 0.008); dir.y += rnd(-0.008, 0.008); dir.z += rnd(-0.008, 0.008);
    dir.normalize();
    org.copy(cam.position);
    const maxT = 140;
    let best = G.city.raycast(org.x, org.y, org.z, dir.x, dir.y, dir.z, maxT);
    let kind = best < maxT ? 'wall' : 'none', hitE = null, hitP = null, hitV = null;
    for (const e of enemies) {
      if (e.state === 'dead') continue;
      const t = rayCyl(org.x, org.y, org.z, dir.x, dir.y, dir.z, e.x, e.z, 0.45, e.y, e.y + 1.9, best);
      if (t > 1.5 && t < best) { best = t; kind = 'enemy'; hitE = e; }
    }
    if (G.traffic) {
      const r = G.traffic.rayHit(org.x, org.y, org.z, dir.x, dir.y, dir.z, best);
      if (r && r.t > 1.5 && r.t < best) { best = r.t; kind = 'ped'; hitP = r.ped; }
    }
    for (const v of G.vehicles.list) {
      if (v === P.vehicle || v.removed) continue;
      if (Math.abs(v.x - org.x) > 150 || Math.abs(v.z - org.z) > 150) continue;
      const t = rayVehicle(v, org.x, org.y, org.z, dir.x, dir.y, dir.z, best);
      if (t > 1.5 && t < best) { best = t; kind = 'vehicle'; hitV = v; }
    }
    const t = best < maxT ? best : 80;
    const hx = org.x + dir.x * t, hy = org.y + dir.y * t, hz = org.z + dir.z * t;
    const mx = P.x + Math.sin(P.yaw) * 0.7 - Math.cos(P.yaw) * 0.28, mz = P.z + Math.cos(P.yaw) * 0.7 + Math.sin(P.yaw) * 0.28;
    G.fx.tracer(mx, P.y + 1.4, mz, hx, hy, hz);
    G.fx.muzzle(mx, P.y + 1.4, mz);
    G.audio.gunshot();
    G.fx.shake = Math.min(1, G.fx.shake + 0.06);
    P.camPitch = Math.max(-0.35, P.camPitch - 0.02);
    P.camYaw += rnd(-0.004, 0.004);
    P.model.armR.rotation.x = -1.8;
    if (kind === 'enemy') {
      const head = hy > hitE.y + 1.55;
      C.damageEnemy(hitE, head ? 55 : 26, true);
      G.fx.impact(hx, hy, hz);
      G.hud.hitMarker(head);
    } else if (kind === 'ped') {
      G.traffic.damagePed(hitP, hy > 1.55 ? 60 : 28, true);
      G.fx.impact(hx, hy, hz);
      G.hud.hitMarker(false);
    } else if (kind === 'vehicle') {
      G.vehicles.damage(hitV, 13);
      G.fx.impact(hx, hy, hz);
      G.fx.sparks(hx, hy, hz, 4);
      if (hitV.driver && hitV.driver !== 'player' && G.traffic) G.traffic.panicDriver(hitV);
      if (G.police) G.police.crime('hitCar', hx, hz);
    } else if (kind === 'wall') G.fx.impact(hx, hy, hz);
    for (const e of enemies) {
      if (e.state !== 'dead' && e.team === 'gang' && !e.aggro && !e.calm && Math.hypot(e.x - P.x, e.z - P.z) < 38) e.aggro = true;
    }
    if (G.traffic) G.traffic.alarm(P.x, P.z, 55);
    if (G.police) G.police.crime('shoot', P.x, P.z);
  }
  C.giveWeapon = (ammo) => {
    const P = G.player;
    P.hasPistol = true;
    P.ammoClip = P.clipSize;
    P.ammoReserve = Math.max(P.ammoReserve, ammo);
    P.weapon = 'pistol';
  };

  function updatePlayerWeapon(dt, P) {
    const inp = G.input;
    if (C.fireCd > 0) C.fireCd -= dt;
    if (P.mode !== 'walk' || P.weapon !== 'pistol' || !P.hasPistol) { C.reloadT = 0; return; }
    if (C.reloadT > 0) {
      C.reloadT -= dt;
      if (C.reloadT <= 0) {
        const take = Math.min(P.clipSize - P.ammoClip, P.ammoReserve);
        P.ammoClip += take; P.ammoReserve -= take;
      }
      return;
    }
    if (inp.wasPressed('KeyR') && P.ammoClip < P.clipSize && P.ammoReserve > 0) { C.reloadT = 1.1; G.audio.reload(); G.hud.message('Mengisi ulang…', 'info', 1.1); return; }
    if (inp.mouseDown(0) && C.fireCd <= 0) {
      if (P.ammoClip > 0) shoot(P);
      else if (P.ammoReserve > 0) { C.reloadT = 1.1; G.audio.reload(); G.hud.message('Mengisi ulang…', 'info', 1.1); } else { C.fireCd = 0.4; G.hud.message('Amunisi habis!', 'warn', 1.2); }
    }
  }
  C.isReloading = () => C.reloadT > 0;

  C.update = (dt) => {
    const P = G.player;
    const now = performance.now() / 1000;
    updatePlayerWeapon(dt, P);
    updatePickups(dt, P);
    separate();
    const cam = G.camera;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const far = Math.hypot(e.x - P.x, e.z - P.z) > 260 && !e.tag;
      if (far) { if (e.team === 'police' || e.team === 'gang') C.removeEnemy(e); continue; }
      updateEnemy(e, dt, P, now);
      if (e.alive) {
        const show = e.state !== 'dead' && (e.hp < e.maxHp || e.aggro) && Math.hypot(e.x - cam.position.x, e.z - cam.position.z) < 45 && !e.boss;
        e.bar.g.visible = show;
        if (show) {
          const k = clamp(e.hp / e.maxHp, 0.001, 1);
          e.bar.g.position.set(e.x, e.y + (e.h.group.scale.y > 1 ? 2.35 : 2.1), e.z);
          e.bar.g.quaternion.copy(cam.quaternion);
          e.bar.fg.scale.set(k, 1, 1);
          e.bar.fg.position.x = -(1 - k) * 0.5;
          e.bar.fg.position.z = 0.001;
        }
      }
    }
  };

  C.reset = () => {
    for (let i = enemies.length - 1; i >= 0; i--) C.removeEnemy(enemies[i]);
    C.clearPickups();
    C.fireCd = 0; C.reloadT = 0;
  };
  return C;
}
