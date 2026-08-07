// ============================================================
// BILLBOARDS.JS — the booking sheet. This file IS the ad server:
// edit, commit, deploy. The client filters by date, so one deploy
// can carry weeks of scheduled bookings.
//
// Entry fields:
//   id    unique string (your reference / invoice number)
//   text  main line (keep it short — it's trackside, read at speed)
//   sub   optional smaller second line
//   from  first active day, 'YYYY-MM-DD' (inclusive, local time)
//   to    last active day,  'YYYY-MM-DD' (inclusive)
//   url   optional link — shown on the post-race sponsor line only
//         (boards are NEVER clickable mid-race; flow is sacred)
//   bg/fg optional colors
//
// House ads (no from/to) run forever and fill any unsold slots, so
// the world never looks vacant. Paid bookings simply join the pool
// for their window; boards rotate through whatever is active.
//
// EDITORIAL RULE: everything here ships under your name into other
// players' races. Manual commit IS the approval step. Refuse freely.
// ============================================================

window.FF = window.FF || {};
window.FF.BILLBOARDS = [
  // ---- House ads: permanent filler tenants ----
  {
    id: 'house-title',
    text: 'PULP FRICTION',
    sub: 'no melons were harmed*',
    fg: '#00ff00',
  },
  {
    id: 'house-yourad',
    text: 'YOUR AD HERE',
    sub: 'boards for hire',
    url: 'https://example.com/billboards', // point at your booking page
    fg: '#ffd22d',
  },
  {
    id: 'house-ghost',
    text: 'BEAT MY GHOST',
    sub: 'coming soon',
    fg: '#39d5ff',
  },

  // ---- Example paid bookings (edit or remove) ----
  // {
  //   id: 'bk-0001-dave-bday',
  //   text: 'HAPPY BIRTHDAY DAVE',
  //   sub: 'love, the melon crew',
  //   from: '2026-08-20',
  //   to: '2026-08-21',
  //   fg: '#ff5d73',
  // },
  // {
  //   id: 'bk-0002-indie-crosspromo',
  //   text: 'PLAY ROCKET GOAT',
  //   sub: 'from our friends at goatworks',
  //   from: '2026-09-01',
  //   to: '2026-09-30',
  //   url: 'https://example.com/rocketgoat',
  // },
];
