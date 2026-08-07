// ============================================================
// WEBRTC — peer-to-peer transport with manual copy-paste signaling.
//
// Zero servers: the "signaling channel" is you sending a code string
// to your friend over any messenger. Host generates an offer code per
// guest; guest pastes it, gets an answer code back; host pastes that.
// Once connected, everything flows P2P over a reliable ordered
// DataChannel — perfect for delay-based lockstep.
//
// STUN (Google's free public server) handles most NAT traversal.
// The ~10-15% of network pairs needing a TURN relay will fail to
// connect; that's the known cost of the $0 setup.
//
// BROWSER-ONLY: nothing here can run or be tested headless.
// ============================================================

(function () {
'use strict';

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function waitIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    // Belt and braces: some stacks stall gathering; 3s of candidates
    // is nearly always enough to connect on home networks.
    setTimeout(resolve, 3000);
  });
}

const encode = (desc) => btoa(JSON.stringify(desc));
const decode = (code) => JSON.parse(atob(code.trim()));

function wireChannel(ch, link) {
  ch.onopen = () => link.open && link.open();
  ch.onmessage = (e) => {
    try { link.message && link.message(JSON.parse(e.data)); } catch (_) { /* ignore junk */ }
  };
  ch.onclose = () => link.close && link.close();
  link.send = (obj) => { if (ch.readyState === 'open') ch.send(JSON.stringify(obj)); };
}

// Host side: one link per guest. Returns { code, acceptAnswer, send }.
async function createHostLink(callbacks) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const link = Object.assign({ pc, send: () => {} }, callbacks);
  wireChannel(pc.createDataChannel('ff', { ordered: true }), link);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc);
  link.code = encode(pc.localDescription);
  link.acceptAnswer = async (answerCode) => {
    await pc.setRemoteDescription(decode(answerCode));
  };
  return link;
}

// Guest side: paste the host's offer, get an answer code to send back.
async function createGuestLink(offerCode, callbacks) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const link = Object.assign({ pc, send: () => {} }, callbacks);
  pc.ondatachannel = (e) => wireChannel(e.channel, link);
  await pc.setRemoteDescription(decode(offerCode));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIce(pc);
  link.code = encode(pc.localDescription);
  return link;
}

window.FF = window.FF || {};
window.FF.webrtc = { createHostLink, createGuestLink };

})();
