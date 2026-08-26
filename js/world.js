// WORLD — the lifecycle owner (refactor step 2, 2026-08-26).
//
// THE PROBLEM THIS ORGAN REPLACES: "the current world" was a
// constellation of fields (state.session, provider, modeName, race)
// mutated by whoever stood nearby, and teardown was whatever each
// exit path remembered. The session-outliving-its-world bug, the
// midnight-provider freeze and the race-inheriting-the-conveyor were
// all the same disease: nothing OWNED the lifecycle.
//
// THE LAW: there is ONE door. Building any world tears down the
// previous one — not because callers remember, but because the door
// is the teardown. main installs its build primitives here at boot
// (they are closures over main's internals and cannot move without
// deeper surgery — a stated stand-in for refactor step 6); this
// module owns WHEN they run and the invariants around them.
//
// Modes call FF.world and nothing else in the shell: the sanctioned
// upward call, held by verify-arch's DOORS set.
(function () {
'use strict';
const G = typeof window !== 'undefined' ? window : globalThis;
G.FF = G.FF || {};

let impl = null;
let kind = 'race';   // the boot world is the daily

function installed() {
  if (!impl) throw new Error('world: not installed (main boots first)');
  return impl;
}

G.FF.world = {
  // main hands over its primitives at boot. Idempotent-hostile on
  // purpose: a second install is a wiring bug, not a feature.
  _install(i) {
    if (impl) throw new Error('world: already installed');
    impl = i;
  },

  // Build an open-session world (party events). The previous world
  // dies by construction: the session build rebuilds the race world
  // underneath, and the door records what now exists.
  buildSession(name, provider, sessionOpts, extras) {
    const s = installed().buildSession(name, provider, sessionOpts, extras);
    kind = 'session';
    return s;
  },

  // Return to the daily race world. THE INVARIANT LIVES HERE: the
  // session dies at the door, before and regardless of what the
  // implementation does (respawnRace's own lifecycle line remains as
  // the belt to this brace).
  toDaily() {
    const i = installed();
    if (i.state && i.state.session) i.state.session = null;
    kind = 'race';
    i.toDaily();
  },

  kind() { return kind; },
};
})();
