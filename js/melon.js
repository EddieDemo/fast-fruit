// ============================================================
// MELON — the persistent melon: spec, derivation, stable (data layer).
//
// A melon is A SINGLE SEED plus a name. Everything else derives:
// scale from the triangular distribution, mass/inertia from the laws
// (state.js), rind pattern from the generator (renderer.js, keyed by
// 'm'+seed so renames never change the rind). No stats are stored —
// stats would invite tampering and drift; the seed cannot lie.
//
// Shipped now (forward-compatibility slice of melon-stable.md):
//   * spec format v1 {v, seed, name, born}
//   * starter melon auto-rolled on first boot (weighted average)
//   * one-time NAMING CEREMONY overlay (the attachment moment)
//   * localStorage stable (a list, though the UI to switch waits)
//   * melon codes (base64url) — export/import ready
// Deferred: rolls-on-win, the stable/roster UI, MP handshake field.
// ============================================================

(function () {
'use strict';

const KEY = 'ff-stable';

// ---- Derivation: seed -> physique ----
// Same triangular law as the bots (state.js): middles common,
// extremes rare. Starters roll tighter around 1.0.
// Display weight anchors scale 1.0 at 9.0 kg — a proper average
// picnic watermelon — and follows the SAME s^3 law as the simulated
// mass, so the label is literally proportional to the physics body's
// mass. The seed cannot lie; neither can the scale readout.
const BASE_KG = 9.0;

function derive(seed) {
  const rng = window.FF.mulberry32(seed >>> 0);
  const u = (rng() + rng()) / 2;
  const scale = 0.85 + u * 0.33;
  const kg = BASE_KG * scale * scale * scale;
  return {
    scale,
    kg,
    lb: kg * 2.20462,
    patternKey: 'm' + (seed >>> 0),
  };
}

// ---- Stable persistence ----
let stable = null; // { v: 1, melons: [{v, seed, name, born}], active: 0 }

function load() {
  if (stable) return stable;
  try { stable = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
  if (!stable || !Array.isArray(stable.melons) || !stable.melons.length) {
    // First boot: deal the starter. Weighted toward average — two
    // extra middling rolls pull the triangular draw toward 1.0.
    let seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    let best = seed, bestDev = Math.abs(derive(seed).scale - 1);
    for (let i = 0; i < 2; i++) {
      const s2 = (seed + 0x9e3779b9 * (i + 1)) >>> 0;
      const dev = Math.abs(derive(s2).scale - 1);
      if (dev < bestDev) { best = s2; bestDev = dev; }
    }
    stable = { v: 1, melons: [{ v: 1, seed: best, name: null, born: new Date().toISOString().slice(0, 10) }], active: 0 };
    save();
  }
  return stable;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(stable)); } catch (_) {}
}

function active() {
  const st = load();
  return st.melons[st.active] || st.melons[0];
}

function rename(name) {
  const m = active();
  m.name = String(name || '').trim().slice(0, 24) || m.name;
  save();
  return m.name;
}

// ---- Melon codes: the seed cannot lie ----
function b64url(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); }

function encodeMelon(m) {
  return b64url(JSON.stringify({ v: 1, s: m.seed >>> 0, n: m.name || '', b: m.born || '' }));
}
function decodeMelon(code) {
  try {
    const o = JSON.parse(unb64url(code));
    if (o.v !== 1 || typeof o.s !== 'number') return null;
    return { v: 1, seed: o.s >>> 0, name: o.n || null, born: o.b || '' };
  } catch (_) { return null; }
}

// ---- The naming ceremony (one-time overlay) ----
function maybeAskName(onDone) {
  const m = active();
  if (m.name) { if (onDone) onDone(m.name); return; }
  if (typeof document === 'undefined' || !document.body) return;
  const wrap = document.createElement('div');
  wrap.id = 'melon-naming';
  const d = derive(m.seed);
  const sizeWord = d.scale < 0.92 ? 'a little one' : d.scale > 1.08 ? 'a big one' : 'a good size';
  wrap.innerHTML = `
    <div class="naming-card">
      <div class="naming-title">you've been dealt a melon</div>
      <div class="naming-sub">${sizeWord} \u2014 ${d.kg.toFixed(1)} kg (${Math.round(d.lb)} lb)</div>
      <input id="melon-name-input" maxlength="24" placeholder="name your melon" autocomplete="off" />
      <button id="melon-name-ok">keep</button>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('#melon-name-input');
  const ok = wrap.querySelector('#melon-name-ok');
  const finish = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    rename(name);
    wrap.remove();
    if (onDone) onDone(name);
  };
  ok.addEventListener('click', finish);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
  setTimeout(() => input.focus(), 50);
}

window.FF = window.FF || {};
window.FF.melon = { derive, active, rename, encodeMelon, decodeMelon, maybeAskName, _load: load };

})();
