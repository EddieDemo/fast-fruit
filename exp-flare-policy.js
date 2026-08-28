// ============================================================
// EXPERIMENT — is the flare a mastery curve? (2026-08-27)
//
// THE QUESTION: under the REAL input geometry — input.js clamps
// |(axis, bounce)| <= 1 radially, so drive and flare compete for one
// thumb's deflection — do three policies separate in pace and
// survival?
//
//   NEVER    pure drive, flare never touched (the beginner)
//   HELD     a static diagonal: permanent partial flare, permanent
//            partial throttle (the naive "bouncy is safer" player)
//   TIMED    full drive; flick to the minimum surviving flare only
//            when a lethal landing is committed (the skilled player)
//            — this is the shipped 'oracle' brain's policy
//
// WHY IT MATTERS: if TIMED clearly beats both, the skill gap is real
// and the remaining work is legibility. If HELD ties TIMED, the
// timing window is too forgiving. If NEVER ties everything, the
// flare is decoration.
//
// THE MEASUREMENT HAZARD THIS EXISTS TO AVOID: a previous sweep
// varied CONFIG.restitution, handing bots high bounce WHILE holding
// full drive — an input no thumb can produce. It "proved" a dominant
// strategy that does not exist. Every policy here is radially
// clamped, exactly as input.js clamps a real stick.
// ============================================================
'use strict';

global.window = global.window || {};
global.window.FF = global.window.FF || {};
const H = require('./harness.js');
const FF = global.window.FF;
const P = FF.pilot;

// The thumb: no policy may exceed the gamut. Same maths as
// input.js recompute().
function thumb(axis, bounce) {
  const mag = Math.hypot(axis, bounce);
  if (mag > 1) { axis /= mag; bounce /= mag; }
  return { axis, bounce };
}

// NEVER — the beginner: all budget on drive.
P.register('p_never', () => {
  const base = P.create('cruise');
  return {
    name: 'p_never',
    drive(m, ctx) {
      const d = base.drive(m, ctx);
      return thumb(d.axis, 0);
    },
    save() { return base.save ? base.save() : null; },
    load(s) { if (base.load) base.load(s); },
  };
});

// HELD — the naive player: a permanent diagonal. Costs drive on
// every tick, buys bounce on every tick.
function heldFactory(frac) {
  return () => {
    const base = P.create('cruise');
    return {
      name: 'p_held' + frac,
      drive(m, ctx) {
        const d = base.drive(m, ctx);
        // Keep the drive DIRECTION, spend `frac` of budget upward.
        const dir = d.axis >= 0 ? 1 : -1;
        return thumb(dir * Math.sqrt(Math.max(0, 1 - frac * frac)), frac);
      },
      save() { return base.save ? base.save() : null; },
      load(s) { if (base.load) base.load(s); },
    };
  };
}
P.register('p_held3', heldFactory(0.3));
P.register('p_held6', heldFactory(0.6));

// TIMED — the skilled player. NOT the shipped oracle: that brain also
// carries its own route logic (send-vs-brake calls), so racing it
// against cruise compares ROUTE strategies and the flare's effect is
// confounded. This is cruise's exact driving with ONE addition — the
// flick — so the flare is the only variable in the experiment.
const RE_ASK = 10;
function timedFactory(margin) {
  return () => {
    const base = P.create('cruise');
    let held = 0, ask = 0;
    return {
      name: 'p_timed' + margin,
      drive(m, ctx) {
        const d = base.drive(m, ctx);
        const grounded = m.hitSeverity > 0 || (m.airTicks || 0) === 0;
        if (grounded) { held = 0; ask = 0; return thumb(d.axis, 0); }
        // Airborne: ask the ring what the committed landing will do,
        // on the same cadence the shipped oracle uses.
        if (ask <= 0) {
          ask = RE_ASK;
          const pred = P.predictSplat(ctx.state, m, false, {
            rawAxis: d.axis, torqueAxis: d.axis, rawBounce: 0, bounceAxis: 0,
          });
          if (pred && pred.splat) {
            const D = FF.damage;
            const need = D.restitutionToSurvive(pred.worst, pred.T,
              D.bodyRestitution(m));
            // The MINIMUM flare that survives, plus a safety margin:
            // least deflection spent = most drive kept (the circular
            // budget is why "minimum" is also "fastest").
            held = need === null ? 1
              : Math.min(1, D.restitutionToBounce(need) + margin);
          } else held = 0;
        }
        ask--;
        return thumb(d.axis, held);
      },
      save() { return base.save ? base.save() : null; },
      load(s) { if (base.load) base.load(s); },
    };
  };
}
P.register('p_timed', timedFactory(0.05));
P.register('p_sloppy', timedFactory(0.35));   // a human-ish over-flare

// ---- the field: one policy under test, ten identical rivals -------
// The rivals are plain cruise so the policy is the ONLY variable;
// the tested body sits at roster index 0.
function fieldFor(policy) {
  const r = [{ species: 'watermelon', brain: policy }];
  for (let i = 0; i < 10; i++) r.push('watermelon');
  return r;
}

const POLICIES = ['p_never', 'p_held3', 'p_held6', 'p_timed', 'p_sloppy'];
const SEEDS = H.SWEEP_SEEDS.slice(0, 12);

console.log('policy      finish(s)  deaths  maxImpact  finished');
console.log('----------------------------------------------------');
const summary = {};
for (const pol of POLICIES) {
  let tSum = 0, tN = 0, dSum = 0, impSum = 0, finN = 0;
  for (const seed of SEEDS) {
    const r = H.runRace(seed, fieldFor(pol), 3);
    const me = r.racers[0];
    if (me.finished) { tSum += me.timeSec; tN++; finN++; }
    dSum += me.deaths;
    impSum += me.maxImpact || 0;
  }
  const avgT = tN ? (tSum / tN) : NaN;
  summary[pol] = { avgT, deaths: dSum / SEEDS.length };
  console.log(pol.padEnd(11)
    + (tN ? avgT.toFixed(1) : '  DNF').padStart(8)
    + (dSum / SEEDS.length).toFixed(2).padStart(9)
    + Math.round(impSum / SEEDS.length).toString().padStart(11)
    + (finN + '/' + SEEDS.length).padStart(10));
}

console.log('');
const base = summary.p_never;
for (const pol of POLICIES) {
  if (pol === 'p_never') continue;
  const s = summary[pol];
  const dt = ((base.avgT - s.avgT) / base.avgT * 100);
  const dd = base.deaths ? ((base.deaths - s.deaths) / base.deaths * 100) : 0;
  console.log(pol + ' vs never: ' + (dt >= 0 ? '+' : '') + dt.toFixed(1)
    + '% pace, ' + (dd >= 0 ? '-' : '+') + Math.abs(dd).toFixed(0) + '% deaths');
}
