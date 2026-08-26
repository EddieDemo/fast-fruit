(function () {
'use strict';
// ============================================================
// FLOW — the game-state machine and its screens.
//
// One authority over "what mode is the game in": 'menu', 'race',
// 'finish' (and any state registered later — 'pause' is a one-liner
// away). main.js asks flow.state to decide whether the solo sim
// steps; everything else (panels, buttons, standings capture) lives
// here. Netplay bypasses the screens entirely: lockstep sessions own
// their own start, and a local menu over a shared sim is a desync
// dressed as UI.
//
// Screens are DOM overlays built (and styled) by this module, so the
// feature deploys as ONE file plus a script tag — no styles.css or
// index.html surgery to forget on a device (the stale-copy lesson).
//
//   MENU:   your melon, slowly rotating; stable selector if you own
//           more than one; RACE.
//   FINISH: the standings AS THE PLAYER CROSSED THE LINE — position,
//           a slowly rotating render of each racer's actual body
//           (species, pigment, pattern), name; RETRY / MAIN MENU.
//
// Presentation tier throughout: reads sim state, never writes it.
// ============================================================

const flow = { state: 'boot' };
// THE SHARED PRIVATES live in flow-lib.js (split commit 1,
// 2026-08-26): IIFEs cannot share locals, so everything a screen
// module will need is an explicit export. Destructured once here so
// every call site below reads exactly as it did when these were
// locals — the move-only guarantee.
const { el, fmtTime, ordinal, ordinalSuffix, racerIdentity,
        computeStandings, spinners, clearCanvas, startSpinners,
        setSpinPaused, spinPaused, remeasureSpinners, pushSpecPortrait,
        pushMelonPortrait } = window.FF.flowLib;
let stateRef = null;
let respawnFn = null;
let netplayFn = null;   // () => true while a lockstep session is live
let exhibitionHooks = null;
let providerFn = null;      // () => the live track provider, for fast-forward
let lastResolved = null;    // the resolved finish times for this race
let startLegFn = null;      // (trackName) => build a race on that track
let rebuildFn = null;       // (trackName, botCount) => rebuild for a restore
let finishHandledTick = null;

// ---- Styles (scoped, injected) ----
const CSS = `
.ff-screen { position: fixed; inset: 0; display: flex; align-items: center;
  justify-content: center; z-index: 40; background: rgba(5, 8, 5, 0.72);
  font-family: ui-monospace, Menlo, monospace;
  /* Safe areas: landscape phones put the notch on a SIDE, and the
     home indicator eats the bottom in both orientations. */
  padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
           max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  box-sizing: border-box; }
/* ============ THE PANEL CONTRACT ============
   Every screen is HEAD / BODY / FOOT:
     .ff-head  fixed  — title, subtitle, tabs. Never scrolls away.
     .ff-body  fluid  — the only thing that scrolls, and the only
                        thing allowed to run out of room.
     .ff-foot  fixed  — the buttons. Pinned by construction, so they
                        cannot be pushed off a short screen.
   The panel is VIEWPORT-BOUNDED, never content-sized.

   min-height: 0 on the body is the load-bearing line: a flex child
   defaults to min-height:auto and REFUSES to shrink below its
   content, so without it the body pushes the foot off the screen
   instead of scrolling. That single omission produced all three
   landscape bugs (menu RACE button unreachable, finish MAIN MENU
   outside the box, panel resizing between tabs).

   dvh over vh so retracting mobile browser chrome doesn't re-clip. */
.ff-panel { background: rgba(10, 14, 10, 0.96); border: 1px solid #1f3a24;
  border-radius: 10px; padding: 20px 24px; min-width: 280px; max-width: 86vw;
  max-height: 100%; display: flex; flex-direction: column; box-sizing: border-box;
  color: #cfe8cf; box-shadow: 0 12px 60px rgba(0,0,0,0.6); }
.ff-head, .ff-foot { flex: none; }
.ff-body { flex: 1 1 auto; min-height: 0; overflow-y: auto;
  -webkit-overflow-scrolling: touch; }
/* A row of buttons: the stacked width:100% must NOT survive into a
   row, or two buttons demand 200% of the container and the second
   one leaves the panel. Stated on the container so every future
   button row inherits the fix instead of rediscovering the bug. */
.ff-buttons { display: flex; gap: 8px; }
.ff-buttons .ff-btn { flex: 1 1 0; width: auto; min-width: 0; }
.ff-title { color: var(--c-accent); font-size: var(--fs-title); font-weight: 700;
  letter-spacing: 2px; margin: 0 0 14px; text-align: center;
  /* Most titles are one short word ('FINISH', 'PAUSED'). The naming
     screen's headlines are content, and the longest of them
     ('Congratulations, it's a Melon!') is wider than the panel at
     every viewport — so the title wraps rather than overflowing, and
     balances so the two lines are of similar length instead of
     leaving one orphaned word. text-wrap is progressive: browsers
     without it simply wrap normally, which still fits. */
  text-wrap: balance; }
.ff-sub { color: var(--c-dim); font-size: var(--fs-body); text-align: center; margin: 0 0 16px; }
.ff-melon-row { display: flex; align-items: center; justify-content: center;
  gap: 14px; margin: 6px 0 10px; }
.ff-melon-name { font-size: var(--fs-lead); color: var(--c-text); min-width: 120px; text-align: center; }
/* The racer line beneath the melon name: micro/faint, the same
   relationship the standings rows use. */
.ff-melon-pilot { font-size: var(--fs-micro); letter-spacing: var(--tr-micro);
  color: var(--c-faint); text-align: center; margin-top: 3px; }
.ff-melon-pilot.ff-renamable { cursor: pointer;
  text-decoration: underline dotted rgba(159, 199, 165, 0.3);
  text-underline-offset: 3px; }
.ff-melon-pilot.ff-renamable:hover { color: var(--c-dim); }
/* Tappable, but NOT a button: this is an edit-in-place affordance, so
   it stays type with a hint of underline rather than joining the
   commitment tier (see the tab note below — same reasoning). */
.ff-melon-name.ff-renamable { cursor: pointer;
  text-decoration: underline dotted rgba(159, 199, 165, 0.4);
  text-underline-offset: 4px; }
.ff-melon-name.ff-renamable:hover { color: var(--c-accent); }
/* The menu panel is wider than the others: it carries a portrait of
   the melon AND its papers. */
.ff-screen.ff-menu-screen .ff-panel { min-width: 320px; max-width: min(92vw, 620px); }
/* THE PORTRAIT. Sized from the viewport in BOTH axes — vw alone
   overflows a short landscape window, vh alone leaves a postage stamp
   on a tall narrow one — with a hard cap so a desktop monitor doesn't
   get an absurd melon. */
canvas.ff-spin.ff-portrait { width: min(52vw, 34vh, 260px); height: min(52vw, 34vh, 260px); }
.ff-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px;
  margin: 2px 0 10px; }
.ff-section { font-size: var(--fs-micro); letter-spacing: 0.16em; color: var(--c-accent);
  border-top: 1px solid #1f3a24; padding-top: 8px; margin-top: 2px; }
.ff-dayline { font-size: var(--fs-micro); letter-spacing: var(--tr-micro);
  color: var(--c-faint); text-align: center; margin-top: 8px; }
/* The expired-run note. Sits with the day line because it is a fact
   about the DAY, not an error: dim, one line, gone on the next visit. */
.ff-expired { font-size: var(--fs-micro); letter-spacing: var(--tr-micro);
  color: var(--c-dim); text-align: center; margin-top: 6px; }
.ff-finish-note { color: var(--c-faint); }
/* Pause hub: settings and the controls reminder. */
.ff-settings { margin: 2px 0 4px; }
/* An editable setting value: same row grammar as the toggles, but
   dotted-underlined like the melon name on the menu, because it opens
   an editor rather than flipping a state. */
.ff-set-v.ff-set-edit { color: var(--c-text);
  text-decoration: underline dotted rgba(159, 199, 165, 0.4);
  text-underline-offset: 4px; }
.ff-set-row { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 7px 0; border-bottom: 1px solid #14261a; }
.ff-set-k { font-size: var(--fs-label); letter-spacing: var(--tr-label);
  color: var(--c-dim); }
.ff-set-v { min-width: 62px; padding: 6px 10px; border-radius: 7px;
  background: #0d1f12; border: 1px solid #23402a; color: var(--c-faint);
  font: inherit; font-size: var(--fs-label); letter-spacing: var(--tr-label);
  cursor: pointer; }
.ff-set-v.on { background: #123018; border-color: #2a5a34; color: var(--c-accent); }
.ff-controls { margin: 12px 0 4px; }
.ff-controls-body { margin-top: 6px; font-size: var(--fs-micro);
  letter-spacing: var(--tr-micro); color: var(--c-faint); line-height: 1.9; }
.ff-ctl-up { color: rgba(92, 235, 110, 0.85); }
.ff-ctl-down { color: rgba(255, 122, 82, 0.85); }
@media (max-height: 560px) {
  .ff-controls { margin-top: 8px; }
  .ff-controls-body { line-height: 1.6; }
}
/* The cup rows are places rows; only their second line differs. */
.ff-cup-rows { margin-top: 2px; }
.ff-cup-head { font-size: var(--fs-label); letter-spacing: var(--tr-label);
  color: var(--c-accent); text-align: center; padding: 2px 0 8px; }
/* 'abandon cup' is deliberately the quietest thing on the screen:
   possible, never accidental. */
/* The countdown: centred, unmissable, and out of the way of the
   thumb — it is above the play area, not on it. pointer-events none
   throughout, because a touch during the pan means "ready" and must
   reach the canvas. */
/* The settle scrim: fades in at the flag, holds under the results,
   and clears fast on the way out — slow to arrive, quick to leave, so
   a retry loop never feels like it is dimming at you. */
.ff-fade { position: fixed; inset: 0; z-index: 8; pointer-events: none;
  background: rgba(5, 8, 5, 0.72); opacity: 0;
  transition: opacity 250ms ease-out; }
.ff-fade.out { transition-duration: 120ms; }
/* The panel arrives with the fade rather than snapping in. */
.ff-screen.ff-finish-screen { animation: ff-panel-in 250ms ease-out; }
@keyframes ff-panel-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
.ff-count { position: fixed; inset: 0; z-index: 12; pointer-events: none;
  display: flex; align-items: center; justify-content: center; }
.ff-count-text { font-family: var(--mono, ui-monospace, monospace);
  color: var(--c-text); text-shadow: 0 0 24px rgba(0,0,0,0.8);
  animation: ff-count-pop 260ms ease-out; }
.ff-count-count { font-size: var(--fs-colossal); font-weight: var(--fw-bold);
  letter-spacing: var(--tr-colossal); }
.ff-count-go { font-size: var(--fs-banner); font-weight: var(--fw-bold);
  letter-spacing: var(--tr-banner); color: var(--c-accent);
  text-shadow: 0 0 30px rgba(57, 255, 95, 0.45); }
.ff-count-hint { font-size: var(--fs-lead); letter-spacing: 0.18em;
  color: var(--c-dim); animation: ff-count-breathe 2.2s ease-in-out infinite; }
@keyframes ff-count-pop {
  from { transform: scale(1.5); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes ff-count-breathe {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
.ff-confirm { z-index: 50; }
.ff-confirm-panel { max-width: min(86vw, 360px); }
.ff-confirm-title { color: var(--c-text); }
/* The destructive choice is the QUIET one, and it is red. */
.ff-btn.ff-danger { color: #ff8a72; }
.ff-btn.ff-danger:active { color: #ff5c4a; }
.ff-btn.ff-quiet { background: none; border: none; color: var(--c-faint);
  font-size: var(--fs-micro); letter-spacing: var(--tr-micro); padding: 8px; }
.ff-stat-row { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 5px 0 6px; border-bottom: 1px solid #14261a; min-width: 0; }
.ff-stat-row .k { font-size: var(--fs-micro); letter-spacing: 0.09em; color: var(--c-dim); flex: none; }
.ff-stat-row .v { font-size: var(--fs-body); color: var(--c-text); text-align: right;
  font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.ff-stat-row .v small { display: block; font-size: var(--fs-micro); color: var(--c-faint);
  letter-spacing: 0.04em; margin-top: 1px; line-height: 1.2; }
/* The menu sizes to content while it FITS, and stops at the viewport:
   height:auto with a max-height gives a tight panel on a tall screen
   and a bounded, scrolling one on a short screen — no dead gap, no
   escaped button. (height:auto ALONE was the landscape bug: nothing
   bounded it, so RACE fell off the bottom.) */
.ff-screen.ff-menu-screen .ff-panel { height: auto; max-height: 100%; }
/* SHORT VIEWPORTS: portrait beside the papers, not above them — the
   same fix the finish screen needed, for the same reason. */
@media (max-height: 560px) {
  .ff-menu-body { display: flex; align-items: center; gap: 16px; }
  .ff-menu-left { flex: none; display: flex; flex-direction: column; align-items: center; }
  .ff-menu-right { flex: 1 1 auto; min-width: 0; }
  .ff-stats { grid-template-columns: 1fr; margin: 0; }
  canvas.ff-spin.ff-portrait { width: min(34vw, 46vh, 200px); height: min(34vw, 46vh, 200px); }
}
.ff-btn { display: block; width: 100%; margin: 8px 0 0; padding: 12px;
  background: #123018; color: var(--c-accent); border: 1px solid #2a5a34;
  border-radius: 7px; font: inherit; font-size: var(--fs-lead); letter-spacing: 1px;
  cursor: pointer; }
.ff-btn:active { background: #1a4522; }
.ff-btn.ff-secondary { color: #9fc7a5; border-color: #23402a; background: #0d1f12; }
.ff-arrow { background: none; border: 1px solid #2a5a34; color: var(--c-accent);
  border-radius: 6px; font: inherit; font-size: var(--fs-lead); padding: 6px 12px; cursor: pointer; }
/* A STATED height, not an inferred one: PLACES, RACE and YOU have
   different content heights, and a content-sized panel visibly
   breathed as you tapped between them. Bounded by the viewport, so
   this is a target rather than a demand. */
.ff-screen.ff-finish-screen .ff-panel { height: min(88dvh, 620px); }
/* ---- TABS ARE NAVIGATION, NOT ACTIONS (2026-08-13) ----------------
   These used to be filled, bordered, 7px-rounded boxes — which are
   the EXACT values of .ff-btn (active tab) and .ff-btn.ff-secondary
   (inactive). The finish screen therefore read as six buttons in one
   costume, where four change the VIEW and two change the WORLD, and
   only size and position told them apart.
   They are different CLASSES of control, not different priorities:
   RETRY and MAIN MENU are commitments (irreversible, they end this
   screen), while a tab is free, reversible, and one of them is
   ALWAYS already chosen. So the tabs drop the button's two defining
   features — the enclosing box and the fill — and mark the active one
   with a rule beneath it. A line under a word says "you are here";
   a filled box says "press me to make something happen".
   The same demotion .ff-quiet already makes for "abandon cup".
   THE HIT TARGET DOES NOT SHRINK: padding is unchanged, only the
   paint. A thumb still gets the same area it always had. */
/* ---- THE NAMING SCREEN ----
   Everything here is the start screen's language: the panel, the
   title, the portrait, the stat rows and the button are all shared
   classes. Only the text field is new, so it borrows the field
   treatment the rest of the interface implies — panel-dark, accent
   text, the button's own border colour and radius. */
/* The prize line on the cup tab, and the blocked-award note. */
.ff-racer-screen .ff-panel { max-width: min(92vw, 420px); }
.ff-racer-screen .ff-spin { display: block; margin: 4px auto; width: 128px; height: 128px; }
.ff-racer-screen .ff-stats { grid-template-columns: 1fr; }
.ff-rc-prow { display: flex; align-items: center; justify-content: center;
  gap: 10px; }
.ff-rc-decals { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;
  margin: 8px 0 2px; }
.ff-rc-chip { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.ff-rc-chip canvas { width: 36px; height: 36px; display: block; }
.ff-rc-chip div { font-size: var(--fs-micro); letter-spacing: var(--tr-micro);
  color: var(--c-faint); }
.ff-reward-screen .ff-panel { max-width: min(92vw, 440px); text-align: center;
  cursor: pointer; user-select: none; }
.ff-reward-big { font-size: var(--fs-hero); font-weight: var(--fw-bold);
  letter-spacing: var(--tr-hero); margin: 10px 0 4px; }
.ff-reward-name { font-size: var(--fs-lead); font-weight: var(--fw-bold);
  letter-spacing: var(--tr-lead); margin: 8px 0 2px; }
.ff-reward-sub { font-size: var(--fs-label); letter-spacing: var(--tr-label);
  color: var(--c-dim); text-transform: uppercase; }
.ff-xp-track { height: 14px; border: 1px solid rgba(255,255,255,0.3);
  border-radius: 999px; margin: 14px 8px 6px; overflow: hidden; }
.ff-xp-fill { height: 100%; width: 0%; background: currentColor;
  border-radius: 999px; }
.ff-xp-line { font-family: ui-monospace, monospace;
  font-size: var(--fs-label); letter-spacing: var(--tr-label);
  color: var(--c-text); }
.ff-levelup-stamp { display: none; margin: 10px auto 2px;
  padding: 5px 16px; border: 2px solid currentColor; border-radius: 6px;
  font-size: var(--fs-title); letter-spacing: var(--tr-title); }
.ff-levelup-stamp.ff-stamped { display: inline-block; }
.ff-reward-art { width: 132px; height: 132px; margin: 8px auto;
  image-rendering: pixelated; display: block; }
.ff-reward-foot { margin-top: 14px; }
.ff-edit-chip { display: block; margin: 4px auto 0; background: none;
  border: 1px solid rgba(255,255,255,0.22); border-radius: 999px;
  color: inherit; font: inherit; font-size: var(--fs-label);
  letter-spacing: var(--tr-label);
  padding: 3px 12px; cursor: pointer; opacity: 0.85; }
.ff-edit-chip:hover { opacity: 1; }
.ff-release-link { display: block; margin: 6px auto 0; background: none; border: none;
  color: var(--c-faint); font: inherit; font-size: var(--fs-micro);
  letter-spacing: var(--tr-micro); cursor: pointer; }
.ff-release-link:hover { color: #ff8a72; }
.ff-cup-prize { text-align: center; font-size: var(--fs-label);
  letter-spacing: var(--tr-label); color: var(--c-gold);
  margin: 2px 0 8px; }
.ff-cup-prize.dim { color: var(--c-faint); letter-spacing: var(--tr-micro);
  font-size: var(--fs-micro); }
/* The release grid: your six, each with the record that dies with it. */
.ff-release-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
@media (max-width: 420px) { .ff-release-grid { grid-template-columns: repeat(2, 1fr); } }
.ff-release-cell { background: #0d1f12; border: 1px solid #23402a; border-radius: 8px;
  padding: 8px 4px; cursor: pointer; font: inherit; color: var(--c-text);
  display: flex; flex-direction: column; align-items: center; }
.ff-release-cell:hover { border-color: var(--c-accent); }
.ff-release-cell canvas.ff-spin { width: 62px; height: 62px; }
.ff-rel-name { font-size: var(--fs-body); margin-top: 4px; text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ff-rel-stat { font-size: var(--fs-micro); color: var(--c-dim); }
.ff-rel-rec { font-size: var(--fs-micro); color: var(--c-faint); margin-top: 2px; }
.ff-release-screen { z-index: 45; }
/* SHORT SCREENS MUST SHOW ALL SIX AT ONCE. The panel contract keeps
   the foot pinned and scrolls the body, which is correct behaviour
   for a list — but this is not a list, it is a CHOICE, and an
   irreversible one: a player who cannot see the last two cells may
   release a melon without knowing what the alternatives were.
   Measured at 844x390: three columns of the standard cell scrolled,
   with the bottom row below the fold. So the cell compacts (smaller
   portrait, tighter type) rather than the grid scrolling. */
@media (max-height: 560px) {
  .ff-release-grid { grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .ff-release-cell { padding: 5px 3px; }
  .ff-release-cell canvas.ff-spin { width: 40px; height: 40px; }
  .ff-rel-name { font-size: var(--fs-micro); margin-top: 2px; }
  .ff-rel-stat, .ff-rel-rec { font-size: var(--fs-micro); }
  .ff-rel-rec { margin-top: 0; }
  .ff-release-screen .ff-title { margin-bottom: 4px; }
  .ff-release-screen .ff-sub { margin-bottom: 8px; }
}
.ff-name-input { display: block; width: 100%; box-sizing: border-box;
  margin: 0 0 8px; padding: 12px;
  background: #060a07; color: var(--c-accent);
  border: 1px solid #2a5a34; border-radius: 7px;
  font: inherit; font-size: var(--fs-lead); letter-spacing: 1px;
  text-align: center; }
.ff-name-input::placeholder { color: var(--c-faint); letter-spacing: var(--tr-body); }
.ff-name-input:focus { outline: none; border-color: var(--c-accent); }
/* The ceremony's portrait row carries no arrows (there is one melon,
   and it is yours), so it centres on its own. */
.ff-naming-screen .ff-melon-row { justify-content: center; }
.ff-naming-screen .ff-stats { margin-top: 4px; }
.ff-tabs { flex: none; display: flex; gap: 0; margin: 0 0 10px;
  border-bottom: 1px solid #14261a; }
.ff-tab { flex: 1; padding: 7px 4px; cursor: pointer;
  background: none; border: none; border-bottom: 2px solid transparent;
  /* The active rule sits ON the container's hairline, so the row has
     one baseline rather than two competing ones. */
  margin-bottom: -1px;
  color: var(--c-dim); font: inherit; font-size: var(--fs-label);
  letter-spacing: 0.1em; transition: color 0.12s ease-out; }
.ff-tab.on { color: var(--c-accent); border-bottom-color: var(--c-accent); }
@media (prefers-reduced-motion: reduce) { .ff-tab { transition: none; } }
.ff-pane { display: none; }
.ff-pane.on { display: block; }
/* Superlatives: label above, winner and value below. */
.ff-facts { }
.ff-fact { display: flex; align-items: baseline; justify-content: space-between;
  gap: 10px; padding: 7px 2px; border-bottom: 1px solid #14261a; }
.ff-fact-l { font-size: var(--fs-micro); letter-spacing: 0.09em; color: var(--c-dim); flex: none; }
.ff-fact-r { text-align: right; min-width: 0; }
.ff-fact-n { display: block; font-size: var(--fs-body); color: var(--c-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ff-fact-v { display: block; font-size: var(--fs-label); color: var(--c-accent);
  font-variant-numeric: tabular-nums; }
.ff-empty { padding: 18px 4px; text-align: center; font-size: var(--fs-body); color: var(--c-faint); }
/* The YOU tab uses the RACE tab's rows verbatim — one list shape for
   both, so the tabs read as one screen with different contents. */
.ff-summary { margin: 2px 0 10px; }
.ff-fact-n.hi { color: var(--c-accent); }
/* The panes no longer scroll themselves — .ff-body owns the scroll,
   so a pane is just content and the tab bar can never be pushed off
   by a long standings list. */
.ff-rows { margin: 4px 0 10px; }
.ff-title, .ff-btn, .ff-melon-row, .ff-melon-name, .ff-sub { flex: none; }
.ff-row { display: flex; align-items: center; gap: 12px; padding: 6px 4px;
  border-bottom: 1px solid #14261a; }
.ff-row.ff-you { background: rgba(57, 255, 95, 0.07); border-radius: 6px; }
/* NON-PODIUM places recede. Silver (2nd) is a pale grey by nature, so
   a bone-white 4th sitting next to it read as a second silver — the
   podium stopped looking like a podium. The rest of the field is now
   dimmer, lighter in weight and slightly smaller, so the top three
   are the only bright, heavy numbers on the screen. */
.ff-pos { width: 62px; color: rgba(207, 232, 207, 0.42); font-size: var(--fs-title); font-weight: 400;
  text-align: right; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
.ff-pos .ff-ord { font-size: var(--fs-body); font-weight: 400; color: rgba(127, 163, 131, 0.5);
  /* On the numeral's SHOULDER — the same ordinal convention the
     in-race labels use. One idea, one styling. */
  vertical-align: super; }
/* The podium: bright, bold and a size larger than the field. */
.ff-row:nth-child(-n+3) .ff-pos { font-size: var(--fs-hero); font-weight: 700; }
.ff-row:nth-child(-n+3) .ff-pos .ff-ord { font-size: var(--fs-lead); font-weight: 600; color: var(--c-dim); }
/* The podium reads at a glance: gold, silver, bronze. */
.ff-row:nth-child(1) .ff-pos { color: var(--c-gold); }
.ff-row:nth-child(2) .ff-pos { color: var(--c-silver); }
.ff-row:nth-child(3) .ff-pos { color: var(--c-bronze); }
/* YOUR row is never dimmed: finishing 9th should still be legible at
   a glance, and it is the one row you look for. */
.ff-row.ff-you .ff-pos { color: var(--c-accent); font-weight: 700; }
.ff-row.ff-you .ff-pos .ff-ord { color: rgba(57, 255, 95, 0.75); }
/* The pilot line: who drove the melon named above it. Micro/faint —
   the secondary role — so a scan reads the melons and a careful look
   reads the competitors. Same relationship as name-over-time. */
.ff-rpilot { font-size: var(--fs-micro); letter-spacing: var(--tr-micro);
  color: var(--c-faint); margin-top: 1px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.ff-you .ff-rpilot { color: var(--c-dim); }
.ff-rname { font-size: var(--fs-body); color: var(--c-text); flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ff-rtime { font-size: var(--fs-micro); color: var(--c-dim); letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums; margin-top: 1px; }
.ff-row.ff-you .ff-rtime { color: var(--c-accent); }
.ff-you-tag { flex: none; }
.ff-you-tag { color: var(--c-accent); font-size: var(--fs-label); letter-spacing: 1px; }
canvas.ff-spin { width: 52px; height: 52px; flex: none; }

/* The pause button joins the top-centre cluster: it sits immediately
   LEFT of respawn (which is centred) and daily (at 50%+34), mirroring
   daily's offset on the other side. Styling matches the cluster by
   using the same custom properties, so a theme change carries. */
/* TOP-RIGHT: the player's corner. The dev lane runs down the left
   edge (styles.css), so opening the gate can never shift or cover
   this. */
/* THE TARGET IS BIGGER THAN THE GLYPH. A ~30px button in the corner
   furthest from a racing thumb is a miss waiting to happen, and
   platform guidance puts the minimum touch target near 44px. The
   visible pill stays small — it is chrome over a game — while the
   TAPPABLE area is padded out to 56px and pushed to the very corner,
   so the whole corner works, not just the pill.
   Implemented as transparent padding rather than a bigger button:
   growing the pill would cost screen; growing the padding costs
   nothing visible. */
#ff-pause-btn { position: fixed; z-index: 10;
  top: 0; right: 0;
  padding: calc(var(--lane-t, 10px) + 6px) calc(var(--lane-r, 10px) + 6px) 16px 16px;
  min-width: 56px; min-height: 56px;
  box-sizing: content-box;
  background: none; border: none; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  display: flex; align-items: flex-start; justify-content: flex-end; }
/* The visible pill lives inside that target. */
#ff-pause-btn .ff-pause-pill,
#ff-pix-btn .ff-pause-pill { display: inline-block;
  background: var(--panel-bg, #161616); color: var(--panel-fg, #ddd);
  border-radius: 10px; padding: 8px 12px;
  font-family: var(--mono, ui-monospace, monospace); font-size: var(--fs-body);
  line-height: 1; }
#ff-pause-btn:active .ff-pause-pill { color: var(--panel-accent, #39ff5f); }
#ff-pause-btn[hidden] { display: none; }

/* THE PIXEL TOGGLE sits immediately LEFT of pause: same pill
   language, same oversized tap target philosophy, offset clear of
   the corner button's padded zone. Accent colour while the mode is
   on — the pill is the state indicator. */
#ff-pix-btn { position: fixed; z-index: 10;
  top: 0; right: 78px;
  padding: calc(var(--lane-t, 10px) + 6px) 8px 16px 8px;
  min-width: 44px; min-height: 56px;
  box-sizing: content-box;
  background: none; border: none; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  display: flex; align-items: flex-start; justify-content: flex-end; }
#ff-pix-btn:active .ff-pause-pill { color: var(--panel-accent, #39ff5f); }
#ff-pix-btn.ff-on .ff-pause-pill { color: var(--panel-accent, #39ff5f); }
#ff-pix-btn[hidden] { display: none; }

/* LANDSCAPE PHONES: short viewports. Everything that costs vertical
   space shrinks — the standings list keeps the space it needs to
   still show several rows, and the buttons sit side by side instead
   of stacking, which alone recovers ~50px. */
@media (max-height: 500px) {
  .ff-panel { padding: 12px 18px; border-radius: 8px; }
  .ff-title { font-size: var(--fs-lead); margin-bottom: 6px; }
  .ff-sub { margin-bottom: 8px; }
  .ff-row { padding: 3px 4px; gap: 9px; }
  canvas.ff-spin { width: 34px; height: 34px; }
  .ff-pos { width: 48px; font-size: var(--fs-lead); }
  .ff-pos .ff-ord { font-size: var(--fs-micro); }
  .ff-row:nth-child(-n+3) .ff-pos { font-size: var(--fs-title); }
  .ff-row:nth-child(-n+3) .ff-pos .ff-ord { font-size: var(--fs-body); }
  .ff-rname { font-size: var(--fs-body); }
  .ff-tabs { margin-bottom: 6px; }
  .ff-tab { padding: 5px 3px; font-size: var(--fs-micro); }
  .ff-fact { padding: 4px 2px; }
  .ff-fact-n { font-size: var(--fs-body); }
  .ff-summary { margin-bottom: 6px; }
  .ff-melon-row { margin: 2px 0 8px; }
  .ff-melon-row canvas.ff-spin { width: 64px; height: 64px; }
  .ff-btn { padding: 9px; font-size: var(--fs-body); margin-top: 6px; }
  /* (the .ff-buttons row contract lives with the panel contract) */
  .ff-buttons .ff-btn { margin-top: 6px; }
}
/* Wide-and-short: let the panel use the horizontal room it has. */
@media (max-height: 500px) and (min-width: 700px) {
  .ff-panel { max-width: 70vw; }
}
`;

// ---- Standings: captured at the instant the player finishes ----
// Pure function so the harness can test the ranking without a DOM.
// ---- THE RACER IDENTITY BLOCK -------------------------------------
// A melon is a body and a pilot is who drove it, so anywhere the game
// RECORDS a result it has to name both — otherwise the standings tell
// you a melon beat you without telling you who was steering it.
//
// ONE COMPONENT, every list. The places rows and the cup table were
// two near-identical implementations of the same block; a third
// (future) list would have been a third. The rule they encode:
// the MELON is the protagonist and reads first, the PILOT is the
// accountable party and sits beneath in the micro/faint role — the
// same relationship the rows already use for name-over-time.
//
// Moments of ACTION stay melon-only by design (the ticker, the death
// overlay): "PULPED IN THE PACK — LIL SQUISH" is drama, and appending
// a pilot to it deflates the joke. Moments of RECORD carry both.
// Dev hook: dress the active melon, until the customise screen exists.
//   FF._dress('eye-googly', 'flag-fr')      apply, seeded placement
//   FF._dress()                             strip it back to bare
// Dev door for the roll era: grant a decal by id, until earning is
// the only path anyone uses. FF._grant('flag-bd')
// Refreshes an open editor tray, because a dev door that grants
// invisibly reads as a dev door that failed (it did, 2026-08-16).
window.FF._grant = (id) => {
  const ok = window.FF.melon.grantDecal(id);
  if (ok && window.FF.editor && window.FF.editor.refreshTray) {
    window.FF.editor.refreshTray();
  }
  return ok;
};

// GRANT-ALL, mobile-reachable (Eddie, 2026-08-18): the console door
// above is useless on a phone, and pixel-legibility testing needs the
// whole catalogue wearable. A dev-lane button (behind the five-tap
// gate like every dev tool) walks the catalogue through the SAME
// sanctioned grant door — validated, idempotent, duplicates
// impossible — so this is a convenience over _grant, not a second
// granting mechanism. Withheld/retired items are not in ALL, so the
// flag roadmap's holds are respected automatically.
(function () {
  if (typeof document === 'undefined' || !window.FF.devtools) return;
  const gbtn = document.createElement('button');
  gbtn.id = 'ff-grant-all-btn';
  gbtn.textContent = '\ud83c\udf81 all decals';
  gbtn.title = 'Grant every catalogue decal (dev)';
  // LANE GEOMETRY, not hardcoded pixels: slot 4 of the dev stack
  // (tune, cockpit, studio, grant-all). A hardcoded top:190px put it
  // under the HUD on a phone — invisible, which reads exactly like a
  // button that was never added.
  gbtn.style.cssText = 'position:fixed;z-index:30;'
    + 'top:calc(var(--dev-top) + var(--dev-step) * 4);left:var(--lane-l);'
    + 'background:var(--panel-bg,#161616);color:var(--panel-fg,#ddd);'
    + 'border:none;border-radius:10px;padding:8px 10px;cursor:pointer;'
    + 'font-family:var(--mono,ui-monospace,monospace);'
    + 'font-size:var(--fs-body);display:none;';
  document.body.appendChild(gbtn);
  gbtn.addEventListener('click', () => {
    const D = window.FF.decals, M = window.FF.melon;
    if (!D || !M) return;
    let got = 0;
    for (const item of D.ALL) if (M.grantDecal(item.id)) got++;
    if (window.FF.editor && window.FF.editor.refreshTray) {
      window.FF.editor.refreshTray();
    }
    gbtn.textContent = '\u2713 ' + (got ? got + ' granted' : 'all owned');
    setTimeout(() => { gbtn.textContent = '\ud83c\udf81 all decals'; }, 1600);
  });
  window.FF.devtools.register({
    show: () => { gbtn.style.display = ''; },
    hide: () => { gbtn.style.display = 'none'; },
  });

  // PIXEL CAPTURE (Eddie, 2026-08-18): saves the ACTUAL low-res
  // buffer as a PNG — ground truth for pixel-look iteration. Lane
  // slot 5, same gate. On tap: downloads (or opens, where mobile
  // blocks downloads) the current frame's 320 buffer; disabled
  // feedback when pixel mode is off.
  const cbtn = document.createElement('button');
  cbtn.id = 'ff-px-capture-btn';
  cbtn.textContent = '\ud83d\udcf7 px capture';
  cbtn.title = 'Save the live 320 buffer as PNG (dev)';
  cbtn.style.cssText = 'position:fixed;z-index:30;'
    + 'top:calc(var(--dev-top) + var(--dev-step) * 5);left:var(--lane-l);'
    + 'background:var(--panel-bg,#161616);color:var(--panel-fg,#ddd);'
    + 'border:none;border-radius:10px;padding:8px 10px;cursor:pointer;'
    + 'font-family:var(--mono,ui-monospace,monospace);'
    + 'font-size:var(--fs-body);display:none;';
  document.body.appendChild(cbtn);
  cbtn.addEventListener('click', () => {
    const url = window.FF._pxCapture && window.FF._pxCapture();
    if (!url) {
      cbtn.textContent = '\u2014 pixel mode off';
      setTimeout(() => { cbtn.textContent = '\ud83d\udcf7 px capture'; }, 1400);
      return;
    }
    const a2 = document.createElement('a');
    a2.href = url;
    a2.download = 'ff-px-' + Date.now() + '.png';
    document.body.appendChild(a2);
    a2.click();
    a2.remove();
    cbtn.textContent = '\u2713 saved';
    setTimeout(() => { cbtn.textContent = '\ud83d\udcf7 px capture'; }, 1400);
  });
  window.FF.devtools.register({
    show: () => { cbtn.style.display = ''; },
    hide: () => { cbtn.style.display = 'none'; },
  });

  // LIGHT COLUMN cycle (PIXEL 320 Phase 5): steps the palette's light
  // state. Everything on screen shifts together because everything
  // resolves through the same table — sprites re-RESOLVE from their
  // index maps rather than re-baking. Lane slot 6, same dev gate.
  const lbtn = document.createElement('button');
  lbtn.id = 'ff-light-btn';
  lbtn.title = 'Cycle the light column (dev)';
  lbtn.style.cssText = 'position:fixed;z-index:30;'
    + 'top:calc(var(--dev-top) + var(--dev-step) * 6);left:var(--lane-l);'
    + 'background:var(--panel-bg,#161616);color:var(--panel-fg,#ddd);'
    + 'border:none;border-radius:10px;padding:8px 10px;cursor:pointer;'
    + 'font-family:var(--mono,ui-monospace,monospace);'
    + 'font-size:var(--fs-body);display:none;';
  const paintLight = () => {
    const p2 = window.FF.palette;
    lbtn.textContent = '\u2600 ' + (p2 ? p2.getLight() : 'STANDARD');
  };
  // Hour cycle (Phase 5.2), lane slot 7. Strength and hour are
  // ORTHOGONAL — a tunnel at dusk is not a tunnel at noon — so they
  // get a control each rather than one combined list.
  const hbtn = document.createElement('button');
  hbtn.id = 'ff-hour-btn';
  hbtn.title = 'Cycle the time of day (dev)';
  hbtn.style.cssText = 'position:fixed;z-index:30;'
    + 'top:calc(var(--dev-top) + var(--dev-step) * 7);left:var(--lane-l);'
    + 'background:var(--panel-bg,#161616);color:var(--panel-fg,#ddd);'
    + 'border:none;border-radius:10px;padding:8px 10px;cursor:pointer;'
    + 'font-family:var(--mono,ui-monospace,monospace);'
    + 'font-size:var(--fs-body);display:none;';
  const paintHour = () => {
    const p2 = window.FF.palette;
    hbtn.textContent = '\u23f1 ' + (p2 && p2.getTime ? p2.getTime() : 'NOON');
  };
  paintHour();
  document.body.appendChild(hbtn);
  hbtn.addEventListener('click', () => {
    const p2 = window.FF.palette;
    if (!p2 || !p2.setTime) return;
    const order = p2.TIME_NAMES;
    const i = order.indexOf(p2.getTime());
    p2.setTime(order[(i + 1) % order.length]);
    paintHour();
    if (window.FF._paintSkyBtn) window.FF._paintSkyBtn();
  });
  window.FF.devtools.register({
    show: () => { hbtn.style.display = ''; },
    hide: () => { hbtn.style.display = 'none'; },
  });

  // SKY cycle (Phase 6), lane slot 9. The hour button above chooses a
  // ROLE (and with it that role's classic sky); this walks every sky
  // in the library regardless of role, because comparing an Asia sky
  // against a violet one is exactly the judgement the device is for.
  const kbtn = document.createElement('button');
  kbtn.id = 'ff-sky-btn';
  kbtn.title = 'Cycle the sky (dev)';
  kbtn.style.cssText = 'position:fixed;z-index:30;'
    + 'top:calc(var(--dev-top) + var(--dev-step) * 9);left:var(--lane-l);'
    + 'background:var(--panel-bg,#161616);color:var(--panel-fg,#ddd);'
    + 'border:none;border-radius:10px;padding:8px 10px;cursor:pointer;'
    + 'font-family:var(--mono,ui-monospace,monospace);'
    + 'font-size:var(--fs-body);display:none;';
  const paintSky = () => {
    const p2 = window.FF.palette;
    kbtn.textContent = '\u2601 ' + (p2 && p2.getSky ? p2.getSky() : 'noon');
  };
  paintSky();
  window.FF._paintSkyBtn = paintSky;
  document.body.appendChild(kbtn);
  kbtn.addEventListener('click', () => {
    const p2 = window.FF.palette;
    if (!p2 || !p2.setSky || !window.FF.sky) return;
    const order = window.FF.sky.SPEC_IDS;
    const i = order.indexOf(p2.getSky());
    p2.setSky(order[(i + 1) % order.length]);
    paintSky();
    paintHour();
  });
  window.FF.devtools.register({
    show: () => { kbtn.style.display = ''; },
    hide: () => { kbtn.style.display = 'none'; },
  });

  // Shadow debug (Phase 5.5), lane slot 8: paints the cast flat —
  // magenta shadowed, green lit — and reports the hour and the sun's
  // bearing, so a capture answers "is the shadow in the right place"
  // without anyone inferring it from tone.
  const sbtn = document.createElement('button');
  sbtn.id = 'ff-shadow-btn';
  sbtn.title = 'Show the shadow cast (dev)';
  sbtn.style.cssText = 'position:fixed;z-index:30;'
    + 'top:calc(var(--dev-top) + var(--dev-step) * 8);left:var(--lane-l);'
    + 'background:var(--panel-bg,#161616);color:var(--panel-fg,#ddd);'
    + 'border:none;border-radius:10px;padding:8px 10px;cursor:pointer;'
    + 'font-family:var(--mono,ui-monospace,monospace);'
    + 'font-size:var(--fs-body);display:none;';
  const paintShadowBtn = () => {
    const p2 = window.FF.palette;
    const hour = p2 && p2.getTime ? p2.getTime() : '?';
    const deg = p2 && p2.sunDeg ? p2.sunDeg() : '?';
    sbtn.textContent = (window.FF.PX_SHADOW_DEBUG ? '\u25a0 ' : '\u25a1 ')
      + hour + ' ' + deg + '\u00b0';
  };
  paintShadowBtn();
  document.body.appendChild(sbtn);
  sbtn.addEventListener('click', () => {
    window.FF.PX_SHADOW_DEBUG = !window.FF.PX_SHADOW_DEBUG;
    paintShadowBtn();
  });
  window.FF.devtools.register({
    show: () => { sbtn.style.display = ''; paintShadowBtn(); },
    hide: () => { sbtn.style.display = 'none'; },
  });
  paintLight();
  document.body.appendChild(lbtn);
  lbtn.addEventListener('click', () => {
    const p2 = window.FF.palette;
    if (!p2) return;
    const order = p2.STATES;
    const i = order.indexOf(p2.getLight());
    p2.setLight(order[(i + 1) % order.length]);
    paintLight();
  });
  window.FF.devtools.register({
    show: () => { lbtn.style.display = ''; },
    hide: () => { lbtn.style.display = 'none'; },
  });
})();
window.FF._dress = (...ids) => {
  const M = window.FF.melon, D = window.FF.decals;
  const spec = M.active();
  spec.decals = ids.length ? ids.map((id, i) => D.place(spec, id, i)) : null;
  M._save();
  const ms = SCREENS.menu;
  if (ms && ms.paintPortrait) ms.paintPortrait();
  return spec.decals;
};

// ---- THE COUNTDOWN CAPTION ----------------------------------------
// A DOM overlay rather than canvas text: it inherits the type scale
// and the colour tokens, so the one piece of typography every player
// sees before every race is styled by the same law as everything
// else. Driven from the render loop, but its CONTENT comes from the
// sim's tick count — the numbers are not animated on wall time.
let elFade = null;
let elCount = null;
let lastCaption = '';
// The scrim that dims the race while the result settles. It is the
// same veil the panels sit on, brought in early so the moment reads
// as intentional rather than as a stall.
function buildFade() {
  elFade = el('div', 'ff-fade');
  document.body.appendChild(elFade);
  elFade.style.display = 'none';
}

function clearFade() {
  if (!elFade) return;
  elFade.classList.add('out');      // 120ms leaving, 250ms arriving
  elFade.style.opacity = '0';
  setTimeout(() => {
    if (elFade.style.opacity === '0') {
      elFade.style.display = 'none';
      elFade.classList.remove('out');
    }
  }, 160);
}

function buildCountdown() {
  elCount = el('div', 'ff-count');
  elCount.appendChild(el('div', 'ff-count-text', ''));
  document.body.appendChild(elCount);
  elCount.style.display = 'none';
}

function updateCountdown(state) {
  if (!elCount || !window.FF.gridStart) return;
  const cap = window.FF.gridStart.caption(state);
  const text = cap ? cap.text : '';
  if (text !== lastCaption) {
    lastCaption = text;
    const node = elCount.firstChild;
    node.textContent = text;
    node.className = 'ff-count-text' + (cap ? ' ff-count-' + cap.kind : '');
    elCount.style.display = text ? 'flex' : 'none';
    // Re-trigger the pop each time the number changes.
    if (text) {
      node.style.animation = 'none';
      void node.offsetWidth;
      node.style.animation = '';
    }
  }
}

// ---- CONFIRM ------------------------------------------------------
// One dialog, reused by anything destructive. Deliberately NOT a
// browser confirm(): that blocks the frame loop, cannot be styled,
// and reads as a webpage rather than a game.
//
// The defaults are chosen to be safe: CANCEL is the primary, styled
// button and the destructive action is the quiet one — the reverse of
// the screen it was opened from, so muscle memory cannot carry a
// player through it. Tapping the backdrop cancels; Escape cancels.
let elConfirm = null;
function buildConfirm() {
  elConfirm = el('div', 'ff-screen ff-confirm');
  const panel = el('div', 'ff-panel ff-confirm-panel');
  const head = el('div', 'ff-head');
  const title = el('h1', 'ff-title ff-confirm-title', '');
  const body = el('p', 'ff-sub', '');
  head.appendChild(title);
  head.appendChild(body);
  panel.appendChild(head);
  const keep = el('button', 'ff-btn', '');
  const go = el('button', 'ff-btn ff-quiet ff-danger', '');
  const foot = el('div', 'ff-foot');
  foot.appendChild(keep);
  foot.appendChild(go);
  panel.appendChild(foot);
  elConfirm.appendChild(panel);
  document.body.appendChild(elConfirm);
  elConfirm.style.display = 'none';
  elConfirm._title = title;
  elConfirm._body = body;
  elConfirm._keep = keep;
  elConfirm._go = go;
  // The backdrop cancels; a tap inside the panel must not.
  elConfirm.addEventListener('click', (e) => { if (e.target === elConfirm) confirmClose(); });
  panel.addEventListener('click', (e) => e.stopPropagation());
  keep.addEventListener('click', confirmClose);
  // ONE permanent listener that reads the pending action, rather than
  // re-assigning onclick per call: a handler that is swapped each
  // time is a handler that can be left pointing at the previous
  // question if a close path ever misses.
  go.addEventListener('click', () => {
    const fn = confirmPending;
    confirmClose();
    if (fn) fn();
  });
}

function confirmClose() {
  if (elConfirm) elConfirm.style.display = 'none';
  confirmPending = null;
}

let confirmPending = null;
function confirmAsk(opts) {
  if (!elConfirm) return;
  elConfirm._title.textContent = opts.title || 'ARE YOU SURE?';
  elConfirm._body.textContent = opts.body || '';
  elConfirm._keep.textContent = opts.cancel || 'CANCEL';
  elConfirm._go.textContent = opts.confirm || 'CONFIRM';
  confirmPending = opts.onConfirm || null;
  elConfirm.style.display = 'flex';
}

function confirmIsOpen() { return !!elConfirm && elConfirm.style.display !== 'none'; }


let elPause = null, elPauseBtn = null, elPixBtn = null;
let fromMenuOrRetry = true; // set by the paths that BEGIN a race
function buildPause() {
  elPause = el('div', 'ff-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'PAUSED'));
  head.appendChild(el('p', 'ff-sub', 'the world is frozen'));
  panel.appendChild(head);

  // ---- PAUSE AS A HUB ----------------------------------------------
  // The settings that used to sit as permanent corner buttons live
  // here instead. A phone whose whole input model is "one thumb,
  // anywhere" cannot afford eight persistent controls around the play
  // area; genre norm is two or three, and pause is where a player is
  // NOT under pressure. It is also the natural home for the controls
  // reminder — the flare is otherwise invisible to anyone who never
  // reads the one-time hint.
  const body = el('div', 'ff-body');
  const settings = el('div', 'ff-settings');
  body.appendChild(settings);

  const toggles = [];
  const addToggle = (label, get, set) => {
    const row = el('div', 'ff-set-row');
    row.appendChild(el('div', 'ff-set-k', label));
    const val = el('button', 'ff-set-v', '');
    const paint = () => {
      const on = !!get();
      val.textContent = on ? 'ON' : 'OFF';
      val.classList.toggle('on', on);
    };
    val.addEventListener('click', () => { set(); paint(); });
    row.appendChild(val);
    settings.appendChild(row);
    toggles.push(paint);
    paint();
  };
  // WHO IS RACING. Not a toggle — a value you can change, so it uses
  // the settings grammar with an editable value rather than ON/OFF.
  // The pause screen is a safe place to open the naming screen from:
  // returning re-enters 'pause', which is idempotent. (The finish
  // screen is NOT — entering it performs the career write.)
  const addValueRow = (label, get, onOpen) => {
    const row = el('div', 'ff-set-row');
    row.appendChild(el('div', 'ff-set-k', label));
    const val = el('button', 'ff-set-v ff-set-edit', '');
    const paint = () => { val.textContent = get(); };
    val.addEventListener('click', onOpen);
    row.appendChild(val);
    settings.appendChild(row);
    toggles.push(paint);
    paint();
  };
  addValueRow('RACER',
    () => (window.FF.melon && window.FF.melon.playerName) ? window.FF.melon.playerName() : 'Player',
    () => flow.openNaming('pilot'));

  addToggle('SOUND',
    () => !(window.FF.audio && window.FF.audio.isMuted && window.FF.audio.isMuted()),
    () => { if (window.FF.audio && window.FF.audio.toggleMuted) window.FF.audio.toggleMuted(); });
  addToggle('TRAINING RING',
    () => !!window.FF.CONFIG.practiceSplat,
    () => { window.FF.CONFIG.practiceSplat = window.FF.CONFIG.practiceSplat ? 0 : 1; });

  const controls = el('div', 'ff-controls');
  controls.appendChild(el('div', 'ff-set-k', 'CONTROLS'));
  const ctl = el('div', 'ff-controls-body');
  ctl.appendChild(el('div', null, '\u25C0  drag anywhere to spin  \u25B6'));
  const flare = el('div', null, '\u25B2  bouncy \u2014 survives big falls');
  flare.className = 'ff-ctl-up';
  ctl.appendChild(flare);
  const dead = el('div', null, '\u25BC  dead \u2014 no bounce, lands heavy');
  dead.className = 'ff-ctl-down';
  ctl.appendChild(dead);
  controls.appendChild(ctl);
  body.appendChild(controls);
  panel.appendChild(body);
  elPause._toggles = toggles;

  const resume = el('button', 'ff-btn', 'RESUME');
  const restart = el('button', 'ff-btn ff-secondary', 'RESTART RACE');
  elPause._restart = restart;
  const menu = el('button', 'ff-btn ff-secondary', 'MAIN MENU');
  const foot = el('div', 'ff-foot');
  foot.appendChild(resume);
  foot.appendChild(restart);
  foot.appendChild(menu);
  panel.appendChild(foot);
  elPause.appendChild(panel);
  document.body.appendChild(elPause);
  resume.addEventListener('click', () => flow.go('race'));
  restart.addEventListener('click', () => {
    // MID-CUP, RESTART MEANS THE WHOLE ATTEMPT. Restarting a single
    // leg would let a player re-roll a bad race and keep the good
    // ones, and a points table assembled from cherry-picked legs is
    // not a result. Unlimited ATTEMPTS were always the design; per-leg
    // retries are a different, weaker thing.
    // THE PARTY OBEYS THE SAME LAW (2026-08-26s): restarting a
    // single game would let a player re-roll a bad one and keep the
    // good ones. begin() rebuilds from game 1 through the lifecycle
    // door, which tears the live session down itself.
    const PC = window.FF.partycup;
    if (PC && PC.isRunning && PC.isRunning()) {
      PC.begin();
      fromMenuOrRetry = true;
      flow.go('race');
      return;
    }
    const c = window.FF.cup;
    if (c && c.isRunning() && startLegFn) {
      if (window.FF.resume) window.FF.resume.clear();
      c.begin();
      startLegFn(c.trackForLeg(0));
    } else if (respawnFn) {
      respawnFn();
    }
    fromMenuOrRetry = true;
    flow.go('race');
  });
  menu.addEventListener('click', () => {
    if (sessionCtx && sessionCtx.final && sessionCtx.onMenu) {
      const go4 = sessionCtx.onMenu;
      sessionCtx = null;
      go4();                       // the event module tears down
      return;
    }
    // Leaving for the menu ends the run: nothing left to resume, and
    // an orphaned snapshot would offer to restore a race the player
    // deliberately walked away from.
    //
    // NO PRIZE HANDOVER HERE. This is the PAUSE screen's exit, not the
    // finish screen's — a prize is only ever pending after a completed
    // cup, which lands on the finish screen. An edit that added the
    // handover matched both handlers at once and pasted `collectThen`
    // into this one, where it is not in scope: the console threw
    // ReferenceError and MAIN MENU stopped working from pause.
    // MID-PARTY, MENU MEANS ABANDON (2026-08-26s). Before this
    // branch existed the handler fell through to the race path:
    // the party cup stayed alive in memory and respawnFn rebuilt a
    // race under a live session. abandon() records nothing and
    // tears back to the daily through the lifecycle door.
    const PC2 = window.FF.partycup;
    if (PC2 && PC2.isRunning && PC2.isRunning()) {
      PC2.abandon();
      fromMenuOrRetry = true;
      flow.go('menu');
      return;
    }
    if (window.FF.resume) window.FF.resume.clear();
    if (window.FF.cup && !window.FF.cup.isRunning()) window.FF.cup.abandon();
    if (respawnFn) respawnFn();
    fromMenuOrRetry = true;
    flow.go('menu');
  });

  // The button itself: visible only while racing (a pause control on
  // the pause screen would be a trap).
  elPauseBtn = el('button', null, '');
  elPauseBtn.id = 'ff-pause-btn';
  elPauseBtn.appendChild(el('span', 'ff-pause-pill', 'II'));
  elPauseBtn.setAttribute('aria-label', 'Pause');
  elPauseBtn.hidden = true;
  document.body.appendChild(elPauseBtn);
  elPauseBtn.addEventListener('click', () => {
    if (flow.state === 'race') flow.go('pause');
    else if (flow.state === 'pause') flow.go('race');
  });

  // The pixelation cycle (aesthetic test, Eddie 2026-08-18): taps
  // step through vector and the historical resolution tiers, in
  // Eddie's ruled order — 320 (arcade-literal: Out Run / System 16),
  // 427 (240-row class), 512 (Neo Geo / SNES-hires), 480, 640 (VGA).
  // The pill SAYS the current mode. The renderer reads FF.PIXELATE +
  // FF.PIXELATE_W per frame; menus, HUD, and stick glass stay
  // native. Persisted so a verdict survives reloads; localStorage is
  // try/caught: file:// contexts can deny.
  const PIX_MODES = [null, 320];   // LOCKED at 320 (Eddie ruling);
                                   // FF.PIXELATE_W stays a dev tunable
  const pixLabel = (m) => (m === null ? 'VECTOR' : String(m));
  let pixIdx = 0;
  try {
    const saved = localStorage.getItem('ff-pixelate-mode');
    const i = PIX_MODES.indexOf(saved === 'null' || saved === null ? null : (saved | 0));
    if (saved !== null && i >= 0) pixIdx = i;
    else if (localStorage.getItem('ff-pixelate') === '1') pixIdx = PIX_MODES.indexOf(640);
  } catch (e) { /* stay at vector */ }
  const pixApply = () => {
    const m = PIX_MODES[pixIdx];
    window.FF.PIXELATE = m !== null;
    window.FF.PIXELATE_W = m || 0;
    if (elPixBtn) {
      elPixBtn.classList.toggle('ff-on', m !== null);
      elPixBtn.firstChild.textContent = pixLabel(m);
    }
  };
  elPixBtn = el('button', null, '');
  elPixBtn.id = 'ff-pix-btn';
  elPixBtn.appendChild(el('span', 'ff-pause-pill', pixLabel(PIX_MODES[pixIdx])));
  elPixBtn.setAttribute('aria-label', 'Cycle pixelation mode');
  elPixBtn.hidden = true;
  document.body.appendChild(elPixBtn);
  pixApply();
  elPixBtn.addEventListener('click', () => {
    pixIdx = (pixIdx + 1) % PIX_MODES.length;
    pixApply();
    try {
      localStorage.setItem('ff-pixelate-mode', String(PIX_MODES[pixIdx]));
    } catch (e) { /* file:// may deny persistence; the cycle still works */ }
  });
  // Escape/P toggle for desktop; ignored while the studio has focus.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
    // A dialog owns Escape while it is open.
    if (confirmIsOpen()) { if (e.code === 'Escape') confirmClose(); return; }
    if (flow.state === 'race') flow.go('pause');
    else if (flow.state === 'pause') flow.go('race');
  });
}


// ---- The machine ----
const SCREENS = {};
flow.register = function (name, screen) { SCREENS[name] = screen; };
// ---- THE BACK BUTTON -------------------------------------------
// On mobile web, back is a SYSTEM-LEVEL expectation: Android users
// press it constantly, and until now it left the game entirely —
// mid-cup, with a race in progress. Each screen pushes a history
// entry, and a popstate walks the machine backwards instead of
// leaving the page.
//
// WHAT BACK MEANS, per screen:
//   race   -> pause      (never straight to the menu: a back press is
//                         not a decision to abandon a race)
//   pause  -> race       (it is a modal; back dismisses it)
//   finish -> menu       (mid-cup it is ignored — leaving abandons the
//                         attempt, which must stay deliberate)
//   menu   -> leave      (the only screen where back exits the game)
//
// The guard flag stops the pushState we perform in response to a
// popstate from being read as another navigation.
let historyDepth = 0;
let handlingPop = false;

function pushHistory(name) {
  if (typeof history === 'undefined' || !history.pushState) return;
  if (handlingPop) return;
  try {
    historyDepth++;
    history.pushState({ ff: name, d: historyDepth }, '');
  } catch (_) {}
}

// ---- AUTO-PAUSE ----------------------------------------------------
// The most common interruption on a phone is not a button press: it
// is a call, a notification, or switching apps. The game should pause
// itself for those rather than simulating on into a race the player
// cannot see — and it is the one "control" that needs no reach at
// all, which matters when the pause button sits in the corner
// furthest from a racing thumb.
//
// Solo only: a lockstep race's clock belongs to every peer, and one
// player's notification is not grounds for stopping everyone else's.
function initAutoPause() {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  const pauseIfRacing = () => {
    if (flow.state !== 'race') return;
    if (netplayFn && netplayFn()) return;
    flow.go('pause');
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseIfRacing(); return; }
    // COMING BACK IS ALSO AN EVENT. The menu decides what to offer at
    // the moment it is entered, so a player who left the game sitting
    // on the menu across midnight kept being offered a run that today
    // no longer has (pressing it was safe — restore() re-checks — but
    // the button vanished under their thumb with no explanation).
    // Re-asking on return costs one call and fixes both kinds of
    // resume, and it is also where the "expired" note gets its chance
    // to appear for a player who never navigated away.
    const ms = SCREENS.menu;
    if (flow.state === 'menu' && ms && ms.refresh) {
      try { ms.refresh(); } catch (_) {}
    }
  });
  // Safari on iOS is unreliable about visibilitychange when the app
  // is backgrounded from a gesture; blur catches what it misses, and
  // pausing twice is a no-op.
  window.addEventListener('blur', pauseIfRacing);
}

