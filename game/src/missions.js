// missions.js — Raka's story: 6 sequential missions with briefings, objectives, 3D markers, fail/retry and rewards.
import * as THREE from 'three';
import { clamp, formatMoney, rnd } from './utils.js';
import { createHumanoid, animateHumanoid } from './humanoid.js';
import { S } from './city.js';

const LEFT = (fx, fz) => ({ x: fz, z: -fx });

export function createMissions(G) {
  const city = G.city;
  const L = city.landmarks;
  const M = {
    index: 0, state: 'idle', cur: null, objective: '', hint: '', timer: null, markers: [], s: {}, t: 0,
    noWanted: false, allowsRacerSwap: false, autoT: 0, cool: 0, boss: null, scriptActive: false, scriptT: 0,
    freeRoam: false, bonus: 0,
  };
  let scriptQ = [];
  let scriptCb = null;
  const props = [];
  const tracked = { vehicles: [], tags: [] };

  // ---------- 3D markers (beam + ring + arrow) ----------
  const beamGeo = new THREE.CylinderGeometry(1.2, 1.2, 90, 14, 1, true);
  beamGeo.translate(0, 45, 0);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ringGeo = new THREE.RingGeometry(2.7, 3.4, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const arrowGeo = new THREE.ConeGeometry(1.0, 2.0, 4);
  arrowGeo.rotateX(Math.PI);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffe36a, fog: false });
  const pool = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(beamGeo, beamMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.y = 6;
    g.add(beam, ring, arrow);
    g.visible = false;
    G.scene.add(g);
    pool.push({ g, beam, ring, arrow });
  }
  function updateMarkerMeshes(dt) {
    const t = performance.now() / 1000;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i], m = M.markers[i];
      if (!m) { p.g.visible = false; continue; }
      p.g.visible = true;
      p.g.position.set(m.x, city.groundY(m.x, m.z), m.z);
      const r = (m.r || 5) / 3;
      p.ring.scale.set(r, 1, r);
      p.beam.scale.set(Math.max(0.6, r * 0.6), 1, Math.max(0.6, r * 0.6));
      p.arrow.position.y = 7 + Math.sin(t * 3 + i) * 0.6;
      p.arrow.rotation.y = t * 2;
      p.ring.rotation.y = -t * 0.5;
      p.g.visible = i === 0 || true;
    }
  }

  // ---------- helpers exposed to mission definitions ----------
  M.say = (speaker, text, dur = 4) => G.hud.say(speaker, text, dur);
  M.setObjective = (t) => { M.objective = t; };
  M.setHint = (t) => { M.hint = t; };
  M.setMarkers = (list) => { M.markers = list; };
  M.addMoney = (n, why) => {
    G.money += n;
    G.hud.message('+' + formatMoney(n) + (why ? ' — ' + why : ''), 'good', 2.8);
    G.audio.cash();
  };
  M.runScript = (lines, cb) => {
    scriptQ = lines.slice();
    scriptCb = cb || null;
    nextLine();
  };
  function nextLine() {
    const l = scriptQ.shift();
    if (!l) {
      M.scriptActive = false;
      const cb = scriptCb; scriptCb = null;
      if (cb) cb();
      return;
    }
    const dur = Math.max(2.4, 1.4 + l.t.length * 0.045);
    G.hud.say(l.s, l.t, dur);
    M.scriptT = dur;
    M.scriptActive = true;
  }
  const near = (x, z, r) => Math.hypot(G.player.x - x, G.player.z - z) < r;
  M.near = near;
  M.trackVehicle = (v) => { tracked.vehicles.push(v); return v; };

  M.carNearPlayer = (type, color) => {
    const P = G.player;
    const rx = Math.round(P.x / S) * S, rz = Math.round(P.z / S) * S;
    let x, z, yaw;
    if (Math.abs(P.x - rx) < Math.abs(P.z - rz)) { x = rx + 3.4; z = P.z + 6; yaw = 0; } else { x = P.x + 6; z = rz - 3.4; yaw = Math.PI / 2; }
    const v = G.vehicles.spawn(type, x, z, yaw, { color, parked: true });
    return v;
  };

  // ---------- NPC props (Ayah, Bang Joko) ----------
  function makeProp(x, z, yaw, o) {
    const h = createHumanoid(o);
    h.group.traverse((c) => { c.frustumCulled = false; });
    h.group.position.set(x, city.groundY(x, z), z);
    h.group.rotation.y = yaw;
    G.scene.add(h.group);
    const p = { h, x, z, yaw };
    props.push(p);
    return p;
  }
  function spawnProps() {
    if (props.length) return;
    makeProp(-196.5, 10.2, Math.PI, { shirt: 0x6a7a8a, pants: 0x3a3a40, skin: 0xb97c54, hair: 0xcfcfcf });
    makeProp(-283, 249.2, Math.PI, { shirt: 0xc05a2a, pants: 0x2a3a5a, skin: 0x8a5a3a, hair: 0x101010 });
  }
  function updateProps(dt) {
    const P = G.player;
    for (const p of props) {
      const d = Math.hypot(P.x - p.x, P.z - p.z);
      if (d < 18) {
        const a = Math.atan2(P.x - p.x, P.z - p.z);
        let da = a - p.yaw;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        p.yaw += da * Math.min(1, dt * 4);
        p.h.group.rotation.y = p.yaw;
      }
      animateHumanoid(p.h, dt, 0, false, 0, false);
    }
  }

  // ---------- race helpers ----------
  const RACE_NODES = [[-3, 3], [0, 3], [0, 0], [-3, 0]];
  function buildRaceWaypoints() {
    const pts = RACE_NODES.map(([i, j]) => city.node(i, j));
    const wps = [];
    for (let k = 0; k < 4; k++) {
      const n = pts[k], prev = pts[(k + 3) % 4], next = pts[(k + 1) % 4];
      const fin = { x: Math.sign(n.x - prev.x), z: Math.sign(n.z - prev.z) };
      const fout = { x: Math.sign(next.x - n.x), z: Math.sign(next.z - n.z) };
      const li = LEFT(fin.x, fin.z), lo = LEFT(fout.x, fout.z);
      wps.push({ x: n.x - fin.x * 15 + li.x * 3.4, z: n.z - fin.z * 15 + li.z * 3.4, corner: true });
      wps.push({ x: n.x + fout.x * 15 + lo.x * 3.4, z: n.z + fout.z * 15 + lo.z * 3.4, corner: false });
    }
    return { pts, wps };
  }

  // ---------- mission definitions ----------
  const defs = [
    {
      id: 1, title: 'Pulang Kampung', reward: 50000, auto: true,
      brief: [
        'Cahaya Bay. Lima tahun berlalu, tapi bau laut dan knalpot di sini masih sama.',
        'Raka turun dari bus dengan satu tas dan sejuta penyesalan. Ayah menelepon semalam — suaranya aneh. Bengkel Jaya sedang dalam bahaya.',
        'Berjalan kaki ke Bengkel Jaya di Kota Lama. Ikuti penanda kuning di minimap dan di dunia.',
      ],
      spawn: () => ({ x: L.busStop.x, z: L.busStop.z, yaw: Math.PI }),
      begin(M) {
        M.s = { said1: false, said2: false, arrived: false };
        const b = L.bengkel;
        M.setMarkers([{ x: b.x, z: b.z, r: 5, label: 'Bengkel Jaya' }]);
        M.setObjective('Jalan ke Bengkel Jaya di Kota Lama');
        M.setHint('WASD jalan · Shift lari · Spasi lompat · Mouse putar kamera');
        M.say('Raka', '…Cahaya Bay. Lima tahun, dan bau asin ini masih sama.', 4.5);
      },
      update(M, dt) {
        const s = M.s, b = L.bengkel;
        const d = Math.hypot(G.player.x - b.x, G.player.z - b.z);
        if (!s.said1 && M.t > 10) {
          s.said1 = true;
          M.say('Raka', 'Mobil yang terparkir bisa dipinjam — tekan E di dekatnya. Atau jalan kaki saja, aku butuh udara.', 5);
          M.setHint('E: masuk mobil · H klakson · L lampu · Q ganti radio · Shift lari');
        }
        if (!s.said2 && d < 90) { s.said2 = true; M.say('Raka', 'Itu dia… atap seng, papan tulisan merah. Bengkel Jaya.', 3.8); }
        if (!s.arrived && d < 6) {
          s.arrived = true;
          M.setMarkers([]);
          M.setObjective('Bicara dengan Ayah');
          M.runScript([
            { s: 'Pak Darto', t: 'Raka…? Kamu benar-benar pulang.' },
            { s: 'Raka', t: 'Aku dengar soal utang itu, Yah. Berapa totalnya?' },
            { s: 'Pak Darto', t: 'Tiga ratus juta, ke Laskar Senja. Mereka beri waktu tiga hari. Kalau tidak, bengkel ini mereka ambil.' },
            { s: 'Raka', t: 'Tiga hari. Cukup untuk kembali jadi orang yang dulu aku benci.' },
            { s: 'Pak Darto', t: 'Jangan, Nak. Jangan balik ke jalanan itu.' },
            { s: 'Raka', t: 'Bengkel ini hidup Ayah. Aku yang mulai semua masalah ini — aku yang akan selesaikan.' },
          ], () => M.complete());
        }
      },
    },
    {
      id: 2, title: 'Antar Paket', reward: 150000, auto: true,
      brief: [
        'Pak Darto punya kiriman suku cadang untuk tiga pelanggan lama. Upahnya cukup untuk menyicil bunga pertama.',
        'Sedan hijau di depan bengkel boleh dipakai — atau curi mobil lain, Cahaya Bay tidak akan bertanya.',
        'Antar paket ke 3 titik sebelum waktu habis. Jangan menarik perhatian polisi.',
      ],
      spawn: () => ({ x: -198, z: 9.6, yaw: Math.PI }),
      begin(M) {
        M.s = {
          delivered: 0, warned: false,
          targets: [
            { x: -160, z: 40, label: 'Warung Kopi Bu Sari' },
            { x: 0, z: 120, label: 'Dive Shop Bahari' },
            { x: 160, z: -40, label: 'Villa Bukit Hijau' },
          ],
        };
        if (!(M.carM2 && !M.carM2.removed && M.carM2.alive)) {
          M.carM2 = G.vehicles.spawn('sedan', -205, 4.6, Math.PI / 2, { color: 0x2e9c5a, parked: true });
          M.carM2.isMission = true;
        }
        M.timer = 200;
        M.setMarkers([M.s.targets[0]]);
        M.setObjective('Antar paket 1/3: ' + M.s.targets[0].label);
        M.setHint('Masuk ke mobil (E) lalu lewati penanda kuning');
        M.say('Pak Darto', 'Sedan hijau itu masih bagus. Hati-hati di jalan, Nak.', 4);
      },
      update(M, dt) {
        const s = M.s;
        M.timer -= dt;
        if (M.timer <= 0) { M.fail('Waktu pengantaran habis!'); return; }
        const t = s.targets[s.delivered];
        const P = G.player;
        if (near(t.x, t.z, 9)) {
          if (P.mode === 'driving') {
            s.delivered++;
            M.addMoney(20000, 'paket diterima');
            G.audio.ui('confirm');
            if (s.delivered >= 3) {
              M.bonus = Math.floor(M.timer) * 100;
              M.complete();
              return;
            }
            const n = s.targets[s.delivered];
            M.setMarkers([n]);
            M.setObjective('Antar paket ' + (s.delivered + 1) + '/3: ' + n.label);
            M.say('Pelanggan', 'Wah, tepat waktu! Salam buat Pak Darto ya.', 3);
          } else if (!s.warned) {
            s.warned = true;
            M.say('Raka', 'Paketnya harus diantar pakai mobil. Aku butuh kendaraan.', 3.5);
          }
        }
      },
    },
    {
      id: 3, title: 'Balapan Liar', reward: 300000,
      startPoint: { x: -280, z: 246.5, r: 4.5, label: 'Garasi Kilat' },
      brief: [
        'Bang Joko, mantan mekanik tim balapmu, menunggu di Garasi Kilat. "Kau masih ingat jalurnya, Raka? Malam ini ada balapan liar mengelilingi kota."',
        '"Hadiahnya cukup menutup setengah bunga utang Ayahmu. Mobilnya sudah kupanaskan."',
        'Balapan 3 lap melawan 3 mobil sport. Hanya juara pertama yang dapat hadiah. Lewati setiap checkpoint dan jangan kalah.',
      ],
      spawn: () => ({ x: -280, z: 250, yaw: Math.PI }),
      begin(M) {
        const { pts, wps } = buildRaceWaypoints();
        M.noWanted = true;
        G.traffic.suspend = true;
        G.traffic.clearNearby(380);
        const gridX = [-304, -292];
        const lanes = [236.6, 243.4];
        const cols = [0x2f6fd0, 0xd9342b, 0xf2f2f2, 0xf2c030];
        const racers = [];
        let ci = 0;
        for (const x of gridX) for (const z of lanes) {
          const v = G.vehicles.spawn('sport', x, z, Math.PI / 2, { color: cols[ci], driver: ci === 0 ? null : { racer: true } });
          v.static = true;
          v.isMission = true;
          racers.push({ v, k: 0, w: 1, player: ci === 0, skill: ci === 0 ? 1 : rnd(0.93, 1.0), cruise: rnd(33, 37), stuckT: 0, revT: 0, dnf: false, finished: false, name: ['Raka', 'Si Merah', 'Putih', 'Kuning'][ci] });
          if (ci > 0) v.isRacer = true;
          ci++;
        }
        G.player.forceEnter(racers[0].v);
        G.player.camYaw = Math.PI / 2;
        M.s = { pts, wps, racers, cd: 0, started: false, finished: false, legLen: 240, lastCount: -1, place: 1 };
        M.setMarkers([{ x: pts[0].x, z: pts[0].z, r: 16, label: 'Start' }]);
        M.setObjective('Bersiap di garis start…');
        M.setHint('WASD kemudi · Spasi rem tangan · Lewati checkpoint kuning');
        M.say('Bang Joko', 'Tiga lap! Pegang setir seperti dulu, Raka!', 3);
      },
      update(M, dt) {
        const s = M.s, P = G.player;
        const R = s.racers;
        s.cd += dt;
        if (!s.started) {
          const c = Math.floor(s.cd - 0.5);
          if (c !== s.lastCount && c >= 0 && c <= 3) {
            s.lastCount = c;
            if (c < 3) { G.hud.countdown(String(3 - c)); G.audio.ui('count'); } else { G.hud.countdown('GO!'); G.audio.ui('go'); }
          }
          if (s.cd >= 3.5) { s.started = true; for (const r of R) r.v.static = false; M.setObjective('Balapan dimulai!'); }
          return;
        }
        const total = 13;
        const prog = (r) => {
          const cp = s.pts[r.k % 4];
          const v = r.v;
          return r.k - clamp(Math.hypot(cp.x - v.x, cp.z - v.z) / s.legLen, 0, 1) + (r.finished ? 5 : 0);
        };
        for (const r of R) {
          const v = r.v;
          if (r.finished || r.dnf) continue;
          if (!v.alive) { r.dnf = true; continue; }
          const cp = s.pts[r.k % 4];
          const rd = r.player ? (P.mode === 'driving' ? Math.hypot(cp.x - P.x, cp.z - P.z) : 999) : Math.hypot(cp.x - v.x, cp.z - v.z);
          if (rd < 22) {
            r.k++;
            if (r.player) G.audio.ui('confirm');
            if (r.k >= total) {
              r.finished = true;
              if (!s.finished) { s.finished = true; s.winner = r; }
            }
          }
          if (!r.player) {
            const pp = prog(R[0]), np = prog(r);
            let band = 1;
            const diff = (np - pp) * s.legLen;
            if (diff > 120) band = 0.8; else if (diff < -100) band = 1.12;
            const wp = s.wps[r.w % 8];
            const dd = Math.hypot(wp.x - v.x, wp.z - v.z);
            if (dd < 10) r.w++;
            let tgt = r.cruise * r.skill * band;
            if (wp.corner) tgt = Math.min(tgt, 13 + Math.max(0, dd - 12) * 0.75);
            if (r.revT > 0) {
              r.revT -= dt;
              G.vehicles.steerTo(v, wp.x, wp.z, 8, { reverse: true });
              v.ctrl.steer = -v.ctrl.steer;
            } else {
              G.vehicles.steerTo(v, wp.x, wp.z, tgt);
              if (Math.abs(v.speed) < 1 && tgt > 3) r.stuckT += dt; else r.stuckT = 0;
              if (r.stuckT > 1.6) { r.stuckT = 0; r.revT = 1.3; }
            }
            v.lightsOn = false;
          }
        }
        if (s.finished) {
          if (s.winner.player) { M.bonus = 0; M.complete(); } else M.fail(s.winner.name + ' menang lebih dulu. Kamu kalah!');
          return;
        }
        const me = R[0];
        let rank = 1;
        const myp = prog(me);
        for (let i = 1; i < R.length; i++) if (!R[i].dnf && prog(R[i]) > myp) rank++;
        s.place = rank;
        const lap = Math.min(3, Math.floor(Math.max(0, me.k - 1) / 4) + 1);
        M.setObjective('Posisi ' + rank + '/4 — Lap ' + lap + '/3');
        const cpN = s.pts[me.k % 4];
        M.setMarkers([{ x: cpN.x, z: cpN.z, r: 14, label: 'Checkpoint' }]);
        if (P.mode !== 'driving' && M.t > 8) M.setHint('Kembali ke mobilmu! (E)');
        else M.setHint('Lap ' + lap + '/3 — jangan sampai disalip');
      },
      cleanup(M) {
        G.traffic.suspend = false;
        M.noWanted = false;
        const s = M.s;
        if (s && s.racers) for (const r of s.racers) {
          if (r.player) { r.v.static = false; r.v.isMission = false; continue; }
          if (!r.v.removed) G.vehicles.remove(r.v);
        }
      },
    },
    {
      id: 4, title: 'Tagih Utang', reward: 100000,
      startPoint: { x: -200, z: 8.6, r: 4.5, label: 'Bengkel Jaya' },
      brief: [
        'Bang Kirun dari Laskar Senja menawarkan kesepakatan: tagih utang dua toko yang menunggak ke geng mereka, dan potongan utang Ayah menantimu.',
        'Bang Joko menyelipkan sebuah pistol tua ke tanganmu. "Buat jaga-jaga. Peluruku cuma segini."',
        'Datangi dua tempat dan ambil uangnya — dengan cara damai (E) atau paksa (F / tembak). Tekan 2 untuk pistol.',
      ],
      spawn: () => ({ x: -192, z: 9.6, yaw: Math.PI }),
      begin(M) {
        G.combat.giveWeapon(48);
        G.hud.message('Pistol didapat — tekan 2 untuk ganti senjata, klik kiri tembak, R reload', 'good', 5);
        M.s = {
          loc: 0, spawned: false, done: false, forced: false, scripting: false, actors: [], collected: 0, debtor: null,
          locs: [
            { pt: L.debt1, name: 'Toko Sembako Pak Hasan', debtor: 'Pak Hasan', goons: 1, armed: false, peace: 40000, force: 70000 },
            { pt: L.debt2, name: 'Gudang Ikan Pak Rahmat', debtor: 'Pak Rahmat', goons: 2, armed: true, peace: 50000, force: 90000 },
          ],
        };
        M.setMarkers([{ x: L.debt1.x, z: L.debt1.z, r: 6, label: 'Toko Sembako' }]);
        M.setObjective('Datangi Toko Sembako Pak Hasan');
        M.setHint('Peluru terbatas — ambil ammo dari pickup kuning');
        M.say('Raka', 'Dua toko. Dua amplop. Lalu Ayah bebas dari mereka.', 4);
      },
      update(M, dt) {
        const s = M.s, P = G.player;
        const loc = s.locs[s.loc];
        if (!loc) return;
        const pt = loc.pt;
        if (!s.spawned && near(pt.x, pt.z, 60)) {
          s.spawned = true;
          const d = G.combat.spawnEnemy({ team: 'gang', x: pt.x + 1.5, z: pt.z + 3, hp: 70, armed: false, shirt: 0x8a6a3a, pants: 0x3a3a3a, aggro: false, hold: true, guard: 0, name: loc.debtor, tag: 'm4', speed: 4.2, dmg: 6 });
          s.debtor = d;
          s.actors = [d];
          for (let i = 0; i < loc.goons; i++) {
            const g = G.combat.spawnEnemy({ team: 'gang', x: pt.x + (i ? -4 : 4), z: pt.z + 1 + i * 2, hp: 65, armed: loc.armed, aggro: false, hold: true, guard: 1.5, tag: 'm4', dmg: 7, acc: 0.42, range: 12 });
            s.actors.push(g);
          }
        }
        if (!s.spawned || s.done || s.scripting) return;
        const d = s.debtor;
        if (!s.forced) {
          if (s.actors.some((e) => e.aggro && e.state !== 'dead')) s.forced = true;
          else if (d && d.state !== 'dead' && near(d.x, d.z, 4.5)) {
            G.hud.prompt('[E] Bicara baik-baik   [F] Paksa', 3);
            if (G.input.wasPressed('KeyE') && !G.interactTaken) {
              G.interactTaken = true;
              s.scripting = true;
              M.runScript([
                { s: 'Raka', t: 'Pak, aku datang atas nama Laskar Senja. Tolong bayar yang menunggak.' },
                { s: loc.debtor, t: 'Anak muda… aku cuma punya segini. Ambillah. Jangan sakiti keluargaku.' },
                { s: 'Raka', t: 'Terima kasih, Pak. Semoga kita tidak bertemu lagi.' },
              ], () => {
                M.addMoney(loc.peace, 'cara damai');
                s.collected += loc.peace;
                s.scripting = false;
                finishLoc(M);
              });
            } else if (G.input.wasPressed('KeyF')) s.forced = true;
          }
        }
        if (s.forced && !s.fightOn) {
          s.fightOn = true;
          for (const e of s.actors) if (e.state !== 'dead') e.aggro = true;
          M.setObjective('Kalahkan ' + loc.debtor + ' dan anak buahnya');
          M.setMarkers([]);
          M.say(loc.debtor, 'Berani-beraninya! Hajar dia!', 3);
        }
        if (s.forced) {
          const alive = s.actors.filter((e) => e.state !== 'dead').length;
          M.setObjective('Kalahkan ' + loc.debtor + ' dan anak buahnya (' + alive + ' lawan)');
          if (alive === 0) {
            M.addMoney(loc.force, 'uang rampasan');
            s.collected += loc.force;
            finishLoc(M);
          }
        }
      },
      cleanup(M) {
        G.combat.removeByTag('m4');
      },
    },
    {
      id: 5, title: 'Kabur dari Razia', reward: 200000, auto: true,
      brief: [
        'Uang sudah di tangan, tapi sirene meraung dari ujung jalan — razia gabungan polisi mengepung kawasan itu!',
        'Suara Bang Joko di radio: "Raka! Kabur ke rumah aman di Bukit Hijau. Jangan berhenti, jangan lihat belakang!"',
        'Wanted level 3. Lepaskan pengejarmu atau langsung tancap gas ke penanda kuning di Bukit Hijau.',
      ],
      spawn: () => ({ x: -120, z: 197, yaw: Math.PI }),
      begin(M) {
        const sh = L.safeHouse;
        M.s = { said: false, car: null };
        M.s.car = M.carNearPlayer('sport', 0x9aa3ab);
        G.police.setStars(3);
        M.setMarkers([{ x: sh.x, z: sh.z, r: 9, label: 'Rumah Aman' }]);
        M.setObjective('Kabur dari polisi — capai Rumah Aman di Bukit Hijau');
        M.setHint('Gunakan gang sempit, tikung tajam, dan rem tangan (Spasi)');
        M.say('Bang Joko', 'Raka! Mobil sport di dekatmu — ambil! Polisi sudah di mana-mana!', 4.5);
      },
      update(M, dt) {
        const sh = L.safeHouse, s = M.s;
        if (!s.said && G.police.stars === 0) { s.said = true; M.say('Bang Joko', 'Bersih! Sekarang menuju rumah aman, jangan sampai ada yang mengikuti.', 4); }
        if (near(sh.x, sh.z, 10)) {
          G.police.reset();
          G.hud.message('Polisi kehilangan jejakmu', 'good', 3);
          M.complete();
        }
      },
    },
    {
      id: 6, title: 'Akhir Senja', reward: 1000000,
      startPoint: { x: -200, z: 8.6, r: 4.5, label: 'Bengkel Jaya' },
      brief: [
        'Bang Kirun ternyata mengkhianatimu: utang Ayah dinaikkan lagi malam ini. Kesabaran Raka habis.',
        'Markas Laskar Senja ada di Bukit Hijau, dijaga ketat. Bos Gerhana menunggu di dalam.',
        'Serbu markas, kalahkan anak buahnya, jatuhkan bosnya, dan selamatkan Bengkel Jaya. Kamu dibekali armor dan amunisi tambahan.',
      ],
      spawn: () => ({ x: 205, z: -78, yaw: Math.PI / 2 }),
      begin(M) {
        const mk = L.markas;
        G.player.health = 100;
        G.player.addArmor(80);
        G.combat.giveWeapon(60);
        G.player.ammoReserve = Math.max(G.player.ammoReserve, 96);
        M.s = { stage: 0, boss: null, goons: [], intro: false, scripting: false, bossSaid: false };
        M.s.car = M.carNearPlayer('sport', 0x24282b);
        const pos = [[264, -100], [296, -100], [262, -116], [298, -118], [272, -108], [288, -108], [281, -99], [268, -128], [294, -128]];
        pos.forEach((p, i) => {
          const armed = i % 3 !== 2;
          const e = G.combat.spawnEnemy({ team: 'gang', x: p[0], z: p[1], hp: armed ? 70 : 85, armed, aggro: false, guard: 2.5, tag: 'm6', dmg: armed ? 7 : 8, acc: 0.44, range: 13 });
          M.s.goons.push(e);
        });
        const boss = G.combat.spawnEnemy({ team: 'gang', x: mk.boss.x, z: mk.boss.z, hp: 300, armed: true, aggro: false, guard: 1, scale: 1.15, shirt: 0xff8a1f, pants: 0x1a1a1a, tag: 'm6', dmg: 10, acc: 0.55, range: 15, name: 'BOS GERHANA', boss: true, speed: 4.2 });
        M.s.boss = boss;
        M.boss = boss;
        M.setMarkers([{ x: mk.gate.x, z: mk.gate.z, r: 10, label: 'Markas Laskar Senja' }]);
        M.setObjective('Serbu markas Laskar Senja di Bukit Hijau');
        M.setHint('Berlindung di balik peti dan tembok — armor melindungi kamu');
        M.say('Raka', 'Malam ini semuanya selesai.', 3.5);
      },
      update(M, dt) {
        const s = M.s, mk = L.markas;
        const goonsAlive = s.goons.filter((e) => e.state !== 'dead').length;
        const boss = s.boss;
        if (s.stage === 0) {
          if (near(mk.gate.x, mk.gate.z, 24)) {
            s.stage = 1;
            for (const e of s.goons) e.aggro = true;
            M.setMarkers([]);
            M.say('Anak buah', 'Itu Raka! Habisi dia!', 3);
          }
        }
        if (s.stage >= 1) {
          if (boss && boss.state !== 'dead' && (goonsAlive <= 3 || near(boss.x, boss.z, 26))) boss.aggro = true;
          if (goonsAlive > 0) M.setObjective('Habisi anak buah Laskar Senja (' + goonsAlive + ' tersisa)');
          else if (boss && boss.state !== 'dead') {
            M.setObjective('Kalahkan Bos Gerhana');
            boss.aggro = true;
            if (!s.bossSaid) { s.bossSaid = true; M.say('Bos Gerhana', 'Kau pikir bisa menyentuhku, anak mekanik?', 3.5); }
          }
          if (boss && boss.state !== 'dead') G.hud.setBoss('BOS GERHANA', clamp(boss.hp / boss.maxHp, 0, 1));
        }
        if (boss && boss.state === 'dead' && !s.scripting) {
          s.scripting = true;
          G.hud.setBoss(null);
          M.setObjective('Selamatkan Bengkel Jaya');
          M.runScript([
            { s: 'Bos Gerhana', t: 'Kau… menang malam ini. Tapi Cahaya Bay tidak pernah benar-benar tidur…' },
            { s: 'Raka', t: 'Cukup untukku. Bengkel Ayah bebas.' },
            { s: 'Pak Darto', t: 'Raka… terima kasih. Bengkel ini akan selalu punya tempat untukmu.' },
          ], () => M.complete());
        }
      },
      cleanup(M) {
        G.combat.removeByTag('m6');
        G.hud.setBoss(null);
        M.boss = null;
      },
    },
  ];
  M.defs = defs;

  function finishLoc(M) {
    const s = M.s;
    s.done = false;
    s.spawned = false;
    s.forced = false;
    s.fightOn = false;
    const old = s.actors.slice();
    setTimeout(() => { for (const e of old) if (e.alive && e.state !== 'dead' && !e.aggro) G.combat.removeEnemy(e); }, 6000);
    s.loc++;
    if (s.loc >= s.locs.length) {
      M.setMarkers([]);
      M.bonus = 0;
      M.say('Bang Kirun', 'Bagus, Raka. Utang ayahmu berkurang… untuk sekarang.', 3.5);
      setTimeout(() => { if (M.state === 'active' && M.cur === defs[3]) M.complete(); }, 1500);
      s.done = true;
    } else {
      const n = s.locs[s.loc];
      M.setMarkers([{ x: n.pt.x, z: n.pt.z, r: 6, label: n.name }]);
      M.setObjective('Datangi ' + n.name);
    }
  }

  // ---------- flow ----------
  function setPending() {
    M.cur = null;
    const d = defs[M.index];
    if (!d) { M.freeRoam = true; M.markers = []; M.objective = 'Free roam — jelajahi Cahaya Bay'; M.hint = 'Semua distrik terbuka. Nikmati kota!'; return; }
    M.freeRoam = false;
    M.timer = null;
    if (d.auto) { M.autoT = 2.5; M.markers = []; M.objective = ''; } else {
      M.markers = [{ x: d.startPoint.x, z: d.startPoint.z, r: d.startPoint.r, label: d.startPoint.label }];
      M.objective = 'Mulai misi: ' + d.title + ' di ' + d.startPoint.label;
      M.hint = '';
    }
  }

  M.startNew = () => {
    cleanupCur();
    spawnProps();
    M.index = 0;
    M.state = 'idle';
    M.cool = 2;
    M.carM2 = null;
    setPending();
  };
  M.loadState = (idx) => {
    cleanupCur();
    spawnProps();
    M.index = clamp(idx, 0, defs.length);
    M.state = 'idle';
    M.cool = 2;
    setPending();
  };

  function openBriefing(def) {
    M.state = 'briefing';
    M.cur = def;
    M.markers = [];
    G.setState('briefing');
    G.hud.showBriefing(def, M.index + 1, () => beginCur());
  }
  function beginCur() {
    const def = M.cur;
    M.state = 'active';
    M.t = 0;
    M.bonus = 0;
    M.timer = null;
    M.hint = '';
    G.setState('playing');
    G.hud.banner('MISI ' + def.id, def.title, 'start');
    def.begin(M);
  }
  function cleanupCur() {
    const def = M.cur;
    if (def && def.cleanup) def.cleanup(M);
    scriptQ = []; scriptCb = null; M.scriptActive = false;
    M.noWanted = false;
    if (G.traffic) G.traffic.suspend = false;
    G.hud.setBoss(null);
  }

  M.complete = () => {
    const def = M.cur;
    if (!def || M.state !== 'active') return;
    const reward = def.reward + (M.bonus || 0);
    G.money += reward;
    G.audio.ui('win');
    G.hud.banner('MISI SELESAI', def.title, 'win', '+' + formatMoney(reward));
    cleanupCur();
    M.index++;
    M.state = 'idle';
    M.cool = 4;
    M.hint = '';
    M.timer = null;
    G.player.health = Math.max(G.player.health, 60);
    setPending();
    if (M.index >= defs.length) {
      G.hud.message('TAMAT — Bengkel Jaya selamat. Free roam dibuka!', 'good', 7);
    }
    G.save.save();
  };

  M.fail = (reason) => {
    if (M.state !== 'active') return;
    const def = M.cur;
    M.state = 'failed';
    G.audio.ui('fail');
    G.setState('failed');
    G.hud.showFail(def.title, reason, () => { M.restart(); G.setState('playing'); });
  };

  // Restart the current mission from its starting condition.
  M.restart = () => {
    const def = M.cur || defs[M.index];
    if (!def) return;
    cleanupCur();
    M.cur = def;
    const sp = def.spawn ? def.spawn() : null;
    G.police.reset();
    G.player.revive(sp ? sp.x : G.player.x, sp ? sp.z : G.player.z, sp ? sp.yaw : G.player.yaw);
    G.player.health = 100;
    M.state = 'active';
    M.t = 0;
    M.bonus = 0;
    M.timer = null;
    G.hud.banner('MISI ' + def.id, def.title, 'start');
    def.begin(M);
  };
  // Called after respawn from BUSTED/WASTED while a mission was running.
  M.onPlayerDown = () => {
    if (M.state === 'active') { G.hud.message('Misi diulang dari awal', 'warn', 3); M.restart(); }
  };
  M.isActive = () => M.state === 'active';

  M.onEnterVehicle = () => {};
  M.onExitVehicle = () => {};

  M.update = (dt) => {
    spawnProps();
    updateProps(dt);
    updateMarkerMeshes(dt);
    if (M.cool > 0) M.cool -= dt;
    if (M.scriptActive) { M.scriptT -= dt; if (M.scriptT <= 0) nextLine(); }
    const P = G.player;
    if (M.state === 'active') {
      M.t += dt;
      const def = M.cur;
      if (def && def.update) def.update(M, dt);
      return;
    }
    if (M.state !== 'idle') return;
    const d = defs[M.index];
    if (!d) return;
    if (d.auto) {
      if (M.autoT > 0) { M.autoT -= dt; if (M.autoT <= 0 && !P.dead) openBriefing(d); }
    } else if (M.cool <= 0 && !P.dead && G.police.stars === 0 && !M.scriptActive && near(d.startPoint.x, d.startPoint.z, d.startPoint.r)) {
      openBriefing(d);
    }
  };

  // Jump straight into mission idx (demo scenes / testing).
  M.quickStart = (idx) => {
    cleanupCur();
    spawnProps();
    M.index = clamp(idx, 0, defs.length - 1);
    M.cur = defs[M.index];
    M.autoT = 0;
    beginCur();
  };

  M.reset = () => {
    cleanupCur();
    M.cur = null; M.state = 'idle'; M.markers = []; M.objective = ''; M.hint = ''; M.timer = null;
  };

  return M;
}
