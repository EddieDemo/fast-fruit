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
let stateRef = null;
let respawnFn = null;
let netplayFn = null;   // () => true while a lockstep session is live
let exhibitionHooks = null;
let providerFn = null;      // () => the live track provider, for fast-forward
let lastResolved = null;    // the resolved finish times for this race
let startLegFn = null;      // (trackName) => build a race on that track
let rebuildFn = null;       // (trackName, botCount) => rebuild for a restore
let practiceMode = true;    // true until a cup is started
let finishHandledTick = null;
let spinRAF = 0;

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
#ff-pause-btn .ff-pause-pill { display: inline-block;
  background: var(--panel-bg, #161616); color: var(--panel-fg, #ddd);
  border-radius: 10px; padding: 8px 12px;
  font-family: var(--mono, ui-monospace, monospace); font-size: var(--fs-body);
  line-height: 1; }
#ff-pause-btn:active .ff-pause-pill { color: var(--panel-accent, #39ff5f); }
#ff-pause-btn[hidden] { display: none; }

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
function racerIdentity(melonName, pilotName, isPlayer) {
  const nm = el('div', 'ff-rname', melonName);
  if (isPlayer) nm.appendChild(el('span', 'ff-you-tag', '  \u2014 YOU'));
  if (pilotName) nm.appendChild(el('div', 'ff-rpilot', pilotName));
  return nm;
}

// ---- THE AWARD FLOW ------------------------------------------------
// TWO STEPS, because they are two different questions and answering
// them on one screen would put seven melons and a decision on a 390px
// phone.
//
//   1. THE CEREMONY — the same screen a first melon arrives on,
//      showing the new melon and its stats, with a quiet LEAVE IT
//      beside KEEP. Answerable from the new melon alone: you do not
//      need to think about your other six to know whether a 6.1 kg
//      runt interests you.
//   2. THE RELEASE — only if they keep it AND the stable is full.
//      Which of the six goes, with a confirm, because the released
//      melon's career record dies with it and that is the part that
//      is genuinely irreversible.
//
// The melon is already in the stable (or held aside, if full) before
// any of this runs: the flow decides what to KEEP, never whether the
// prize existed.
function openAwardFlow(award, then) {
  const go = then || (() => flow.go('menu'));
  // Not full: it is already in the stable. Name it and go.
  if (!award.full) {
    namingAward = award.spec;
    flow.openNaming('award', () => { namingAward = null; go(); });
    return;
  }
  // Full: the ceremony first, then the release grid if they keep it.
  namingAward = award.spec;
  flow.openNaming('award', (kept) => {
    namingAward = null;
    if (kept === null) { go(); return; }   // left it
    openRelease(award.spec, go);
  }, { allowLeave: true });
}

// Step two: which of the six goes. Built fresh each time — it is a
// rare screen and the stable it lists changes.
let elRelease = null;
function openRelease(spec, then) {
  const go = then || (() => flow.go('menu'));
  const M = window.FF.melon;
  if (!elRelease) {
    elRelease = el('div', 'ff-screen ff-release-screen');
    const panel = el('div', 'ff-panel');
    const head = el('div', 'ff-head');
    head.appendChild(el('h1', 'ff-title', 'STABLE FULL'));
    head.appendChild(el('p', 'ff-sub', 'choose one to release'));
    panel.appendChild(head);
    const body = el('div', 'ff-body');
    const grid = el('div', 'ff-release-grid');
    body.appendChild(grid);
    panel.appendChild(body);
    const foot = el('div', 'ff-foot');
    const cancel = el('button', 'ff-btn ff-quiet', 'keep my six, discard the new one');
    foot.appendChild(cancel);
    panel.appendChild(foot);
    elRelease.appendChild(panel);
    document.body.appendChild(elRelease);
    elRelease._grid = grid;
    elRelease._cancel = cancel;
  }
  const grid = elRelease._grid;
  grid.textContent = '';
  spinners.length = 0;
  M.stableList().forEach((m, i) => {
    const d = M.deriveSpec(m);
    const cell = el('button', 'ff-release-cell');
    const cv = el('canvas', 'ff-spin');
    cv.width = 160; cv.height = 160;
    cell.appendChild(cv);
    cell.appendChild(el('div', 'ff-rel-name', m.name || M.UNNAMED_NAME));
    cell.appendChild(el('div', 'ff-rel-stat', d.kg.toFixed(1) + ' kg'));
    const r = m.record || {};
    cell.appendChild(el('div', 'ff-rel-rec',
      (r.races || 0) + ' races  \u00b7  ' + (r.wins || 0) + ' wins'));
    cell.addEventListener('click', () => {
      // THE CONFIRM SAYS WHAT IS LOST. Not "are you sure" — what for.
      confirmAsk({
        title: 'RELEASE ' + (m.name || 'THIS MELON').toUpperCase() + '?',
        body: 'Its career \u2014 ' + (r.races || 0) + ' races, ' + (r.wins || 0)
          + ' wins \u2014 goes with it. This cannot be undone.',
        cancel: 'KEEP IT',
        confirm: 'RELEASE',
        onConfirm: () => {
          M.acceptAward(spec, i);
          elRelease.style.display = 'none';
          namingAward = spec;
          flow.openNaming('award', () => { namingAward = null; go(); });
        },
      });
    });
    grid.appendChild(cell);
    clearCanvas(cv);
    const F = window.FF.FRUITS.watermelon || {};
    const a = window.FF.CONFIG.semiMajor * d.scale;
    spinners.push({ canvas: cv, angle: i * 0.7, a, b: a * 0.78,
      color: d.bodyColor, patKey: d.patternKey, fruit: 'watermelon', rate: 0.4 });
  });
  elRelease._cancel.onclick = () => {
    elRelease.style.display = 'none';
    go();
  };
  elRelease.style.display = 'flex';
  spinnersPaused = false;
  startSpinners();
}

// Dev/test hook: the release screen is otherwise only reachable by
// winning a seventh melon, which is days of play away.
window.FF._openRelease = (spec) => openRelease(spec);

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
window.FF._dress = (...ids) => {
  const M = window.FF.melon, D = window.FF.decals;
  const spec = M.active();
  spec.decals = ids.length ? ids.map((id, i) => D.place(spec, id, i)) : null;
  M._save();
  if (elMenu && elMenu._paintPortrait) elMenu._paintPortrait();
  return spec.decals;
};

function computeStandings(state, resolved) {
  const rows = [];
  const hz = (window.FF.CONFIG && window.FF.CONFIG.physicsHz) || 120;
  const startTick = state.raceStartTick || 0;
  const push = (m, isPlayer) => rows.push({
    name: m.name || (isPlayer ? 'YOU' : '???'),
    // The PILOT: who drove this melon. The melon is the character;
    // the pilot is the competitor, and a results table has to say
    // both or it cannot tell you who actually beat you.
    pilot: m.pilot || '',
    // ...and the IDENTITY OF RECORD, which every downstream table
    // keys on (state.racerKey). Computed once, here, so the cup and
    // the resolver cannot disagree about who a row is.
    key: window.FF.racerKey(m),
    // Elapsed from the race start to THIS racer's own crossing. Null
    // for anyone still out on track when the standings were captured
    // — shown as a dash, because inventing a time for an unfinished
    // racer would be the one dishonest number on the screen.
    // A racer still on track when the flag fell has no stamp of its
    // own; finishline.js fast-forwards the rest of the race on a
    // clone and supplies the REAL time it would have set. Only a
    // body that could not finish at all stays null — and it is
    // marked DNF, which sorts LAST on time rather than first.
    timeSec: (m.finishTick !== undefined && m.finishTick !== null)
      ? (m.finishTick - startTick) / hz
      : (resolved && resolved.byKey[window.FF.racerKey(m)] && !resolved.byKey[window.FF.racerKey(m)].dnf
        ? resolved.byKey[window.FF.racerKey(m)].timeSec
        : null),
    dnf: !!(resolved && resolved.byKey[window.FF.racerKey(m)] && resolved.byKey[window.FF.racerKey(m)].dnf
      && (m.finishTick === undefined || m.finishTick === null)),
    fruit: m.fruit || 'watermelon',
    color: m.bodyColor || '#37a01c',
    patKey: m.patKey || m.name || 'x',
    // THE OUTFIT IS PART OF WHAT A MELON LOOKS LIKE (ruled
    // 2026-08-16): any surface that draws a melon draws its decals.
    // Bots carry null today; the day bot decals ship, every table
    // shows them for free.
    decals: m.decals || null,
    a: m.a, b: m.b,
    x: m.x,
    isPlayer,
  });
  for (const p of state.players) push(p.melon, p.melon === state.melon);
  for (const b of state.bots) push(b.melon, false);
  // PLACE FOLLOWS TIME. Ordering by distance-at-the-flag was the old
  // rule, from before finish times existed for everyone: it put a
  // melon five metres further along ahead of one running a faster
  // pace, and then printed both their times underneath — a standing
  // that visibly contradicted its own numbers.
  //
  // Now the finishing order IS the order of finish times: measured
  // for anyone who crossed, projected for the rest (finishline.js).
  // A racer with no time at all (DNF) sorts last, and distance is the
  // final tiebreak so two identical times still order sensibly.
  rows.sort((r, q) => {
    const rt = (r.dnf || r.timeSec === null || r.timeSec === undefined) ? Infinity : r.timeSec;
    const qt = (q.dnf || q.timeSec === null || q.timeSec === undefined) ? Infinity : q.timeSec;
    if (rt !== qt) return rt - qt;
    return q.x - r.x;
  });
  rows.forEach((r, i) => { r.pos = i + 1; });
  return rows;
}

