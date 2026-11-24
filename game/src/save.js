// save.js — localStorage persistence for progress, settings and the Continue menu.
const SAVE_KEY = 'cahayabay-save-v1';
const SETTINGS_KEY = 'cahayabay-settings-v1';

function safeGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

export function createSave(G) {
  const api = {
    hasSave() {
      const raw = safeGet(SAVE_KEY);
      if (!raw) return false;
      try {
        const d = JSON.parse(raw);
        return !!d && d.version === 1;
      } catch (e) {
        return false;
      }
    },
    load() {
      const raw = safeGet(SAVE_KEY);
      if (!raw) return null;
      try {
        const d = JSON.parse(raw);
        return d && d.version === 1 ? d : null;
      } catch (e) {
        return null;
      }
    },
    // Snapshot of progress: mission index, money, position, weapon state and last vehicle.
    save() {
      const p = G.player;
      if (!p || G.missions == null) return false;
      const v = p.vehicle || p.lastVehicle;
      const data = {
        version: 1,
        savedAt: Date.now(),
        mission: G.missions.index,
        money: G.money,
        hour: G.gameHour,
        x: p.x,
        z: p.z,
        yaw: p.yaw,
        health: p.health,
        armor: p.armor,
        hasPistol: p.hasPistol,
        ammoClip: p.ammoClip,
        ammoReserve: p.ammoReserve,
        inVehicle: !!p.vehicle,
        vehicle: v && v.alive !== false
          ? { type: v.type, color: v.color, x: v.x, z: v.z, yaw: v.yaw, hp: v.hp }
          : null,
      };
      return safeSet(SAVE_KEY, JSON.stringify(data));
    },
    clear() {
      try {
        window.localStorage.removeItem(SAVE_KEY);
      } catch (e) { /* ignore */ }
    },
    loadSettings() {
      const raw = safeGet(SETTINGS_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },
    saveSettings() {
      return safeSet(SETTINGS_KEY, JSON.stringify(G.settings));
    },
  };
  return api;
}