function initHistory() {
  if (typeof window === 'undefined' || !window.addEventListener) return;
  // A base entry, so the FIRST back press has somewhere to land
  // rather than leaving immediately.
  pushHistory('menu');
  window.addEventListener('popstate', () => {
    handlingPop = true;
    try {
      // A dialog is the topmost thing on screen: back closes it and
      // goes no further.
      if (confirmIsOpen()) { confirmClose(); pushHistory(flow.state); return; }
      const s = flow.state;
      if (s === 'race') {
        flow.go('pause');
        pushHistory('pause');      // stay inside the game
      } else if (s === 'pause') {
        flow.go('race');
        pushHistory('race');
      } else if (s === 'finish') {
        const partyBack = window.FF.partycup && window.FF.partycup.isRunning
          && window.FF.partycup.isRunning();
        if ((window.FF.cup && window.FF.cup.isRunning()) || partyBack) {
          // Mid-cup — EITHER cup (party joined 2026-08-26t: before
          // this, back between party games fell through to the
          // abandon path and respawned a race under the session).
          // Refuse: abandoning must be a deliberate tap, and the
          // finish screen's own quit carries the confirm.
          pushHistory('finish');
        } else {
          if (window.FF.resume) window.FF.resume.clear();
          if (window.FF.cup) window.FF.cup.abandon();
          if (respawnFn) respawnFn();
          fromMenuOrRetry = true;
          flow.go('menu');
        }
      } else {
        // On the menu, back means back: let the browser leave, but
        // keep one entry so a stray press does not exit instantly.
        pushHistory('menu');
      }
    } finally {
      handlingPop = false;
    }
  });
}

