// HUD TOGGLES — temporary horizon test switches (Eddie, 2026-08-24).
//
// Two always-on-screen buttons, bottom-left, OUTSIDE the dev tools:
// they preview the first slice of the horizon-band roadmap before the
// real world-anchored horizon exists. LINE draws a 1px edge at the
// sky floor; FILL paints from the floor down — which OCCLUDES the
// clouds below it, previewing exactly how the core ground layer will
// give clouds their flat bases for free. Both default OFF, both are
// stated stand-ins: they anchor to the sky FLOOR (screen-space), so
// they inherit its known resize drift until the horizon goes
// world-anchored. Glass family styling; browser-only, guarded.
(function () {
'use strict';
if (typeof window === 'undefined' || typeof document === 'undefined') return;
window.FF = window.FF || {};
window.FF.HORIZON_LINE = false;
window.FF.HORIZON_FILL = false;

function make(label, flag, bottom) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'position:fixed;left:12px;bottom:' + bottom + 'px;'
    + 'z-index:70;padding:8px 14px;border-radius:999px;cursor:pointer;'
    + 'background:rgba(10,14,10,0.9);border:1px solid #2a5a34;color:#39ff5f;'
    + 'font:12px ui-monospace, Menlo, monospace;opacity:0.55;';
  const paint = () => {
    const on = !!window.FF[flag];
    b.style.opacity = on ? '1' : '0.55';
    b.style.borderColor = on ? '#39ff5f' : '#2a5a34';
  };
  b.onclick = () => { window.FF[flag] = !window.FF[flag]; paint(); };
  paint();
  document.body.appendChild(b);
}

function init() {
  make('horizon fill', 'HORIZON_FILL', 12);
  make('horizon line', 'HORIZON_LINE', 52);
}
if (document.body) init();
else document.addEventListener('DOMContentLoaded', init);
})();