// mm:ss.s from the start line to this racer's own crossing.
function fmtTime(sec) {
  if (sec === null || sec === undefined) return '\u2014';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

// A full ordinal ("3rd"). fillCup called this before it existed —
// a ReferenceError inside the finish screen's enter(), which killed
// the frame loop and left a black screen on NEXT RACE.
function ordinal(n) {
  return String(n) + ordinalSuffix(n);
}

// English ordinal suffix. 11/12/13 are the classic trap (eleventh,
// not eleven-first), so the teens are special-cased before the
// last-digit rule — a 12-racer field would have hit it.
function ordinalSuffix(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  const d = n % 10;
  return d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
}

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

// ---- DOM scaffolding ----
let elMenu = null, elFinish = null;
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildMenu() {
  elMenu = el('div', 'ff-screen ff-menu-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  const title = el('h1', 'ff-title', 'FAST FRUIT');
  head.appendChild(title);
  head.appendChild(el('p', 'ff-sub', 'pick your racer'));
  panel.appendChild(head);
  // THE HANDLE for developer tools: five taps here. Outside the play
  // area, on a screen you choose to visit, mirroring the build-number
  // convention every phone owner has already met.
  if (window.FF.devtools) window.FF.devtools.arm(title);

  // Two blocks so one media query can flip portrait-above-papers into
  // portrait-beside-papers without touching the DOM.
  const body = el('div', 'ff-menu-body');
  const leftCol = el('div', 'ff-menu-left');
  const rightCol = el('div', 'ff-menu-right');
  const row = el('div', 'ff-melon-row');
  const left = el('button', 'ff-arrow', '\u25C0');
  const spin = el('canvas', 'ff-spin ff-portrait');
  // Initial hint only: syncCanvasSize measures the real box every
  // frame and resizes the backing store to match device pixels.
  spin.width = 560; spin.height = 560;
  const right = el('button', 'ff-arrow', '\u25B6');
  row.appendChild(left); row.appendChild(spin); row.appendChild(right);
  leftCol.appendChild(row);
  // THE PORTRAIT IS THE DOOR (Eddie, 2026-08-15): tapping the melon
  // opens the edit screen — rename and decals in one place. A big
  // melon that opens the editor is a big target; the chip underneath
  // is the discoverability, not the button.
  const openEditor = () => {
    if (window.FF.editor) window.FF.editor.open(() => flow.go('menu'));
  };
  spin.style.cursor = 'pointer';
  spin.setAttribute('role', 'button');
  spin.setAttribute('tabindex', '0');
  spin.title = 'edit melon';
  spin.addEventListener('click', openEditor);
  spin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(); }
  });
  const editChip = el('button', 'ff-edit-chip', '\u270E edit');
  editChip.addEventListener('click', openEditor);
  leftCol.appendChild(editChip);
  const nameEl = el('div', 'ff-melon-name', '');
  // THE SECOND DOOR — now into the EDITOR, where renaming lives with
  // the rest of changing-your-melon (ruled 2026-08-15). The rename
  // card itself is unchanged, one tap deeper; the pause-screen door
  // and the pilot door below still open it directly.
  nameEl.classList.add('ff-renamable');
  nameEl.setAttribute('role', 'button');
  nameEl.setAttribute('tabindex', '0');
  nameEl.title = 'edit melon';
  const openRename = openEditor;
  nameEl.addEventListener('click', openRename);
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRename(); }
  });
  leftCol.appendChild(nameEl);
  // WHO IS DRIVING IT. The same melon-over-pilot relationship the
  // standings use, on the screen where you pick the melon — and the
  // second rename door, because a player who wants to be called
  // something looks here first.
  const releaseBtn = el('button', 'ff-release-link', 'release this melon');
  releaseBtn.style.display = 'none';
  const pilotEl = el('div', 'ff-melon-pilot ff-renamable', '');
  pilotEl.setAttribute('role', 'button');
  pilotEl.setAttribute('tabindex', '0');
  pilotEl.title = 'rename yourself';
  const openPilotRename = () => flow.openNaming('pilot');
  pilotEl.addEventListener('click', openPilotRename);
  pilotEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPilotRename(); }
  });
  leftCol.appendChild(pilotEl);
  leftCol.appendChild(releaseBtn);
  const statsEl = el('div', 'ff-stats');
  rightCol.appendChild(statsEl);
  // (Single table now — the CAREER sub-heading retired with the split.
  // melon.career() is untouched and still feeds it.)
  body.appendChild(leftCol);
  body.appendChild(rightCol);
  const bodyZone = el('div', 'ff-body');
  bodyZone.appendChild(body);
  panel.appendChild(bodyZone);

  // THE HIERARCHY IS THE EXPLANATION. The cup is the day's event and
  // the single race is how you learn it, so they are not peers: one
  // primary button, one quiet secondary. The cup's label carries the
  // SCALE of the commitment — four races is a real ask, and a player
  // who discovers that in race three feels tricked.
  // A half-finished run is the most urgent thing on this screen, so
  // it takes the primary slot and pushes the cup down to secondary.
  const resumeBtn = el('button', 'ff-btn', 'RESUME');
  const cupBtn = el('button', 'ff-btn',
    'DAILY CUP \u00b7 ' + ((window.FF.cup && window.FF.cup.LEGS) || 3) + ' RACES');
  const race = el('button', 'ff-btn ff-secondary', "PRACTICE TODAY'S TRACK");
  const foot = el('div', 'ff-foot');
  foot.appendChild(resumeBtn);
  foot.appendChild(cupBtn);
  foot.appendChild(race);
  const dayLine = el('div', 'ff-dayline', '');
  foot.appendChild(dayLine);
  // A run that expired while the player was away gets SAID, not
  // silently removed: they left a race waiting and came back for it,
  // and a button that simply isn't there reads as a fault in their
  // memory or in the game. One dim line, shown once.
  const expiredLine = el('div', 'ff-expired', '');
  expiredLine.style.display = 'none';
  foot.appendChild(expiredLine);
  panel.appendChild(foot);
  elMenu.appendChild(panel);
  document.body.appendChild(elMenu);

  const M = window.FF.melon;
  // WHAT THE MENU SHOWS, and in what order. melon.js still computes
  // the full card — every physical stat and the whole career record —
  // and this is purely the menu's editorial choice about which of it
  // earns space on the first screen (Eddie, 2026-08-12). A later
  // "detailed info" view is then a different selection over the same
  // data, not new plumbing: change this list, change the card.
  //
  // The NAME is deliberately absent: it sits under the portrait as a
  // heading, not as a row in a table of statistics.
  const MENU_ROWS = ['species', 'weight', 'races', 'wins', 'podiums', 'best'];

  // One renderer for both halves: stats() and career() return the
  // same row shape, so the card grows by adding rows in melon.js and
  // never by editing the menu.
  const renderRows = (box, rows) => {
    box.textContent = '';
    for (const r of rows) {
      const line = el('div', 'ff-stat-row');
      line.appendChild(el('span', 'k', r.label));
      const v = el('span', 'v', r.value);
      if (r.note) v.appendChild(el('small', null, r.note));
      line.appendChild(v);
      box.appendChild(line);
    }
  };
  const fillStats = () => {
    const design = window.FF.studio && window.FF.studio.design;
    const fruit = (design && design.fruit) || 'watermelon';
    // Both sources, indexed by key, then selected in the declared
    // order. Unknown keys are skipped rather than rendered blank, so
    // this list can name a row that a future species doesn't have.
    const byKey = new Map();
    for (const r of (M.stats ? M.stats(M.active().seed, fruit, M.active().wide) : [])) byKey.set(r.key, r);
    for (const r of (M.career ? M.career() : [])) byKey.set(r.key, r);
    const rows = [];
    for (const k of MENU_ROWS) { const r = byKey.get(k); if (r) rows.push(r); }
    renderRows(statsEl, rows);
  };
  const refresh = () => {
    fillStats();
    // The day's identity, and how you have done at it. This is what
    // makes returning tomorrow feel like a fixture rather than a
    // relaunch.
    // A waiting run rewrites the menu's hierarchy.
    const snap = window.FF.resume ? window.FF.resume.peek() : null;
    // peek() clears an expired snapshot as a side effect and leaves a
    // note behind; ask AFTER peeking, and only when nothing is
    // waiting (a fresh run supersedes news about an old one).
    if (elMenu._expiredLine) {
      const why = (!snap && window.FF.resume && window.FF.resume.takeExpiry)
        ? window.FF.resume.takeExpiry() : null;
      // 'day' is the interesting case and the common one: a new daily
      // landed while they were away. 'age' means the run simply sat
      // too long. Neither is an error, so neither shouts.
      elMenu._expiredLine.textContent = why === 'day'
        ? "yesterday's run expired \u00b7 today's track is new"
        : why === 'age' ? 'your unfinished run expired' : '';
      elMenu._expiredLine.style.display = elMenu._expiredLine.textContent ? '' : 'none';
    }
    if (elMenu._resumeBtn) {
      elMenu._resumeBtn.style.display = snap ? '' : 'none';
      elMenu._cupBtn.classList.toggle('ff-secondary', !!snap);
      if (snap) {
        elMenu._resumeBtn.textContent = snap.cup
          ? 'RESUME CUP \u00b7 RACE ' + Math.min(window.FF.cup.LEGS, (snap.cup.leg || 0) + 1)
            + ' OF ' + window.FF.cup.LEGS
          : 'RESUME PRACTICE';
      }
    }
    if (window.FF.cup && window.FF.dailyTrackName) {
      const day = window.FF.dailyTrackName().replace('Daily ', '');
      const rec = window.FF.cup.dayRecord();
      // The build stamp rides along: a screenshot of the menu now
      // says which build produced everything else in the screenshot.
      const build = window.FF.BUILD ? '  \u00b7  ' + window.FF.BUILD : '';
      dayLine.textContent = (rec && rec.bestPoints !== null
        ? day + '  \u00b7  best ' + rec.bestPoints + ' pts in ' + rec.attempts
          + (rec.attempts === 1 ? ' try' : ' tries')
        : day + '  \u00b7  not raced yet') + build;
    }
    const st = M._load();
    const cur = M.active();
    nameEl.textContent = (cur.name || M.UNNAMED_NAME || 'Unnamed Melon')
      + (st.melons.length > 1 ? '  (' + (st.active + 1) + '/' + st.melons.length + ')' : '');
    pilotEl.textContent = M.playerName ? M.playerName() : 'Player';
    const many = st.melons.length > 1;
    releaseBtn.style.display = many ? '' : 'none';
    left.style.visibility = many ? 'visible' : 'hidden';
    right.style.visibility = many ? 'visible' : 'hidden';
  };
  // THE PORTRAIT IS PART OF THE STATE, NOT PART OF THE ENTRANCE.
  // It was pushed once in menu.enter() and never rebuilt, so cycling
  // melons repainted the stats and the name while the picture kept
  // showing the first melon — the one screen whose entire job is
  // "look at your melon" was showing the wrong one. Rebuilding here
  // means any future thing that changes the active melon repaints for
  // free. The rotation angle carries over so the swap reads as a
  // change of melon rather than a stutter.
  const paintPortrait = () => {
    const prev = spinners.length ? spinners[0].angle : 0;
    spinners.length = 0;
    clearCanvas(elMenu._spin);
    pushMelonPortrait(elMenu._spin);
    if (spinners.length) spinners[0].angle = prev;
    spinnersPaused = false;
    startSpinners();
  };
  elMenu._paintPortrait = paintPortrait;

  const cycle = (d) => {
    const st = M._load();
    M.setActive((st.active + d + st.melons.length) % st.melons.length);
    refresh();
    paintPortrait();
    // No respawn here any more: during the exhibition a respawn would
    // restart the background race on every arrow press, and the real
    // grid is rebuilt on RACE anyway.
    if (!(window.FF.exhibition && window.FF.exhibition.running) && respawnFn) respawnFn();
  };
  left.addEventListener('click', () => cycle(-1));
  right.addEventListener('click', () => cycle(1));
  // RELEASE, from the start screen. Only offered when there is more
  // than one melon — you must always have something to race — and it
  // always confirms, because the career record is what is actually
  // lost and that cannot be undone.
  releaseBtn.addEventListener('click', () => {
    const st = M._load();
    const cur = M.active();
    const r = cur.record || {};
    confirmAsk({
      title: 'RELEASE ' + (cur.name || 'THIS MELON').toUpperCase() + '?',
      body: 'Its career \u2014 ' + (r.races || 0) + ' races, ' + (r.wins || 0)
        + ' wins \u2014 goes with it. This cannot be undone.',
      cancel: 'KEEP IT',
      confirm: 'RELEASE',
      onConfirm: () => {
        if (M.deleteMelon(st.active)) refresh();
      },
    });
  });
  // PRACTICE: leg 1, no record, freely retried.
  race.addEventListener('click', () => {
    fromMenuOrRetry = true;
    practiceMode = true;
    if (window.FF.cup) window.FF.cup.abandon();
    if (window.FF.exhibition) window.FF.exhibition.stop();
    if (respawnFn) respawnFn();
    flow.go('race');
  });
  // THE CUP: four legs, scored together.
  cupBtn.addEventListener('click', () => {
    if (!window.FF.cup || !startLegFn) return;
    fromMenuOrRetry = true;
    practiceMode = false;
    if (window.FF.exhibition) window.FF.exhibition.stop();
    window.FF.cup.begin();
    startLegFn(window.FF.cup.trackForLeg(0));
    flow.go('race');
  });
  elMenu._dayLine = dayLine;
  elMenu._expiredLine = expiredLine;
  elMenu._resumeBtn = resumeBtn;
  elMenu._cupBtn = cupBtn;
  resumeBtn.addEventListener('click', () => {
    const R = window.FF.resume;
    if (!R || !rebuildFn) return;
    const snap = R.restore(stateRef, rebuildFn);
    // Vanished or stale between the menu being drawn and this tap
    // (the midnight case, if it turns over in that gap): refresh
    // re-reads the store, hides the button and shows the note that
    // restore's own peek() just left behind.
    if (!snap) { refresh(); return; }
    practiceMode = !!snap.practice;
    fromMenuOrRetry = false;                  // mid-run: keep the records
    if (window.FF.exhibition) window.FF.exhibition.stop();
    // Never drop a returning player into a moving world.
    flow.go('race');
    flow.go('pause');
  });
  elMenu._refresh = refresh;
  elMenu._spin = spin;
  elMenu._stats = statsEl;
}

