// sweep-races.js — the SWEEP report (spec §5/§6).
//
//   node sweep-races.js capture <file.json>     run the pinned sweep, save it
//   node sweep-races.js compare <a.json> <b.json>  judge b against a
//
// THE COMPARISON IS BIT-EXACT BY DESIGN. The harness names racers so
// that racerKey lexicographic order equals canonical body order, which
// makes the stage 1 contact-order law's pair sequence identical to the
// pre-law spawn-order sequence — so on flat-equivalent tracks (every
// track today: one strand, top face only reachable) the slab build is
// not "within tolerance" of the baseline, it is THE SAME TRAJECTORIES.
// compare therefore demands identical path hashes per racer per seed,
// and only reports distributions as corroborating colour. If bit
// identity ever has to be relinquished (a future stage moving the
// laws), this file is where that becomes an explicit, argued decision.
'use strict';
const fs = require('fs');
const H = require('./harness.js');

const mode = process.argv[2];

if (mode === 'capture') {
  const out = process.argv[3] || 'sweep.json';
  const t0 = Date.now();
  const s = H.sweep(H.SWEEP_SEEDS, null, 3);
  const report = {
    capturedAt: new Date().toISOString(),
    wallSec: Math.round((Date.now() - t0) / 100) / 10,
    seeds: s.seeds,
    laps: s.laps,
    agg: s.agg,
    races: s.races.map((r) => ({
      seed: r.seed, ticks: r.ticks, deathsByKind: r.deathsByKind, racers: r.racers,
    })),
  };
  // times array is bulky and derivable; keep the summary stats only
  delete report.agg.times;
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log('sweep captured -> ' + out + '  (' + report.wallSec + 's wall)');
  console.log('  finished ' + s.agg.finished + '/' + (s.agg.finished + s.agg.dnf)
    + '  stuck ' + s.agg.stuck + '  deaths ' + s.agg.deaths
    + '  meanT ' + (s.agg.meanTime ? s.agg.meanTime.toFixed(1) : '-')
    + '  medianT ' + (s.agg.medianTime ? s.agg.medianTime.toFixed(1) : '-'));
  for (const r of report.races) {
    const fin = r.racers.filter((x) => x.finished).length;
    const stuck = r.racers.filter((x) => x.stuck).length;
    const d = r.racers.reduce((a, x) => a + x.deaths, 0);
    console.log('  seed ' + r.seed + '  fin ' + fin + '/12  stuck ' + stuck + '  deaths ' + d);
  }
  process.exit(0);
}

if (mode === 'compare') {
  const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
    if (!ok) failures++;
  };
  check('same experiment: seeds and laps match',
    JSON.stringify(a.seeds) === JSON.stringify(b.seeds) && a.laps === b.laps);
  let bitOk = true, mism = [];
  for (let i = 0; i < a.races.length; i++) {
    const ra = a.races[i], rb = b.races.find((r) => r.seed === ra.seed);
    if (!rb) { bitOk = false; mism.push(ra.seed + ':missing'); continue; }
    for (let j = 0; j < ra.racers.length; j++) {
      const xa = ra.racers[j], xb = rb.racers[j];
      if (!xb || xa.pathHash !== xb.pathHash) {
        bitOk = false; mism.push(ra.seed + '/' + xa.key);
      }
    }
  }
  check('BIT IDENTITY: every racer\'s path hash identical, every seed', bitOk,
    bitOk ? a.races.length + ' races x ' + a.races[0].racers.length + ' racers'
      : 'first mismatches: ' + mism.slice(0, 5).join(' '));
  // Corroborating colour (implied by bit identity, but printed so a
  // failure is legible in racing terms rather than only in hashes):
  const line = (t) => 'fin ' + t.agg.finished + '  stuck ' + t.agg.stuck
    + '  deaths ' + t.agg.deaths + '  meanT '
    + (t.agg.meanTime ? t.agg.meanTime.toFixed(2) : '-');
  console.log('  A: ' + line(a));
  console.log('  B: ' + line(b));
  check('distributions: finish, stuck and death totals identical',
    a.agg.finished === b.agg.finished && a.agg.stuck === b.agg.stuck
    && a.agg.deaths === b.agg.deaths);
  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

console.log('usage: node sweep-races.js capture <out.json> | compare <a.json> <b.json>');
process.exit(2);
