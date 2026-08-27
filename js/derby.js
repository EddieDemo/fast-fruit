// DERBY — Demolition Derby, stage 2 of the ruled plan (2026-08-26):
// THE ARENA. This delivery is wiring — bowl geometry, the provider,
// the spawn law, a placement-capable session entry, the minimal
// registered brain (a wall-turnaround reflex, ruled as wiring, not
// AI), and the metric SHELL whose datum arrives with stage 3.
//
// NOT HERE YET (later stages, in ruled order): elimination (no
// conveyor — stage 3), kill attribution (fatal-blow with 3 s assist
// window, reading lastContactBody/Tick breadcrumbs — stage 3), the
// partycup leg adapter + `derby:over` announcement (stage 4), real
// derby AI (deferred by ruling — the brain below is deliberately
// dumb), and the death-camera chain linger -> grudge -> manual.
//
// SEPARATION, on the skijump pattern: this module owns the ARENA (a
// pure provider), the SPAWN LAW, its brain and its metric; the
// session chassis owns the clock; the world door owns the build.
// Nothing here touches physics.js.
(function () {
'use strict';
const G = typeof window !== 'undefined' ? window : globalThis;
G.FF = G.FF || {};
const FF = G.FF;

// ---- THE ARENA LAW (all px; 100 px = 1 m; y-down, floor at 0) -----
// Ruled 2026-08-26: large shallow bowl, ~120 m rim to rim (Eddie:
// 100-200, the call landed at 120 = ~7.5 viewport-widths — runway
// enough to build launch speed, dense enough that twelve bodies
// meet). A symmetrical centre ramp: up, a RAISED FLAT PLATEAU (ruled:
// not a trough), down — head-ons happen ABOVE the deck. Edges curve
// gently into vertical walls (quarter-pipes): melons cannot leave.
// NUMBERS ARE TUNABLE, NOT RULED — the harness owns the taste pass.
const ARENA = {
  HALF: 6000,          // rim to rim = 120 m
  PLATEAU_HALF: 600,   // raised deck: 12 m wide...
  PLATEAU_H: 500,      // ...5 m above the floor
  RAMP_DEG: 25,        // ramp grade
  FILLET: 220,         // lip/foot arc radius — sampled, never a crease
  WALL_R: 800,         // quarter-pipe radius into the vertical
  WALL_H: 2400,        // wall crown height above the floor (24 m).
                       // Floor bound held analytically by the suite
                       // (crown > vtop^2/2g); the VERDICT is raced —
                       // no body crosses 60% of it in a full derby.
  DS: 40,              // arc sample step (the skijump crease lesson:
                       // clamped/coarse arcs read as phantom creases)
};

// ---- Geometry -----------------------------------------------------
// Build the RIGHT half from the plateau centre outward, then mirror.
// Symmetry is therefore BIT-EXACT BY CONSTRUCTION — the suite holds
// it as law, so a future hand-edit to one side cannot ship silently.
function rightHalf(A) {
  const th = A.RAMP_DEG * Math.PI / 180;
  const pts = [];
  const push = (x, y) => pts.push({ x, y });

  // 1. Plateau deck: centre to the lip fillet's start.
  const lipStart = A.PLATEAU_HALF - A.FILLET * Math.sin(th);
  push(0, -A.PLATEAU_H);
  push(lipStart, -A.PLATEAU_H);

  // 2. LIP: convex fillet, slope 0 -> +grade (y-down: downhill is
  // +dy). Centre sits below the deck surface (+y). Fillets sample at
  // 12px, not DS — the suite's crease guard caught 8.33-degree steps
  // at DS=40 on first run (the skijump lesson, live).
  const nLip = Math.max(8, Math.ceil((A.FILLET * th) / 12));
  for (let i = 1; i <= nLip; i++) {
    const p = th * (i / nLip);
    push(lipStart + A.FILLET * Math.sin(p),
      -A.PLATEAU_H + A.FILLET * (1 - Math.cos(p)));
  }

  // 3. Straight ramp: whatever drop the two fillets do not cover.
  const filletDrop = A.FILLET * (1 - Math.cos(th));
  const straightDrop = A.PLATEAU_H - 2 * filletDrop;
  const lipEndX = pts[pts.length - 1].x;
  const lipEndY = pts[pts.length - 1].y;
  const footArcStartX = lipEndX + straightDrop / Math.tan(th);
  push(footArcStartX, lipEndY + straightDrop);

  // 4. FOOT: concave fillet, +grade -> 0, landing exactly on y = 0.
  for (let i = 1; i <= nLip; i++) {
    const p = th * (1 - i / nLip);   // th -> 0
    push(footArcStartX + A.FILLET * (Math.sin(th) - Math.sin(p)),
      -A.FILLET * (1 - Math.cos(p)));
  }

  // 5. Flat floor to the quarter-pipe's base.
  const footX = pts[pts.length - 1].x;
  const pipeBaseX = A.HALF - A.WALL_R;
  push(pipeBaseX, 0);

  // 6. QUARTER-PIPE: floor tangent to vertical (the tracks.js bowl
  // parameterisation), sampled at DS.
  const nPipe = Math.max(6, Math.ceil((A.WALL_R * (Math.PI / 2)) / A.DS));
  for (let i = 1; i <= nPipe; i++) {
    const p = (Math.PI / 2) * (i / nPipe);
    push(pipeBaseX + A.WALL_R * Math.sin(p), -A.WALL_R * (1 - Math.cos(p)));
  }

  // 7. Vertical wall to the crown.
  push(A.HALF, -A.WALL_H);

  pts.footX = footX;         // spawn law reads these bounds
  pts.pipeBaseX = pipeBaseX;
  return pts;
}

function buildArena() {
  const R = rightHalf(ARENA);
  const pts = [];
  // Mirror: left side is the right side reversed with x negated — the
  // y values are THE SAME FLOATS, which is what bit-exact means.
  for (let i = R.length - 1; i >= 1; i--) pts.push({ x: -R[i].x, y: R[i].y });
  for (let i = 0; i < R.length; i++) pts.push({ x: R[i].x, y: R[i].y });
  // Arc length, accumulated — the template convention.
  let s = 0;
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    s += Math.sqrt(dx * dx + dy * dy);
    pts[i].s = s;
  }
  return { pts, footX: R.footX, pipeBaseX: R.pipeBaseX, law: ARENA };
}

// ---- Provider (the skijump shape: finite, static, no periods) -----
function provider(arena, seed) {
  return {
    period: null,
    seed: (seed || 0) >>> 0,  // race.seed adopts this: hour, sky, moon
    get pts() { return arena.pts; },
    polys() { return [arena.pts]; },
    rev: 0,
    reset() {},
    update() {},
  };
}

// ---- THE SPAWN LAW ------------------------------------------------
// Ruled: half the field starts on the far LEFT flat, half on the far
// RIGHT, packs facing each other across the plateau. Seeded: pack
// membership (which side the player draws), order within packs, and
// a small x-jitter. Deterministic per seed — same seed, same grid.
function spawnSlots(seed, count, arena) {
  const rng = FF.mulberry32(((seed >>> 0) ^ 0xDE4B) >>> 0);
  const A = arena.law;
  const n = count || 12;
  const per = Math.floor(n / 2);
  const GAP = 300;                       // > 2*semiMajor: no overlap at rest
  const inner = arena.footX + 500;       // packs live on the FLATS:
  const outer = arena.pipeBaseX - 400;   // clear of foot and pipe
  const packSpan = (per - 1) * GAP;
  const packOuter = Math.min(outer, inner + packSpan + 900);
  const slots = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < per; i++) {
      const jitter = Math.floor((rng() - 0.5) * 80);
      // Outermost slot first: the pack stacks from the wall inward.
      const x = side * (packOuter - i * GAP + jitter);
      slots.push({ x, side });
    }
  }
  // Seeded assignment: shuffle WHICH slot each canonical body index
  // draws (player is index 0 — some days you start left, some right).
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = slots[i]; slots[i] = slots[j]; slots[j] = t;
  }
  return slots;
}