let elPause = null, elPauseBtn = null;
let elFinishNote = null, elFinishTitle = null;
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
    const c = window.FF.cup;
    if (!practiceMode && c && c.isRunning() && startLegFn) {
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
  // Escape/P toggle for desktop; ignored while the studio has focus.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
    // A dialog owns Escape while it is open.
    if (confirmIsOpen()) { if (e.code === 'Escape') confirmClose(); return; }
    if (flow.state === 'race') flow.go('pause');
    else if (flow.state === 'pause') flow.go('race');
  });
}

function buildFinish() {
  elFinish = el('div', 'ff-screen ff-finish-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  const finishTitle = el('h1', 'ff-title', 'FINISH');
  head.appendChild(finishTitle);
  // WHAT THIS RESULT COUNTED FOR. A practice race ends on the same
  // screen as a cup race and records nothing — a player who notices
  // their stats did not move will assume a bug, not a rule. Saying so
  // costs one line and removes the doubt entirely.
  const finishNote = el('p', 'ff-sub ff-finish-note', '');
  head.appendChild(finishNote);
  elFinishNote = finishNote;
  elFinishTitle = finishTitle;
  // Three tabs: the result, the race, and your run. PLACES leads
  // because it answers the question everyone has at the flag; the
  // other two are for the curious, and burying them behind a tap is
  // what keeps the result page from becoming a spreadsheet.
  const tabs = el('div', 'ff-tabs');
  // A tab strip is not a row of buttons, and now that it no longer
  // LOOKS like one it should not sound like one either: a screen
  // reader announcing "four buttons" gives the same wrong impression
  // the old styling gave the eye. role=tablist + aria-selected says
  // "one choice, currently on this", which is what showTab maintains.
  tabs.setAttribute('role', 'tablist');
  const panes = {};
  const tabBtns = {};
  const rows = el('div', 'ff-rows');
  const facts = el('div', 'ff-facts');
  const summary = el('div', 'ff-summary');
  const cupTable = el('div', 'ff-facts');
  const paneDefs = [
    ['cup', 'CUP', cupTable],
    ['places', 'PLACES', rows],
    ['race', 'RACE', facts],
    ['you', 'YOU', summary],
  ];
  for (const [key, label, content] of paneDefs) {
    const btn = el('button', 'ff-tab', label);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-controls', 'ff-pane-' + key);
    btn.id = 'ff-tabbtn-' + key;
    btn.addEventListener('click', () => showTab(key));
    tabs.appendChild(btn);
    tabBtns[key] = btn;
    const pane = el('div', 'ff-pane');
    pane.id = 'ff-pane-' + key;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', 'ff-tabbtn-' + key);
    pane.appendChild(content);
    panes[key] = pane;
  }
  head.appendChild(tabs);
  panel.appendChild(head);
  const bodyZone = el('div', 'ff-body');
  for (const [key] of paneDefs) bodyZone.appendChild(panes[key]);
  panel.appendChild(bodyZone);
  const retry = el('button', 'ff-btn', 'RETRY');
  const menu = el('button', 'ff-btn ff-secondary', 'MAIN MENU');
  const btns = el('div', 'ff-buttons');
  btns.appendChild(retry);
  btns.appendChild(menu);
  // Mid-cup the action is NEXT RACE and nothing else is a peer:
  // leaving abandons the attempt entirely, so it must be deliberate
  // rather than one of two equal buttons.
  const next = el('button', 'ff-btn', 'NEXT RACE');
  const quit = el('button', 'ff-btn ff-quiet', 'abandon cup');
  const cupBtns = el('div');
  cupBtns.appendChild(next);
  cupBtns.appendChild(quit);
  const foot = el('div', 'ff-foot');
  foot.appendChild(btns);
  foot.appendChild(cupBtns);
  panel.appendChild(foot);
  elFinish._btns = btns;
  elFinish._cupBtns = cupBtns;
  next.addEventListener('click', () => {
    const c = window.FF.cup;
    if (!c || !startLegFn) return;
    startLegFn(c.trackForLeg(c.current().leg));
    fromMenuOrRetry = true;
    flow.go('race');
  });
  // ABANDONING IS DESTRUCTIVE AND SILENT: it throws away every leg
  // already raced, and nothing on screen would say so afterwards. A
  // quiet button made it hard to hit BY ACCIDENT; a confirm makes it
  // impossible — and, more usefully, it states the cost in the one
  // moment the player is deciding.
  quit.addEventListener('click', () => {
    const c = window.FF.cup;
    const legs = (c && c.current()) ? c.current().results.length : 0;
    confirmAsk({
      title: 'ABANDON CUP?',
      body: legs === 1
        ? 'One race already run. It will not be recorded.'
        : legs > 1
          ? legs + ' races already run. None of them will be recorded.'
          : 'Nothing will be recorded.',
      confirm: 'ABANDON',
      cancel: 'KEEP RACING',
      onConfirm: () => {
        // Records nothing — not even the legs already run.
        if (window.FF.resume) window.FF.resume.clear();
        if (window.FF.cup) window.FF.cup.abandon();
        practiceMode = true;
        if (respawnFn) respawnFn();
        flow.go('menu');
      },
    });
  });
  elFinish.appendChild(panel);
  document.body.appendChild(elFinish);
  // ---- COLLECT ON THE WAY OUT, WHICHEVER DOOR ----------------------
  // The prize is spent by EVERY exit from this screen, not just MAIN
  // MENU. Without this, pressing RETRY after winning left the award
  // pending: the melon was safe (it is persisted the moment it is
  // won) but the ceremony never ran, and the next completed cup
  // overwrote the pending award — a prize collected silently, with no
  // moment attached to it. Now the ceremony always happens, and only
  // the destination afterwards differs.
  // THE TELLING. Everything in the queue is already true; these
  // cards only present it, one per reward, in the order it queued —
  // xp first (the constant), decals next, melon last, because the
  // melon chains into acceptance and naming and nothing should come
  // back from a naming ceremony to '+56 XP, tap to continue'.
  const collectThen = (next) => runRewards(next);

  retry.addEventListener('click', () => {
    collectThen(() => {
      // After a completed cup, RETRY means another ATTEMPT at the day —
      // unlimited by design, ranked on your best.
      if (!practiceMode && window.FF.cup && window.FF.cup.isComplete() && startLegFn) {
        window.FF.cup.begin();
        startLegFn(window.FF.cup.trackForLeg(0));
      } else if (respawnFn) {
        respawnFn();
      }
      fromMenuOrRetry = true;
      flow.go('race');
    });
  });
  menu.addEventListener('click', () => {
    // Leaving for the menu ends the run: nothing left to resume, and
    // an orphaned snapshot would offer to restore a race the player
    // deliberately walked away from.
    if (window.FF.resume) window.FF.resume.clear();
    if (window.FF.cup && !window.FF.cup.isRunning()) window.FF.cup.abandon();
    if (respawnFn) respawnFn();
    fromMenuOrRetry = true;
    // THE HANDOVER. The prize was announced on the cup tab and is
    // already in the stable; this is the ceremony. It happens between
    // the finish screen and the menu, so the input-requiring beat
    // lands once the player has decided they are done reading — and
    // never before the placing that earned it.
    collectThen(() => flow.go('menu'));
  });
  // THE DOOR HAS TO NAME WHAT IS BEHIND IT. 'YOU'VE WON A MELON'
  // followed by two buttons that say RETRY and MAIN MENU leaves the
  // player told about a prize with no visible way to reach it — and
  // nothing hints that the menu route hands it over on the way. So
  // when a prize is waiting the exit says so and becomes the PRIMARY
  // action, and RETRY steps down to secondary.
  //
  // THE LABEL IS 'MELON GET!' — the acquisition shout from the
  // Japanese Super Mario Sunshine ("SHINE GET!"), whose joke is the
  // word order, not the casing. Set in CAPS like every other button:
  // the buttons are one family and a lone sentence-case member reads
  // as an inconsistency before it reads as a quote. The plain
  // language directly above it ("YOU'VE WON A MELON" on the cup tab)
  // does the informing, so the button is free to celebrate.
  elFinish._paintPrizeButtons = () => {
    // ONE LABEL LAW (ruled 2026-08-16, replacing the MAIN MENU /
    // MELON GET! switch): the button says GET XP exactly when
    // pressing it gets you something — the reward queue is non-empty
    // after every completed cup (xp is the constant), and the same
    // press still runs decals and the melon ceremony after it. XP,
    // not EXP: every shipped surface already says XP (+76 XP, PILOT
    // LEVEL 2 · 26/75 XP), and two spellings of one number is noise.
    // Practice and reward-less exits keep MAIN MENU, because a button
    // that promises xp it cannot pay is a lie.
    const waiting = window.FF.melon.pendingRewards().length > 0;
    menu.textContent = waiting ? 'GET XP' : 'MAIN MENU';
    menu.classList.toggle('ff-secondary', !waiting);
    retry.classList.toggle('ff-secondary', waiting);
  };
  elFinish._rows = rows;
  elFinish._cupTable = cupTable;
  elFinish._facts = facts;
  elFinish._summary = summary;
  elFinish._panes = panes;
  elFinish._tabBtns = tabBtns;
}

// ---- The rotating racer previews ----
// One rAF loop serves every visible spinner; each row's canvas is
// redrawn via the renderer's own standalone body draw, so previews
// are the REAL species/pigment/pattern, not icons.
const spinners = []; // { canvas, a, b, color, patKey, fruit, angle }
let spinnersPaused = false;
// A canvas has TWO sizes: its CSS box and its backing store. A fixed
// backing store is under-resolved the moment CSS scales the box up on
// a high-DPR screen — and no amount of pattern fidelity survives being
// resampled by a soft canvas. So each spinner sizes its store from the
// box it actually occupies times devicePixelRatio, and re-sizes when
// that changes (rotation, window resize, moving to another monitor).
// Wipe a canvas that is about to be reused. Without this, a spinner
// whose loop hasn't run yet still displays the last thing drawn into
// it — which is how a fresh menu could show a race-old portrait.
function clearCanvas(cv) {
  const ctx = cv.getContext && cv.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
}

// Any layout-changing event drops the cached boxes, so the rare
// remeasure never lags a rotation or a window resize.
if (typeof window !== 'undefined' && window.addEventListener) {
  for (const ev of ['resize', 'orientationchange']) {
    window.addEventListener(ev, () => {
      spinMeasureAt = 0;
      for (const s of spinners) s.box = null;
    });
  }
}

function syncCanvasSize(cv) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const rect = cv.getBoundingClientRect();
  const cssW = rect.width || cv.clientWidth || 104;
  const want = Math.max(64, Math.min(1600, Math.round(cssW * dpr)));
  if (cv.width !== want || cv.height !== want) { cv.width = want; cv.height = want; }
  return { dpr, cssW };
}

