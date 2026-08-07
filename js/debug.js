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

const { CONFIG, DEFAULTS, SCHEMA, PRESETS, applyPreset, getActivePreset, resetConfig } = window.FF;
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

  function refreshSliders() {
    for (const [key, { slider, val }] of inputs) {
      slider.value = CONFIG[key];
      val.textContent = format(CONFIG[key]);
    }
  }

  // ---- Tracks: mode buttons (Endless + registry entries) ----
  if (window.FF.modes) {
    const trackTitle = document.createElement('div');
    trackTitle.className = 'debug-group-title';
    trackTitle.textContent = 'Track';
    panel.appendChild(trackTitle);

    const trackRow = document.createElement('div');
    trackRow.className = 'debug-actions';
    const modeButtons = new Map();
    for (const name of window.FF.modes.names) {
      const b = button(name, () => {
        window.FF.modes.select(name);
        updateModeHighlight();
      });
      modeButtons.set(name, b);
      trackRow.appendChild(b);
    }
    var updateModeHighlight = () => {
      for (const [name, b] of modeButtons) {
        b.classList.toggle('active', name === window.FF.modes.active());
      }
    };
    panel.appendChild(trackRow);
    updateModeHighlight();
  }

  // ---- Presets: complete feel-snapshots, toggle live ----
  const presetTitle = document.createElement('div');
  presetTitle.className = 'debug-group-title';
  presetTitle.textContent = 'Preset';
  panel.appendChild(presetTitle);

  const presetRow = document.createElement('div');
  presetRow.className = 'debug-actions';
  const presetButtons = new Map();
  for (const name of Object.keys(PRESETS)) {
    const b = button(name, () => {
      applyPreset(name);
      refreshSliders();
      updatePresetHighlight();
    });
    presetButtons.set(name, b);
    presetRow.appendChild(b);
  }
  function updatePresetHighlight() {
    for (const [name, b] of presetButtons) {
      b.classList.toggle('active', name === getActivePreset());
    }
  }
  panel.appendChild(presetRow);

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

  const btnReset = button('preset \u21ba', () => {
    resetConfig(); // restores the ACTIVE preset, undoing slider fiddling
    refreshSliders();
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
  updatePresetHighlight();
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
