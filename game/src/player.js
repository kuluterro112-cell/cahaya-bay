// player.js — Raka: walking/running/jumping, third-person camera, entering/exiting cars, punching, damage and regen.
import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff } from './utils.js';
import { createHumanoid, animateHumanoid, setHumanoidDead } from './humanoid.js';

export function createPlayer(G) {
  const h = createHumanoid({ shirt: 0xe9892c, pants: 0x2a3550, skin: 0xd9a47c, hair: 0x14100c });
  h.group.traverse((o) => { o.frustumCulled = false; });
  G.scene.add(h.group);

  const P = {
    x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, vy: 0, onGround: true, speed: 0,
    health: 100, armor: 0, maxHealth: 100, dead: false, lastHurt: -99,
    mode: 'walk', vehicle: null, lastVehicle: null,
    weapon: 'fist', hasPistol: false, clipSize: 12, ammoClip: 12, ammoReserve: 0,
    camYaw: 0, camPitch: 0.28, camDist: 4.4, camTarget: new THREE.Vector3(), lookIdle: 0,
    punchT: 0, punchCd: 0, punchHit: false, stepT: 0, hitCd: 0, enterT: 0, exitT: 0, enterV: null,
    model: h, moving: false, running: false, aiming: false, nearVehicle: null,
  };
  const tmp = { x: 0, z: 0 };
  const camPos = new THREE.Vector3();
  let camReady = false;
  let curDist = 4.4;
  let fovNow = 62;
  const look = new THREE.Vector3();

  P.setMode = (m) => { P.mode = m; };

  P.teleport = (x, z, yaw) => {
    P.x = x; P.z = z;
    P.y = G.city.groundY(x, z);
    P.vx = P.vz = P.vy = 0;
    if (yaw !== undefined) { P.yaw = yaw; P.camYaw = yaw; }
    camReady = false;
    P.sync();
  };

  P.sync = () => {
    h.group.position.set(P.x, P.y, P.z);
    h.group.rotation.y = P.yaw;
    h.gun.visible = P.weapon === 'pistol' && P.hasPistol;
  };

  P.damage = (amt, src) => {
    if (P.dead || amt <= 0) return;
    P.lastHurt = performance.now() / 1000;
    const a = Math.min(P.armor, amt);
    P.armor -= a;
    P.health -= amt - a;
    G.hud.flashDamage(Math.min(1, amt / 30));
    if (P.health <= 0) P.die(src);
  };
  P.heal = (n) => { P.health = Math.min(P.maxHealth, P.health + n); };
  P.addArmor = (n) => { P.armor = Math.min(100, P.armor + n); };

  P.die = (src) => {
    if (P.dead) return;
    P.dead = true;
    P.health = 0;
    if (P.vehicle) P.exitVehicleInstant(P.vehicle);
    P.mode = 'dead';
    h.group.visible = true;
    G.onPlayerDeath(src);
  };
  P.revive = (x, z, yaw) => {
    P.dead = false;
    P.health = 100;
    P.armor = 0;
    P.mode = 'walk';
    P.vehicle = null;
    P.enterV = null;
    h.group.visible = true;
    setHumanoidDead(h, 0);
    P.weapon = P.hasPistol ? P.weapon : 'fist';
    P.teleport(x, z, yaw);
    P.lastHurt = performance.now() / 1000;
  };

  // Seat the player in a vehicle immediately (race start, continue, demo scenes).
  P.forceEnter = (v) => {
    if (!v) return;
    P.vehicle = v;
    P.lastVehicle = v;
    P.enterV = null;
    v.driver = 'player';
    v.isNPC = false;
    v.ctrl.throttle = 0; v.ctrl.steer = 0; v.ctrl.handbrake = false;
    v.steerIn = 0;
    P.mode = 'driving';
    P.x = v.x; P.z = v.z; P.y = v.y; P.yaw = v.yaw;
    P.camYaw = v.yaw;
    P.lookIdle = 5;
    h.group.visible = false;
    camReady = false;
  };

  P.exitVehicleInstant = (v) => {
    if (!v) return;
    P.lastVehicle = v;
    P.vehicle = null;
    if (v.driver === 'player') v.driver = null;
    v.ctrl.throttle = 0; v.ctrl.steer = 0;
    G.audio.setHorn(false);
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    P.x = v.x + fz * (v.T.W / 2 + 1.1);
    P.z = v.z - fx * (v.T.W / 2 + 1.1);
    P.y = G.city.groundY(P.x, P.z);
    P.mode = P.dead ? 'dead' : 'walk';
    h.group.visible = true;
    P.sync();
  };

  // -------- enter / exit vehicle --------
  function tryEnterVehicle() {
    const v = G.vehicles.nearestEnterable(P.x, P.z, 3.6);
    if (!v) return false;
    if (v.isRacer && !G.missions.allowsRacerSwap) return false;
    const driver = v.driver;
    if (driver && driver !== 'player') {
      if (G.traffic) G.traffic.ejectDriver(v);
      if (G.police) G.police.crime('carjack', v.x, v.z, { vehicle: v });
    } else if (!driver && !v.parked && v.isNPC) {
      // abandoned traffic car — fine to take
    }
    P.mode = 'entering';
    P.enterV = v;
    P.enterT = 0;
    v.doorTarget = 1;
    G.audio.door();
    G.vehicles.doorPos(v, tmp);
    P.doorX = tmp.x; P.doorZ = tmp.z;
    return true;
  }
  function finishEnter() {
    const v = P.enterV;
    P.enterV = null;
    if (!v || v.removed || !v.alive) { P.mode = 'walk'; return; }
    v.driver = 'player';
    v.isNPC = false;
    v.ctrl.throttle = 0; v.ctrl.steer = 0; v.ctrl.handbrake = false;
    v.steerIn = 0;
    P.vehicle = v;
    P.lastVehicle = v;
    P.mode = 'driving';
    h.group.visible = false;
    v.doorTarget = 0;
    G.audio.door();
    G.hud.message(v.T.label + ' — H klakson, L lampu, Q radio', 'info', 3);
    if (G.missions) G.missions.onEnterVehicle(v);
  }
  function exitVehicle() {
    const v = P.vehicle;
    if (!v) return;
    if (Math.abs(v.speed) > 14) { G.hud.message('Terlalu cepat untuk keluar!', 'warn', 1.5); return; }
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const side = [v.T.W / 2 + 1.0, -(v.T.W / 2 + 1.0), 0];
    let ox = v.x + fz * side[0], oz = v.z - fx * side[0];
    for (let k = 0; k < 3; k++) {
      const sx = v.x + fz * side[k] - (k === 2 ? fx * (v.T.L / 2 + 1.2) : 0);
      const sz = v.z - fx * side[k] - (k === 2 ? fz * (v.T.L / 2 + 1.2) : 0);
      const l = G.city.query(sx, sz, 0.5);
      let free = true;
      for (const c of l) if (sx > c.x0 - 0.4 && sx < c.x1 + 0.4 && sz > c.z0 - 0.4 && sz < c.z1 + 0.4) { free = false; break; }
      if (free) { ox = sx; oz = sz; break; }
    }
    v.doorTarget = 1;
    v.driver = null;
    v.ctrl.throttle = 0; v.ctrl.steer = 0; v.ctrl.handbrake = true;
    G.audio.setHorn(false);
    P.lastVehicle = v;
    P.vehicle = null;
    P.x = ox; P.z = oz;
    P.y = G.city.groundY(ox, oz);
    P.vx = v.vx * 0.5; P.vz = v.vz * 0.5;
    P.yaw = v.yaw;
    P.mode = 'exiting';
    P.exitT = 0;
    P.exitV = v;
    h.group.visible = true;
    G.audio.door();
    if (G.missions) G.missions.onExitVehicle(v);
  }

  // -------- melee --------
  function startPunch() {
    if (P.punchCd > 0 || P.mode !== 'walk') return;
    P.punchCd = 0.5;
    P.punchT = 0.001;
    P.punchHit = false;
  }
  function resolvePunch() {
    P.punchHit = true;
    let hit = false;
    if (G.combat) hit = G.combat.meleeHit(P, 16) || hit;
    if (!hit && G.traffic) hit = G.traffic.meleeHit(P, 16) || hit;
    if (hit) {
      G.audio.punch();
      G.fx.shake = Math.min(1, G.fx.shake + 0.08);
    } else G.audio.step(true);
  }

  // -------- camera --------
  P.updateCamera = (dt, snap) => {
    const cam = G.camera;
    const v = P.vehicle;
    const driving = P.mode === 'driving' && v;
    const aimMode = !driving && P.weapon === 'pistol' && P.hasPistol;
    // target
    let tx = P.x, ty = P.y + (driving ? 1.4 : 1.55), tz = P.z;
    if (driving) { tx = v.x; ty = v.y + 1.4; tz = v.z; }
    const k = snap || !camReady ? 1 : 1 - Math.exp(-(driving ? 16 : 24) * dt);
    P.camTarget.x += (tx - P.camTarget.x) * k;
    P.camTarget.y += (ty - P.camTarget.y) * k;
    P.camTarget.z += (tz - P.camTarget.z) * k;
    if (!camReady) { P.camTarget.set(tx, ty, tz); }
    if (driving) {
      P.lookIdle += dt;
      if (P.lookIdle > 1.1) {
        const head = Math.abs(v.speed) > 2 ? (v.speed >= 0 ? v.yaw : v.yaw + Math.PI) : P.camYaw;
        P.camYaw = dampAngle(P.camYaw, head, 2.6, dt);
        P.camPitch = damp(P.camPitch, 0.2, 2, dt);
      }
    }
    const wantDist = driving ? 7.4 + Math.min(4, Math.abs(v.speed) * 0.09) : aimMode ? 2.8 : 4.4;
    let dist = wantDist;
    const cp = Math.cos(P.camPitch), sp = Math.sin(P.camPitch);
    const dx = Math.sin(P.camYaw), dz = Math.cos(P.camYaw);
    const rx = -dz, rz = dx; // right-hand vector (camera right)
    const shoulder = aimMode ? 0.75 : 0;
    const bx = P.camTarget.x + rx * shoulder, by = P.camTarget.y, bz = P.camTarget.z + rz * shoulder;
    let px = bx - dx * cp * dist, py = by + sp * dist + 0.3, pz = bz - dz * cp * dist;
    const ex = px - bx, ey = py - by, ez = pz - bz;
    const len = Math.hypot(ex, ey, ez);
    const hit = G.city.raycast(bx, by, bz, ex, ey, ez, len);
    let allowed = len;
    if (hit < len) allowed = Math.max(0.9, hit - 0.45);
    const rate = allowed < curDist ? 26 : 5;
    curDist = camReady ? damp(curDist, allowed, rate, dt) : allowed;
    const f = curDist / len;
    px = bx + ex * f; py = by + ey * f; pz = bz + ez * f;
    const gy = G.city.groundY(px, pz) + 0.45;
    if (py < gy) py = gy;
    camPos.set(px, py, pz);
    const sh = G.fx.shake * 0.35;
    cam.position.set(px + (Math.random() - 0.5) * sh, py + (Math.random() - 0.5) * sh, pz + (Math.random() - 0.5) * sh);
    look.set(bx + dx * 8, by - sp * 4 + (driving ? 0.2 : 0.1), bz + dz * 8);
    cam.lookAt(look);
    const fovT = driving ? 62 + clamp(Math.abs(v.speed) / v.T.maxSpeed, 0, 1) * 18 : aimMode ? 52 : 62;
    fovNow = damp(fovNow, fovT, 5, dt);
    if (Math.abs(cam.fov - fovNow) > 0.05) { cam.fov = fovNow; cam.updateProjectionMatrix(); }
    camReady = true;
  };

  // -------- walking --------
  function collideStatic() {
    const r = 0.38;
    const l = G.city.query(P.x, P.z, r + 1);
    let stand = -1;
    for (let n = 0; n < l.length; n++) {
      const c = l[n];
      const inX = P.x > c.x0 - 0.1 && P.x < c.x1 + 0.1, inZ = P.z > c.z0 - 0.1 && P.z < c.z1 + 0.1;
      if (c.h <= 2.4 && P.y >= c.h - 0.4 && inX && inZ) { if (c.h > stand) stand = c.h; continue; }
      if (P.y >= c.h - 0.1) continue;
      const px = clamp(P.x, c.x0, c.x1), pz = clamp(P.z, c.z0, c.z1);
      const dx = P.x - px, dz = P.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        P.x += (dx / d) * (r - d); P.z += (dz / d) * (r - d);
      } else {
        const a = P.x - c.x0, b = c.x1 - P.x, t = P.z - c.z0, e = c.z1 - P.z;
        const m = Math.min(a, b, t, e);
        if (m === a) P.x = c.x0 - r; else if (m === b) P.x = c.x1 + r; else if (m === t) P.z = c.z0 - r; else P.z = c.z1 + r;
      }
    }
    return stand;
  }

  function collideVehicles(dt) {
    P.nearVehicle = null;
    const vs = G.vehicles.list;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      const dxw = P.x - v.x, dzw = P.z - v.z;
      if (Math.abs(dxw) > 6 || Math.abs(dzw) > 6) continue;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const fd = dxw * fx + dzw * fz, ld = dxw * fz - dzw * fx;
      const hl = v.T.L / 2 + 0.3, hw = v.T.W / 2 + 0.3;
      if (Math.abs(fd) < hl && Math.abs(ld) < hw && P.y < 1.5) {
        const sp = Math.hypot(v.vx, v.vz);
        if (sp > 3 && v.driver !== null && P.hitCd <= 0 && !v.wreck) {
          P.hitCd = 0.7;
          P.damage((sp - 2.5) * 4.5, 'vehicle');
          P.vx += v.vx * 0.6; P.vz += v.vz * 0.6; P.vy = 4;
          P.onGround = false;
          G.fx.impact(P.x, 1, P.z);
          G.audio.punch();
        }
        const penF = hl - Math.abs(fd), penL = hw - Math.abs(ld);
        if (penF < penL) {
          const s = Math.sign(fd) || 1;
          P.x += fx * s * penF; P.z += fz * s * penF;
        } else {
          const s = Math.sign(ld) || 1;
          P.x += fz * s * penL; P.z -= fx * s * penL;
        }
      }
    }
    P.nearVehicle = G.vehicles.nearestEnterable(P.x, P.z, 3.6);
  }

  P.update = (dt) => {
    const inp = G.input;
    const now = performance.now() / 1000;
    const { dx, dy } = inp.consumeLook(dt);
    if (dx || dy) {
      P.camYaw -= dx * 0.0022 * G.settings.sens;
      P.camPitch = clamp(P.camPitch + dy * 0.0018 * G.settings.sens, -0.35, 1.25);
      P.lookIdle = 0;
    }
    if (P.hitCd > 0) P.hitCd -= dt;
    if (P.punchCd > 0) P.punchCd -= dt;

    if (P.health < P.maxHealth && now - P.lastHurt > 6 && !P.dead) P.health = Math.min(P.maxHealth, P.health + 3 * dt);

    if (P.mode === 'driving') {
      const v = P.vehicle;
      if (!v || v.removed) { P.mode = 'walk'; P.vehicle = null; h.group.visible = true; return; }
      P.x = v.x; P.z = v.z; P.y = v.y; P.yaw = v.yaw; P.speed = Math.abs(v.speed);
      P.sync();
      if (inp.wasPressed('KeyE') && !G.interactTaken) { G.interactTaken = true; exitVehicle(); }
      if (inp.wasPressed('KeyQ')) G.hud.radio(G.audio.nextStation());
      G.audio.setMusicMode('car');
      return;
    }

    if (P.mode === 'entering') {
      const v = P.enterV;
      P.enterT += dt;
      if (!v || v.removed) { P.mode = 'walk'; return; }
      P.x += (P.doorX - P.x) * Math.min(1, dt * 8);
      P.z += (P.doorZ - P.z) * Math.min(1, dt * 8);
      P.yaw = dampAngle(P.yaw, Math.atan2(v.x - P.x, v.z - P.z), 12, dt);
      animateHumanoid(h, dt, 2, false, 0, false);
      P.sync();
      if (P.enterT > 0.55) finishEnter();
      return;
    }
    if (P.mode === 'exiting') {
      P.exitT += dt;
      P.vx *= 0.9; P.vz *= 0.9;
      if (P.exitT > 0.45) {
        if (P.exitV) P.exitV.doorTarget = 0;
        P.mode = 'walk';
        P.exitV = null;
      }
      animateHumanoid(h, dt, 0, false, 0, false);
      P.sync();
      return;
    }
    if (P.mode === 'dead') {
      setHumanoidDead(h, Math.min(1, h.dead + dt * 3));
      P.sync();
      return;
    }

    // ---- walking ----
    G.audio.setMusicMode('walk');
    if (inp.wasPressed('Digit1')) { P.weapon = 'fist'; }
    if (inp.wasPressed('Digit2') && P.hasPistol) { P.weapon = 'pistol'; G.hud.message('Pistol', 'info', 1.2); }
    const aimMode = P.weapon === 'pistol' && P.hasPistol;
    const fwdIn = (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0);
    const strIn = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
    const cfx = Math.sin(P.camYaw), cfz = Math.cos(P.camYaw);
    let wx = cfx * fwdIn + -cfz * strIn;
    let wz = cfz * fwdIn + cfx * strIn;
    const wl = Math.hypot(wx, wz);
    P.moving = wl > 0.01;
    if (P.moving) { wx /= wl; wz /= wl; }
    P.running = P.moving && inp.isDown('ShiftLeft') || P.moving && inp.isDown('ShiftRight');
    const top = P.punchT > 0 ? 1.4 : P.running ? (aimMode ? 6.2 : 7.4) : 3.5;
    const lam = P.onGround ? 14 : 2.5;
    P.vx = damp(P.vx, wx * (P.moving ? top : 0), lam, dt);
    P.vz = damp(P.vz, wz * (P.moving ? top : 0), lam, dt);
    if (inp.wasPressed('Space') && P.onGround) { P.vy = 8.4; P.onGround = false; }
    P.vy -= 26 * dt;
    P.x += P.vx * dt;
    P.z += P.vz * dt;
    P.y += P.vy * dt;
    let stand = collideStatic();
    collideVehicles(dt);
    G.city.clampToWorld(P);
    if (P.z > 388) P.z = 388;
    const gy = Math.max(G.city.groundY(P.x, P.z), stand);
    if (P.y <= gy) { P.y = gy; if (P.vy < 0) P.vy = 0; P.onGround = true; } else if (P.y > gy + 0.08) P.onGround = false;
    P.speed = Math.hypot(P.vx, P.vz);

    if (aimMode) P.yaw = dampAngle(P.yaw, P.camYaw, 16, dt);
    else if (P.moving) P.yaw = dampAngle(P.yaw, Math.atan2(wx, wz), 12, dt);

    // footsteps
    if (P.onGround && P.speed > 1) {
      P.stepT += P.speed * dt;
      const stride = P.running ? 2.5 : 1.9;
      if (P.stepT > stride) { P.stepT = 0; G.audio.step(P.running); if (P.running && Math.random() < 0.2) G.fx.dust(P.x, P.y, P.z, 1); }
    }

    // melee
    if (inp.wasPressed('KeyF') || (inp.mouseClicked(0) && !aimMode)) startPunch();
    if (P.punchT > 0) {
      P.punchT += dt;
      if (!P.punchHit && P.punchT > 0.14) resolvePunch();
      if (P.punchT > 0.4) P.punchT = 0;
    }
    P.aiming = aimMode;
    animateHumanoid(h, dt, P.speed, aimMode, P.punchT > 0 ? P.punchT / 0.4 : 0, !P.onGround);
    P.sync();

    // enter a car
    if (inp.wasPressed('KeyE') && !G.interactTaken) {
      if (tryEnterVehicle()) G.interactTaken = true;
    }
    if (P.nearVehicle && !G.interactTaken) {
      const v = P.nearVehicle;
      G.hud.prompt(v.driver ? '[E] Rebut ' + v.T.label : '[E] Masuk ' + v.T.label, 1);
    }
  };

  P.model = h;
  return P;
}