// ---- THE SPINNERS ARE THE FINISH SCREEN'S REAL COST ----------------
// The results panel registers a rotating body per racer on BOTH the
// PLACES and CUP tabs: two dozen canvases, each needing a
// portrait-resolution pattern raster (for a watermelon that is a
// per-pixel island field). Three costs came out of that, and all
// three landed on the frame the player crosses the line:
//
//   BUILD SPIKE   two dozen rasters built in one frame.
//   DOUBLE DRAW   the hidden tab's twelve kept redrawing, because
//                 isConnected cannot see display:none. Half the work
//                 was for pixels nobody could look at.
//   LAYOUT THRASH getBoundingClientRect per spinner per frame — two
//                 dozen forced reflows every frame.
//
// Fixed here by drawing only what is visible, measuring only when the
// size can actually have changed, and turning at a rate the motion
// does not miss.
const SPIN_FPS = 30;              // decorative rotation; 60 is waste
const SPIN_FRAME_MS = 1000 / SPIN_FPS;
let spinLast = 0;
let spinMeasureAt = 0;            // remeasure clock (see below)

// A canvas that is display:none still reports isConnected — so the
// hidden tab has to be excluded by geometry, not by connection.
function spinnerVisible(cv) {
  return cv.isConnected && cv.offsetParent !== null;
}

