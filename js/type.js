(function () {
'use strict';
// ============================================================
// TYPE — the type scale. One law for every size, weight, tracking
// and text colour in the interface.
//
// WHY: an audit of the UI found FIFTEEN distinct font sizes between
// 8 and 26px — 9, 10, 11, 12, 13, 14, 15 all in use, seven steps
// inside six pixels, which is finer than the eye reliably resolves.
// That is not a hierarchy, it is noise that happens to be ordered.
// Colour was the same story: #39ff5f, #00ff00, #0f0 and #8f8 were
// four spellings of one green.
//
// The fix is the same shape as every other law in this project: a
// small set of named steps, derived by a rule, that everything else
// must express itself in. Hierarchy becomes a decision made ONCE
// rather than re-litigated at every new panel with a number pulled
// from feel.
//
// THE SCALE: six steps on a 1.25 minor third, each FLUID between a
// phone bound and a desktop bound. Responsiveness lives in the step,
// so "small on a phone, comfortable on desktop" stops being a
// per-element decision (there were four hand-rolled clamps before).
//
// NAMED BY ROLE, NEVER BY SIZE. The moment a token is called --fs-12
// you are choosing pixels again.
//
//   micro  a footnote: times under names, qualifiers
//   label  small caps keys: WEIGHT, MOST SPLATTED
//   body   the readable default: values, names, buttons
//   lead   a row that matters: standings names, big stats
//   title  a screen's name: FINISH, PAUSED
//   hero   the one thing on screen: a death headline
//
// TRACKING RIDES THE SIZE. Small uppercase needs air; large type
// needs slightly less. It is a property of the step, not a choice
// per rule (there were eight different values chosen ad hoc).
//
// THE CANVAS CANNOT INHERIT CSS. In-race labels are drawn with
// ctx.font and scale with camera zoom — they are part of the SCENE,
// not the interface, so they keep their world scaling. What they DO
// take from here is the ratio, so their internal proportions match
// the interface's. RATIO is exported for exactly that, and the suite
// asserts the CSS variables and these numbers come from one object.
// ============================================================

const RATIO = 1.25;

// [min, max] px. Each step is ~RATIO from the last; the pairs were
// snapped to the sizes already in use so this is a tidying, not a
// redesign — the game should look almost identical afterwards.
const STEPS = {
  micro: { min: 9, max: 10, track: '0.09em' },
  label: { min: 10, max: 11, track: '0.09em' },
  body: { min: 12, max: 14, track: '0.03em' },
  lead: { min: 15, max: 18, track: '0.02em' },
  title: { min: 18, max: 22, track: '0.06em' },
  hero: { min: 22, max: 28, track: '0.04em' },
};

// Fluid between the bounds across a REAL viewport range: min at a
// 390px phone, max at a 1280px desktop, linear between.
//
// The first attempt used a preferred term scaled off `min` alone,
// which pinned every step to its MAX at every realistic width — the
// scale looked fluid and was in fact a uniform size increase (body
// 12 -> 14 on a phone). That is a redesign, not a tidying, and the
// promise here was that the game should look almost identical
// afterwards. Solve the line through the two anchors instead.
const VW_MIN = 390, VW_MAX = 1280;
function clampFor(min, max) {
  const slopeVw = ((max - min) / (VW_MAX - VW_MIN)) * 100;   // px per 100vw
  const intercept = min - ((max - min) * VW_MIN) / (VW_MAX - VW_MIN);
  return 'clamp(' + min + 'px, ' + slopeVw.toFixed(3) + 'vw + ' + intercept.toFixed(2) + 'px, ' + max + 'px)';
}

// ROLES — hierarchy is cheaper in weight and colour than in size, a
// lesson the standings list already taught us: dimming and
// un-bolding separated the field from the podium better than size
// alone. Two or three roles beat fifteen sizes.
const COLORS = {
  text: '#dff3df',    // the readable default
  dim: '#7fa383',     // labels and secondary
  faint: '#5d7a62',   // qualifiers, footnotes
  accent: '#39ff5f',  // the game's green: YOU, emphasis, actions
  gold: '#ffd54a',
  silver: '#d8e2e6',
  bronze: '#e0a06a',
};

const WEIGHTS = { normal: 400, medium: 600, bold: 700 };

function css() {
  let out = ':root {\n';
  for (const [name, s] of Object.entries(STEPS)) {
    out += '  --fs-' + name + ': ' + clampFor(s.min, s.max) + ';\n';
    out += '  --tr-' + name + ': ' + s.track + ';\n';
  }
  for (const [name, c] of Object.entries(COLORS)) out += '  --c-' + name + ': ' + c + ';\n';
  for (const [name, w] of Object.entries(WEIGHTS)) out += '  --fw-' + name + ': ' + w + ';\n';
  out += '}\n';
  return out;
}

function inject() {
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'ff-type-scale';
  style.textContent = css();
  // First in the head: every other stylesheet resolves against these.
  if (document.head.firstChild) document.head.insertBefore(style, document.head.firstChild);
  else document.head.appendChild(style);
}

window.FF = window.FF || {};
window.FF.type = { RATIO, STEPS, COLORS, WEIGHTS, css, inject };
inject();
})();