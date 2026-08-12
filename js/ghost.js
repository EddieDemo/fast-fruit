// ============================================================
// GHOST — the challenge link and the two-tier ghost system.
//
// TIER 1 — THE SHARED GHOST (lives in a URL):
//   seed/track + finish time + splits + the racer's cast name + a
//   coarse distance trace (track position at 1Hz, delta-encoded).
//   ~800 chars: fits in any messenger. Renders as a translucent
//   rival rolling the surface at the recorded pace with a live
//   +/- gap on its nameplate. Position-over-time IS the ghost in a
//   game about being ahead.
//
// TIER 2 — THE LOCAL GHOST (localStorage):
//   your own best run at high fidelity (x, y, angle every 2 ticks)
//   for personal time-attack. No URL constraint, no compromise.
//
// A run is (track, time): determinism does the rest. Everything here
// is presentation-side — recording reads state, playback draws — the
// sim never knows ghosts exist. Dormant in multiplayer (the rivals
// are real there).
//
// Share format: #g= + base64url(JSON{v,t,ms,n,sp,d}) where d is the
// per-second distance delta in 4px (4cm) units.
// ============================================================

(function () {
'use strict';

const { CONFIG, terrainYAt } = window.FF;

const SAMPLE_TICKS = 120;      // 1Hz coarse trace for the share code
const LOCAL_EVERY = 2;         // full-fidelity local ghost cadence
const DELTA_UNIT = 4;          // 4px = 4cm resolution in the code

// ---- Recording state ----
let rec = null;      // active recording { startTick, coarse:[], frames:[] }
// FROZEN, not stopped: after the flag the autopilot drives the body,
// and a ghost that kept sampling would have you racing a lap you did
// not drive. But the finish-edge block below still has to run — it is
// what builds lastRun, offers the challenge and saves a best — so
// this only gates the SAMPLING, never the bookkeeping. (Clearing rec
// outright silently lost the save.)
let recFrozen = false;
let lastRun = null;  // finished run, ready to share
let prevFinished = false;

// ---- Playback state ----
let challenge = null; // decoded shared ghost { name, ms, coarse:[], ... }
let localGhost = null; // full-fidelity best { ms, frames:[] }

// ---- Encoding ----
function b64url(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); }

function encodeRun(run) {
  const deltas = [];
  for (let i = 1; i < run.coarse.length; i++) {
    deltas.push(Math.round((run.coarse[i] - run.coarse[i - 1]) / DELTA_UNIT));
  }
  return b64url(JSON.stringify({
    v: 1,
    t: run.track,
    ms: run.timeTicks,
    n: run.name || '',
    m: run.melonSeed || 0, // the runner's melon: friends race GERALD
    sp: run.splits,
    d: deltas,
  }));
}

function decodeCode(code) {
  try {
    const o = JSON.parse(unb64url(code));
    if (o.v !== 1 || !Array.isArray(o.d)) return null;
    const coarse = [0];
    for (const d of o.d) coarse.push(coarse[coarse.length - 1] + d * DELTA_UNIT);
    return { track: o.t, timeTicks: o.ms, name: o.n || 'A RIVAL', melonSeed: o.m || 0, splits: o.sp || [], coarse };
  } catch (_) { return null; }
}

// ---- Lifecycle (driven from main) ----
function onRaceStart(state) {
  if (state.race.mode !== 'track' || state.players.length > 1) { rec = null; return; }
  rec = { startTick: state.tick, track: null, coarse: [0], frames: [] };
  prevFinished = false;
  recFrozen = false; // a new race records again
  // Load the local best for this track lazily at each race start.
  loadLocalGhost(currentTrackName(state));
}

function currentTrackName(state) {
  // The race carries lap config, not the name; recover it from FF.modes'
  // active provider via main's exposed label if present, else default.
  return (window.FF.currentModeName && window.FF.currentModeName()) || 'Track 1';
}

function update(state) {
  if (!rec || state.race.mode !== 'track' || state.players.length > 1) return;
  const elapsed = state.tick - rec.startTick;
  const dist = state.melon.x - state.raceStartX;

  if (!recFrozen) {
    // Coarse trace: one sample per second of race time.
    while (rec.coarse.length <= Math.floor(elapsed / SAMPLE_TICKS)) {
      rec.coarse.push(Math.round(dist));
    }
    // Full-fidelity local frames.
    if (elapsed % LOCAL_EVERY === 0) {
      const m = state.melon;
      rec.frames.push(Math.round(m.x), Math.round(m.y), Math.round(m.angle * 100) / 100);
    }
  }

  // Finish edge: freeze the run, offer the challenge, save if best.
  const finished = state.race.finishedTick !== null;
  if (finished && !prevFinished) {
    const track = currentTrackName(state);
    lastRun = {
      track,
      timeTicks: state.race.finishedTick - state.raceStartTick,
      name: state.melon.name || '',
      melonSeed: (window.FF.melon && window.FF.melon.active().seed) || 0,
      splits: state.race.splits.slice(),
      coarse: rec.coarse.slice(),
      frames: rec.frames.slice(),
    };
    saveIfBest(lastRun);
    showChallengeButton();
  }
  prevFinished = finished;
}

// ---- Local best persistence ----
function bestKey(track) { return 'pf-best-' + track; }

function saveIfBest(run) {
  try {
    const cur = JSON.parse(localStorage.getItem(bestKey(run.track)) || 'null');
    if (cur && cur.ms <= run.timeTicks) return;
    localStorage.setItem(bestKey(run.track), JSON.stringify({
      ms: run.timeTicks, n: run.name, f: run.frames,
    }));
    localGhost = { ms: run.timeTicks, name: run.name, frames: run.frames };
  } catch (_) { /* storage full or unavailable: local ghost is a luxury */ }
}

function loadLocalGhost(track) {
  try {
    const cur = JSON.parse(localStorage.getItem(bestKey(track)) || 'null');
    localGhost = cur ? { ms: cur.ms, name: cur.n, frames: cur.f } : null;
  } catch (_) { localGhost = null; }
}

// ---- Ghost sampling ----
function coarsePos(coarse, elapsed) {
  const t = elapsed / SAMPLE_TICKS;
  const i = Math.floor(t);
  if (i >= coarse.length - 1) return coarse[coarse.length - 1];
  return coarse[i] + (coarse[i + 1] - coarse[i]) * (t - i);
}

function framePos(frames, elapsed) {
  const idx = Math.floor(elapsed / LOCAL_EVERY);
  const n = frames.length / 3;
  const i = Math.min(idx, n - 1) * 3;
  return { x: frames[i], y: frames[i + 1], angle: frames[i + 2] };
}

// ---- Rendering (called by renderer inside the world pass) ----
function draw(ctx, state, cam, toScreenX, toScreenY, zoom) {
  if (state.race.mode !== 'track' || state.players.length > 1) return;
  const elapsed = state.tick - state.raceStartTick;
  const period = state.period;

  // Shared challenge ghost: surface-rolling pace marker.
  if (challenge) {
    const dist = coarsePos(challenge.coarse, elapsed);
    const wx = state.raceStartX + dist;
    drawGhostAt(ctx, state, cam, toScreenX, toScreenY, zoom, wx, null, null,
      challenge.name, dist, period, '#ffffff', challenge.melonSeed);
  }

  // Local best ghost: full-fidelity replay (skip if a challenge is
  // running — one ghost at a time keeps the track readable).
  if (!challenge && localGhost && localGhost.frames.length >= 3) {
    const f = framePos(localGhost.frames, elapsed);
    drawGhostAt(ctx, state, cam, toScreenX, toScreenY, zoom, f.x, f.y, f.angle,
      'BEST', f.x - state.raceStartX, period, '#9fdf9f');
  }
}

function drawGhostAt(ctx, state, cam, toScreenX, toScreenY, zoom, wx, wy, angle, label, dist, period, color, melonSeed) {
  // Nearest image to the camera.
  let gx = wx, gy = wy;
  if (period) {
    const k = Math.round((wx - cam.x) / period.L);
    if (k !== 0) { gx -= k * period.L; if (gy !== null) gy -= k * period.D; }
  }
  // The ghost wears its owner's physique: scale from the melon seed
  // (old codes without a seed render at 1.0 — back-compatible).
  const gd = melonSeed ? window.FF.melon.derive(melonSeed) : null;
  const gs = gd ? gd.scale : 1;
  const a = CONFIG.semiMajor * gs, b = CONFIG.semiMinor * gs;
  let gAngle = angle;
  if (gy === null) {
    // Coarse ghost: ride the surface, fake a rolling angle from distance.
    const sy = terrainYAt(state.terrain, gx);
    if (sy === null) return;
    gy = sy - b - 0.5;
    gAngle = (wx / ((a + b) / 2)) % (Math.PI * 2);
  }
  const sx = toScreenX(gx), syy = toScreenY(gy);

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.translate(sx, syy);
  ctx.scale(zoom, zoom);
  // Same sun as the living: a lit ghost reads as a RACER, not a marker.
  if (window.FF.shadeEllipse) {
    window.FF.shadeEllipse(ctx, gAngle, a, b, color, gd ? gd.patternKey : label);
  } else {
    ctx.rotate(gAngle);
    ctx.beginPath();
    ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();

  // Nameplate with the live gap: + means the ghost is ahead.
  const gap = (dist - (state.melon.x - state.raceStartX)) / 100;
  const gapTxt = (gap >= 0 ? '+' : '\u2212') + Math.abs(gap).toFixed(0) + 'm';
  const surfY = terrainYAt(state.terrain, gx);
  if (surfY !== null) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.font = '400 11px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(`${label} ${gapTxt}`, sx, toScreenY(surfY) + 48);
    ctx.restore();
  }
}

// ---- Share UI ----
let shareBtn = null, banner = null;

function fmtTicks(t) {
  const s = t / 120;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

function showChallengeButton() {
  if (typeof document === 'undefined') return;
  if (!shareBtn) {
    shareBtn = document.createElement('button');
    shareBtn.id = 'challenge-btn';
    shareBtn.addEventListener('click', shareLastRun);
    document.body.appendChild(shareBtn);
  }
  shareBtn.textContent = `challenge a friend \u2014 ${fmtTicks(lastRun.timeTicks)} \u29c9`;
  shareBtn.style.display = 'block';
}

async function shareLastRun() {
  if (!lastRun) return;
  const url = location.origin + location.pathname + '#g=' + encodeRun(lastRun);
  const text = `I did ${fmtTicks(lastRun.timeTicks)} on ${lastRun.track} as ${lastRun.name}. Beat my ghost:`;
  try {
    if (navigator.share) { await navigator.share({ text, url }); return; }
  } catch (_) { /* user cancelled: fall through to clipboard */ }
  try {
    await navigator.clipboard.writeText(text + ' ' + url);
    shareBtn.textContent = 'link copied!';
    setTimeout(showChallengeButton, 1400);
  } catch (_) {
    prompt('Copy your challenge link:', url);
  }
}

function showBanner(text) {
  if (typeof document === 'undefined') return;
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'ghost-banner';
    document.body.appendChild(banner);
  }
  banner.textContent = text;
  banner.style.display = 'block';
}

// Transient announcement (daily selection etc.): shows, then fades —
// unless a persistent challenge banner owns the slot.
let announceTimer = null;
function announce(text) {
  if (challenge) return; // the challenge banner has priority
  showBanner(text);
  if (announceTimer) clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { if (!challenge && banner) banner.style.display = 'none'; }, 4000);
}

// ---- Boot: accept a challenge from the URL ----
function initFromUrl() {
  if (typeof location === 'undefined') return;
  const m = (location.hash || '').match(/[#&]g=([A-Za-z0-9_-]+)/);
  if (!m) return;
  const g = decodeCode(m[1]);
  if (!g) return;
  challenge = g;
  showBanner(`racing ${g.name.toUpperCase()} \u2014 ${fmtTicks(g.timeTicks)}`);
}
initFromUrl();

window.FF = window.FF || {};
window.FF.ghost = {
  stopRecording() { recFrozen = true; },
  update, draw, onRaceStart, announce,
  getChallengeTrack: () => (challenge ? challenge.track : null),
  encodeRun, decodeCode, // exposed for the headless suite
  _debug: { get challenge() { return challenge; }, get lastRun() { return lastRun; } },
};

})();