// The placement law handed to the world door (sessionOpts.place):
// runs at build, after the grid ceremony's default line, before the
// session captures respawn anchors — so "your spot" is your PACK spot.
function makePlace(seed) {
  return function place(bodies, state) {
    const arena = _arena;
    const slots = spawnSlots(seed, bodies.length, arena);
    const semiMinor = (FF.CONFIG && FF.CONFIG.semiMinor) || 36;
    for (let i = 0; i < bodies.length; i++) {
      const m = bodies[i], sl = slots[i % slots.length];
      m.x = sl.x;
      m.y = -semiMinor - 60;   // a short drop onto the flat
      m.vx = 0; m.vy = 0; m.omega = 0; m.angle = 0;
      m.derbyKills = 0;        // the schema (see above): born here
      m.derbyDmgTaken = 0;
    }
    // THE BRAIN SWAP (ruled shape 1, 2026-08-26): the MODE assigns
    // the discipline's brain at build; the roster keeps naming each
    // character's RACING brain. 'derby' is registered below — and
    // pilot.create's fallback-to-cruise means this line was legal
    // even before it was. Brain FAMILIES (per-character derby
    // personalities) are the explored-later option, on record.
    if (state && state.bots && FF.pilot && FF.pilot.create) {
      for (const b of state.bots) {
        b.brainName = 'derby';
        b.brain = FF.pilot.create('derby');
      }
    }
  };
}

