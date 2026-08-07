// ============================================================
// MP — private-race UI and session glue. Owns the channels; routes
// input messages (guests <-> host, host relays between guests); calls
// FF.netStart on every peer once the host presses start.
//
// Topology: star. Host is slot 0 and the relay hub — guests send only
// to the host, which forwards to the other guests. Lockstep itself is
// symmetric; only the plumbing is star-shaped.
//
// BROWSER-ONLY.
// ============================================================

(function () {
'use strict';

const { webrtc } = window.FF;

const root = document.createElement('div');
root.id = 'mp-root';
document.body.appendChild(root);

const toggle = document.createElement('button');
toggle.id = 'mp-toggle';
toggle.textContent = 'mp';
root.appendChild(toggle);

const panel = document.createElement('div');
panel.id = 'mp-panel';
panel.className = 'collapsed';
root.appendChild(panel);

toggle.addEventListener('click', () => {
  panel.classList.toggle('collapsed');
  toggle.textContent = panel.classList.contains('collapsed') ? 'mp' : 'close';
});

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const status = el('div', 'mp-status', 'private race: host or join');
let session = null; // set by FF.netStart's return

function codeBox(labelText, value, readonly) {
  const wrap = el('div', 'mp-codebox');
  wrap.appendChild(el('div', 'mp-label', labelText));
  const ta = el('textarea');
  ta.readOnly = !!readonly;
  if (value) ta.value = value;
  wrap.appendChild(ta);
  if (readonly) {
    const copy = el('button', null, 'copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ta.value); copy.textContent = 'copied!'; }
      catch { ta.select(); copy.textContent = 'select+copy'; }
      setTimeout(() => (copy.textContent = 'copy'), 1200);
    });
    wrap.appendChild(copy);
  }
  return { wrap, ta };
}

function clearPanel() {
  panel.innerHTML = '';
  panel.appendChild(status);
}

// ---------------- HOST ----------------
function hostFlow(guestCount) {
  clearPanel();
  const links = []; // one per guest, in slot order 1..guestCount
  const playerCount = guestCount + 1;

  const beginRace = () => {
    status.textContent = 'racing! (host)';
    session = window.FF.netStart({
      count: playerCount,
      slot: 0,
      sendInput: (msg) => { for (const l of links) l.send(msg); },
      setStatus: (s) => { if (s) status.textContent = s; else status.textContent = 'racing! (host)'; },
    });
    // Host relays each guest's inputs to every other guest.
    for (const l of links) {
      l.message = (msg) => {
        session.receive(msg);
        if (msg.t === 'i') for (const o of links) if (o !== l) o.send(msg);
      };
    }
    for (const l of links) l.send({ t: 'go', count: playerCount, slot: l.slot });
    panel.classList.add('collapsed');
    toggle.textContent = 'mp';
  };

  const addGuest = async (slot) => {
    status.textContent = `creating link for player ${slot + 1}\u2026`;
    const link = await webrtc.createHostLink({
      open: () => {
        status.textContent = `player ${slot + 1} connected (${links.filter(l => l.connected).length + 0}/${guestCount})`;
        link.connected = true;
        if (links.length === guestCount && links.every(l => l.connected)) {
          const start = el('button', 'mp-primary', 'START RACE');
          start.addEventListener('click', beginRace);
          panel.appendChild(start);
          status.textContent = 'all players connected';
        } else if (links.length < guestCount) {
          addGuest(links.length + 1);
        }
      },
    });
    link.slot = slot;
    links.push(link);
    const offer = codeBox(`send this code to player ${slot + 1}:`, link.code, true);
    panel.appendChild(offer.wrap);
    const answer = codeBox(`paste player ${slot + 1}'s reply code:`, '', false);
    const connect = el('button', null, 'connect');
    connect.addEventListener('click', () => link.acceptAnswer(answer.ta.value).catch(() => {
      status.textContent = 'bad reply code \u2014 try pasting again';
    }));
    answer.wrap.appendChild(connect);
    panel.appendChild(answer.wrap);
  };

  addGuest(1);
}

// ---------------- GUEST ----------------
function joinFlow() {
  clearPanel();
  const offer = codeBox("paste the host's code:", '', false);
  panel.appendChild(offer.wrap);
  const join = el('button', 'mp-primary', 'join');
  join.addEventListener('click', async () => {
    join.disabled = true;
    status.textContent = 'building reply code\u2026';
    try {
      const link = await webrtc.createGuestLink(offer.ta.value, {
        open: () => { status.textContent = 'connected \u2014 waiting for host to start'; },
        message: (msg) => {
          if (msg.t === 'go') {
            status.textContent = `racing! (player ${msg.slot + 1})`;
            session = window.FF.netStart({
              count: msg.count,
              slot: msg.slot,
              sendInput: (m) => link.send(m),
              setStatus: (s) => { if (s) status.textContent = s; },
            });
            // Rewire: after start, all messages are race traffic.
            link.message = (m2) => session.receive(m2);
            panel.classList.add('collapsed');
            toggle.textContent = 'mp';
          }
        },
      });
      const reply = codeBox('send this reply code back to the host:', link.code, true);
      panel.appendChild(reply.wrap);
    } catch {
      status.textContent = 'bad code \u2014 check the paste and try again';
      join.disabled = false;
    }
  });
  panel.appendChild(join);
}

// ---------------- Menu ----------------
function menu() {
  clearPanel();
  const row = el('div', 'mp-row');
  for (const n of [1, 2, 3]) {
    const b = el('button', null, `host ${n + 1}p`);
    b.addEventListener('click', () => hostFlow(n));
    row.appendChild(b);
  }
  const j = el('button', null, 'join');
  j.addEventListener('click', joinFlow);
  row.appendChild(j);
  panel.appendChild(row);
}

menu();

})();