function spinLoop(now) {
  spinRAF = 0;
  const draw = window.FF.drawMelonStandalone;
  if (!draw || spinnersPaused) return;
  const t = now || (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Rate-limit: the bodies turn slowly and decoratively, so half the
  // frames are indistinguishable and cost half as much.
  if (t - spinLast < SPIN_FRAME_MS) {
    spinRAF = requestAnimationFrame(spinLoop);
    return;
  }
  const dt = spinLast ? Math.min(0.1, (t - spinLast) / 1000) : 1 / SPIN_FPS;
  spinLast = t;
  // MEASURE RARELY. A canvas box only changes on resize or rotation,
  // and getBoundingClientRect forces a synchronous layout — two dozen
  // of those per frame is the classic way to lose smoothness. Once a
  // second is plenty; resize handlers catch the rest.
  const remeasure = t >= spinMeasureAt;
  if (remeasure) spinMeasureAt = t + 1000;
  let any = false;
  for (const s of spinners) {
    if (!spinnerVisible(s.canvas)) continue;
    any = true;
    s.angle += dt * 55 * (s.rate === undefined ? 0.9 : s.rate) / 60; // slow, stately
    const box = (remeasure || !s.box) ? syncCanvasSize(s.canvas) : s.box;
    s.box = box;
    const ctx = s.canvas.getContext('2d');
    ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
    ctx.save();
    ctx.translate(s.canvas.width / 2, s.canvas.height / 2);
    const fit = (s.canvas.width / 2 - 4 * box.dpr) / Math.max(s.a, s.b);
    ctx.scale(fit, fit);
    // The pattern raster is built for THIS destination: `fit` is
    // exactly device pixels per world pixel, which is the number the
    // renderer needs and the only place it can be known.
    draw(ctx, s.angle, s.a, s.b, s.color, s.patKey, s.fruit, fit, s.decals);
    ctx.restore();
  }
  // Keep the loop alive while ANY spinner exists, visible or not: the
  // player can switch tabs, and a loop that stopped because the
  // visible ones were hidden would never restart itself.
  if ((any || spinners.length) && flow.state !== 'race') {
    spinRAF = requestAnimationFrame(spinLoop);
  }
}
function startSpinners() {
  if (!spinRAF) spinRAF = requestAnimationFrame(spinLoop);
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
    if (flow.state === 'menu' && elMenu && elMenu._refresh) {
      try { elMenu._refresh(); } catch (_) {}
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
        if (window.FF.cup && window.FF.cup.isRunning() && !practiceMode) {
          // Mid-cup: refuse. Abandoning must be a deliberate tap.
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

// ---- THE NAMING GATE (2026-08-14) --------------------------------
// A first-time player is given a melon before anything else happens.
// This is a real FLOW STATE rather than a floating overlay, because
// an overlay that lives outside the screen system is exactly how the
// ceremony ended up racing the menu for the same pixels: it fired at
// boot, rendered behind the menu (z-20 vs z-40), and only surfaced
// once the race screen stepped aside — so it appeared to arrive
// mid-race, and the tap that dismissed it fell through to the armed
// grid and started the countdown.
//
// THE EXHIBITION RUNS BEHIND IT. A blank field behind the card is a
// loading screen; melons already tumbling down today's track is the
// game introducing itself while you name your racer. The exhibition's
// local body is deliberately NOT dressed in the player's melon
// (main.js skips that for the exhibition), which is right here too:
// the melon being named is the one on the card, not one of the twelve
// in the background.
//
// NOTHING ELSE IS TOUCHABLE and nothing can leak: no race has been
// built at this point, so there is no grid to arm — the structural
// version of the fix rather than a guard bolted on.
flow.register('naming', {
  enter() {
    // start() is a no-op while running, so this only fires on the boot
    // ceremony, where the menu has never been entered and nothing is
    // running behind us yet.
    if (window.FF.exhibition && exhibitionHooks) window.FF.exhibition.start(exhibitionHooks);
    clearFade();
    const M = window.FF.melon;
    const cur = M.active();
    const isPilot = namingMode === 'pilot';
    const isAward = namingMode === 'award';
    elNaming._title.textContent = isPilot ? 'YOUR NAME'
      : namingMode === 'rename' ? 'RENAME'
      : (M.pickHeadline ? M.pickHeadline() : "You've got Melon!");
    elNaming._sub.textContent = isPilot ? 'who is racing?'
      : namingMode === 'rename' ? 'what should it be called?'
      : isAward ? 'your prize for the cup'
      : 'name your racer';
    elNaming._input.placeholder = isPilot ? 'your name' : 'name your melon';
    elNaming._input.value = isPilot ? (M.playerName ? M.playerName() : '')
      : namingMode === 'rename' ? (cur.name || '') : '';
    // LEAVE IT: only offered when accepting the prize would cost one
    // of the six. A player must be able to say no to a runt without
    // first being made to choose a victim.
    elNaming._leave.style.display = namingAllowLeave ? '' : 'none';
    // THE BUTTON STATES THE ACTION THAT EXISTS. 'KEEP' implies an
    // alternative, and outside the full-stable case there isn't one:
    // the melon is already yours and the screen is a gift being
    // handed over, not a decision. So the label follows the mode —
    //   choice to decline  -> KEEP   (paired with 'leave it')
    //   a gift, no choice  -> THANKS (the headlines are all giving
    //                        moments; 'Take this!' wants 'Thanks')
    //   an edit            -> SAVE
    elNaming._keep.textContent = namingAllowLeave ? 'KEEP'
      : (isPilot || namingMode === 'rename') ? 'SAVE'
      : 'THANKS';
    elNaming._refresh(namingAward);
    elNaming.style.display = 'flex';
    spinners.length = 0;
    clearCanvas(elNaming._spin);
    if (namingAward) pushSpecPortrait(elNaming._spin, namingAward);
    else pushMelonPortrait(elNaming._spin);
    spinnersPaused = false;
    startSpinners();
    // Focus AFTER the screen is up, or the keyboard opens against a
    // hidden field on iOS.
    setTimeout(() => { try { elNaming._input.focus(); } catch (_) {} }, 60);
  },
  exit() {
    elNaming.style.display = 'none';
    spinners.length = 0;
  },
});

// Open the naming screen. Modes:
//   'ceremony' — first boot, names the MELON
//   'rename'   — rename the melon
//   'pilot'    — rename YOU, the racer driving it
// Returns to the screen it was opened from, so the door can sit on
// more than one screen without each caller having to say where back
// is. NOTE it deliberately cannot be opened from 'finish': entering
// that screen performs the one career write, so returning to it would
// count the race twice.
flow.openNaming = function (mode, onDone, opts) {
  namingMode = mode || 'ceremony';
  namingAllowLeave = !!(opts && opts.allowLeave);
  const from = (flow.state && flow.state !== 'naming') ? flow.state : 'menu';
  namingDone = onDone || (() => flow.go(from === 'finish' ? 'menu' : from));
  flow.go('naming');
};

// THE HERO PORTRAIT, in one place. The menu and the naming ceremony
// both show the player's melon at portrait size, and they must show
// the SAME melon — same seed-derived scale, colour, rind and species,
// same slow rate. Two copies of this drifted the moment one of them
// learned about the Shader Studio's design override.
// The same portrait, for a spec that is NOT the active melon (a prize
// being offered). Shares the rate and geometry so a won melon is
// presented exactly as the start screen presents yours.
function pushSpecPortrait(canvas, spec) {
  const M = window.FF.melon;
  const d = M.deriveSpec(spec);
  const F = window.FF.FRUITS.watermelon || {};
  const a = window.FF.CONFIG.semiMajor * d.scale * (F.sizeMult || 1);
  spinners.push({ rate: 0.55, canvas, angle: 0,
    a, b: a * (F.aspect || 0.78),
    color: d.bodyColor, patKey: d.patternKey, fruit: 'watermelon',
    decals: spec.decals || null });
}

function pushMelonPortrait(canvas) {
  const M = window.FF.melon;
  const d = M.deriveSpec(M.active());
  const design = window.FF.studio && window.FF.studio.design;
  const fruit = (design && design.fruit) || 'watermelon';
  const F = window.FF.FRUITS[fruit] || {};
  // Semi-major from CONFIG, not a hard-coded 46: the portrait must
  // track the same reference the sim uses if the tune panel moves it.
  const a = window.FF.CONFIG.semiMajor * d.scale * (F.sizeMult || 1);
  spinners.push({
    // The hero portrait turns slower than the results rows: it is
    // being looked AT, not glanced at.
    rate: 0.55,
    canvas, angle: 0,
    a, b: a * (F.aspect || 0.78),
    color: (design && design.color) || d.bodyColor,
    decals: M.active().decals || null,
    // d.patternKey ('m'+seed), NOT String(seed): the race body is
    // dressed with d.patternKey (main.js) and the award screen uses
    // it too, so a bare seed here generated a DIFFERENT rind — the
    // melon on the menu was not the melon on the track.
    patKey: (design && design.patKey) || d.patternKey,
    fruit,
  });
}

// ---- THE NAMING SCREEN -------------------------------------------
// Built from the START SCREEN'S OWN COMPONENTS (Eddie, 2026-08-14):
// same .ff-screen scrim, same .ff-panel, same head/body/foot
// contract, same .ff-title, the same portrait canvas classes, the
// same .ff-stat-row grammar and the same .ff-btn. The card it
// replaces predated type.js entirely — #111 panels, #fff titles,
// #9a9a9a labels and a PINK keep button, the only pink control in the
// game — so it read as a different product at the exact moment a new
// player forms their first impression.
//
// Two modes, one screen: the CEREMONY (first boot, headline varies)
// and RENAME (from the menu). They differ by a string and a starting
// value, which is not enough to justify two surfaces.
//
// STATS: species and weight only. The full card belongs to the start
// screen, where a player is choosing; here they are being handed one
// melon, and length is a number nobody needs before they have a name.
const NAMING_ROWS = ['species', 'weight'];
let elNaming = null;
let namingMode = 'ceremony';
// The prize rolled at cup completion, waiting to be told and (if the
// stable is full) resolved. Cleared once the player has seen it out.
// The spec being named by the 'award' mode: a prize is not the active
// melon, so the screen must be told which melon it is naming.
let namingAward = null;
let namingAllowLeave = false;
let namingDone = null;

function buildNaming() {
  const M = window.FF.melon;
  elNaming = el('div', 'ff-screen ff-naming-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  const title = el('h1', 'ff-title', '');
  const sub = el('p', 'ff-sub', '');
  head.appendChild(title); head.appendChild(sub);
  panel.appendChild(head);

  const bodyZone = el('div', 'ff-body');
  const row = el('div', 'ff-melon-row');
  const spin = el('canvas', 'ff-spin ff-portrait');
  spin.width = 560; spin.height = 560;
  row.appendChild(spin);
  bodyZone.appendChild(row);
  const statsEl = el('div', 'ff-stats');
  bodyZone.appendChild(statsEl);
  panel.appendChild(bodyZone);

  const foot = el('div', 'ff-foot');
  const input = el('input', 'ff-name-input');
  input.id = 'melon-name-input';
  input.maxLength = 24;
  input.placeholder = 'name your melon';
  input.autocomplete = 'off';
  const keep = el('button', 'ff-btn', 'KEEP');
  keep.id = 'melon-name-ok';
  const leave = el('button', 'ff-btn ff-quiet', 'leave it');
  leave.style.display = 'none';
  foot.appendChild(input);
  foot.appendChild(keep);
  foot.appendChild(leave);
  panel.appendChild(foot);
  elNaming.appendChild(panel);
  document.body.appendChild(elNaming);

  const finish = () => {
    const typed = input.value.trim();
    // WHICH IDENTITY is being named: the melon (a body) or the pilot
    // (you). One screen, one field, two destinations — the mode says
    // which, so neither can be written by accident.
    let out;
    if (namingMode === 'award' && namingAward) {
      // Name the PRIZE, which is its own spec — never the melon the
      // player is currently racing.
      namingAward.name = String(typed || M.UNNAMED_NAME).slice(0, 24);
      M._save && M._save();
      out = namingAward.name;
    } else if (namingMode === 'pilot') {
      out = M.renamePlayer(typed || M.playerName());
    } else {
      const cur = M.active();
      // Empty is not a wall and not a random identity: see melon.js.
      out = M.rename(typed || cur.name || M.UNNAMED_NAME);
    }
    const cb = namingDone; namingDone = null;
    if (cb) cb(out);
  };
  keep.addEventListener('click', finish);
  // Declining a prize: the callback is told with null, so the caller
  // can tell "left it" from "kept it" without inspecting the stable.
  leave.addEventListener('click', () => {
    const cb = namingDone; namingDone = null;
    if (cb) cb(null);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
  });

  elNaming._title = title;
  elNaming._sub = sub;
  elNaming._spin = spin;
  elNaming._stats = statsEl;
  elNaming._input = input;
  elNaming._leave = leave;
  elNaming._keep = keep;
  elNaming._refresh = () => {
    const design = window.FF.studio && window.FF.studio.design;
    const fruit = (design && design.fruit) || 'watermelon';
    const byKey = new Map();
    for (const r of (M.stats ? M.stats(M.active().seed, fruit, M.active().wide) : [])) byKey.set(r.key, r);
    const rows = [];
    for (const k of NAMING_ROWS) { const r = byKey.get(k); if (r) rows.push(r); }
    statsEl.textContent = '';
    for (const r of rows) {
      const line = el('div', 'ff-stat-row');
      line.appendChild(el('span', 'k', r.label));
      const v = el('span', 'v', r.value);
      if (r.note) v.appendChild(el('small', null, r.note));
      line.appendChild(v);
      statsEl.appendChild(line);
    }
  };
}

flow.register('menu', {
  enter() {
    // Scenery: a full grid of bots lapping today's daily behind the
    // panel. Started here and stopped on exit, so it can never
    // outlive the screen that owns it.
    if (window.FF.exhibition && exhibitionHooks) window.FF.exhibition.start(exhibitionHooks);
    clearFade();
    elMenu.style.display = 'flex';
    elMenu._refresh();
    spinners.length = 0;
    elMenu._paintPortrait();   // one definition of "paint the portrait"
    // Unrevealed rewards re-offer here: they are persisted facts, and
    // a crash or closed tab between earning and telling loses nothing
    // but the wait.
    if (window.FF.melon.pendingRewards().length) {
      runRewards(() => {});
    }
  },
  exit(to) {
    // Pressing RACE resets to a clean grid: you cannot be handed a
    // lap-two position you did not earn, so the exhibition is torn
    // down and a real race is built fresh (respawnFn below).
    //
    // ...BUT NOT WHEN THE NAMING SCREEN IS WHAT COVERS US. That screen
    // shows the very same exhibition through its scrim, so tearing it
    // down here and letting naming.enter() start it again REBUILT the
    // race — the field visibly jumped back to the grid every time a
    // player tapped to rename themselves. Leave it running and the
    // backdrop is continuous, which is the whole point of it.
    if (window.FF.exhibition && to !== 'naming') window.FF.exhibition.stop();
    elMenu.style.display = 'none';
  },
});

flow.register('race', {
  enter() {
    clearFade();          // a new race is never dimmed
    if (elPauseBtn) elPauseBtn.hidden = false;
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
  exit() { if (elPauseBtn) elPauseBtn.hidden = true; },
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
      elPause._restart.textContent = (!practiceMode && c && c.isRunning())
        ? 'RESTART CUP' : 'RESTART RACE';
    }
    elPause.style.display = 'flex';
  },
  exit() { elPause.style.display = 'none'; },
});

// A cup leg finishing is not the end of anything except that leg, so
// the finish screen behaves differently mid-cup: the standings become
// a POINTS TABLE and the action is NEXT RACE. Leaving mid-cup must be
// deliberate — abandoning records nothing at all — so MAIN MENU is
// demoted rather than offered as an equal choice.
function inCup() {
  return !practiceMode && window.FF.cup && window.FF.cup.isRunning();
}
function cupJustEnded() {
  return !practiceMode && window.FF.cup && window.FF.cup.isComplete();
}

// ---- THE REWARD CARDS ------------------------------------------------
// One overlay, reconfigured per entry. Sports-administration voice:
// the cards read like notices posted by an unseen governing body that
// takes melon racing entirely seriously. Tap anywhere: a tap during
// the bar animation completes it instantly; a tap after advances. The
// sequence must never cost a fast player more taps than it has cards.
let elReward = null;
let rewardAnim = null;      // { finish() } while the bar is animating

function buildRewardScreen() {
  elReward = el('div', 'ff-screen ff-reward-screen');
  const panel = el('div', 'ff-panel');
  elReward.appendChild(panel);
  elReward._panel = panel;
  document.body.appendChild(elReward);
}

function showRewardCard(entry, onAdvance) {
  if (!elReward) buildRewardScreen();
  const panel = elReward._panel;
  panel.textContent = '';
  elReward.style.display = 'flex';

  if (entry.kind === 'xp') paintXpCard(panel, entry);
  else paintDecalCard(panel, entry);

  // A REAL BUTTON. The quiet style is for the road not taken (QUIT
  // RACE beside CONTINUE RACE); this is the only road, so it gets the
  // standard button. The whole card still advances on tap — the
  // button is the visible affordance, not a smaller hit target.
  const foot = el('div', 'ff-reward-foot');
  foot.appendChild(el('button', 'ff-btn', 'CONTINUE'));
  panel.appendChild(foot);

  const advance = (ev) => {
    ev.preventDefault();
    if (rewardAnim) { rewardAnim.finish(); return; }   // first tap: skip anim
    elReward.removeEventListener('pointerdown', advance);
    window.removeEventListener('keydown', keyAdvance);
    elReward.style.display = 'none';
    onAdvance();
  };
  const keyAdvance = (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') advance(ev);
  };
  elReward.addEventListener('pointerdown', advance);
  window.addEventListener('keydown', keyAdvance);
}

function paintXpCard(panel, e) {
  const X = window.FF.xp;
  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'PILOT RECORD'));
  head.appendChild(el('p', 'ff-sub ff-reward-sub', 'official adjustment'));
  panel.appendChild(head);
  const big = el('div', 'ff-reward-big', '+0 XP');
  panel.appendChild(big);
  const stamp = el('div', 'ff-levelup-stamp', 'LEVEL UP');
  panel.appendChild(stamp);
  const track = el('div', 'ff-xp-track');
  const fill = el('div', 'ff-xp-fill');
  track.appendChild(fill);
  panel.appendChild(track);
  const line = el('div', 'ff-xp-line', '');
  panel.appendChild(line);

  // The bar animates the FACT (from -> to, wrapping at each level it
  // crossed); nothing here recomputes an award.
  const dur = Math.min(1200, 300 + 8 * (e.added || 0));
  const t0 = performance.now();
  let done = false;
  const setTo = (xpNow) => {
    const p = X.progress(Math.round(xpNow));
    fill.style.width = Math.round(100 * p.into / p.need) + '%';
    big.textContent = '+' + Math.round(xpNow - e.from) + ' XP';
    line.textContent = 'PILOT LEVEL ' + p.level + ' \u00b7 '
      + p.into + ' / ' + p.need + ' XP';
    if (p.level > e.levelFrom) stamp.classList.add('ff-stamped');
  };
  const finish = () => {
    if (done) return;
    done = true;
    rewardAnim = null;
    setTo(e.to);
  };
  rewardAnim = { finish };
  (function tick(now) {
    if (done) return;
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - (1 - t) * (1 - t);
    setTo(e.from + (e.to - e.from) * eased);
    if (t >= 1) { finish(); return; }
    requestAnimationFrame(tick);
  })(t0);
}

function paintDecalCard(panel, e) {
  const D = window.FF.decals;
  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'DECAL AWARDED'));
  head.appendChild(el('p', 'ff-sub ff-reward-sub',
    'issued at pilot level ' + e.level));
  panel.appendChild(head);
  const cv = el('canvas', 'ff-reward-art');
  cv.width = 176; cv.height = 176;
  const item = D.byId(e.id);
  if (item) D.paintArt(cv, item);
  panel.appendChild(cv);
  panel.appendChild(el('div', 'ff-reward-name', (e.label || e.id).toUpperCase()));
  panel.appendChild(el('div', 'ff-xp-line',
    '1 OF ' + e.setSize + ' \u00b7 ' + e.setLabel));
}