// ---- THE WIRING BRAIN (not the AI — that stays deferred) ----------
// Cruise's whole policy is "hold right forever"; in a pen that ends
// pinned against the right wall. The one reflex wiring needs: drive
// toward the centre you spawned facing, and when the wall has held
// you stalled for ~3/4 s, turn around. Targeting, ramp timing and
// avoidance are the LATER, ruled-deferred work.
if (FF.pilot && FF.pilot.register) {
  FF.pilot.register('derby', () => {
    let dir = 0, stall = 0;
    return {
      name: 'derby',
      drive(m) {
        if (dir === 0) dir = m.x > 0 ? -1 : 1;   // face the arena
        if (m.vx * dir < 30) stall++; else stall = 0;
        if (stall > 90) { dir = -dir; stall = 0; }   // the turnaround
        return { axis: dir, bounce: 0 };
      },
      save() { return { dir, stall }; },
      load(s) { if (s) { dir = s.dir || 0; stall = s.stall || 0; } },
    };
  });
}

// ---- THE METRIC SHELL ---------------------------------------------
// The session chassis ranks by metric; derby's is KILLS. The adapter
// is registered NOW so the chassis contract is honest end to end; the
// DATUM (m.derbyKills, written by stage 3's fatal-blow attribution
// law) is all zeros this stage — ranks are placeholder until then,
// and the suite says so out loud.
if (FF.session && FF.session.registerMetric) {
  FF.session.registerMetric({
    id: 'derby.kills',
    sample(state, m) { return m.derbyKills || 0; },
    better(a, b) { return a > b; },
    format(v) { return v + ' KO'; },
  });
}

// ---- THE SCHEMA (declared at the mode's own build door) -----------
// derbyKills and derbyDmgTaken are MODE fields; physics never reads
// them (the C5 law stands). They are declared in place() below — NOT
// through the observer reset door, and the reason is a finding: that
// door fires inside reviveIfDue, and under permadeath NO body ever
// revives, so an observer-declared schema would never exist in
// exactly the mode that needs it. place() runs for every body at
// world build, before tick one: from birth, for real.

// ---- THE ATTRIBUTION LAW (ruled: fatal blow with assist window) ---
// At the tick a body dies (the chassis tick sees it the same sim
// tick — the hook runs inside the fixed step, after physics):
//   * pairSeverity > 0 this tick  -> a melon was in the fatal
//     contact: the breadcrumb partner takes the kill.
//   * else, breadcrumb within the ASSIST WINDOW -> a shove finished
//     by terrain: the shover takes it.
//   * older than the window -> an environment death; nobody scores.
// Ruled edges: mutual head-ons credit BOTH (each is the other's
// breadcrumb); posthumous kills stand (the dead can score);
// self-kills are impossible (the breadcrumb is never self).
const ASSIST_TICKS = 3 * 120;   // the ruled ~3 s window

// ---- THE ELIMINATION TICK -----------------------------------------
// Registered as the session's customer law (sessionOpts.onTick).
// Deterministic: runs inside the fixed step, reads only sim state.
// Ends the derby at last-alive; the chassis clock ends it at 2:00 —
// whichever comes first. announceData carries the final placements
// out through the named moment ('derby:over').
function makeTick() {
  let keys = null, wasAlive = null, deathTick = null;
  return function derbyTick(state, s) {
    const bodies = [state.players[0].melon].concat(state.bots.map((b) => b.melon));
    if (!keys) {
      keys = bodies.map((m) => FF.racerKey(m));
      wasAlive = bodies.map((m) => !!m.alive);
      deathTick = bodies.map(() => Infinity);
    }
    let alive = 0;
    for (let i = 0; i < bodies.length; i++) {
      const m = bodies[i];
      // The damage ledger (the survivor tiebreak): per-step severity
      // fields are zeroed at the top of each step, so post-step they
      // hold exactly this tick's hurt.
      if (m.alive) m.derbyDmgTaken += (m.hitSeverity || 0) + (m.pairSeverity || 0);
      if (wasAlive[i] && !m.alive) {
        deathTick[i] = state.tick;
        const fatalWasMelon = (m.pairSeverity || 0) > 0;
        const fresh = m.lastContactIdx >= 0
          && (state.tick - m.lastContactTick) <= ASSIST_TICKS;
        if (fatalWasMelon || fresh) {
          // The breadcrumb is a canonical index — bodies[] here IS
          // canonical order, and the index cannot collide or lie.
          const killer = bodies[m.lastContactIdx];
          if (killer && killer !== m) killer.derbyKills += 1;
        }
      }
      wasAlive[i] = !!m.alive;
      if (m.alive) alive++;
    }
    s.announceData = placements(bodies, keys, deathTick);
    if (alive <= 1 && !s.over) FF.session.end(state);
  };
}

