// city.js — builds Cahaya Bay: road grid, sidewalks, procedural buildings, signs, parks, beach, sea, sky,
// traffic lights, street lamps, palms, plus road-graph/collision data used by AI and physics.
import * as THREE from 'three';
import {
  makeRng, clamp, lerp, TAU, makeCanvas, boxPart, cylPart, spherePart, extrudePart, gablePart,
  planeXZ, wallQuad, mergeGeos, colorize,
} from './utils.js';

export const S = 80; // distance between road centerlines
export const RW = 14; // road width
export const HALF = RW / 2;
export const SW = 3.5; // sidewalk width
export const I_MIN = -5, I_MAX = 5, J_MIN = -4, J_MAX = 4;
export const BOUNDS = { minX: -428, maxX: 428, minZ: -338, maxZ: 392 };

export const SIGN_NAMES = [
  'Warung Kopi', 'Bengkel Jaya', 'Pasar Ikan', 'Toko Sembako', 'Apotek Sehat', 'Bakso Pak Kumis', 'Salon Cantik', 'Toko Roti Manis',
  'Warung Padang', 'Kios Pulsa', 'Laundry Bersih', 'Es Campur Segar', 'Sate Madura', 'Toko Buku Pelangi', 'Mini Mart Cahaya', 'Hotel Samudra',
  'Resto Seafood', 'Dive Shop Bahari', 'Kafe Senja', 'Warung Nasi', 'Toko Emas Murni', 'Bank Nusantara', 'Fotokopi Cepat', 'Toko Kelontong',
  'Barber Shop Rapi', 'Gudang Ikan Segar', 'Ikan Bakar Pantai', 'Kedai Jus Segar', 'Garasi Kilat', 'Klinik Sehat', 'RS Cahaya', 'Kantor Polisi',
  'LASKAR SENJA', 'Toko Sepatu', 'Hotel Pelangi', 'Cuci Mobil Kilat',
];
const SHOP_SIGNS = [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 29, 33, 35];
const SIGN_COLS = 4;
const SIGN_ROWS = 9;

export function nodePos(i, j) { return { x: i * S, z: j * S }; }
export function hasNode(i, j) { return i >= I_MIN && i <= I_MAX && j >= J_MIN && j <= J_MAX; }

export function districtAt(x, z) {
  if (z > 100) return x < 0 ? 'Marina' : 'Pantai Cahaya';
  if (z < -170 || x > 130) return 'Bukit Hijau';
  if (x < -130) return 'Kota Lama';
  return 'Downtown';
}

// Keyframes for the light/sky cycle (hour -> colors/intensities).
const ENV_KEYS = [
  { h: 0, top: 0x0a1230, bot: 0x1b2a4e, sun: 0x7f95d9, si: 0.35, hs: 0x2a3a7a, hg: 0x1a2030, hi: 0.5 },
  { h: 5.5, top: 0x2a3566, bot: 0xe08a6a, sun: 0xffb080, si: 0.8, hs: 0x6a78b0, hg: 0x40342c, hi: 0.8 },
  { h: 7.5, top: 0x4aa3e8, bot: 0xc4e6f6, sun: 0xfff0d0, si: 2.0, hs: 0xa0d0ff, hg: 0x6a7a50, hi: 1.2 },
  { h: 12, top: 0x1f86e3, bot: 0xaadcf7, sun: 0xfffbe8, si: 2.5, hs: 0xbfe0ff, hg: 0x7f8a60, hi: 1.4 },
  { h: 16.5, top: 0x3a8fe0, bot: 0xd7e3ec, sun: 0xffe2a8, si: 2.2, hs: 0xc0d8f0, hg: 0x7a7a58, hi: 1.3 },
  { h: 18.3, top: 0x4a6cc0, bot: 0xffb070, sun: 0xffa458, si: 1.7, hs: 0xb0a8c8, hg: 0x6a5a48, hi: 1.0 },
  { h: 19.6, top: 0x2a2f66, bot: 0xe0707a, sun: 0xff7a5a, si: 0.7, hs: 0x7a78b0, hg: 0x40343a, hi: 0.8 },
  { h: 21, top: 0x0f1638, bot: 0x2d3f78, sun: 0x7f95d9, si: 0.35, hs: 0x2a3a7a, hg: 0x1a2030, hi: 0.55 },
  { h: 24, top: 0x0a1230, bot: 0x1b2a4e, sun: 0x7f95d9, si: 0.35, hs: 0x2a3a7a, hg: 0x1a2030, hi: 0.5 },
];

