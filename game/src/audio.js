// audio.js — everything is synthesized with WebAudio: engine, siren, guns, steps, horn, UI, and synthwave radio.
import { clamp } from './utils.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Three original synth stations. chords are triads (midi), bass roots (midi) per bar.
export const STATIONS = [
  { name: 'Senja FM', bpm: 104, wave: 'sawtooth', roots: [45, 41, 48, 43], chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
    bass: [0, null, 0, 12, 0, null, 0, 12, 0, null, 0, 12, 0, 7, 5, 3], arp: [0, 1, 2, 1, 2, 1, 0, 1, 0, 1, 2, 1, 2, 1, 2, 0],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  { name: 'Pantai Chill', bpm: 84, wave: 'triangle', roots: [48, 43, 45, 41], chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
    bass: [0, null, null, null, 0, null, 7, null, 0, null, null, null, 7, null, 5, null], arp: [0, null, 1, null, 2, null, 1, null, 0, null, 1, null, 2, null, 1, 2],
    kick: [0, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  { name: 'Bengkel Beat', bpm: 126, wave: 'square', roots: [40, 40, 43, 38], chords: [[52, 55, 59], [52, 55, 59], [55, 59, 62], [50, 54, 57]],
    bass: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 7], arp: [0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [1, 3, 5, 7, 9, 11, 13, 15] },
];

export function createAudio(G) {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noiseBuf = null;
  let muted = false;
  let engineNodes = null;
  let sirenNodes = null;
  let heliNodes = null;
  let hornNodes = null;
  let musicTimer = null;
  let nextStepTime = 0;
  let step = 0;
  let stationIdx = 0;
  let lastStation = -1;
  let musicTarget = 0.35;
  let sirenPhase = 0;
  const api = { stationIndex: 0, stations: STATIONS, muted: false };

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch (e) {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : G.settings.volume;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.0;
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    buildEngine();
    buildSiren();
    buildHeli();
    buildHorn();
    nextStepTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(musicTick, 90);
    return true;
  }

  function buildEngine() {
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(sfxBus);
    o1.start();
    o2.start();
    engineNodes = { o1, o2, lp, g };
  }
  function buildSiren() {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g);
    o2.connect(g);
    g.connect(sfxBus);
    o.start();
    o2.start();
    sirenNodes = { o, o2, g };
  }
  function buildHeli() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 160;
    bp.Q.value = 0.8;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(trem.gain);
    const level = ctx.createGain();
    level.gain.value = 0;
    src.connect(bp);
    bp.connect(trem);
    trem.connect(level);
    level.connect(sfxBus);
    src.start();
    lfo.start();
    heliNodes = { level };
  }
  function buildHorn() {
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'square';
    o2.type = 'square';
    o1.frequency.value = 392;
    o2.frequency.value = 494;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.value = 0;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(sfxBus);
    o1.start();
    o2.start();
    hornNodes = { g };
  }

  // ----- one-shots -----
  function noiseBurst(dur, f0, q, vol, type = 'bandpass', f1 = null) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }
  function tone(freq, dur, type, vol, slideTo = null, delay = 0, bus = null) {
    if (!ensure()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(bus || sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  api.init = () => {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  };
  api.gunshot = () => {
    noiseBurst(0.2, 5000, 0.7, 0.55, 'lowpass', 300);
    tone(120, 0.14, 'sine', 0.5, 40);
  };
  api.enemyShot = () => {
    noiseBurst(0.16, 3500, 0.7, 0.28, 'lowpass', 400);
    tone(100, 0.1, 'sine', 0.25, 40);
  };
  api.punch = () => {
    noiseBurst(0.09, 700, 1, 0.5, 'lowpass', 150);
    tone(95, 0.09, 'sine', 0.45, 55);
  };
  api.step = (running) => noiseBurst(0.05, 700 + Math.random() * 500, 2.5, running ? 0.16 : 0.1);
  api.crash = (intensity = 1) => {
    noiseBurst(0.3, 900, 0.6, clamp(intensity * 0.12, 0.08, 0.7), 'bandpass', 200);
    tone(180, 0.18, 'square', clamp(intensity * 0.04, 0.03, 0.2), 70);
  };
  api.explosion = () => {
    noiseBurst(1.5, 2800, 0.3, 0.95, 'lowpass', 70);
    tone(62, 1.1, 'sine', 0.85, 24);
  };
  api.reload = () => {
    tone(1200, 0.04, 'square', 0.1);
    tone(800, 0.05, 'square', 0.1, null, 0.5);
  };
  api.pickup = () => {
    tone(880, 0.08, 'triangle', 0.2);
    tone(1320, 0.12, 'triangle', 0.2, null, 0.07);
  };
  api.cash = () => {
    tone(1568, 0.07, 'square', 0.12);
    tone(2093, 0.18, 'square', 0.12, null, 0.07);
  };
  api.door = () => noiseBurst(0.12, 400, 1.2, 0.22, 'lowpass', 150);
  api.ui = (type = 'click') => {
    if (type === 'click') tone(660, 0.06, 'square', 0.1);
    else if (type === 'confirm') { tone(523, 0.09, 'square', 0.12); tone(784, 0.12, 'square', 0.12, null, 0.08); }
    else if (type === 'back') tone(330, 0.09, 'square', 0.1, 220);
    else if (type === 'text') tone(900 + Math.random() * 200, 0.025, 'square', 0.04);
    else if (type === 'win') [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.18, null, i * 0.11));
    else if (type === 'fail') [440, 349, 262].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.12, null, i * 0.16));
    else if (type === 'wanted') { tone(880, 0.1, 'square', 0.14); tone(660, 0.1, 'square', 0.14, null, 0.12); }
    else if (type === 'go') tone(1046, 0.4, 'square', 0.16);
    else if (type === 'count') tone(660, 0.18, 'square', 0.14);
  };

  api.setHorn = (on) => {
    if (!ctx || !hornNodes) return;
    hornNodes.g.gain.setTargetAtTime(on ? 0.1 : 0, ctx.currentTime, 0.01);
  };
  api.setEngine = (speed01, throttle, active) => {
    if (!ctx || !engineNodes) return;
    const t = ctx.currentTime;
    const gears = 4;
    const s = clamp(speed01, 0, 1);
    const rpm = 0.2 + ((s * gears) % 1) * 0.8;
    const f = 42 + rpm * 90 + s * 40;
    engineNodes.o1.frequency.setTargetAtTime(f, t, 0.05);
    engineNodes.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    engineNodes.lp.frequency.setTargetAtTime(280 + rpm * 700 + throttle * 300, t, 0.08);
    engineNodes.g.gain.setTargetAtTime(active ? 0.1 + Math.abs(throttle) * 0.08 : 0, t, 0.08);
  };
  api.setSiren = (level, dt = 0.016) => {
    if (!ctx || !sirenNodes) return;
    sirenPhase += dt;
    const f = 760 + 280 * Math.sin(sirenPhase * 5.2);
    sirenNodes.o.frequency.value = f;
    sirenNodes.o2.frequency.value = f * 1.5;
    sirenNodes.g.gain.setTargetAtTime(clamp(level, 0, 1) * 0.07, ctx.currentTime, 0.1);
  };
  api.setHeli = (level) => {
    if (!ctx || !heliNodes) return;
    heliNodes.level.gain.setTargetAtTime(clamp(level, 0, 1) * 0.6, ctx.currentTime, 0.2);
  };

  // ----- music -----
  api.setStation = (i) => {
    stationIdx = ((i % 4) + 4) % 4;
    api.stationIndex = stationIdx;
  };
  api.nextStation = () => {
    api.setStation(stationIdx + 1);
    api.ui('click');
    return stationIdx < STATIONS.length ? STATIONS[stationIdx].name : 'Radio Mati';
  };
  api.stationName = () => (stationIdx < STATIONS.length ? STATIONS[stationIdx].name : 'Radio Mati');
  // mode: 'menu' | 'walk' | 'car'
  api.setMusicMode = (mode) => {
    musicTarget = mode === 'menu' ? 0.5 : mode === 'car' ? 0.85 : 0.33;
    api.musicMode = mode;
  };
  api.musicMode = 'menu';
  api.activeStation = () => (api.musicMode === 'car' ? stationIdx : api.musicMode === 'menu' ? 0 : 0);

  api.setVolume = (v) => {
    G.settings.volume = v;
    if (master) master.gain.setTargetAtTime(muted ? 0 : v, ctx.currentTime, 0.02);
  };
  api.toggleMute = () => {
    muted = !muted;
    api.muted = muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : G.settings.volume, ctx.currentTime, 0.02);
    return muted;
  };

  function musicNote(freq, t, dur, type, vol, cutoff) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function drum(kind, t) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g);
      g.connect(musicBus);
      o.start(t);
      o.stop(t + 0.25);
      return;
    }
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const dur = kind === 'hat' ? 0.05 : 0.16;
    g.gain.setValueAtTime(kind === 'hat' ? 0.12 : 0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(musicBus);
    src.start(t, Math.random(), dur + 0.02);
  }
  function playStep(st, s, t) {
    const stepDur = 60 / st.bpm / 4;
    const barStep = s % 16;
    const bar = Math.floor(s / 16) % 4;
    const root = st.roots[bar];
    const chord = st.chords[bar];
    if (barStep === 0) {
      for (const n of chord) {
        musicNote(mtof(n), t, stepDur * 15, st.wave === 'square' ? 'sawtooth' : st.wave, 0.05, 900);
        musicNote(mtof(n) * 1.006, t, stepDur * 15, 'sawtooth', 0.035, 700);
      }
    }
    const b = st.bass[barStep];
    if (b !== null && b !== undefined) musicNote(mtof(root + b), t, stepDur * 1.8, 'sawtooth', 0.15, 420);
    const a = st.arp[barStep];
    if (a !== null && a !== undefined) musicNote(mtof(chord[a % 3] + 12 + (barStep >= 8 ? 12 : 0)), t, stepDur * 1.4, st.wave, 0.06, 2600);
    if (st.kick.includes(barStep)) drum('kick', t);
    if (st.snare.includes(barStep)) drum('snare', t);
    if (st.hat.includes(barStep)) drum('hat', t);
  }
  function musicTick() {
    if (!ctx || ctx.state !== 'running') return;
    const idx = api.activeStation();
    const off = api.musicMode === 'car' && idx >= STATIONS.length;
    musicBus.gain.setTargetAtTime(off ? 0 : musicTarget * 0.9, ctx.currentTime, 0.25);
    if (off) {
      nextStepTime = Math.max(nextStepTime, ctx.currentTime + 0.05);
      return;
    }
    if (idx !== lastStation) {
      lastStation = idx;
      step = 0;
      nextStepTime = Math.max(nextStepTime, ctx.currentTime + 0.05);
    }
    const st = STATIONS[idx];
    const stepDur = 60 / st.bpm / 4;
    while (nextStepTime < ctx.currentTime + 0.3) {
      playStep(st, step, nextStepTime);
      nextStepTime += stepDur;
      step++;
    }
  }

  return api;
}