// Run the queue front-to-back. Melon entries hand off to the existing
// award ceremony (acceptance, possibly naming) and the runner resumes
// after it — but since melons queue last, 'resumes' is almost always
// 'finishes'.
function runRewards(next) {
  const M = window.FF.melon;
  const q = M.pendingRewards();
  if (!q.length) { next(); return; }
  const e = q[0];
  if (e.kind === 'melon') {
    M.shiftReward();
    openAwardFlow(e.award, () => runRewards(next));
    return;
  }
  showRewardCard(e, () => {
    M.shiftReward();                 // popped only after the tap-past
    runRewards(next);
  });
}

flow.register('finish', {
  enter() {
    // THE ONE CAREER WRITE. This is the only moment a race is
    // genuinely complete, and entering this state happens exactly once
    // per finish (flow.onFrame fires on the crossing tick and latches),
    // so the record can't double-count. Everything written comes from
    // the standings captured at the flag and the race book — no new
    // measurement, no second source of truth.
    const M = window.FF.melon;
    if (M && M.recordRace) {
      // The times were resolved during the settle beat (see
      // beginSettle): by here they are a fact, not a computation.
      const resolved = lastResolved;
      const rowsNow = computeStandings(stateRef, resolved);
      const mine = rowsNow.find(r => r.isPlayer);
      const rw = window.FF.raceWatch;
      const sum = (rw && rw.summary) ? rw.summary(stateRef) : {};
      if (mine) {
        // PRACTICE RECORDS NOTHING: it is how you learn the day's
        // terrain, not a result. Cup races record as races, exactly
        // as before the cup existed.
        if (!practiceMode) {
          M.recordRace({
            place: mine.pos,
            fieldSize: rowsNow.length,
            splats: sum.deaths || 0,
            bestLapTicks: (stateRef.race && stateRef.race.bestLapTicks) || null,
            distanceM: mine.x / 100,
            biggestSurvived: sum.biggestSurvived || 0,
          });
        }
        // XP BANKS AT THE LINE (5 per cup race finished — the law is
        // xp.js's). A DNF banks nothing; practice banks nothing. The
        // fact is written now; any telling of it waits for cup end.
        if (!practiceMode && window.FF.cup && window.FF.cup.current()
            && !mine.dnf && M.addXp && window.FF.xp) {
          M.addXp(window.FF.xp.XP_RACE);
        }
        if (!practiceMode && window.FF.cup && window.FF.cup.current()) {
          window.FF.cup.completeLeg({
            place: mine.pos,
            fieldSize: rowsNow.length,
            timeSec: mine.timeSec,
            dnf: !!mine.dnf,
            splats: sum.deaths || 0,
            standings: rowsNow,   // the whole field, for the points table
          });
          // A finished cup banks the attempt and the career record.
          if (window.FF.cup.isComplete()) {
            const done = window.FF.cup.finish();
            if (done && M.recordCup) {
              // done.place is the player's rank in the cup's own
              // points table — a fact, computed from every racer's
              // finishes, not an estimate from the player's score.
              M.recordCup({ place: done.place, points: done.totals.points });
            }
            // ---- THE PRIZE ----------------------------------------
            // Rolled HERE, at the same latched moment as the career
            // write, so it happens exactly once per completed cup and
            // cannot be re-rolled by revisiting a screen. The melon is
            // minted and persisted immediately (melon.js) — a player
            // who closes the tab between this screen and the menu keeps
            // what they won. What follows is only the telling of it.
            // Completion xp banks with the career write: the cup
            // bonus plus the points-become-xp law. The reveal card
            // carries a snapshot (from/to) so the bar it animates is
            // the fact as it happened, not a re-derivation later.
            if (done && M.addXp && window.FF.xp) {
              const X = window.FF.xp;
              const cupState = window.FF.cup.current() || {};
              const from = (typeof cupState.xpStart === 'number')
                ? cupState.xpStart : M.pilotXp();
              M.addXp(X.XP_CUP + X.XP_PER_POINT * (done.totals.points | 0));
              const to = M.pilotXp();
              M.queueReward({ kind: 'xp', from, to, added: to - from,
                levelFrom: X.levelFor(from), levelTo: X.levelFor(to) });
              // Every level crossed fires its roll NOW — the sticker
              // is granted and persisted here; the card only tells it.
              M.settleLevelRolls();
            }
            if (done && M.awardForCup) {
              const award = M.awardForCup({
                day: (window.FF.cup.current() || {}).day,
                attempt: (done.record && done.record.attempts) || 1,
                place: done.place,
              });
              // Won melons join the queue like everything else —
              // last, per the ruling: the showstopper closes the
              // sequence because it chains into acceptance and naming.
              if (award && award.won) {
                M.queueReward({ kind: 'melon', award });
              }
            }
          }
        }
      }
    }
    // Hand the melon over: the field keeps racing behind the panel.
    // Solo only — in netplay peers exchange inputs, so substituting
    // local AI would desync the session (netplay bypasses these
    // screens anyway; the guard is belt and braces).
    if (window.FF.autopilot) window.FF.autopilot.engage(stateRef, { netplay: !!netplayFn && netplayFn() });
    if (elFinish._paintPrizeButtons) elFinish._paintPrizeButtons();
    elFinish.style.display = 'flex';
    const rows = elFinish._rows;
    rows.textContent = '';
    spinners.length = 0;
    for (const r of computeStandings(stateRef, lastResolved)) {
      const row = el('div', 'ff-row' + (r.isPlayer ? ' ff-you' : ''));
      // Ordinal, with the suffix styled small: the NUMBER is the
      // thing you read across the room.
      const pos = el('div', 'ff-pos', String(r.pos));
      pos.appendChild(el('span', 'ff-ord', ordinalSuffix(r.pos)));
      row.appendChild(pos);
      const c = el('canvas', 'ff-spin');
      c.width = 104; c.height = 104; // hint; syncCanvasSize owns it
      row.appendChild(c);
      const nm = racerIdentity(r.name, r.pilot, r.isPlayer);
      nm.appendChild(el('div', 'ff-rtime', r.dnf ? 'DNF' : fmtTime(r.timeSec)));
      row.appendChild(nm);
      rows.appendChild(row);
      clearCanvas(c);
      spinners.push({ canvas: c, angle: r.pos * 0.7, a: r.a, b: r.b,
        color: r.color, patKey: r.patKey, fruit: r.fruit, decals: r.decals });
    }
    fillFacts();
    fillSummary();
    const cupping = !practiceMode && window.FF.cup && window.FF.cup.current();
    // After the places rows: both tabs push into the same spinner
    // list, which is emptied once at the top of enter().
    fillCup();
    // Mid-cup the standings that matter are the CUP's, so that tab
    // leads; a single race still opens on its own result.
    setCupMode(!!cupping, cupping && window.FF.cup.isComplete());
    if (elFinishNote) {
      const c = window.FF.cup;
      if (practiceMode) {
        elFinishNote.textContent = 'practice \u00b7 nothing recorded';
      } else if (c && c.isComplete()) {
        const rec = c.dayRecord();
        const t = c.totals();
        elFinishNote.textContent = 'cup complete \u00b7 ' + t.points + ' pts'
          + (rec && rec.attempts > 1
            ? '  \u00b7  best ' + rec.bestPoints + ' in ' + rec.attempts + ' tries'
            : '');
      } else if (c && c.current()) {
        elFinishNote.textContent = 'race ' + c.current().leg + ' of ' + c.LEGS;
      } else {
        elFinishNote.textContent = '';
      }
      elFinishNote.style.display = elFinishNote.textContent ? '' : 'none';
    }
    if (elFinishTitle) {
      elFinishTitle.textContent = (!practiceMode && window.FF.cup && window.FF.cup.isComplete())
        ? 'CUP COMPLETE' : 'FINISH';
    }
    showTab(cupping ? 'cup' : 'places');
    startSpinners();
  },
  exit() {
    clearFade();
    if (window.FF.autopilot) window.FF.autopilot.disengage();
    // Release the tab-scoped pause: it is meaningless once this
    // screen is gone, and leaving it set froze the next screen's
    // spinners.
    spinnersPaused = false;
    elFinish.style.display = 'none';
  },
});

