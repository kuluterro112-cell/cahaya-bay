// hud.js — DOM HUD (health, money, stars, clock, speedometer, objective, subtitles, banners, briefing) + 2D minimap.
import { clamp, damp, formatMoney, formatClock, formatTime, makeCanvas } from './utils.js';
import { S, RW, HALF, BOUNDS, I_MIN, I_MAX, J_MIN, J_MAX } from './city.js';

const MAP_MIN_X = -440, MAP_MAX_X = 440, MAP_MIN_Z = -350, MAP_MAX_Z = 420;
const MAP_SC = 1.15;
const MM = 210; // minimap pixel size

export function createHud(G) {
  const $ = (id) => document.getElementById(id);
  const el = {
    root: $('hud'), hp: $('hpFill'), hpText: $('hpText'), armor: $('armorFill'), money: $('money'), stars: $('stars'),
    clock: $('clock'), district: $('district'), speedo: $('speedo'), speedCanvas: $('speedCanvas'), speedNum: $('speedNum'),
    radio: $('radioName'), carHp: $('carHpFill'), objective: $('objectiveText'), objTimer: $('objTimer'), objDist: $('objDist'),
    objArrow: $('objArrow'), hint: $('hintText'), weapon: $('weaponText'), cross: $('crosshair'), hit: $('hitMarker'),
    prompt: $('prompt'), subSpeaker: $('subSpeaker'), subText: $('subText'), sub: $('subtitle'), toasts: $('toasts'), banner: $('banner'),
    bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'), bannerExtra: $('bannerExtra'), boss: $('bossBar'), bossName: $('bossName'),
    bossFill: $('bossFill'), arrest: $('arrestBar'), arrestFill: $('arrestFill'), dmg: $('damageVignette'), count: $('countdown'),
    mm: $('minimap'), controls: $('controlsHint'), brief: $('briefing'), briefNum: $('briefNum'), briefTitle: $('briefTitle'),
    briefText: $('briefText'), briefReward: $('briefReward'), briefStart: $('briefStart'), fail: $('failScreen'), failTitle: $('failTitle'),
    failReason: $('failReason'), failRetry: $('failRetry'), distBanner: $('districtBanner'), muted: $('mutedIcon'), objBox: $('objective'),
  };
  const H = { visible: false };
  const mctx = el.mm.getContext('2d');
  const sctx = el.speedCanvas.getContext('2d');
  el.mm.width = MM; el.mm.height = MM;
  el.speedCanvas.width = 150; el.speedCanvas.height = 150;

  // ---------- pre-rendered city map ----------
  const mapCanvas = makeCanvas(Math.ceil((MAP_MAX_X - MAP_MIN_X) * MAP_SC), Math.ceil((MAP_MAX_Z - MAP_MIN_Z) * MAP_SC));
  const mx = (x) => (MAP_MAX_X - x) * MAP_SC;
  const my = (z) => (MAP_MAX_Z - z) * MAP_SC;
  H.buildMap = () => {
    const g = mapCanvas.getContext('2d');
    g.fillStyle = '#7fb069';
    g.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
    // sea and beach
    g.fillStyle = '#4a9fd8';
    g.fillRect(0, 0, mapCanvas.width, my(392));
    g.fillStyle = '#ecd9a6';
    g.fillRect(0, my(392), mapCanvas.width, (392 - 334) * MAP_SC);
    // blocks
    for (let bi = I_MIN; bi < I_MAX; bi++) for (let bj = J_MIN; bj < J_MAX; bj++) {
      const cx = bi * S + S / 2, cz = bj * S + S / 2;
      const d = G.city.districtAt(cx, cz);
      g.fillStyle = d === 'Downtown' ? '#b9c3cc' : d === 'Kota Lama' ? '#d8c3a0' : d === 'Marina' ? '#c9bfa8' : d === 'Pantai Cahaya' ? '#e6d6a4' : '#8cc070';
      const x0 = bi * S + HALF, x1 = (bi + 1) * S - HALF, z0 = bj * S + HALF, z1 = (bj + 1) * S - HALF;
      g.fillRect(mx(x1), my(z1), (x1 - x0) * MAP_SC, (z1 - z0) * MAP_SC);
    }
    // buildings
    for (const c of G.city.colliders) {
      if (c.kind !== 'b') continue;
      g.fillStyle = c.h > 40 ? '#7f95aa' : c.h > 16 ? '#97a8b8' : '#b59a78';
      g.fillRect(mx(c.x1), my(c.z1), (c.x1 - c.x0) * MAP_SC, (c.z1 - c.z0) * MAP_SC);
    }
    // parks
    g.fillStyle = '#6fbf5a';
    for (const [bi, bj] of [[0, 0], [1, -2]]) {
      const x0 = bi * S + HALF, x1 = (bi + 1) * S - HALF, z0 = bj * S + HALF, z1 = (bj + 1) * S - HALF;
      g.fillRect(mx(x1), my(z1), (x1 - x0) * MAP_SC, (z1 - z0) * MAP_SC);
    }
    // roads
    g.fillStyle = '#4a4e55';
    for (let i = I_MIN; i <= I_MAX; i++) g.fillRect(mx(i * S + HALF), my(J_MAX * S + HALF), RW * MAP_SC, (J_MAX - J_MIN) * S * MAP_SC + RW * MAP_SC);
    for (let j = J_MIN; j <= J_MAX; j++) g.fillRect(mx(I_MAX * S + HALF), my(j * S + HALF), (I_MAX - I_MIN) * S * MAP_SC + RW * MAP_SC, RW * MAP_SC);
    g.strokeStyle = '#d9d36a';
    g.lineWidth = 1;
    g.setLineDash([6, 6]);
    for (let i = I_MIN; i <= I_MAX; i++) { g.beginPath(); g.moveTo(mx(i * S), my(J_MIN * S - HALF)); g.lineTo(mx(i * S), my(J_MAX * S + HALF)); g.stroke(); }
    for (let j = J_MIN; j <= J_MAX; j++) { g.beginPath(); g.moveTo(mx(I_MIN * S - HALF), my(j * S)); g.lineTo(mx(I_MAX * S + HALF), my(j * S)); g.stroke(); }
    g.setLineDash([]);
    // landmark labels
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(30,30,40,0.75)';
    const lab = (t, x, z) => g.fillText(t, mx(x), my(z));
    lab('MARINA', -200, 300);
    lab('PANTAI', 200, 300);
    lab('KOTA LAMA', -280, 20);
    lab('DOWNTOWN', 0, -40);
    lab('BUKIT HIJAU', 280, -200);
  };

  // ---------- messages ----------
  const toasts = [];
  H.message = (text, kind = 'info', sec = 3) => {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    el.toasts.appendChild(d);
    toasts.push({ d, t: sec });
    while (toasts.length > 5) { const o = toasts.shift(); o.d.remove(); }
  };
  let sub = { t: 0, text: '', shown: 0, speaker: '' };
  H.say = (speaker, text, dur = 4) => {
    sub = { t: dur, text, shown: 0, speaker };
    el.subSpeaker.textContent = speaker;
    el.subText.textContent = '';
    el.sub.classList.add('on');
  };
  let promptText = '', promptPrio = -1;
  H.prompt = (t, prio = 0) => { if (prio >= promptPrio) { promptText = t; promptPrio = prio; } };
  let dmg = 0;
  H.flashDamage = (k) => { dmg = Math.max(dmg, 0.35 + k * 0.6); };
  let hitT = 0;
  H.hitMarker = (head) => { hitT = 0.18; el.hit.classList.toggle('head', !!head); el.hit.classList.add('on'); };
  let radioT = 0;
  H.radio = (name) => { radioT = 3; el.radio.textContent = '♪ ' + name; el.radio.classList.add('flash'); };
  let bannerT = 0;
  H.banner = (title, sub2, kind = 'start', extra = '') => {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub2 || '';
    el.bannerExtra.textContent = extra;
    el.banner.className = 'banner ' + kind;
    void el.banner.offsetWidth;
    el.banner.classList.add('on');
    bannerT = kind === 'win' ? 4.5 : 2.8;
  };
  let countT = 0;
  H.countdown = (text) => {
    el.count.textContent = text;
    el.count.classList.remove('on');
    void el.count.offsetWidth;
    el.count.classList.add('on');
    countT = 0.9;
  };
  H.setBoss = (name, ratio) => {
    if (!name) { el.boss.classList.remove('on'); return; }
    el.boss.classList.add('on');
    el.bossName.textContent = name;
    el.bossFill.style.width = Math.round(ratio * 100) + '%';
  };
  H.setArrest = (r) => {
    if (r > 0.02) { el.arrest.classList.add('on'); el.arrestFill.style.width = Math.round(clamp(r, 0, 1) * 100) + '%'; } else el.arrest.classList.remove('on');
  };
  H.show = (v) => { H.visible = v; el.root.style.display = v ? 'block' : 'none'; };

  // briefing overlay
  let briefCb = null, briefTimer = 0, briefLines = [], briefChars = 0, briefOpen = false;
  H.showBriefing = (def, num, cb) => {
    briefCb = cb;
    briefLines = def.brief;
    briefChars = 0;
    briefOpen = true;
    el.briefNum.textContent = 'MISI ' + def.id + ' / 6';
    el.briefTitle.textContent = def.title;
    el.briefText.textContent = '';
    el.briefReward.textContent = 'Hadiah: ' + formatMoney(def.reward);
    el.brief.classList.add('on');
    G.input.exitLock();
  };
  function closeBriefing() {
    if (!briefOpen) return;
    briefOpen = false;
    el.brief.classList.remove('on');
    G.audio.ui('confirm');
    const cb = briefCb; briefCb = null;
    if (cb) cb();
    G.input.requestLock();
  }
  H.briefingOpen = () => briefOpen;
  let failCb = null, failOpen = false;
  H.showFail = (title, reason, cb) => {
    failCb = cb;
    failOpen = true;
    el.failTitle.textContent = title;
    el.failReason.textContent = reason;
    el.fail.classList.add('on');
    G.input.exitLock();
  };
  function closeFail() {
    if (!failOpen) return;
    failOpen = false;
    el.fail.classList.remove('on');
    const cb = failCb; failCb = null;
    if (cb) cb();
    G.input.requestLock();
  }
  el.briefStart.addEventListener('click', closeBriefing);
  el.failRetry.addEventListener('click', closeFail);
  window.addEventListener('keydown', (e) => {
    if (briefOpen) {
      if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); if (briefChars < totalChars(briefLines)) briefChars = 1e6; else closeBriefing(); }
    } else if (failOpen && (e.code === 'Enter' || e.code === 'KeyE')) { e.preventDefault(); closeFail(); }
  });
  const totalChars = (lines) => lines.reduce((a, l) => a + l.length + 1, 0);

  // ---------- speedometer ----------
  function drawSpeedo(kmh, maxKmh) {
    const c = sctx;
    c.clearRect(0, 0, 150, 150);
    c.save();
    c.translate(75, 75);
    c.fillStyle = 'rgba(10,16,30,0.62)';
    c.beginPath(); c.arc(0, 0, 70, 0, Math.PI * 2); c.fill();
    c.lineWidth = 7; c.lineCap = 'round';
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.beginPath(); c.arc(0, 0, 58, a0, a1); c.stroke();
    const k = clamp(kmh / maxKmh, 0, 1);
    const grd = c.createLinearGradient(-58, 0, 58, 0);
    grd.addColorStop(0, '#46e0b0'); grd.addColorStop(0.6, '#ffd23a'); grd.addColorStop(1, '#ff4a3a');
    c.strokeStyle = grd;
    c.beginPath(); c.arc(0, 0, 58, a0, a0 + (a1 - a0) * k); c.stroke();
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i <= 11; i++) {
      const a = a0 + (a1 - a0) * (i / 11);
      c.beginPath();
      c.moveTo(Math.cos(a) * 47, Math.sin(a) * 47);
      c.lineTo(Math.cos(a) * 52, Math.sin(a) * 52);
      c.stroke();
    }
    c.restore();
  }

  // ---------- minimap ----------
  const flash = { t: 0 };
  function drawMinimap(dt) {
    const P = G.player;
    const c = mctx;
    const driving = P.mode === 'driving' && P.vehicle;
    const R = driving ? 230 : 150;
    H.mmR = H.mmR === undefined ? R : damp(H.mmR, R, 3, dt);
    const Rm = H.mmR;
    const ppm = (MM / 2 - 6) / Rm;
    const a = G.camera ? Math.atan2(Math.sin(P.camYaw), Math.cos(P.camYaw)) : 0;
    c.clearRect(0, 0, MM, MM);
    c.save();
    c.beginPath(); c.arc(MM / 2, MM / 2, MM / 2 - 3, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#2b3a4a'; c.fillRect(0, 0, MM, MM);
    c.translate(MM / 2, MM / 2);
    c.rotate(a);
    const k = ppm / MAP_SC;
    c.scale(k, k);
    c.drawImage(mapCanvas, -mx(P.x), -my(P.z));
    c.scale(1 / k, 1 / k);
    // blips (world -> screen, rotated frame)
    const bx = (x) => -(x - P.x) * ppm, by = (z) => -(z - P.z) * ppm;
    const edge = MM / 2 - 12;
    // vehicles
    for (const v of G.vehicles.list) {
      if (v.removed || v === P.vehicle) continue;
      const dx = bx(v.x), dz = by(v.z);
      if (dx * dx + dz * dz > edge * edge) continue;
      c.save();
      c.translate(dx, dz);
      c.rotate(-v.yaw);
      if (v.isPolice && G.police.stars > 0) c.fillStyle = Math.floor(flash.t * 5) % 2 ? '#ff3a3a' : '#3a7aff';
      else c.fillStyle = v.wreck ? '#555' : v.isPolice ? '#a8c0ff' : 'rgba(245,245,245,0.85)';
      const sz = v.type === 'truck' ? 4.4 : 3.2;
      c.fillRect(-sz / 2, -sz, sz, sz * 2);
      c.restore();
    }
    // enemies
    for (const e of G.combat.enemies) {
      if (e.state === 'dead') continue;
      const dx = bx(e.x), dz = by(e.z);
      if (dx * dx + dz * dz > edge * edge) continue;
      c.fillStyle = e.team === 'police' ? (Math.floor(flash.t * 5) % 2 ? '#3a7aff' : '#ff3a3a') : '#ff4a4a';
      c.beginPath(); c.arc(dx, dz, e.boss ? 5 : 3, 0, Math.PI * 2); c.fill();
    }
    // helicopter
    const hl = G.police.heli;
    if (hl && hl.active) {
      const dx = bx(hl.x), dz = by(hl.z);
      c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
      const dd = Math.hypot(dx, dz);
      const f = dd > edge ? edge / dd : 1;
      c.fillText('✚', dx * f, dz * f + 4);
    }
    // mission markers
    const mk = G.missions.markers;
    for (let i = 0; i < mk.length; i++) {
      const m = mk[i];
      let dx = bx(m.x), dz = by(m.z);
      const dd = Math.hypot(dx, dz);
      const out = dd > edge;
      if (out) { dx *= edge / dd; dz *= edge / dd; }
      c.save();
      c.translate(dx, dz);
      c.fillStyle = '#ffd23a';
      c.strokeStyle = '#1a1a1a';
      c.lineWidth = 2;
      if (out) {
        c.rotate(Math.atan2(dz, dx) + Math.PI / 2);
        c.beginPath(); c.moveTo(0, -8); c.lineTo(7, 6); c.lineTo(-7, 6); c.closePath();
      } else { c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); }
      c.fill(); c.stroke();
      c.restore();
    }
    // north marker
    c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center';
    c.fillText('N', 0, -(MM / 2 - 8) + 4);
    c.restore();
    // player arrow (always at the center)
    c.save();
    c.translate(MM / 2, MM / 2);
    c.rotate(a - P.yaw);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#0b1b2b';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath();
    c.fill(); c.stroke();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 4;
    c.beginPath(); c.arc(MM / 2, MM / 2, MM / 2 - 3, 0, Math.PI * 2); c.stroke();
  }

  // ---------- main update ----------
  let moneyShown = 0, lastDistrict = '', distT = 0, lastMode = '';
  H.update = (dt) => {
    if (!H.visible) return;
    const P = G.player;
    flash.t += dt;
    // vitals
    el.hp.style.width = clamp(P.health / P.maxHealth * 100, 0, 100) + '%';
    el.hp.classList.toggle('low', P.health < 30);
    el.hpText.textContent = Math.ceil(P.health);
    el.armor.style.width = clamp(P.armor, 0, 100) + '%';
    moneyShown = damp(moneyShown, G.money, 6, dt);
    el.money.textContent = formatMoney(Math.round(moneyShown));
    // stars
    const st = G.police.stars;
    const kids = el.stars.children;
    for (let i = 0; i < 5; i++) {
      kids[i].className = 'star' + (i < st ? ' on' : '') + (i < st && G.police.searching ? ' blink' : '');
    }
    el.clock.textContent = formatClock(G.gameHour);
    const dist = G.city.districtAt(P.x, P.z);
    el.district.textContent = dist;
    if (dist !== lastDistrict) {
      if (lastDistrict !== '' && G.state === 'playing') { el.distBanner.textContent = dist.toUpperCase(); el.distBanner.classList.remove('on'); void el.distBanner.offsetWidth; el.distBanner.classList.add('on'); }
      lastDistrict = dist;
    }
    // mode dependent
    const driving = P.mode === 'driving' && P.vehicle;
    const mode = driving ? 'car' : 'walk';
    if (mode !== lastMode) {
      lastMode = mode;
      el.controls.innerHTML = driving
        ? '<b>WASD</b> kemudi · <b>Spasi</b> rem tangan · <b>H</b> klakson · <b>L</b> lampu · <b>Q</b> radio · <b>E</b> keluar · <b>M</b> mute'
        : '<b>WASD</b> gerak · <b>Shift</b> lari · <b>Spasi</b> lompat · <b>E</b> masuk mobil · <b>F</b> pukul · <b>1/2</b> senjata · <b>R</b> reload · <b>Esc</b> pause';
    }
    el.speedo.style.display = driving ? 'block' : 'none';
    if (driving) {
      const v = P.vehicle;
      const kmh = Math.abs(v.speed) * 3.6;
      el.speedNum.textContent = Math.round(kmh);
      drawSpeedo(kmh, 220);
      el.carHp.style.width = clamp(v.hp / v.maxHp * 100, 0, 100) + '%';
      el.carHp.classList.toggle('low', v.hp < v.maxHp * 0.35);
      radioT -= dt;
      if (radioT <= 0) { el.radio.classList.remove('flash'); el.radio.textContent = '♪ ' + G.audio.stationName(); }
    }
    // weapon
    if (!driving) {
      if (P.weapon === 'pistol' && P.hasPistol) el.weapon.textContent = 'PISTOL  ' + (G.combat.isReloading() ? '…' : P.ammoClip) + ' / ' + P.ammoReserve;
      else el.weapon.textContent = 'TINJU' + (P.hasPistol ? '   [2] Pistol' : '');
      el.weapon.parentElement.style.display = 'block';
    } else el.weapon.parentElement.style.display = 'none';
    el.cross.style.display = !driving && P.weapon === 'pistol' && P.hasPistol && P.mode === 'walk' ? 'block' : 'none';
    // objective
    const M = G.missions;
    el.objective.textContent = M.objective || '';
    el.objBox.style.display = M.objective ? 'block' : 'none';
    el.hint.textContent = M.hint || '';
    el.objTimer.textContent = M.timer !== null && M.timer !== undefined ? formatTime(M.timer) : '';
    el.objTimer.style.display = M.timer !== null && M.timer !== undefined ? 'inline-block' : 'none';
    if (M.markers.length) {
      const m = M.markers[0];
      const dx = m.x - P.x, dz = m.z - P.z;
      el.objDist.textContent = Math.round(Math.hypot(dx, dz)) + ' m';
      el.objArrow.style.display = 'inline-block';
      const bearing = Math.atan2(dx, dz);
      const rot = (P.camYaw - bearing) * 180 / Math.PI;
      el.objArrow.style.transform = 'rotate(' + rot.toFixed(1) + 'deg)';
    } else { el.objDist.textContent = ''; el.objArrow.style.display = 'none'; }
    // prompt
    if (promptText) { el.prompt.textContent = promptText; el.prompt.classList.add('on'); } else el.prompt.classList.remove('on');
    promptText = ''; promptPrio = -1;
    // subtitle
    if (sub.t > 0) {
      sub.t -= dt;
      const n = Math.min(sub.text.length, Math.floor((sub.shown += dt * 70)));
      const txt = sub.text.slice(0, n);
      if (el.subText.textContent !== txt) {
        el.subText.textContent = txt;
        if (n % 4 === 0) G.audio.ui('text');
      }
      if (sub.t <= 0) el.sub.classList.remove('on');
    }
    // toasts
    for (let i = toasts.length - 1; i >= 0; i--) {
      toasts[i].t -= dt;
      if (toasts[i].t <= 0) { toasts[i].d.classList.add('out'); const d = toasts[i].d; setTimeout(() => d.remove(), 400); toasts.splice(i, 1); }
    }
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.classList.remove('on'); }
    if (countT > 0) { countT -= dt; if (countT <= 0) el.count.classList.remove('on'); }
    if (hitT > 0) { hitT -= dt; if (hitT <= 0) el.hit.classList.remove('on'); }
    dmg = Math.max(0, dmg - dt * 1.4);
    const low = P.health < 30 && !P.dead ? 0.25 + 0.15 * Math.sin(flash.t * 6) : 0;
    el.dmg.style.opacity = Math.max(dmg, low).toFixed(2);
    el.muted.style.display = G.audio.muted ? 'block' : 'none';
    drawMinimap(dt);
    // typewriter in briefing
    if (briefOpen) {
      briefChars += dt * 85;
      let rem = Math.floor(briefChars);
      let out = '';
      for (const l of briefLines) {
        if (rem <= 0) break;
        out += l.slice(0, rem) + '\n\n';
        rem -= l.length + 1;
      }
      el.briefText.textContent = out.trim();
    }
  };

  return H;
}