flow.go = function (name) {
  const prev = SCREENS[flow.state];
  // exit() is handed the DESTINATION. flow.state is still the screen
  // being left at this point, so a handler that wants to behave
  // differently depending on where it is going cannot read it — the
  // menu's "don't tear down the exhibition if naming is covering us"
  // guard silently never fired for exactly this reason.
  if (prev && prev.exit) prev.exit(name);
  flow.state = name;
  const next = SCREENS[name];
  if (next && next.enter) next.enter();
  pushHistory(name);
};

flow.register('race', {
  enter() {
    clearFade();          // a new race is never dimmed
    if (elPauseBtn) elPauseBtn.hidden = false;
    if (elPixBtn) elPixBtn.hidden = false;
    // Commentary records are RACE-scoped: "biggest hit survived"
    // means this race, not this session. Only a fresh start clears
    // them — resuming from pause must not (you'd re-earn records you
    // already set).
    if (fromMenuOrRetry) {
      if (window.FF.ticker) window.FF.ticker.reset();
      if (window.FF.raceWatch) window.FF.raceWatch.reset();
      if (window.FF.events) window.FF.events.reset();
      fromMenuOrRetry = false;
    }
  },
  exit() {
    if (elPauseBtn) elPauseBtn.hidden = true;
    if (elPixBtn) elPixBtn.hidden = true;
  },
});