// ---- THE PLACEMENT LAW (ruled chains) -----------------------------
// Survivors above the dead. Survivor ties (timer expiry): kills,
// then LEAST DAMAGE TAKEN, then the racerKey floor (stated-
// arbitrary, deterministic). Least-damage SUBSTITUTES the originally
// proposed "remaining toughness" — retracted 2026-08-26: damage is
// cluster-scoped (clusterE resets at cluster close), no persistent
// HP exists to remain. Same spirit, honestly computable. The dead:
// later death first, then kills, then the floor.
function placements(bodies, keys, deathTick) {
  const rows = bodies.map((m, i) => ({
    key: keys[i], idx: i, name: m.name || '?', pilot: m.pilot || '',
    alive: !!m.alive, deathTick: deathTick[i],
    kills: m.derbyKills || 0, dmgTaken: m.derbyDmgTaken || 0,
  }));
  rows.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) {
      if (b.kills !== a.kills) return b.kills - a.kills;
      if (a.dmgTaken !== b.dmgTaken) return a.dmgTaken - b.dmgTaken;
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return a.idx - b.idx;   // the true floor: total even when
    }                          // names collide (the '?' lesson)
    if (a.deathTick !== b.deathTick) return b.deathTick - a.deathTick;
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.idx - b.idx;
  });
  rows.forEach((r, i) => { r.place = i + 1; });
  return { placements: rows };
}

// ---- Entry --------------------------------------------------------
const DUR_TICKS = 2 * 60 * 120;   // ruled: two minutes, counted in
                                  // sim ticks, never wall clock

let _arena = null;

// One source of truth for the session opts: start() (browser, via
// the world door) and _begin() (suites, chassis directly) build the
// SAME session — a divergence here would test a session nobody runs.
function sessionOpts(seed, opts) {
  return {
    metric: 'derby.kills',
    durTicks: (opts && opts.durTicks) || DUR_TICKS,
    // DEATHS ARE PERMANENT (ruled): the conveyor's dial at Infinity.
    respawnDelayTicks: Infinity,
    place: makePlace(seed),
    onTick: makeTick(),
    announce: 'derby:over',
  };
}

function start(opts) {
  const seed = (opts && opts.seed) || ((Date.now() / 1000) & 0x7fffffff);
  _arena = buildArena();
  FF.world.buildSession('Derby', provider(_arena, seed), sessionOpts(seed, opts), {});
  if (FF.flow) FF.flow.go('race');
}

// THE EVENT ADAPTER: derby speaks the party cup's leg contract.
// A SESSION event: over when the chassis says so (clock or
// last-alive — both set session.over); standings from the derby's
// own placement law, which onTick keeps current through the final
// tick. bestStr is the kill count — the same datum the metric ranks.
if (FF.partycup && FF.partycup.registerEvent) {
  FF.partycup.registerEvent({
    id: 'derby',
    start,
    isOver: (st) => !!(st && st.session && st.session.over),
    standings(st) {
      const bodies = [st.players[0].melon].concat(st.bots.map((b) => b.melon));
      const pd = st.session && st.session.announceData;
      const rows = (pd && pd.placements ? pd.placements : []).map((r) => ({
        key: r.key,
        name: bodies[r.idx] ? (bodies[r.idx].name || '?') : r.name,
        pilot: r.pilot,
        isPlayer: r.idx === 0,
        place: r.place,
        bestStr: r.kills + ' KO',
      }));
      // No sort: placements() is the ONE producer and emits in place
      // order by its own G-held law — a defensive re-sort here was
      // vacuous (mutation M18 could not make it matter) and dead
      // code is not a safety net.
      return rows;
    },
  });
}

FF.derby = {
  start,
  ARENA,
  ASSIST_TICKS,
  _buildArena: buildArena,
  _spawnSlots: spawnSlots,
  _provider: provider,
  _sessionOpts: sessionOpts,
  _setArena: (a) => { _arena = a; },
  _placements: placements,
};
})();
