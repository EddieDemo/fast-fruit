(function () {
'use strict';
// ============================================================
// DEBUG PANEL — a tuning cockpit generated from config SCHEMA.
// Add a tunable to the schema and it appears here; this file
// should never need to know about individual parameters.
//
// Writes go straight into CONFIG (the sim reads it live every
// step). "Copy" exports the current values as JSON so a tuned
// feel can be pasted back into config.js as the new DEFAULTS.
// ============================================================

const { CONFIG, DEFAULTS, SCHEMA, resetConfig } = window.FF;
const { resetMelon } = window.FF;

function initDebugPanel(state) {
  const root = document.getElementById('debug-root');

  const toggle = document.createElement('button');
  toggle.className = 'debug-toggle';
  toggle.textContent = 'tune';

  const panel = document.createElement('div');
  panel.className = 'debug-panel collapsed';

  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? 'tune' : 'close';
  });

  // valueLabels: key -> span, so reset can refresh the whole panel.
  const inputs = new Map();

  for (const entry of SCHEMA) {
    if (entry.group) {
      const h = document.createElement('div');
      h.className = 'debug-group-title';
      h.textContent = entry.group;
      panel.appendChild(h);
      continue;
    }

    const { key, min, max, step } = entry;
    const row = document.createElement('div');
    row.className = 'debug-row';

    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = key;
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = format(CONFIG[key]);
    label.append(name, val);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = CONFIG[key];
    slider.addEventListener('input', () => {
      CONFIG[key] = parseFloat(slider.value);
      val.textContent = format(CONFIG[key]);
    });

    inputs.set(key, { slider, val });
    row.append(label, slider);
    panel.appendChild(row);
  }

  // ---- Actions ----
  const actions = document.createElement('div');
  actions.className = 'debug-actions';

  const btnRespawn = button('respawn', () => {
    resetMelon(state, state.melon.x, -CONFIG.semiMinor - 200);
  });

  const btnReset = button('defaults', () => {
    resetConfig();
    for (const [key, { slider, val }] of inputs) {
      slider.value = DEFAULTS[key];
      val.textContent = format(DEFAULTS[key]);
    }
  });

  const btnCopy = button('copy', async () => {
    const dump = {};
    for (const entry of SCHEMA) if (entry.key) dump[entry.key] = CONFIG[entry.key];
    const text = JSON.stringify(dump, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      btnCopy.textContent = 'copied!';
    } catch {
      // Clipboard needs a secure context; fall back to console.
      console.log('[Fast Fruit] tuned config:\n' + text);
      btnCopy.textContent = 'in console';
    }
    setTimeout(() => (btnCopy.textContent = 'copy'), 1200);
  });

  actions.append(btnRespawn, btnReset, btnCopy);
  panel.appendChild(actions);
  root.append(toggle, panel);
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function format(v) {
  if (Math.abs(v) >= 100) return String(Math.round(v));
  if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(1);
  return String(Math.round(v * 100) / 100);
}

Object.assign(window.FF, { initDebugPanel });
})();