// PAUSE: a frozen world, nothing captured, nothing reset. main.js
// already gates the solo sim on flow.state === 'race', so the machine
// does the pausing — this screen is only the face of it. (Netplay is
// never gated: pausing a lockstep race would desync the session.)
flow.register('pause', {
  enter() {
    // The likeliest moment for someone to put the phone down.
    if (window.FF.resume && stateRef) {
      window.FF.resume.save(stateRef, { netplay: !!(netplayFn && netplayFn()) });
    }
    for (const paint of (elPause._toggles || [])) paint();
    // Label the truth: mid-cup this restarts the ATTEMPT, not the leg.
    if (elPause._restart) {
      const c = window.FF.cup;
      const partyOn = window.FF.partycup && window.FF.partycup.isRunning
        && window.FF.partycup.isRunning();
      elPause._restart.textContent = (partyOn
        || (c && c.isRunning()))
        ? 'RESTART CUP' : 'RESTART RACE';
    }
    elPause.style.display = 'flex';
  },
  exit() { elPause.style.display = 'none'; },
});


// ---- SESSION FINISH (party games, 2026-08-26) --------------------
// The party cup and the race cup SHARE the finish screen: same rows,
// same portraits, same advance flow. A session result needs no
// resolution (the clock ending IS the resolution), so an event
// module hands over a context and goes; enter() does the rest.
let sessionCtx = null;
flow.showSessionFinish = function (ctx) {
  sessionCtx = ctx || {};
  fromMenuOrRetry = false;
  flow.go('finish');
};

