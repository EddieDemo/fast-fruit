// proto-serpentine: the first serpentine ever laid. Three tiers, two
// C-TURNS (continuous valley curves through vertical — the fold
// machinery's polyline, the ny>0 rule unchanged, self-clearing by
// gravity). Hand-laid, no generator changes: this rig exists to
// answer ONE question before any architecture is committed — what
// does a 12-body field do at a MANDATORY turnaround?
//   run A: naive field, no brake calls (worst case)
//   run B: the wall discipline on the RIGHT turn (bots brake);
//          the LEFT turn stays naive — tier 2 riders carry -vx and
//          the current wallAxis only brakes +vx, which is itself a
//          finding for the heading-aware rework.
'use strict';
const H = require('./harness.js');
const FF = H.FF;
const C = FF.CONFIG;

const R = 560;                       // C-turn radius: tier gap = 2R
const TIER = 6500;

function layWorld(withEntries) {
  // RULING 2026-08-18 (Eddie): the serpentine is CHAINED GALLERY
  // SWITCHBACKS, bypassable turns, shipped semantics verbatim
  // (spec s16, option a). Topology per terrain.js kind==='sw': the
  // PRIMARY BYPASSES (a pocket cannot host the through-line) and
  // every tier/turnaround is an s-anchored BRANCH over the bypass
  // floor, which doubles as the safety net — the proto's whole
  // freefall-leak class is structurally absent.
  //
  // One addition forced by nesting arithmetic: turn 2 nests ~1300 px
  // LEFT of the entry lip, so the primary's chute FOLDS — it
  // descends leftward under the approach (v1 fold at the lip),
  // putting the washboard under the entire chain. Free consequence:
  // the gallery's fork semantics — make the entry jump = ride the
  // serpentine; miss = land on the chute = the express bypass.
  //
  // Plan constants: shipped switchPlan mid-range draws, fixed (the
  // proto is one deterministic template). Derivations verbatim.
  const lipX0 = -100;                 // lip x, known pre-lay (the
                                      // nesting solver needs it for
                                      // the tilt-credit spans)
  const mDrop = 65, demand = 1200, chuteG = 2.0, D = TIER;
  const span = demand / Math.sqrt(1200 / mDrop);      // ~279
  const u = 150, step = 450, apronLen = 500, gApr = 0.045;
  const C1 = 450, C2 = 450, washAmp = 20, washWl = 360;
  const gAup = 0.035, gB = 0.075, gFl = 0.035;
  const aLen2 = 2400;                 // transfer ramp: its upslope does
                                      // the meter's speed-bleed job
                                      // (1450 shed 7 hot riders off
                                      // bowl 2's curl tip to the
                                      // floor at lethal severity)
  const bowlR2 = Math.max(580, (step + aLen2 * gAup + 140) / 1.2418 + 40);
  // aLen SOLVED from the serpentine nesting inequality (the shipped
  // derivation generalised): the WHOLE chain — turn 2's leftmost
  // bowl reach included — must nest right of the chute foot, else
  // the chute diagonal crosses the chain (the shipped bug verbatim;
  // measured here: 66 px corridor jammed deck A2 riders). Iterated
  // because the chain's depth (hence fDrop, hence the foot) depends
  // on aLen through deck A's rise.
  const s104 = Math.sin(104 * Math.PI / 180);
  const turn2reach = span + aLen2 + u + apronLen + s104 * bowlR2;
  let aLen = D + 4000;
  let fDrop = 0;
  for (let it = 0; it < 4; it++) {
    const chainDrop = mDrop - aLen * gAup + step + u * gApr + C1
      + D * gB + mDrop - aLen2 * gAup + step + u * gApr + C1
      + (D + 900) * gB + C2;
    // the floor's own rightward tilt is credit: the C2 constraint
    // binds at deck C's far END, and the floor has descended
    // gFl * (span to there) by then. Omitting it dug the chute 300
    // deeper than the law requires — foot arrivals ran ~10% hot and
    // the washboard's first crest killed 10 of 12 at the landing.
    const cEndXest = (lipX0 + span + aLen - u + 15 - D) - span - aLen2
      + u - 15 + D + 900;
    const footEst = lipX0 + (chainDrop / chuteG);
    fDrop = chainDrop - Math.max(0, (cEndXest - footEst)) * gFl;
    // bLx - chainMinX = span + aLen2 + u + apronLen - u - 15 ... use
    // the direct geometric identity: bLx = lip + span + aLen - u + 15
    // - D; chainMinX = bLx - (span + aLen2 - u + apronLen + s104*R2).
    // the foot's true extent includes the ease + landing-run legs
    const easeDrop = 300 * (1.5 + 1.0 + 0.55 + 0.3);
    const need = (fDrop - easeDrop) / chuteG + 1200 + 700
      + (span + aLen2 - u + apronLen + s104 * bowlR2)
      + 180 + D - span + u - 15;
    aLen = need;
  }
  const bowlR = Math.max(580, (step + aLen * gAup + 140) / 1.2418 + 40);

  const cur = FF.terrainLaws.makeCursor(-2800, 0);
  cur.chunkKind = 'runway';
  cur.flat(1400);
  cur.chunkKind = 'slope';
  cur.leg(1300, 60);
  const lipX = cur.x, lipY = cur.y;   // the serpentine's entry lip

  // ---- chain geometry, pure arithmetic (lay after the primary) ----
  const aEnY = lipY + mDrop;
  const daX0 = lipX + span;
  const capX = daX0 + aLen, capY = aEnY - aLen * gAup;
  const aprY = capY + step;
  const aprL = capX - u, aprR = aprL + apronLen;
  const aprYL = aprY + u * gApr;
  const by0 = aprY - (apronLen - u) * gApr;
  const bRx = aprL + 15, bY = aprYL + C1;
  const bLx = bRx - D, bLy = bY + D * gB;
  // turn 2, mirrored, entered by the deck-B launch (geometric jump)
  const aEn2Y = bLy + mDrop;
  const da2X0 = bLx - span;
  const cap2X = da2X0 - aLen2, cap2Y = aEn2Y - aLen2 * gAup;
  const aprY2 = cap2Y + step;
  const aprL2 = cap2X + u, aprR2 = aprL2 - apronLen;
  const aprYL2 = aprY2 + u * gApr;
  const by02 = aprY2 - (apronLen - u) * gApr;
  const cRx = aprL2 - 15, cY = aprYL2 + C1;
  const cEndX = cRx + D + 900, cEndY = cY + (D + 900) * gB;
  const chainMinX = aprR2 - s104 * bowlR2;

  // ---- PRIMARY: the bypass, shipped orientation ----
  // (v1 note: a LEFTWARD-folded chute crossed the chain — a diagonal
  // spanning all depths cannot avoid left-nested structures. The
  // chute runs RIGHT under high deck A per shipped; failed entry
  // jumps land on it: same fork semantics, correct orientation.)
  // hand-eased foot + flat landing run before the pricing starts —
  // the raw chute-to-crest kink launched terminal arrivals into
  // lethal hop landings (11 deaths raw, 6 with a short ease, target
  // 0-1 at standing-start feed).
  const easeDrop = 300 * (1.5 + 1.0 + 0.55 + 0.3);
  const chuteRun = (fDrop - easeDrop) / chuteG;
  cur.leg(chuteRun, fDrop - easeDrop);
  cur.leg(300, 300 * 1.5);
  cur.leg(300, 300 * 1.0);
  cur.leg(300, 300 * 0.55);
  cur.leg(300, 300 * 0.3);
  cur.leg(700, 700 * gFl);
  if (chainMinX < cur.x + 50) throw new Error('chain crosses the chute foot');
  const bowlFar = aprR + s104 * bowlR;
  let sExit = null;
  const washLeg = (dx, dy) => {
    const x0 = cur.x, s0 = cur.pts[cur.pts.length - 1].s;
    cur.leg(dx, dy);
    const s1v = cur.pts[cur.pts.length - 1].s;
    if (sExit === null && x0 <= cEndX && cur.x > cEndX) {
      sExit = s0 + (s1v - s0) * (cEndX - x0) / (cur.x - x0);
    }
  };
  while (cur.x < bowlFar + 320) {
    washLeg(washWl * 0.5, -washAmp + washWl * 0.5 * gFl);
    washLeg(washWl * 0.5, washAmp + washWl * 0.5 * gFl);
  }
  if (sExit === null) sExit = cur.pts[cur.pts.length - 1].s;
  cur.leg(500, 500 * gFl);
  const finX = cur.x - 300, finY = cur.y;

  // ---- BRANCH CHAIN, s back-propagated from sExit ----
  const arc2 = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  // deck C (+1): tier 3
  const dc = [{ x: cRx, y: cY, k: 'sw' }, { x: cEndX, y: cEndY, k: 'sw' }];
  const arcC = arc2(dc[0], dc[1]);
  dc[0].s = sExit - arcC; dc[1].s = sExit;
  cur.branches.push(dc);
  // apron 2 (+1 rightward drive: the mirrored turnaround) + bowl 2
  const ap2 = [
    { x: aprR2, y: by02, k: 'sw' },
    { x: cap2X - 30, y: aprY2 - 30 * gApr, k: 'sw' },
    { x: aprL2, y: aprYL2, k: 'sw' },
  ];
  {
    let acc = 0; const cum = [0];
    for (let i = 1; i < ap2.length; i++) { acc += arc2(ap2[i - 1], ap2[i]); cum.push(acc); }
    for (let i = 0; i < ap2.length; i++) ap2[i].s = (sExit - arcC) - (acc - cum[i]);
  }
  cur.branches.push(ap2);
  const bw2 = [];
  for (let i = 0; i <= 13; i++) {
    const th = (i / 13) * (104 * Math.PI / 180);
    bw2.push({ x: aprR2 - Math.sin(th) * bowlR2,
      y: by02 - (1 - Math.cos(th)) * bowlR2, k: 'sw' });
  }
  cur.branches.push(bw2);             // UNANNOTATED (the shipped lesson:
                                      // annotating parked half a field)
  // deck A2 (-1): the transfer ramp, cap continuous with apron 2
  const da2 = [{ x: da2X0, y: aEn2Y, k: 'sw' }, { x: cap2X, y: cap2Y, k: 'sw' }];
  const arcA2 = arc2(da2[0], da2[1]);
  da2[0].s = ap2[1].s - arcA2; da2[1].s = ap2[1].s;
  // the mirrored meter: turn 1's wall discipline held its tip-sheds
  // to one; unmetered turn 2 shed seven (the discipline is
  // travelDir-aware post-rework, so the leftward wall works)
  da2.entry = { kind: 'sw', lipX: bLx, lipY: bLy, farX: da2X0,
    demand: 0, wallX: aprR2 };
  cur.branches.push(da2);
  // deck B (-1): tier 2; its bLx launch continues into the jump
  const db = [{ x: bRx, y: bY, k: 'sw' }, { x: bLx, y: bLy, k: 'sw' }];
  const arcB = arc2(db[0], db[1]);
  db[1].s = da2[0].s - span; db[0].s = db[1].s - arcB;
  cur.branches.push(db);
  // apron 1 (-1) + bowl 1
  const ap = [
    { x: aprR, y: by0, k: 'sw' },
    { x: capX + 30, y: aprY - 30 * gApr, k: 'sw' },
    { x: aprL, y: aprYL, k: 'sw' },
  ];
  {
    let acc = 0; const cum = [0];
    for (let i = 1; i < ap.length; i++) { acc += arc2(ap[i - 1], ap[i]); cum.push(acc); }
    for (let i = 0; i < ap.length; i++) ap[i].s = db[0].s - (acc - cum[i]);
  }
  cur.branches.push(ap);
  const bw1 = [];
  for (let i = 0; i <= 13; i++) {
    const th = (i / 13) * (104 * Math.PI / 180);
    bw1.push({ x: aprR + Math.sin(th) * bowlR,
      y: by0 - (1 - Math.cos(th)) * bowlR, k: 'sw' });
  }
  cur.branches.push(bw1);
  // deck A1 (+1): tier 1, entry meter per shipped
  const da = [{ x: daX0, y: aEnY, k: 'sw' }, { x: capX, y: capY, k: 'sw' }];
  const arcA = arc2(da[0], da[1]);
  da[0].s = ap[1].s - arcA; da[1].s = ap[1].s;
  da.entry = { kind: 'sw', lipX, lipY, farX: daX0, demand, wallX: aprR };
  cur.branches.push(da);

  const terrain = [cur.pts];
  for (const b of cur.branches) terrain.push(b);
  return { terrain, lipX, lipY, finX, finY,
    daX0, capX, capY, aprR, by0, bRx, bY, bLx, bLy,
    da2X0, cap2X, aprR2, by02, cRx, cY, cEndX, cEndY, bowlR, bowlR2 };
}

