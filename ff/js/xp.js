// XP — the pilot's progression law. PURE: this file stores nothing,
// draws nothing, and knows nothing about screens. melon.js holds the
// pilot's total; everything else is derived from it through these
// functions, so a level can never drift from the XP that justifies it.
//
// THE LAW (ruled 2026-08-15). Three earnings, all visible arithmetic:
//   * XP_RACE per race FINISHED — banks at each finish line, so an
//     abandoned cup still pays for the races actually run.
//   * XP_CUP for completing every leg — matching the cup's own rule
//     that an attempt only counts when whole.
//   * XP_PER_POINT per cup point — your points BECOME xp, a law the
//     player can verify in their head. Points are the skill signal
//     (13-minus-place per race).
//
// RETUNED FOR THE THREE-LEG CUP (2026-08-15): XP_RACE went 5 -> 7 so
// the pacing claims survived the cut. A completed cup pays 34 to a
// back-marker (the same floor the four-leg cup had) and 67 to a
// sweep — a 2.0x spread — with a median cup (~20 pts) paying 51,
// which keeps the first level (50) inside a median player's first
// cup. Numbers verified in verify-xp.js against the real cup
// arithmetic, not remembered.
//
// THE CURVE: advancing FROM level L costs min(XP_BASE + XP_RAMP*(L-1),
// XP_CAP). Early levels land fast (the first inside a median player's
// first cup), then the cost flattens at XP_CAP — one level per ~3 cups
// forever. The cap is not generosity: a level-up is a decal roll, and
// an unbounded curve would quietly starve late players of the thing
// levels are FOR.
//
// The pilot's stored fact is TOTAL CAREER XP, one integer. Level is
// derived, never stored. Integer arithmetic throughout.
(function () {
'use strict';

const XP_RACE = 7;        // per race finished
const XP_CUP = 10;        // per cup completed (every leg)
const XP_PER_POINT = 1;   // per cup point, banked at cup end

const XP_BASE = 50;       // cost of level 1 -> 2
const XP_RAMP = 25;       // each level costs this much more...
const XP_CAP = 200;       // ...until here, forever after

// Cost to advance FROM level L (L >= 1).
function costFrom(level) {
  return Math.min(XP_BASE + XP_RAMP * (level - 1), XP_CAP);
}

// Level for a career total. Level 1 at 0 xp; walks the curve — the
// cap makes this O(total/XP_CAP), trivial forever.
function levelFor(totalXp) {
  let lvl = 1, spent = 0;
  for (;;) {
    const c = costFrom(lvl);
    if (spent + c > totalXp) return lvl;
    spent += c;
    lvl++;
  }
}

// Progress within the current level, for the bar: how far in, and how
// long this level is.
function progress(totalXp) {
  let lvl = 1, spent = 0;
  for (;;) {
    const c = costFrom(lvl);
    if (spent + c > totalXp) {
      return { level: lvl, into: totalXp - spent, need: c };
    }
    spent += c;
    lvl++;
  }
}

// XP earned by a cup in a given state. racesFinished counts legs the
// pilot crossed the line in; completed means every leg was RUN (the
// cup's own definition); points is the cup total, which only
// banks when the cup completes — half a cup's points are not yet a
// cup result.
function cupXp(racesFinished, completed, points) {
  let xp = XP_RACE * (racesFinished | 0);
  if (completed) xp += XP_CUP + XP_PER_POINT * (points | 0);
  return xp;
}

window.FF = window.FF || {};
window.FF.xp = {
  XP_RACE, XP_CUP, XP_PER_POINT, XP_BASE, XP_RAMP, XP_CAP,
  costFrom, levelFor, progress, cupXp,
};

})();