// ---- Hooks for main.js ----
// Called every frame after lap logic: fires the finish screen ONCE
// per race, at the tick the player crossed the line.
// ---- SETTLING: the beat between the flag and the results ----------
// Crossing the line used to build the finish screen in the same
// frame, which meant fast-forwarding the rest of the field
// synchronously — a visible stall.
//
// Now the crossing starts a JOB and a FADE. The world keeps running
// underneath (the autopilot has the wheel, so the melon races on
// rather than coasting), the job is pumped a slice per frame, and the
// screen is presented the moment the last racer's time lands. When
// resolution is quick — the common case — the fade is all you see.
const SETTLE_FADE_MS = 250;
const SETTLE_MAX_FRAMES = 30;   // ~0.5s at 60fps: the clock-free backstop
let settling = null;   // { startedAt }

function cancelSettle() {
  if (!settling) return;
  settling = null;
  if (window.FF.finishLine && window.FF.finishLine.clear) window.FF.finishLine.clear();
  clearFade();
}

function beginSettle(state) {
  // Hand the wheel over AT THE CROSSING, not when the screen opens:
  // otherwise the melon coasts neutrally through the fade.
  if (window.FF.autopilot) {
    window.FF.autopilot.engage(state, { netplay: !!(netplayFn && netplayFn()) });
  }
  // THE FIELD'S TIMES ARE PROJECTED, NOT SIMULATED. Fast-forwarding
  // the rest of the race was exact but cost a spike the player paid
  // for a number they cannot perceive — and it got worse with every
  // bot that thinks. The estimator is free (see finishline.js), and
  // measurement showed the thing that actually matters is untouched:
  // across every sampled race the PLAYER's own place was identical
  // to the simulated outcome, because everyone ahead of them has
  // genuinely finished and everyone behind must finish later.
  // Disagreement is confined to the order of the tail, where no
  // observable truth exists once we stop simulating.
  lastResolved = (window.FF.finishLine && window.FF.finishLine.estimate)
    ? window.FF.finishLine.estimate(state)
    : null;
  settling = {
    startedAt: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    frames: 0,
  };
  if (elFade) {
    elFade.style.display = 'block';
    requestAnimationFrame(() => { elFade.style.opacity = '1'; });
  }
}