function runField(label, withEntries) {
  const W = layWorld(withEntries);
  const st = FF.createState();
  st.terrain = W.terrain;
  st.period = null;
  st.spine = FF.trackSpace.metricSpine(0, null, st.terrain);
  FF.resetPlayers(st, 1, 0, 0, -C.semiMinor - 200, true);
  const field = H.DEFAULT_ROSTER;
  const saved = C.botRoster;
  C.botRoster = field;
  FF.resetBots(st, field.length, 0, -C.semiMinor - 200, (0x5E4 ^ 0x51ED) >>> 0, 1);
  C.botRoster = saved;
  st.input.rawAxis = 1; st.input.rawBounce = 0;
  const bodies = [st.melon].concat(st.bots.map((b) => b.melon));
  bodies.forEach((m, i) => { m.pilot = 'R' + String(i).padStart(2, '0'); });

  const yB = (x) => W.bY + (W.bRx - x) * (W.bLy - W.bY) / (W.bRx - W.bLx);
  const yC = (x) => W.cY + (x - W.cRx) * (W.cEndY - W.cY) / (W.cEndX - W.cRx);
  const deathLog = [];
  const rec = bodies.map(() => ({
    fin: null, deaths: 0, wasAlive: true, rodeB: false, rodeC: false,
    jam1: 0, jam2: 0,
  }));
  const world = FF.slab.worldFor(st.terrain);
  const HZ = 120;
  let backoff = 0;
  for (let t = 0; t < HZ * 200; t++) {
    // player rig: steer toward travel + human wall-wiggle
    {
      const m = st.melon;
      const prj = world.project ? world.project(m.x, m.y) : null;
      let ax = prj ? prj.dirX : 1;
      if (backoff > 0) { ax = -ax; backoff--; }
      else if (m.grounded && Math.abs(m.vx) < 35 && t % 120 === 0) backoff = 45;
      st.input.rawAxis = ax;
    }
    FF.step(st, 1 / HZ);
    let done = 0;
    for (let i = 0; i < bodies.length; i++) {
      const m = bodies[i], r = rec[i];
      if (r.wasAlive && !m.alive) {
        r.deaths++;
        if (deathLog.length < 25) deathLog.push(Math.round(m.x) + '/' + Math.round(m.y));
      }
      r.wasAlive = m.alive;
      if (!r.rodeB && m.x > W.bLx && m.x < W.bRx - 500
        && Math.abs(m.y - yB(m.x)) < 220) r.rodeB = true;
      if (!r.rodeC && m.x > W.cRx + 500 && m.x < W.cEndX
        && Math.abs(m.y - yC(m.x)) < 220) r.rodeC = true;
      // jam accounting in the two turnaround pockets
      if (Math.abs(m.vx) < 60 && Math.abs(m.vy) < 60) {
        if (m.x > W.aprR - 900 && m.x < W.aprR + W.bowlR + 200
          && m.y > W.capY - 300 && m.y < W.bY + 300) r.jam1++;
        if (m.x > W.aprR2 - W.bowlR2 - 200 && m.x < W.aprR2 + 900
          && m.y > W.by02 - 900 && m.y < W.cY + 300) r.jam2++;
      }
      if (r.fin === null && m.x > W.finX) r.fin = t;
      if (r.fin !== null) done++;
    }
    if (done === bodies.length) break;
  }
  const fins = rec.filter((r) => r.fin !== null);
  const serp = rec.filter((r) => r.rodeC);
  console.log(label + ': fin ' + fins.length + '/' + bodies.length
    + '  serpentine ' + serp.length + ' / bypass ' + (fins.length - serp.length)
    + '  deaths ' + rec.reduce((a, r) => a + r.deaths, 0)
    + (deathLog.length ? '  at ' + deathLog.join(' ') : '')
    + '  worstJam ' + Math.max(...rec.map((r) => Math.max(r.jam1, r.jam2))) + 't');
  return { W, rec };
}

if (require.main === module) {
  runField('serpentine A (entries)', true);
}