export function createCity(G) {
  const scene = G.scene;
  const quality = G.settings.quality;
  const rng = makeRng(20261124);
  const group = new THREE.Group();
  scene.add(group);
  const aniso = G.maxAniso || 4;

  // ---------------- collision grid ----------------
  const CELL = 32;
  const colliders = [];
  const grid = new Map();
  let stamp = 0;
  const qtmp = [];
  const rtmp = [];
  const gkey = (i, j) => (i + 100) * 1000 + (j + 100);
  function addCollider(x0, x1, z0, z1, h, kind = 'b') {
    const c = { x0, x1, z0, z1, h, kind, q: 0 };
    colliders.push(c);
    const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL), j0 = Math.floor(z0 / CELL), j1 = Math.floor(z1 / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = gkey(i, j);
        let l = grid.get(k);
        if (!l) { l = []; grid.set(k, l); }
        l.push(c);
      }
    }
    return c;
  }
  function query(x, z, r) {
    stamp++;
    qtmp.length = 0;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const l = grid.get(gkey(i, j));
        if (!l) continue;
        for (let n = 0; n < l.length; n++) {
          const c = l[n];
          if (c.q !== stamp) { c.q = stamp; qtmp.push(c); }
        }
      }
    }
    return qtmp;
  }
  function rayBox(c, ox, oy, oz, dx, dy, dz) {
    let tmin = 0, tmax = Infinity;
    const slab = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      return tmin <= tmax;
    };
    if (!slab(ox, dx, c.x0, c.x1)) return Infinity;
    if (!slab(oy, dy, 0, c.h)) return Infinity;
    if (!slab(oz, dz, c.z0, c.z1)) return Infinity;
    return tmin;
  }
  // Distance along the ray to the nearest building/prop, or Infinity.
  function raycast(ox, oy, oz, dx, dy, dz, maxD) {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    let best = Infinity;
    stamp++;
    const steps = Math.ceil(maxD / 16);
    for (let s = 0; s <= steps; s++) {
      const d = Math.min(s * 16, maxD);
      const px = ox + dx * d, pz = oz + dz * d;
      const i0 = Math.floor((px - 20) / CELL), i1 = Math.floor((px + 20) / CELL), j0 = Math.floor((pz - 20) / CELL), j1 = Math.floor((pz + 20) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const l = grid.get(gkey(i, j));
          if (!l) continue;
          for (let n = 0; n < l.length; n++) {
            const c = l[n];
            if (c.q === stamp) continue;
            c.q = stamp;
            const t = rayBox(c, ox, oy, oz, dx, dy, dz);
            if (t < best && t <= maxD) best = t;
          }
        }
      }
    }
    return best;
  }

  // ---------------- textures ----------------
  function canvasTex(w, h, draw, repeat = true) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    return t;
  }
  function speckle(g, w, h, n, colors, size = 2) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length];
      g.fillRect(Math.random() * w, Math.random() * h, size, size);
    }
  }
  const texGlass = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f1f4f6'; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 8, 0, 120);
    grd.addColorStop(0, '#9ed4ff'); grd.addColorStop(0.55, '#3f86c4'); grd.addColorStop(1, '#255a8e');
    g.fillStyle = grd; g.fillRect(6, 8, 116, 112);
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath(); g.moveTo(6, 8); g.lineTo(60, 8); g.lineTo(6, 70); g.closePath(); g.fill();
    g.fillStyle = '#dfe6ea'; g.fillRect(62, 8, 4, 112);
  });
  const texOffice = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f0ebe0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9d3c6'; g.fillRect(0, 100, w, 10);
    g.fillStyle = '#516f8d'; g.fillRect(24, 24, 80, 62);
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(24, 24, 80, 14);
    g.fillStyle = '#e8e2d6'; g.fillRect(62, 24, 4, 62);
    g.fillStyle = '#c8c2b4'; g.fillRect(20, 86, 88, 6);
  });
  const texShop = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f7f1e6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5f9cc4'; g.fillRect(22, 30, 84, 56);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(22, 30, 84, 12);
    g.fillStyle = '#e9dfcb'; g.fillRect(18, 86, 92, 7);
    g.fillStyle = '#d7cbb4'; for (let i = 0; i < 4; i++) g.fillRect(22 + i * 21, 30, 2, 56);
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 118, w, 10);
  });
  const texHouse = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#fbf5ea'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#44627a'; g.fillRect(42, 34, 44, 52);
    g.fillStyle = '#fbf5ea'; g.fillRect(62, 34, 4, 52); g.fillRect(42, 58, 44, 4);
    g.fillStyle = '#9a6b45'; g.fillRect(30, 34, 10, 52); g.fillRect(88, 34, 10, 52);
  });
  const texRoad = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#3d4046'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, ['#46494f', '#35383d', '#4b4e54'], 2);
    g.fillStyle = '#e8e8e0'; g.fillRect(6, 0, 3, h); g.fillRect(119, 0, 3, h);
    g.fillStyle = '#f2d54a'; g.fillRect(61, 0, 2, h); g.fillRect(65, 0, 2, h);
    g.fillStyle = '#3d4046'; g.fillRect(58, 56, 12, 20); // gap in the double line for a dashed look
  });
  const texCross = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#3d4046'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 300, ['#46494f', '#35383d'], 2);
    g.fillStyle = '#ecebe4';
    for (let k = 0; k < 6; k++) {
      g.fillRect(24 + k * 14, 6, 8, 20); g.fillRect(24 + k * 14, 102, 8, 20);
      g.fillRect(6, 24 + k * 14, 20, 8); g.fillRect(102, 24 + k * 14, 20, 8);
    }
  });
  const texSign = canvasTex(1024, 36 * 16, (g, w, h) => {
    const cw = w / SIGN_COLS, ch = h / SIGN_ROWS;
    const bgs = ['#c0392b', '#1f7a8c', '#e08e0b', '#2e7d32', '#6a1b9a', '#1565c0', '#ad1457', '#37474f'];
    SIGN_NAMES.forEach((name, i) => {
      const cx = (i % SIGN_COLS) * cw, cy = Math.floor(i / SIGN_COLS) * ch;
      g.fillStyle = name === 'LASKAR SENJA' ? '#1a1a1a' : bgs[i % bgs.length];
      g.fillRect(cx, cy, cw, ch);
      g.strokeStyle = name === 'LASKAR SENJA' ? '#ff8a1f' : '#ffffff';
      g.lineWidth = 5;
      g.strokeRect(cx + 6, cy + 6, cw - 12, ch - 12);
      g.fillStyle = name === 'LASKAR SENJA' ? '#ff8a1f' : '#ffffff';
      let size = 44;
      g.font = 'bold ' + size + 'px sans-serif';
      while (g.measureText(name).width > cw - 36 && size > 16) { size -= 2; g.font = 'bold ' + size + 'px sans-serif'; }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(name, cx + cw / 2, cy + ch / 2 + 2);
    });
  }, false);
  const texWave = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2b94d6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 5, x + 30, y); g.stroke();
    }
  });
  const texGrass = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#5c9d43'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#68ad4c', '#51903a', '#74b556', '#4a8736'], 3);
  });

  // ---------------- materials ----------------
  const mkBld = (map) => new THREE.MeshLambertMaterial({ map, vertexColors: true });
  const matGlass = mkBld(texGlass);
  const matOffice = mkBld(texOffice);
  const matShop = mkBld(texShop);
  const matHouse = mkBld(texHouse);
  const matPlain = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matRoad = new THREE.MeshLambertMaterial({ map: texRoad, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const matCross = new THREE.MeshLambertMaterial({ map: texCross, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const matSign = new THREE.MeshBasicMaterial({ map: texSign, side: THREE.DoubleSide });
  const matFlat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  // ---------------- geometry buckets ----------------
  const B = { glass: [], office: [], shop: [], house: [], plain: [], flat: [], roads: [], cross: [], signs: [] };
  const KINDS = { glass: { tw: 3, th: 3.6 }, office: { tw: 4, th: 4 }, shop: { tw: 5, th: 4.2 }, house: { tw: 5, th: 3.3 } };
  const palmSpots = [], treeSpots = [], lampSpots = [], piers = [];
  const landmarks = {};
  const pickupSpots = [];

  const pastel = [0xf6c9a0, 0xf4e48c, 0xaedccb, 0xf2aaaa, 0xa3c8ea, 0xdcbdf5, 0xffd7a0, 0xc8e4b6];
  const glassTints = [0x86bde8, 0x62abc9, 0xa3cbd9, 0x8fa8ca, 0x72bdb4, 0xb0c1d4];
  const officeTints = [0xeadfca, 0xd9e1e9, 0xf1e1d2, 0xcbd3c4];
  const hotelTints = [0xfff1e0, 0xffe0e8, 0xe0f4ff, 0xfff5c8];
  const wallTints = [0xfff4e0, 0xffe8d0, 0xe8f0ff, 0xe0f0e0, 0xf8e0e0];
  const roofTints = [0xb5523b, 0x8a4a3a, 0x4a6a8a, 0x6a7a4a, 0xa86038];

  function addBuilding(kind, x, z, w, d, floors, color) {
    const k = KINDS[kind];
    const h = floors * k.th;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const bw = Math.max(1, Math.round(w / k.tw));
    const bd = Math.max(1, Math.round(d / k.tw));
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const idx = f * 4 + v;
        let u = uv.getX(idx), vv = uv.getY(idx);
        if (f < 2) { u *= bd; vv *= floors; }
        else if (f < 4) { u *= 0.02; vv *= 0.02; }
        else { u *= bw; vv *= floors; }
        uv.setXY(idx, u, vv);
      }
    }
    g.translate(x + w / 2, h / 2, z + d / 2);
    B[kind].push(colorize(g, color));
    addCollider(x, x + w, z, z + d, h);
    return { x, z, w, d, h };
  }
  function roofDetail(b, tall) {
    const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
    B.plain.push(boxPart(b.w + 0.4, 0.5, b.d + 0.4, cx, b.h + 0.25, cz, 0xcfcac0));
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      B.plain.push(boxPart(rng.range(1.5, 3), 1.3, rng.range(1.5, 3), b.x + rng.range(2, Math.max(2.1, b.w - 3)), b.h + 1.1, b.z + rng.range(2, Math.max(2.1, b.d - 3)), 0x8a8f96));
    }
    if (tall) {
      B.plain.push(boxPart(0.3, 9, 0.3, cx, b.h + 4.5, cz, 0xb0b4ba));
      B.plain.push(boxPart(0.7, 0.7, 0.7, cx, b.h + 9.2, cz, 0xff3030));
    }
  }
  function addHouse(x, z, w, d, floors, wall, roof) {
    const b = addBuilding('house', x, z, w, d, floors, wall);
    B.plain.push(gablePart(w + 1.2, 2.8, d + 1.2, x + w / 2, b.h, z + d / 2, roof));
    B.plain.push(boxPart(1.6, 2.2, 0.2, x + w / 2 + rng.range(-3, 3), 1.1, z + d + 0.05, 0x7b4a2d));
    return b;
  }
  function addSigns(b, rect, count, idx) {
    for (let n = 0; n < count; n++) {
      const faces = [];
      if (b.x - rect.x0 < 10) faces.push({ nx: -1, nz: 0, cx: b.x, cz: b.z + b.d / 2, len: b.d });
      if (rect.x1 - (b.x + b.w) < 10) faces.push({ nx: 1, nz: 0, cx: b.x + b.w, cz: b.z + b.d / 2, len: b.d });
      if (b.z - rect.z0 < 10) faces.push({ nx: 0, nz: -1, cx: b.x + b.w / 2, cz: b.z, len: b.w });
      if (rect.z1 - (b.z + b.d) < 10) faces.push({ nx: 0, nz: 1, cx: b.x + b.w / 2, cz: b.z + b.d, len: b.w });
      if (!faces.length) return;
      const f = rng.pick(faces);
      const si = idx !== undefined ? idx : rng.pick(SHOP_SIGNS);
      const sw = Math.min(7, f.len - 2);
      if (sw < 3) continue;
      const along = rng.range(-(f.len / 2 - sw / 2 - 0.5), f.len / 2 - sw / 2 - 0.5);
      const px = f.cx + f.nx * 0.08 + (f.nx !== 0 ? 0 : along);
      const pz = f.cz + f.nz * 0.08 + (f.nx !== 0 ? along : 0);
      const col = si % SIGN_COLS, row = Math.floor(si / SIGN_COLS);
      B.signs.push(wallQuad(sw, sw / 4, px, 3.4 + rng.range(0, 0.6), pz, Math.atan2(f.nx, f.nz),
        col / SIGN_COLS, 1 - (row + 1) / SIGN_ROWS, (col + 1) / SIGN_COLS, 1 - row / SIGN_ROWS));
    }
  }
  function bigSign(idx, w, x, y, z, yaw) {
    const col = idx % SIGN_COLS, row = Math.floor(idx / SIGN_COLS);
    B.signs.push(wallQuad(w, w / 4, x, y, z, yaw, col / SIGN_COLS, 1 - (row + 1) / SIGN_ROWS, (col + 1) / SIGN_COLS, 1 - row / SIGN_ROWS));
  }
  function overlay(x0, z0, x1, z1, color, y = 0.105) {
    B.flat.push(planeXZ(x0, z0, x1, z1, y, color));
  }
  function addTree(x, z, s = 1) { treeSpots.push({ x, z, s }); addCollider(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 5, 'prop'); }
  function addPalm(x, z, s = 1) { palmSpots.push({ x, z, s }); addCollider(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 6, 'prop'); }
  function addCrate(x, z, s, color = 0x9a7048) {
    B.plain.push(boxPart(s, s, s, x, s / 2 + 0.1, z, color));
    addCollider(x - s / 2, x + s / 2, z - s / 2, z + s / 2, s, 'prop');
  }
  function addBarrel(x, z, color = 0xb83a2a) {
    B.plain.push(cylPart(0.45, 0.45, 1.1, 8, x, 0.65, z, color));
    addCollider(x - 0.45, x + 0.45, z - 0.45, z + 0.45, 1.1, 'prop');
  }

  // ---------------- block layout ----------------
  const blockRect = (bi, bj) => ({ x0: bi * S + HALF, x1: (bi + 1) * S - HALF, z0: bj * S + HALF, z1: (bj + 1) * S - HALF });
  const ringCorners = (bi, bj) => {
    const r = blockRect(bi, bj), h = 1.75;
    return [{ x: r.x0 + h, z: r.z0 + h }, { x: r.x1 - h, z: r.z0 + h }, { x: r.x1 - h, z: r.z1 - h }, { x: r.x0 + h, z: r.z1 - h }];
  };
  function splitLots(ix0, iz0, iw, id, nx, nz, gap) {
    const out = [];
    const w = (iw - gap * (nx - 1)) / nx, d = (id - gap * (nz - 1)) / nz;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) out.push({ x: ix0 + a * (w + gap), z: iz0 + b * (d + gap), w, d });
    return out;
  }

  const SPECIAL = new Map([
    ['-3,0', 'bengkel'], ['3,-2', 'markas'], ['-4,-1', 'debt1'], ['-2,2', 'debt2'], ['-4,3', 'garasi'],
    ['0,-1', 'police'], ['-1,-2', 'hospital'], ['-4,0', 'pasar'], ['0,0', 'park'], ['-3,1', 'kiosk'], ['1,-2', 'park'],
    ['3,-4', 'rumahaman'],
  ]);

  function buildPark(r) {
    overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0x6fb24c);
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    overlay(cx - 2, r.z0 + SW, cx + 2, r.z1 - SW, 0xd8cfb8, 0.11);
    overlay(r.x0 + SW, cz - 2, r.x1 - SW, cz + 2, 0xd8cfb8, 0.11);
    overlay(cx - 9, cz - 9, cx + 9, cz + 9, 0x3f9fd8, 0.115);
    B.plain.push(cylPart(10, 10, 0.4, 20, cx, 0.2, cz, 0xcfc6b0));
    B.plain.push(cylPart(8.8, 8.8, 0.5, 20, cx, 0.22, cz, 0x4aa8e0));
    for (let i = 0; i < 10; i++) {
      const x = rng.range(r.x0 + 8, r.x1 - 8), z = rng.range(r.z0 + 8, r.z1 - 8);
      if (Math.abs(x - cx) < 6 || Math.abs(z - cz) < 6) continue;
      if (rng.chance(0.5)) addPalm(x, z, rng.range(0.9, 1.2)); else addTree(x, z, rng.range(0.9, 1.3));
    }
    for (let k = 0; k < 4; k++) {
      const a = k * TAU / 4;
      const bx = cx + Math.cos(a) * 13, bz = cz + Math.sin(a) * 13;
      B.plain.push(boxPart(2.2, 0.5, 0.7, bx, 0.5, bz, 0x8a5a36, { y: -a }));
      B.plain.push(boxPart(2.2, 0.5, 0.15, bx - Math.sin(a) * 0.3, 0.9, bz + Math.cos(a) * 0.3, 0x8a5a36, { y: -a }));
    }
    for (let i = 0; i < 18; i++) B.flat.push(planeXZ(r.x0 + 8 + (i % 6) * 8, r.z0 + 8 + Math.floor(i / 6) * 8, r.x0 + 9 + (i % 6) * 8, r.z0 + 9 + Math.floor(i / 6) * 8, 0.112, [0xf05a7a, 0xf2d33a, 0xffffff][i % 3]));
  }

  function buildDowntown(r, bi, bj) {
    const ix0 = r.x0 + 5, iz0 = r.z0 + 5, iw = r.x1 - r.x0 - 10;
    overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0xa6aab0);
    if (rng.chance(0.58)) {
      const w = rng.range(30, 42), d = rng.range(30, 42);
      const x = ix0 + (iw - w) / 2 + rng.range(-3, 3), z = iz0 + (iw - d) / 2 + rng.range(-3, 3);
      const floors = rng.int(12, 30);
      const tint = rng.pick(glassTints);
      const b = addBuilding('glass', x, z, w, d, floors, tint);
      if (floors > 18) {
        const w2 = w * 0.62, d2 = d * 0.62, f2 = rng.int(4, 9);
        const g = addBuilding('glass', x + (w - w2) / 2, z + (d - d2) / 2, w2, d2, f2, tint);
        // lift the upper section onto the tower (addBuilding creates it at ground level, so shift it)
        const geo = B.glass[B.glass.length - 1];
        geo.translate(0, b.h, 0);
        colliders[colliders.length - 1].h = b.h + g.h;
        b.h += g.h;
      }
      roofDetail(b, b.h > 55);
      for (let i = 0; i < 3; i++) addPalm(x + rng.range(0, w), z - 3, 1);
    } else {
      for (const l of splitLots(ix0, iz0, iw, iw, 2, 2, 3)) {
        if (rng.chance(0.15)) { overlay(l.x, l.z, l.x + l.w, l.z + l.d, 0x78b858); addTree(l.x + l.w / 2, l.z + l.d / 2); continue; }
        const kind = rng.chance(0.5) ? 'glass' : 'office';
        const b = addBuilding(kind, l.x + 1, l.z + 1, l.w - 2, l.d - 2, rng.int(5, 12), kind === 'glass' ? rng.pick(glassTints) : rng.pick(officeTints));
        roofDetail(b, false);
        if (kind === 'office') addSigns(b, r, 1, rng.chance(0.5) ? 21 : 22);
      }
    }
  }

  function buildKotaLama(r) {
    const ix0 = r.x0 + 5, iz0 = r.z0 + 5, iw = r.x1 - r.x0 - 10;
    overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0xb8b2a2);
    for (const l of splitLots(ix0, iz0, iw, iw, 2, 2, 2)) {
      if (rng.chance(0.1)) { overlay(l.x, l.z, l.x + l.w, l.z + l.d, 0x78b858); addTree(l.x + l.w / 2, l.z + l.d / 2); continue; }
      const b = addBuilding('shop', l.x, l.z, l.w, l.d, rng.int(2, 4), rng.pick(pastel));
      roofDetail(b, false);
      addSigns(b, r, 2);
    }
  }

  function buildMarina(r, innerShrinkE = 0) {
    const ix0 = r.x0 + 5, iz0 = r.z0 + 5, iw = r.x1 - r.x0 - 10 - innerShrinkE, id = r.z1 - r.z0 - 10;
    overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0xaaa89e);
    for (const l of splitLots(ix0, iz0, iw, id, 2, 2, 2)) {
      const t = rng.int(0, 3);
      if (t === 0) {
        const b = addBuilding('office', l.x, l.z, l.w, l.d, 2, rng.pick([0xb8c8d8, 0xd0d8c8, 0xc8b8a8]));
        roofDetail(b, false);
        addSigns(b, r, 1, rng.chance(0.5) ? 2 : 25);
      } else if (t === 1) {
        for (let a = 0; a < 3; a++) for (let c = 0; c < 2; c++) {
          const stack = rng.int(1, 3);
          for (let s = 0; s < stack; s++) B.plain.push(boxPart(l.w / 3 - 1, 2.5, l.d / 2 - 1.5, l.x + (a + 0.5) * l.w / 3, 1.35 + s * 2.55, l.z + (c + 0.5) * l.d / 2, rng.pick([0xc0392b, 0x2a6fb8, 0xe0a010, 0x2e8b57, 0x8a8f96])));
        }
        addCollider(l.x + 0.5, l.x + l.w - 0.5, l.z + 0.5, l.z + l.d - 0.5, 7, 'b');
      } else if (t === 2) {
        const b = addBuilding('shop', l.x, l.z, l.w, l.d, rng.int(2, 3), rng.pick(pastel));
        roofDetail(b, false);
        addSigns(b, r, 2);
      } else {
        overlay(l.x, l.z, l.x + l.w, l.z + l.d, 0xc9a56e, 0.112);
        for (let i = 0; i < 3; i++) addPalm(l.x + 4 + i * (l.w - 8) / 2, l.z + l.d / 2, 1);
      }
    }
  }

  function buildPantai(r, bj) {
    const ix0 = r.x0 + 5, iz0 = r.z0 + 5, iw = r.x1 - r.x0 - 10;
    overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, bj === 3 ? 0xe6d3a0 : 0xd0c8b4);
    for (const l of splitLots(ix0, iz0, iw, iw, 2, 2, 2)) {
      const t = rng.int(0, 3);
      if (t === 0) {
        const b = addBuilding('office', l.x + 1, l.z + 1, l.w - 2, l.d - 2, rng.int(6, 11), rng.pick(hotelTints));
        roofDetail(b, false);
        addSigns(b, r, 1, rng.chance(0.5) ? 15 : 34);
      } else if (t === 1) {
        const b = addBuilding('shop', l.x, l.z, l.w, l.d, 2, rng.pick(pastel));
        roofDetail(b, false);
        addSigns(b, r, 2, rng.pick([16, 18, 26, 27]));
      } else {
        overlay(l.x, l.z, l.x + l.w, l.z + l.d, 0xead7a6, 0.112);
        for (let i = 0; i < 3; i++) {
          const ux = l.x + 5 + i * 8, uz = l.z + l.d / 2 + rng.range(-5, 5);
          B.plain.push(cylPart(0.06, 0.06, 2.6, 5, ux, 1.4, uz, 0xeeeeee));
          B.plain.push(cylPart(0.1, 2.2, 0.8, 10, ux, 2.8, uz, rng.pick([0xe84a4a, 0xf2c030, 0x3a9ae0, 0xffffff])));
          B.plain.push(boxPart(0.9, 0.15, 1.8, ux + 1.6, 0.25, uz, 0xf5f0e0));
        }
        addPalm(l.x + 3, l.z + 3, 1.1); addPalm(l.x + l.w - 3, l.z + l.d - 3, 1.1);
      }
    }
  }

  function buildBukit(r) {
    overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0x74b24e);
    const ix0 = r.x0 + 5, iz0 = r.z0 + 5, iw = r.x1 - r.x0 - 10;
    for (const l of splitLots(ix0, iz0, iw, iw, 2, 2, 0)) {
      const w = rng.range(11, 15), d = rng.range(9, 12);
      const hx = l.x + rng.range(1.5, l.w - w - 1.5), hz = l.z + rng.range(2, l.d - d - 6);
      addHouse(hx, hz, w, d, rng.int(1, 2), rng.pick(wallTints), rng.pick(roofTints));
      overlay(hx + w / 2 - 1.2, hz + d, hx + w / 2 + 1.2, l.z + l.d, 0xcfc8b8, 0.112);
      for (let i = 0; i < 3; i++) addTree(l.x + rng.range(1.5, l.w - 1.5), l.z + l.d - rng.range(1.5, 4), rng.range(0.9, 1.3));
    }
  }

  function buildSpecial(kind, bi, bj, r) {
    if (kind === 'park') { buildPark(r); return; }
    if (kind === 'kiosk') {
      buildMarina(r, 12);
      B.plain.push(boxPart(5, 3.2, 8, -173.5, 1.6, 100, 0xe8d8b0));
      addCollider(-176, -171, 96, 104, 3.2);
      B.plain.push(boxPart(1.6, 0.25, 8.6, -170.6, 3.2, 100, 0xd8402a, { z: -0.35 }));
      bigSign(0, 4.6, -170.9, 2.4, 100, Math.PI / 2);
      overlay(-176, 95, -168, 105, 0xd8c8a0, 0.112);
      landmarks.warung = { x: -168.9, z: 100 };
      return;
    }
    if (kind === 'bengkel') {
      overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0xa8a49a);
      const b = addBuilding('shop', -218, 12, 36, 24, 2, 0xe8a85c);
      roofDetail(b, false);
      B.plain.push(boxPart(13, 4.4, 0.4, -200, 2.2, 11.8, 0x30343a));
      B.plain.push(boxPart(14, 0.6, 1.4, -200, 4.7, 11.2, 0xd8402a));
      bigSign(1, 13, -200, 6.8, 11.85, Math.PI);
      bigSign(1, 8, -182 + 0.1, 5, 24, Math.PI / 2);
      addBarrel(-190, 9.2); addBarrel(-189, 9.8, 0x2a5aa8); addBarrel(-209, 9.4, 0x2a8a4a);
      for (let i = 0; i < 4; i++) B.plain.push(cylPart(0.5, 0.5, 0.3 + i * 0.01, 10, -213, 0.25 + i * 0.3, 9.5, 0x202020));
      overlay(-232, 38, -168, 72, 0x8f8b82, 0.112);
      addCrate(-225, 50, 1.6); addCrate(-222, 55, 1.2); addTree(-176, 66); addPalm(-228, 68);
      landmarks.bengkel = { x: -200, z: 8.6, yard: { x: -200, z: 55 } };
      return;
    }
    if (kind === 'pasar') {
      overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0xc7b99a);
      for (let a = 0; a < 4; a++) for (let c = 0; c < 3; c++) {
        const sx = r.x0 + 10 + a * 13, sz = r.z0 + 16 + c * 16;
        const col = rng.pick([0xe0463a, 0xf0b020, 0x3a8ee0, 0x3aa86a, 0xe86aa0]);
        B.plain.push(boxPart(5, 1.0, 2.4, sx, 0.6, sz, 0x9a7048));
        addCollider(sx - 2.5, sx + 2.5, sz - 1.2, sz + 1.2, 1.1, 'prop');
        B.plain.push(boxPart(5.6, 0.18, 4, sx, 2.9, sz, col));
        for (const px of [-2.6, 2.6]) B.plain.push(boxPart(0.12, 2.8, 0.12, sx + px, 1.4, sz + 1.8, 0x444444));
        B.plain.push(boxPart(0.9, 0.5, 0.7, sx - 1, 1.35, sz, rng.pick([0xe86a3a, 0xf2d03a, 0x6ab04a])));
      }
      B.plain.push(boxPart(0.3, 5, 0.3, r.x0 + 6, 2.5, r.z0 + 6, 0x555555));
      B.plain.push(boxPart(0.3, 5, 0.3, r.x1 - 6, 2.5, r.z0 + 6, 0x555555));
      bigSign(2, 10, (r.x0 + r.x1) / 2, 6.4, r.z0 + 6, Math.PI);
      B.plain.push(boxPart(r.x1 - r.x0 - 8, 0.2, 0.3, (r.x0 + r.x1) / 2, 4.6, r.z0 + 6, 0x555555));
      B.plain.push(boxPart(0.3, 3.2, 0.3, (r.x0 + r.x1) / 2 - 4.5, 3.4, r.z0 + 6, 0x555555));
      B.plain.push(boxPart(0.3, 3.2, 0.3, (r.x0 + r.x1) / 2 + 4.5, 3.4, r.z0 + 6, 0x555555));
      landmarks.pasar = { x: (r.x0 + r.x1) / 2, z: r.z0 + 8 };
      return;
    }
    if (kind === 'debt1' || kind === 'debt2') {
      const d1 = kind === 'debt1';
      overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, d1 ? 0x9c968a : 0xa9a8a0);
      const cx = (r.x0 + r.x1) / 2;
      const zs = d1 ? -66 : 174;
      const b = addBuilding('shop', cx - 12, zs, 24, 14, 2, d1 ? 0xf0c890 : 0x9fc5d8);
      roofDetail(b, false);
      bigSign(d1 ? 3 : 25, 9, cx, 3.6, zs + 14.1, 0);
      B.plain.push(boxPart(2.4, 3.0, 0.3, cx, 1.5, zs + 14.05, 0x6a4a2a));
      const yard = d1 ? [-40] : [200];
      addCrate(cx - 20, yard[0] + 12, 1.6); addCrate(cx - 18.2, yard[0] + 12, 1.2); addCrate(cx + 20, yard[0] + 10, 1.6);
      addBarrel(cx + 19, yard[0] + 13); addBarrel(cx - 22, yard[0] - 8, 0x2a5aa8); addBarrel(cx + 22, yard[0] - 6, 0xe0a010);
      addPalm(cx + 24, zs + 4, 1); addTree(cx - 24, yard[0] + 16);
      landmarks[kind] = { x: cx, z: yard[0], door: { x: cx, z: zs + 15.5 } };
      return;
    }
    if (kind === 'garasi') {
      overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0x9a9a94);
      const b = addBuilding('shop', -300, 254, 40, 22, 2, 0x8fb8c8);
      roofDetail(b, false);
      B.plain.push(boxPart(15, 4.6, 0.4, -280, 2.3, 253.8, 0x464a50));
      bigSign(28, 12, -280, 6.8, 253.75, Math.PI);
      for (let i = 0; i < 4; i++) addPalm(-300 + i * 13, 278, 1);
      landmarks.safe = { x: -280, z: 248.5 };
      return;
    }
    if (kind === 'rumahaman') {
      overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0x9aa088);
      const b = addBuilding('shop', 262, -276, 36, 22, 2, 0xc9d8b0);
      roofDetail(b, false);
      B.plain.push(boxPart(14, 4.4, 0.4, 280, 2.2, -253.8, 0x3a3f46));
      B.plain.push(boxPart(15, 0.6, 1.4, 280, 4.8, -253.3, 0x2fa89a));
      bigSign(35, 12, 280, 6.9, -253.75, 0);
      for (let i = 0; i < 4; i++) addPalm(256 + i * 16, -250, 1);
      addBarrel(300, -252); addCrate(262, -250, 1.4);
      landmarks.safeHouse = { x: 280, z: -241 };
      return;
    }
    if (kind === 'police' || kind === 'hospital') {
      const pol = kind === 'police';
      overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0xb6b8be);
      const bx = pol ? 17 : -65, bz = pol ? -66 : -146;
      const b = addBuilding('office', bx, bz, 46, pol ? 30 : 36, pol ? 4 : 5, pol ? 0xa8c0e8 : 0xffffff);
      roofDetail(b, false);
      const faceZ = bz + (pol ? 30 : 36);
      bigSign(pol ? 31 : 30, 10, bx + 23, 4.2, faceZ + 0.1, 0);
      if (!pol) {
        B.plain.push(boxPart(5, 1.3, 0.2, bx + 23, 14, faceZ + 0.12, 0xe02020));
        B.plain.push(boxPart(1.3, 5, 0.2, bx + 23, 14, faceZ + 0.12, 0xe02020));
      } else {
        B.plain.push(boxPart(46, 0.6, 0.3, bx + 23, 3.2, faceZ + 0.1, 0x1a3a8a));
      }
      for (let i = 0; i < 4; i++) addTree(r.x0 + 12 + i * 14, pol ? r.z1 - 8 : r.z1 - 8);
      landmarks[kind] = { x: pol ? 40 : -40, z: pol ? -8.7 : -88.7 };
      return;
    }
    if (kind === 'markas') {
      overlay(r.x0 + SW, r.z0 + SW, r.x1 - SW, r.z1 - SW, 0x6a6a68);
      const wc = 0x6b6258;
      const wall = (x0, z0, x1, z1) => { B.plain.push(boxPart(x1 - x0, 3.4, z1 - z0, (x0 + x1) / 2, 1.7, (z0 + z1) / 2, wc)); addCollider(x0, x1, z0, z1, 3.4); };
      wall(252, -148, 308, -146.8);
      wall(252, -148, 253.2, -92);
      wall(306.8, -148, 308, -92);
      wall(252, -93.2, 272, -92);
      wall(288, -93.2, 308, -92);
      B.plain.push(boxPart(16, 0.5, 1.4, 280, 4.6, -92.6, 0xff8a1f));
      bigSign(32, 12, 280, 5.9, -92.6 + 0.8, 0);
      const b = addBuilding('office', 262, -145, 36, 20, 2, 0x8a8f98);
      roofDetail(b, false);
      B.plain.push(boxPart(9, 4.2, 0.3, 280, 2.1, -124.8, 0x2a2a2e));
      bigSign(32, 10, 280, 6.4, -124.85, 0);
      addBarrel(258, -100, 0xff8a1f); addBarrel(259.2, -100.6, 0x2a2a2a); addBarrel(300, -100, 0xff8a1f);
      addCrate(300, -110, 1.8); addCrate(298, -113, 1.4); addCrate(258, -118, 1.6); addCrate(260, -121, 1.2);
      landmarks.markas = { x: 280, z: -112, boss: { x: 280, z: -121 }, gate: { x: 280, z: -85 } };
      return;
    }
  }

  function buildBlock(bi, bj) {
    const r = blockRect(bi, bj);
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    B.plain.push(boxPart(r.x1 - r.x0, 0.1, r.z1 - r.z0, cx, 0.05, cz, 0xc9c6bd));
    const sp = SPECIAL.get(bi + ',' + bj);
    const dist = districtAt(cx, cz);
    if (sp) buildSpecial(sp, bi, bj, r);
    else if (dist === 'Downtown') buildDowntown(r, bi, bj);
    else if (dist === 'Kota Lama') buildKotaLama(r);
    else if (dist === 'Marina') buildMarina(r);
    else if (dist === 'Pantai Cahaya') buildPantai(r, bj);
    else buildBukit(r);
    // edge props: lamps and palms/trees along the curb
    const plantsPalm = dist === 'Marina' || dist === 'Pantai Cahaya' || dist === 'Downtown';
    const spots = [];
    for (let t = 14; t < 52; t += 19) {
      spots.push({ x: r.x0 + t + 5, z: r.z0 + 0.8, yaw: Math.PI, px: r.x0 + t + 14, pz: r.z0 + 2.7 });
      spots.push({ x: r.x0 + t + 5, z: r.z1 - 0.8, yaw: 0, px: r.x0 + t + 14, pz: r.z1 - 2.7 });
      spots.push({ x: r.x0 + 0.8, z: r.z0 + t + 5, yaw: -Math.PI / 2, px: r.x0 + 2.7, pz: r.z0 + t + 14 });
      spots.push({ x: r.x1 - 0.8, z: r.z0 + t + 5, yaw: Math.PI / 2, px: r.x1 - 2.7, pz: r.z0 + t + 14 });
    }
    spots.forEach((s, i) => {
      if (i % 2 === 0) { lampSpots.push({ x: s.x, z: s.z, yaw: s.yaw }); addCollider(s.x - 0.2, s.x + 0.2, s.z - 0.2, s.z + 0.2, 6, 'prop'); }
      if (rng.chance(plantsPalm ? 0.75 : 0.35)) {
        if (plantsPalm && rng.chance(0.8)) addPalm(s.px, s.pz, rng.range(0.85, 1.25)); else addTree(s.px, s.pz, rng.range(0.9, 1.2));
      }
    });
    if (!sp && rng.chance(0.4)) {
      const c = ringCorners(bi, bj);
      pickupSpots.push({ x: c[rng.int(0, 3)].x, z: c[rng.int(0, 3)].z });
    }
  }

  for (let bi = I_MIN; bi < I_MAX; bi++) for (let bj = J_MIN; bj < J_MAX; bj++) buildBlock(bi, bj);

  // ---------------- roads ----------------
  const zLen = (J_MAX - J_MIN) * S + RW, xLen = (I_MAX - I_MIN) * S + RW;
  for (let i = I_MIN; i <= I_MAX; i++) {
    B.roads.push(planeXZ(i * S - HALF, J_MIN * S - HALF, i * S + HALF, J_MAX * S + HALF, 0.03, 0xffffff, { ua: 0, ub: 1, va: 0, vb: zLen / 8, swap: false }));
  }
  for (let j = J_MIN; j <= J_MAX; j++) {
    B.roads.push(planeXZ(I_MIN * S - HALF, j * S - HALF, I_MAX * S + HALF, j * S + HALF, 0.03, 0xffffff, { ua: 0, ub: 1, va: 0, vb: xLen / 8, swap: true }));
  }
  for (let i = I_MIN; i <= I_MAX; i++) for (let j = J_MIN; j <= J_MAX; j++) {
    B.cross.push(planeXZ(i * S - HALF, j * S - HALF, i * S + HALF, j * S + HALF, 0.045, 0xffffff, { ua: 0, ub: 1, va: 0, vb: 1, swap: false }));
  }

  // ---------------- beach, boardwalk, piers, boats ----------------
  B.flat.push(planeXZ(-900, 326, 900, 334, 0.115, 0xb98a5a));
  B.flat.push(planeXZ(-900, 334, 900, 392, 0.02, 0xeed9a3));
  B.flat.push(planeXZ(-900, 389, 900, 393, 0.03, 0xf8f4e6));
  for (let k = 0; k < 6; k++) {
    const px = -380 + k * 55 + (k > 2 ? 0 : 0);
    if (px >= 0) break;
    B.plain.push(boxPart(5, 0.3, 66, px, 0.2, 360, 0x9a6f45));
    for (let n = 0; n < 8; n++) B.plain.push(cylPart(0.18, 0.18, 1.2, 6, px + (n % 2 ? 2.2 : -2.2), -0.1, 332 + n * 8, 0x5a4028));
    piers.push({ x0: px - 2.5, x1: px + 2.5, z0: 326, z1: 392 });
    const hx = px + 5.5;
    B.plain.push(extrudePart([[-2.6, 0.2], [2.6, 0.2], [3.2, 1.2], [-3.0, 1.2]], 2.2, rng.pick([0xf5f5f5, 0xe8d070, 0xd8504a]), hx, 0, 372));
    B.plain.push(boxPart(1.6, 1.0, 2.6, hx, 1.7, 371, 0xf8f8f8));
    B.plain.push(boxPart(1.7, 0.45, 2.7, hx, 1.9, 371, 0x3a5a7a));
  }
  for (let i = 0; i < 6; i++) {
    const bx = -300 + i * 38 + rng.range(-10, 10), bz = 405 + rng.range(0, 40);
    B.plain.push(extrudePart([[-3, 0.0], [3.4, 0.0], [4.2, 1.4], [-3.4, 1.4]], 2.6, rng.pick([0xffffff, 0x2a6fb8, 0xe8c840]), bx, 0, bz));
    B.plain.push(cylPart(0.07, 0.07, 6, 5, bx, 4, bz, 0xdddddd));
    B.plain.push(boxPart(0.1, 5, 2.4, bx + 0.05, 4, bz - 1.2, 0xfafafa));
  }

  // ---------------- finalize merged static meshes ----------------
  const finalize = (list, mat, cast, recv) => {
    if (!list.length) return null;
    const m = new THREE.Mesh(mergeGeos(list), mat);
    m.castShadow = cast;
    m.receiveShadow = recv;
    group.add(m);
    return m;
  };
  finalize(B.glass, matGlass, true, true);
  finalize(B.office, matOffice, true, true);
  finalize(B.shop, matShop, true, true);
  finalize(B.house, matHouse, true, true);
  finalize(B.plain, matPlain, true, true);
  finalize(B.flat, matFlat, false, true);
  finalize(B.roads, matRoad, false, true);
  finalize(B.cross, matCross, false, true);
  finalize(B.signs, matSign, false, false);

  // ---------------- ground, hills, sea, sky ----------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 2392), new THREE.MeshLambertMaterial({ map: texGrass }));
  texGrass.repeat.set(500, 300);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, -804);
  ground.receiveShadow = true;
  group.add(ground);

  const hillGeos = [];
  for (let k = 0; k < 34; k++) {
    const a = rng.range(0, TAU), rad = rng.range(520, 1000);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.9 - 80;
    if (z > 300 && Math.abs(x) < 1200) continue;
    const size = rng.range(90, 220);
    hillGeos.push(spherePart(size, 14, 8, x, -size * 0.25, z, rng.pick([0x5aa04a, 0x4f9444, 0x66ad52, 0x3f8a48]), rng.range(0.4, 0.7)));
  }
  finalize(hillGeos, matPlain, false, false);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 3000),
    new THREE.MeshPhongMaterial({ map: texWave, color: 0xbfe6ff, shininess: 90, specular: 0x99ddff, transparent: true, opacity: 0.94 })
  );
  texWave.repeat.set(120, 60);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.06, 388 + 1500);
  group.add(sea);

  // sky dome with vertex-colored gradient
  const skyGeo = new THREE.SphereGeometry(1400, 24, 16);
  const skyCol = new Float32Array(skyGeo.attributes.position.count * 3);
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(55, 24), new THREE.MeshBasicMaterial({ color: 0xfff3c8, fog: false, depthWrite: false, toneMapped: false }));
  sunDisc.renderOrder = -9;
  sunDisc.frustumCulled = false;
  scene.add(sunDisc);

  // clouds: merged puffs, drift by rotating the group
  const cloudGeos = [];
  for (let c = 0; c < 24; c++) {
    const a = rng.range(0, TAU), rad = rng.range(250, 1200), y = rng.range(170, 330);
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    const n = rng.int(4, 7);
    for (let i = 0; i < n; i++) {
      cloudGeos.push(spherePart(rng.range(24, 48), 8, 6, cx + rng.range(-60, 60), y + rng.range(-6, 8), cz + rng.range(-30, 30), 0xffffff, 0.5));
    }
  }
  const clouds = new THREE.Mesh(mergeGeos(cloudGeos), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.93, depthWrite: false, toneMapped: false }));
  clouds.frustumCulled = false;
  scene.add(clouds);

  // lights
  const sun = new THREE.DirectionalLight(0xfffbe8, 2.4);
  sun.position.set(120, 200, 80);
  sun.castShadow = quality !== 'low';
  const shRes = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(shRes, shRes);
  const sc = sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 520;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x7f8a60, 1.4);
  scene.add(hemi);
  scene.fog = new THREE.Fog(0xaadcf7, 160, quality === 'low' ? 520 : 760);

  // ---------------- instanced props ----------------
  const mkInst = (geo, mat, spots, fn) => {
    if (!spots.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, spots.length);
    const o = new THREE.Object3D();
    spots.forEach((s, i) => {
      fn(o, s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = true;
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const palmParts = [cylPart(0.16, 0.3, 6.2, 6, 0, 3.1, 0, 0x8a6a48), cylPart(0.34, 0.34, 0.3, 6, 0, 6.2, 0, 0x5a4630)];
  for (let k = 0; k < 8; k++) {
    let g = new THREE.BoxGeometry(0.9, 0.07, 3.6);
    g.translate(0, 0, 1.8);
    g.rotateX(0.5 + (k % 2) * 0.25);
    g.rotateY(k * TAU / 8);
    g.translate(0, 6.2, 0);
    palmParts.push(colorize(g, k % 2 ? 0x3f9a3c : 0x4fae48));
  }
  palmParts.push(spherePart(0.28, 6, 4, 0.3, 5.95, 0.1, 0x6a4a2a), spherePart(0.28, 6, 4, -0.25, 5.9, -0.2, 0x6a4a2a));
  const palmGeo = mergeGeos(palmParts);
  mkInst(palmGeo, matPlain, palmSpots, (o, s) => { o.position.set(s.x, 0.1, s.z); o.rotation.set(0, rng.range(0, TAU), 0); o.scale.setScalar(s.s); });
  const treeGeo = mergeGeos([
    cylPart(0.2, 0.3, 3.2, 6, 0, 1.6, 0, 0x6e4e32),
    spherePart(1.9, 8, 6, 0, 4.4, 0, 0x3f9a44), spherePart(1.4, 8, 6, 1.1, 3.8, 0.5, 0x4aa84c), spherePart(1.3, 8, 6, -1.0, 3.9, -0.4, 0x358a3c),
  ]);
  mkInst(treeGeo, matPlain, treeSpots, (o, s) => { o.position.set(s.x, 0.1, s.z); o.rotation.set(0, rng.range(0, TAU), 0); o.scale.setScalar(s.s); });
  const lampGeo = mergeGeos([
    cylPart(0.09, 0.12, 6.2, 6, 0, 3.1, 0, 0x4a4f55),
    boxPart(0.12, 0.12, 1.5, 0, 6.2, 0.7, 0x4a4f55),
    boxPart(0.4, 0.14, 0.7, 0, 6.1, 1.35, 0x6a6f75),
  ]);
  mkInst(lampGeo, matPlain, lampSpots, (o, s) => { o.position.set(s.x, 0.1, s.z); o.rotation.set(0, s.yaw, 0); o.scale.setScalar(1); });
  const lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xe8e8d8 });
  const lampBulbs = mkInst(new THREE.BoxGeometry(0.32, 0.08, 0.5), lampBulbMat, lampSpots, (o, s) => {
    o.position.set(s.x + Math.sin(s.yaw) * 1.35, 6.0, s.z + Math.cos(s.yaw) * 1.35); o.rotation.set(0, s.yaw, 0);
  });
  if (lampBulbs) lampBulbs.castShadow = false;

  // traffic light hardware
  const nodeCount = (I_MAX - I_MIN + 1) * (J_MAX - J_MIN + 1);
  const tlSpots = [];
  for (let i = I_MIN; i <= I_MAX; i++) for (let j = J_MIN; j <= J_MAX; j++) {
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) tlSpots.push({ x: i * S + sx * (HALF + 0.9), z: j * S + sz * (HALF + 0.9), sx, sz, i, j });
  }
  const tlPole = mkInst(mergeGeos([cylPart(0.1, 0.13, 5.2, 6, 0, 2.6, 0, 0x30343a), boxPart(0.6, 1.1, 0.6, 0, 5.1, 0, 0x1c2026)]), matPlain, tlSpots, (o, s) => { o.position.set(s.x, 0.1, s.z); o.rotation.set(0, 0, 0); });
  if (tlPole) tlPole.castShadow = false;
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tlLamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), lampMat, tlSpots.length * 2);
  tlLamps.frustumCulled = false;
  const tmpO = new THREE.Object3D();
  const tmpC = new THREE.Color();
  tlSpots.forEach((s, n) => {
    tmpO.position.set(s.x, 5.15, s.z + s.sz * 0.32); tmpO.updateMatrix(); tlLamps.setMatrixAt(n * 2, tmpO.matrix);
    tmpO.position.set(s.x + s.sx * 0.32, 5.15, s.z); tmpO.updateMatrix(); tlLamps.setMatrixAt(n * 2 + 1, tmpO.matrix);
    tlLamps.setColorAt(n * 2, tmpC.set(0xff2a2a));
    tlLamps.setColorAt(n * 2 + 1, tmpC.set(0xff2a2a));
  });
  tlLamps.instanceMatrix.needsUpdate = true;
  group.add(tlLamps);
  const tlCache = new Int8Array(tlSpots.length * 2).fill(-1);
  const LCOL = [0x28ff5a, 0xffcc22, 0xff2a2a];

  // ---------------- traffic light state ----------------
  const CYCLE = 24, GREEN = 9;
  let clock = 0;
  function lightState(i, j, axis) {
    const off = (((i * 7 + j * 13) % CYCLE) + CYCLE) % CYCLE;
    const t = (clock + off) % CYCLE;
    const p = axis === 0 ? t : (t + CYCLE / 2) % CYCLE;
    if (p < GREEN) return 0;
    if (p < CYCLE / 2) return 1;
    return 2;
  }
  function updateLights() {
    for (let n = 0; n < tlSpots.length; n++) {
      const s = tlSpots[n];
      const zs = lightState(s.i, s.j, 1), xs = lightState(s.i, s.j, 0);
      if (tlCache[n * 2] !== zs) { tlCache[n * 2] = zs; tlLamps.setColorAt(n * 2, tmpC.set(LCOL[zs])); tlLamps.instanceColor.needsUpdate = true; }
      if (tlCache[n * 2 + 1] !== xs) { tlCache[n * 2 + 1] = xs; tlLamps.setColorAt(n * 2 + 1, tmpC.set(LCOL[xs])); tlLamps.instanceColor.needsUpdate = true; }
    }
  }
  updateLights();

  // ---------------- environment (sun movement, sky, fog) ----------------
  const cA = new THREE.Color(), cB = new THREE.Color();
  const topC = new THREE.Color(), botC = new THREE.Color(), tmpCol = new THREE.Color();
  const sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
  let envHour = -1;
  let skyTimer = 0;
  function mixKey(h, prop, out) {
    let a = ENV_KEYS[0], b = ENV_KEYS[1];
    for (let i = 0; i < ENV_KEYS.length - 1; i++) {
      if (h >= ENV_KEYS[i].h && h <= ENV_KEYS[i + 1].h) { a = ENV_KEYS[i]; b = ENV_KEYS[i + 1]; break; }
    }
    const t = (h - a.h) / (b.h - a.h || 1);
    out.copy(cA.set(a[prop])).lerp(cB.set(b[prop]), t);
    return t;
  }
  function numKey(h, prop) {
    let a = ENV_KEYS[0], b = ENV_KEYS[1];
    for (let i = 0; i < ENV_KEYS.length - 1; i++) {
      if (h >= ENV_KEYS[i].h && h <= ENV_KEYS[i + 1].h) { a = ENV_KEYS[i]; b = ENV_KEYS[i + 1]; break; }
    }
    return lerp(a[prop], b[prop], (h - a.h) / (b.h - a.h || 1));
  }
  function applySky(top, bot) {
    const pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const hgt = clamp(pos.getY(i) / 1800, 0, 1);
      const k = Math.pow(hgt, 0.55);
      skyCol[i * 3] = lerp(bot.r, top.r, k);
      skyCol[i * 3 + 1] = lerp(bot.g, top.g, k);
      skyCol[i * 3 + 2] = lerp(bot.b, top.b, k);
    }
    skyGeo.attributes.color.needsUpdate = true;
  }
  function setHour(h) {
    h = ((h % 24) + 24) % 24;
    envHour = h;
    mixKey(h, 'top', topC);
    mixKey(h, 'bot', botC);
    mixKey(h, 'sun', tmpCol);
    sun.color.copy(tmpCol);
    sun.intensity = numKey(h, 'si');
    mixKey(h, 'hs', tmpCol);
    hemi.color.copy(tmpCol);
    mixKey(h, 'hg', tmpCol);
    hemi.groundColor.copy(tmpCol);
    hemi.intensity = numKey(h, 'hi');
    scene.fog.color.copy(botC);
    const day = h >= 6 && h <= 18;
    const a = day ? ((h - 6) / 12) * Math.PI : (((h + 18) % 24) / 12) * Math.PI; // sun (day) or moon (night)
    sunDir.set(Math.cos(a) * 0.85, Math.max(0.25, Math.sin(a)), 0.4).normalize();
    lampBulbMat.color.set(h < 6.2 || h > 18.8 ? 0xfff1b0 : 0xb8b8ac);
    if (skyTimer <= 0) { applySky(topC, botC); skyTimer = 0.6; }
  }
  setHour(G.gameHour || 11.5);

  // ---------------- queries for AI and gameplay ----------------
  function blockOf(x, z) {
    const bi = Math.floor(x / S), bj = Math.floor(z / S);
    if (bi < I_MIN || bi >= I_MAX || bj < J_MIN || bj >= J_MAX) return null;
    const lx = x - bi * S, lz = z - bj * S;
    if (lx < HALF || lx > S - HALF || lz < HALF || lz > S - HALF) return null;
    return { bi, bj };
  }
  function groundY(x, z) {
    if (z > 326) {
      for (const p of piers) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return 0.35;
      return z < 334 ? 0.12 : 0.02;
    }
    if (blockOf(x, z)) return 0.1;
    if (x >= I_MIN * S - HALF && x <= I_MAX * S + HALF && z >= J_MIN * S - HALF && z <= J_MAX * S + HALF) return 0.03;
    return 0;
  }
  function isRoad(x, z) {
    if (x < I_MIN * S - HALF || x > I_MAX * S + HALF || z < J_MIN * S - HALF || z > J_MAX * S + HALF) return false;
    const dx = Math.abs(x - Math.round(x / S) * S), dz = Math.abs(z - Math.round(z / S) * S);
    return dx <= HALF || dz <= HALF;
  }
  function nearestNode(x, z) {
    return { i: clamp(Math.round(x / S), I_MIN, I_MAX), j: clamp(Math.round(z / S), J_MIN, J_MAX) };
  }
  // BFS over the road grid. Returns [{i,j},...] from start to goal inclusive.
  function findPath(i0, j0, i1, j1) {
    const key = (i, j) => (i - I_MIN) * 20 + (j - J_MIN);
    const prev = new Map();
    const q = [[i0, j0]];
    prev.set(key(i0, j0), null);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length) {
      const [ci, cj] = q.shift();
      if (ci === i1 && cj === j1) break;
      for (const [di, dj] of dirs) {
        const ni = ci + di, nj = cj + dj;
        if (!hasNode(ni, nj) || prev.has(key(ni, nj))) continue;
        prev.set(key(ni, nj), [ci, cj]);
        q.push([ni, nj]);
      }
    }
    const path = [];
    let cur = [i1, j1];
    if (!prev.has(key(i1, j1))) return [{ i: i0, j: j0 }];
    while (cur) { path.push({ i: cur[0], j: cur[1] }); cur = prev.get(key(cur[0], cur[1])); }
    return path.reverse();
  }

  landmarks.busStop = { x: ringCorners(-3, 2)[1].x, z: ringCorners(-3, 2)[1].z };
  landmarks.spawnHospital = landmarks.hospital;
  landmarks.spawnPolice = landmarks.police;

  const city = {
    group, sun, hemi, landmarks, pickupSpots, colliders, SIGN_NAMES,
    query, raycast, groundY, isRoad, blockOf, nearestNode, findPath, lightState, setHour, ringCorners, districtAt,
    node: nodePos, hasNode,
    get clock() { return clock; },
    clampToWorld(o) {
      o.x = clamp(o.x, BOUNDS.minX, BOUNDS.maxX);
      o.z = clamp(o.z, BOUNDS.minZ, BOUNDS.maxZ);
    },
    // Sun follows the player so the shadow box stays centered where the action is.
    update(dt, cam, focus) {
      clock += dt;
      lightTimer += dt;
      if (lightTimer > 0.25) { lightTimer = 0; updateLights(); }
      skyTimer -= dt;
      if (skyTimer <= 0 || Math.abs(envHour - G.gameHour) > 0.02) setHour(G.gameHour);
      sky.position.copy(cam.position);
      sunDisc.position.copy(cam.position).addScaledVector(sunDir, 1180);
      sunDisc.lookAt(cam.position);
      sunDisc.visible = sunDir.y > 0.2 && G.gameHour > 5.8 && G.gameHour < 18.8;
      clouds.rotation.y += dt * 0.004;
      clouds.position.x = cam.position.x * 0.85;
      clouds.position.z = cam.position.z * 0.85;
      texWave.offset.x += dt * 0.004;
      texWave.offset.y += dt * 0.002;
      if (focus) {
        sun.target.position.set(focus.x, 0, focus.z);
        sun.position.set(focus.x + sunDir.x * 220, sunDir.y * 220, focus.z + sunDir.z * 220);
        sun.target.updateMatrixWorld();
      }
    },
    applyQuality(q) {
      sun.castShadow = q !== 'low';
      const res = q === 'high' ? 2048 : 1024;
      if (sun.shadow.mapSize.x !== res) {
        sun.shadow.mapSize.set(res, res);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      scene.fog.far = q === 'low' ? 520 : 760;
    },
  };
  let lightTimer = 0;
  return city;
}