function pumpSettle(state) {
  if (!settling) return;
  settling.frames++;
  // Nothing to compute any more: the beat exists purely so the result
  // arrives through a fade rather than snapping over a bright race.
  const done = true;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Hold for the fade even if the work finished instantly: arriving
  // mid-fade would snap the panel in over a half-faded world.
  //
  // FRAMES ARE THE BACKSTOP. The hold is measured in wall time, which
  // is right for an animation — but a clock that does not advance
  // (a frozen tab, a stubbed environment) would leave the player
  // staring at a dimmed race for ever. A frame count cannot stall the
  // same way, so whichever arrives first releases the screen.
  const held = (now - settling.startedAt) >= SETTLE_FADE_MS
    || settling.frames >= SETTLE_MAX_FRAMES;
  if (done && held) {
    settling = null;
    flow.go('finish');
  }
}

flow.onFrame = function (state) {
  updateCountdown(state);
  if (settling) { pumpSettle(state); return; }
  if (flow.state !== 'race') return;
  const ft = state.race && state.race.finishedTick;
  if (ft !== null && ft !== undefined && ft !== finishHandledTick) {
    finishHandledTick = ft;
    beginSettle(state);
  }
};

flow.init = function (state, opts) {
  stateRef = state;
  respawnFn = (opts && opts.respawn) || null;
  netplayFn = (opts && opts.isNetplay) || null;
  exhibitionHooks = (opts && opts.exhibition) || null;
  providerFn = (opts && opts.provider) || null;
  startLegFn = (opts && opts.startLeg) || null;
  rebuildFn = (opts && opts.rebuild) || null;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  buildFade();
  buildConfirm();
  buildCountdown();
  buildPause();
  // THE BUILD HOOK (split commit 2): extracted screens cannot be
  // built by name from here. A screen that needs DOM registers a
  // build() with its screen object; they run once, in registration
  // order, at the same phase the in-file builds always ran. A screen
  // hides itself at the end of its own build.
  for (const nm of Object.keys(SCREENS)) {
    const s = SCREENS[nm];
    if (s.build) s.build();
  }
  initHistory();
  initAutoPause();
  elPause.style.display = 'none';
  // A melon that has never been named gets its ceremony FIRST, with
  // the exhibition running behind it; the menu follows. Existing
  // players sitting on a null name (the window where the ceremony was
  // unreachable) are indistinguishable from new ones here, and get it
  // once on this load — which is the honest repair.
  const M = window.FF.melon;
  if (M && M.needsName && M.needsName()) flow.openNaming('ceremony', () => flow.go('menu'));
  else flow.go('menu');
};

