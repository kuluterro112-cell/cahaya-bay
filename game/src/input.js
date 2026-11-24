// input.js — keyboard, mouse (pointer lock) and arrow-key look fallback.
export function createInput(canvas, settings) {
  const down = new Set();
  const pressed = new Set();
  const buttons = [false, false, false];
  const clicked = [false, false, false];
  let mdx = 0;
  let mdy = 0;
  let locked = false;
  let enabled = false; // only gather gameplay input while playing

  const api = {
    get locked() { return locked; },
    setEnabled(v) { enabled = v; if (!v) { down.clear(); buttons[0] = buttons[1] = buttons[2] = false; } },
    isDown: (code) => enabled && down.has(code),
    wasPressed: (code) => enabled && pressed.has(code),
    mouseDown: (b) => enabled && buttons[b],
    mouseClicked: (b) => enabled && clicked[b],
    // Look delta combines mouse movement and arrow keys (fallback when pointer lock is unavailable).
    consumeLook(dt) {
      let dx = mdx;
      let dy = mdy;
      mdx = 0;
      mdy = 0;
      if (enabled) {
        const k = 1.9 * dt / Math.max(0.0005, 0.0022 * settings.sens);
        if (down.has('ArrowLeft')) dx -= k;
        if (down.has('ArrowRight')) dx += k;
        if (down.has('ArrowUp')) dy -= k * 0.6;
        if (down.has('ArrowDown')) dy += k * 0.6;
      }
      return { dx, dy };
    },
    endFrame() {
      pressed.clear();
      clicked[0] = clicked[1] = clicked[2] = false;
    },
    requestLock() {
      try {
        const p = canvas.requestPointerLock && canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* pointer lock unavailable */ }
    },
    exitLock() {
      try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { /* ignore */ }
    },
    onLockChange: null,
    onKey: null,
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (!e.repeat) {
      pressed.add(e.code);
      if (api.onKey) api.onKey(e.code, e);
    }
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => { down.clear(); buttons[0] = buttons[1] = buttons[2] = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (!enabled) return;
    if (!locked) api.requestLock();
    buttons[e.button] = true;
    clicked[e.button] = true;
  });
  window.addEventListener('mouseup', (e) => { buttons[e.button] = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (locked && enabled) {
      mdx += e.movementX || 0;
      mdy += e.movementY || 0;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (api.onLockChange) api.onLockChange(locked);
  });

  return api;
}