function showTab(key) {
  const panes = elFinish._panes, btns = elFinish._tabBtns;
  for (const k of Object.keys(panes)) {
    const on = (k === key);
    panes[k].classList.toggle('on', on);
    btns[k].classList.toggle('on', on);
    // The state the eye reads and the state the screen reader reads
    // are set in the same breath, so they cannot drift.
    btns[k].setAttribute('aria-selected', on ? 'true' : 'false');
  }
  // Spinners live in the PLACES and CUP panes; a hidden canvas would
  // keep the rAF loop alive for nothing, and isConnected cannot see
  // display:none.
  // SCOPED TO THIS SCREEN: leaving the finish on the RACE or YOU tab
  // used to strand this flag as true, so the menu's portrait never
  // animated and simply showed whatever pixels the canvas still held
  // from before the race — a stale bitmap, stretched by CSS, which
  // reads exactly like "low fidelity and won't rotate".
  // A tab change reveals canvases that have never been measured, and
  // hides others; force a remeasure on the next frame.
  spinMeasureAt = 0;
  for (const s of spinners) s.box = null;
  spinnersPaused = !(key === 'places' || key === 'cup');
  if (!spinnersPaused) startSpinners();
}

// ---- The CUP tab: the points table, and what it is for ----------
function fillCup() {
  const box = elFinish._cupTable;
  box.textContent = '';
  const c = window.FF.cup;
  if (!c || !c.current()) return;
  const rows = c.table();
  const t = c.totals();
  const legs = c.current().leg;
  const head = el('div', 'ff-cup-head',
    c.isComplete() ? 'FINAL \u00b7 ' + t.points + ' pts'
      : 'AFTER ' + legs + ' OF ' + c.LEGS + '  \u00b7  ' + t.points + ' pts');
  box.appendChild(head);

  // THE PRIZE, ANNOUNCED WHERE THE DAY'S RESULT IS STATED. The award
  // is a consequence of the placing, so it is told in the moment of
  // triumph and HANDED OVER on the way out (see the MAIN MENU
  // handler): a beat of anticipation between learning and receiving,
  // which is the shape a prize wants. A blocked award says so rather
  // than showing nothing, because winning and receiving nothing looks
  // like a bug.
  // THE FINISH SCREEN ANNOUNCES NOTHING (ruled 2026-08-15). It is
  // performance feedback — positions, points, the truth of the race.
  // Rewards are already granted and queued; their telling begins when
  // the player chooses to leave, one card per reward. (The old
  // dailyCap notice died with the announcement: a blocked award is no
  // reward, and no reward gets no card.)

  // SAME SHAPE AS THE PLACES TAB. A cup standing is a standing: the
  // player reads it the same way, so it gets the same tiered ordinal,
  // the same rotating body, and the same quiet second line. Only the
  // CONTENT differs — points and cumulative time instead of one
  // race's finish. (The rows live in their own container so the
  // podium's :nth-child tiering counts rows, not the heading above
  // them.)
  const list = el('div', 'ff-rows ff-cup-rows');
  box.appendChild(list);

  // The cup's cast is fixed for all four legs, so a racer's
  // appearance can be looked up from this race's standings by name —
  // no second source of truth for what a melon looks like.
  const look = new Map();
  for (const s of computeStandings(stateRef, lastResolved)) {
    look.set(s.key, s);
  }

  for (const r of rows) {
    const key = r.key;
    const s = look.get(key);
    const row = el('div', 'ff-row' + (r.isPlayer ? ' ff-you' : ''));
    const pos = el('div', 'ff-pos', String(r.pos));
    pos.appendChild(el('span', 'ff-ord', ordinalSuffix(r.pos)));
    row.appendChild(pos);
    const cv = el('canvas', 'ff-spin');
    cv.width = 104; cv.height = 104;   // hint; syncCanvasSize owns it
    row.appendChild(cv);
    const nm = racerIdentity(r.isPlayer ? (s ? s.name : 'YOU') : r.name, r.pilot, r.isPlayer);
    nm.appendChild(el('div', 'ff-rtime',
      r.points + ' pts  \u00b7  ' + (r.dnfs ? fmtTime(r.timeSec) + '  \u00b7  ' + r.dnfs + ' DNF' : fmtTime(r.timeSec))));
    row.appendChild(nm);
    list.appendChild(row);
    clearCanvas(cv);
    if (s) {
      spinners.push({ canvas: cv, angle: r.pos * 0.7, a: s.a, b: s.b,
        color: s.color, patKey: s.patKey, fruit: s.fruit, decals: s.decals });
    }
  }
}