// Test hook: what the spinner loop is actually drawing right now.
// Pixel-sampling a rotating portrait cannot answer that question.
flow._spinners = window.FF.flowLib.spinnerDump;
flow.computeStandings = computeStandings;

// ---- THE INTERNALS DOOR (split commit 1) --------------------------
// The machine's own moving parts, exposed for the screen modules the
// split extracts (finish, menu, rewards, naming). Accessors, not
// values: the variables stay HERE, owned by the machine — a screen
// that wants practiceMode asks the machine, every time, and two
// modules can never hold divergent copies (practiceMode lived here
// until ruling B, 2026-08-26: the flag was excised — every reachable
// race is a cup race, and sessions guard on st.session, the thing
// they actually are). Underscore-named because
// this is the family entrance, not the public door: flow's public
// surface (register/go/onFrame/showSessionFinish) is the design;
// _internals is plumbing the split makes explicit.
flow._internals = {
  state: () => stateRef,
  respawn: () => respawnFn,
  netplay: () => netplayFn,
  exhibition: () => exhibitionHooks,
  provider: () => providerFn,
  startLeg: () => startLegFn,
  rebuild: () => rebuildFn,
  lastResolved: () => lastResolved,
  fromMenuOrRetry: () => fromMenuOrRetry,
  setFromMenuOrRetry: (v) => { fromMenuOrRetry = !!v; },
  confirmAsk, confirmIsOpen, clearFade,
  // Session finish context: read by the finish screen (what NEXT
  // means now) and the pause screen (a party MAIN MENU walks
  // onMenu). The variable stays here; two modules can never hold
  // divergent copies.
  sessionCtx: () => sessionCtx,
  setSessionCtx: (v) => { sessionCtx = v; },
  // The reward ceremony runner lives in screen-rewards (commit 4).
  // A TRAMPOLINE, resolved at call time: the finish and menu screens
  // destructure this at THEIR load, which may precede the rewards
  // module's — a direct reference would freeze whatever was bound
  // first.
  runRewards: (next) => window.FF.rewards.run(next),
  // The melon award ceremony (naming-coupled; extracts with the
  // naming commit). An accessor for the same load-order reason.
  openAwardFlow: () => SCREENS.naming.openAward,
};
window.FF.flow = flow;
})();