// Which face is the finish screen wearing?
function setCupMode(cupping, complete) {
  const showCupTab = !!cupping;
  elFinish._tabBtns.cup.style.display = showCupTab ? '' : 'none';
  // Mid-cup: NEXT RACE. Cup over, or a practice race: RETRY / MENU.
  const mid = cupping && !complete;
  elFinish._cupBtns.style.display = mid ? '' : 'none';
  elFinish._btns.style.display = mid ? 'none' : '';
}

// ---- The RACE tab: superlatives over the whole field -------------
function fillFacts() {
  const box = elFinish._facts;
  box.textContent = '';
  const rw = window.FF.raceWatch;
  const facts = (rw && rw.fieldSummary) ? rw.fieldSummary() : [];
  if (!facts.length) {
    box.appendChild(el('div', 'ff-empty', 'a quiet race — nothing to report'));
    return;
  }
  for (const f of facts) {
    const row = el('div', 'ff-fact');
    row.appendChild(el('div', 'ff-fact-l', f.label));
    const right = el('div', 'ff-fact-r');
    right.appendChild(el('div', 'ff-fact-n', f.name));
    right.appendChild(el('div', 'ff-fact-v', f.value));
    row.appendChild(right);
    box.appendChild(row);
  }
}

// ---- The race summary -------------------------------------------
// The finish screen is the one place stats can be DENSE: nothing is
// competing for attention and the race is over. racewatch keeps the
// book during the race (it is the module that already knows race
// context); this only lays it out. Stats that didn't happen are
// omitted rather than shown as zeroes — a wall of 0s reads as
// failure, and an empty slot reads as "not this time".
function fillSummary() {
  const box = elFinish._summary;
  box.textContent = '';
  const rw = window.FF.raceWatch;
  if (!rw || !rw.summary) return;
  const s = rw.summary(stateRef);
  // SAME SHAPE AS THE RACE TAB: label left, value right, one row each
  // (the three-across stat grid put the label under the number, so
  // the two tabs read as different screens). Sharing the row markup
  // means a change to one is a change to both.
  const stat = (v, k, note, hi) => {
    const row = el('div', 'ff-fact');
    row.appendChild(el('div', 'ff-fact-l', k));
    const right = el('div', 'ff-fact-r');
    const n = el('div', 'ff-fact-n' + (hi ? ' hi' : ''), String(v));
    right.appendChild(n);
    if (note) right.appendChild(el('div', 'ff-fact-v', note));
    row.appendChild(right);
    box.appendChild(row);
  };
  // Order kept: the result first, then the flare story, then the rest.
  if (s.bestLapSec !== null) stat(s.bestLapSec.toFixed(1) + 's', 'BEST LAP');
  stat(String(s.deaths), s.deaths === 1 ? 'SPLAT' : 'SPLATS',
    s.deaths === 0 ? 'not a scratch' : null, s.deaths === 0);
  if (s.overtakes) stat(String(s.overtakes), 'OVERTAKES',
    s.passedBy ? s.passedBy + ' passed you' : null);
  if (s.flareSaves) stat(String(s.flareSaves), s.flareSaves === 1 ? 'FLARE SAVE' : 'FLARE SAVES',
    'lives the flare bought', true);
  if (s.biggestSurvived) stat(String(s.biggestSurvived), 'BIGGEST HIT SURVIVED');
  if (s.bestAirSec >= 1) stat(s.bestAirSec.toFixed(1) + 's', 'BEST AIR');
  if (s.longestStreakM >= 100) stat(s.longestStreakM + 'm', 'LONGEST CLEAN RUN');
  if (s.flarePct) stat(s.flarePct + '%', 'TIME FLARED',
    s.deadPct ? s.deadPct + '% dead-sticked' : null);
}

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
  buildMenu();
  buildNaming();
  buildFinish();
  buildPause();
  initHistory();
  initAutoPause();
  elMenu.style.display = 'none';
  elNaming.style.display = 'none';
  elFinish.style.display = 'none';
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
flow._spinners = () => spinners.map(s => ({
  a: +s.a.toFixed(2), color: s.color, patKey: s.patKey, fruit: s.fruit,
  decals: (s.decals || []).length }));
flow.computeStandings = computeStandings;
window.FF.flow = flow;
})();