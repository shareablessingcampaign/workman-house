/* ==========================================================================
   Workman Chat – transport layer (loaded after the main script in index.html)

   1. Bluetooth  : real phone-to-phone chat in the Android app (WorkmanBT plugin).
   2. Internet   : Firebase Realtime Database "inbox" over plain REST + streaming.
                   Works in the Android app AND in a normal browser.
   3. Switching  : a message goes by Bluetooth when the phones are connected, otherwise
                   by internet, otherwise it waits in the queue and goes when either returns.
   4. Calls      : voice / video with WebRTC. Signalling travels through the internet inbox.

   Packet types (JSON):  hello | msg | part | ack | call
   ========================================================================== */
'use strict';

/* ------------------------------ tap guard ------------------------------
   Some phones lose the browser's "click" when the finger lifts on a button (for example when the screen is redrawn
   at that moment). If a finger went down and up cleanly on a button and no click arrived, press the button ourselves. */
(function () {
  let down = null, lastClick = 0;
  document.addEventListener('click', () => { lastClick = Date.now(); }, true);
  document.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
  document.addEventListener('pointercancel', () => { down = null; }, true);
  document.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (!d || e.pointerType === 'mouse') return;
    if (Date.now() - d.t > 700 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    const el = hit && hit.closest ? hit.closest('button, summary, a[href], [onclick]') : null;
    if (!el || el.disabled) return;
    const t0 = Date.now();
    setTimeout(() => { if (lastClick < t0) { try { el.click(); } catch (x) { /* ignore */ } } }, 350);
  }, true);
})();

const WCFG = Object.assign({ firebaseApiKey: '', firebaseDatabaseUrl: '', turnServer: '', setupCode: '' }, window.WC_CONFIG || {});
const NETX = { adv: false, draft: '' };   // UI memory for the Internet screen (kept across re-draws)

/* ---- one-code setup ("Quick Connect"): WK1-<base64url of {k:apiKey,u:databaseUrl,t:turn}> ---- */
function setupEncode(cfg) {
  const o = { k: cfg.key, u: cfg.url }; if (cfg.turn) o.t = cfg.turn;
  return 'WK1-' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/* accepts the bare code, a link that contains it, or a whole message around it. Returns {key,url,turn} or null */
function setupDecode(text) {
  const m = String(text || '').match(/WK1-[A-Za-z0-9_-]+/);
  if (!m) return null;
  try {
    let b = m[0].slice(4).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    const o = JSON.parse(decodeURIComponent(escape(atob(b))));
    const key = String(o.k || '').trim(), url = String(o.u || '').trim().replace(/\/+$/, ''), turn = String(o.t || '').trim();
    if (key.length < 10 || /\s/.test(key) || !/^https:\/\/[^\s/]+/i.test(url)) return null;
    return { key, url, turn };
  } catch (e) { return null; }
}
/* defaults from config.js: a setupCode fills whatever the separate fields leave empty */
(function () {
  const d = setupDecode(WCFG.setupCode);
  if (!d) return;
  if (!WCFG.firebaseApiKey) WCFG.firebaseApiKey = d.key;
  if (!WCFG.firebaseDatabaseUrl) WCFG.firebaseDatabaseUrl = d.url;
  if (!WCFG.turnServer) WCFG.turnServer = d.turn;
})();
const IS_NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
const BT = IS_NATIVE && typeof window.Capacitor.registerPlugin === 'function' ? window.Capacitor.registerPlugin('WorkmanBT') : null;

const NET = { state: 'off', err: '', es: null, rt: null, auth: null, seen: new Set(), fails: 0, registered: '', gen: 0 };
const BTX = { granted: false, status: '', paired: [], busy: {}, listening: false, refreshing: false, report: null, scan: { open: false, running: false, found: [], note: '', pairing: '' } };
const NET_MAX_BYTES = 700 * 1024;      // biggest file we push through the internet inbox
const BT_MAX_BYTES = 25 * 1024 * 1024; // biggest file we push through Bluetooth
const BT_PART = 32768;                 // base64 characters per Bluetooth frame
const ACK_RANK = { queued: 0, sending: 0, sent: 1, delivered: 2, read: 3 };
const asm = {};                        // incoming multi-part files being assembled

/* ------------------------------ small helpers ------------------------------ */
function genCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(8));
  let s = ''; r.forEach((b) => { s += A[b % A.length]; });
  return 'WK-' + s;
}
function normId(s) {
  s = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('WK')) s = s.slice(2);
  return s.length === 8 ? 'WK-' + s : '';
}
function b64ToBlob(b64, mime) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime || 'application/octet-stream' });
}
const errText = (e) => (e && (e.message || e.errorMessage)) || String(e || 'error');

/* ------------------------------ reachability (the automatic switch) ------------------------------ */
function netCfg() {
  return {
    key: String(S.settings.fbKey || WCFG.firebaseApiKey || '').trim(),
    url: String(S.settings.fbUrl || WCFG.firebaseDatabaseUrl || '').trim().replace(/\/+$/, ''),
    turn: String(S.settings.turn || WCFG.turnServer || '').trim()
  };
}
function netReady() { const c = netCfg(); return !!(c.key && c.url && S.settings.myCode); }
function netUsable() { return netReady() && NET.state === 'online' && navigator.onLine !== false; }

/* 'bt' = Bluetooth link, 'net' = internet, 'sim' = browser demo device, null = unreachable */
function reach(d) {
  if (!d) return null;
  if (!d.live) return d.connected && S.settings.bluetoothOn ? 'sim' : null;
  if (d.bt && d.connected && S.settings.bluetoothOn) return 'bt';
  if (d.code && netUsable()) return 'net';
  return null;
}
function routeLabel(d) {
  const r = reach(d);
  return r === 'bt' ? 'Connected via Bluetooth' : r === 'net' ? 'Online via internet' : null;
}

/* ------------------------------ Firebase (REST) ------------------------------ */
async function netAuth(force) {
  const c = netCfg(); const now = Date.now();
  let a = NET.auth;
  if (!a) { try { a = JSON.parse(localStorage.getItem('wc_fb_auth') || 'null'); } catch (e) { a = null; } }
  if (a && a.key !== c.key) a = null;
  if (a && !force && a.exp - 60000 > now) { NET.auth = a; return a; }
  let j;
  if (a && a.refresh) {
    const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(c.key), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.refresh)
    });
    j = await r.json().catch(() => ({}));
    a = r.ok ? { key: c.key, uid: j.user_id, idToken: j.id_token, refresh: j.refresh_token, exp: now + (+j.expires_in) * 1000 } : null;
  }
  if (!a) {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(c.key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.error && j.error.message) || 'HTTP ' + r.status;
      throw new Error(m === 'ADMIN_ONLY_OPERATION' || m === 'OPERATION_NOT_ALLOWED' ? 'Turn on Anonymous sign-in in Firebase (Authentication → Sign-in method)' : m);
    }
    a = { key: c.key, uid: j.localId, idToken: j.idToken, refresh: j.refreshToken, exp: now + (+j.expiresIn) * 1000 };
  }
  NET.auth = a;
  try { localStorage.setItem('wc_fb_auth', JSON.stringify(a)); } catch (e) { /* ignore */ }
  return a;
}
async function netReq(method, path, body) {
  const c = netCfg();
  const go = async (a) => fetch(c.url + path + '.json?auth=' + encodeURIComponent(a.idToken), { method, body: body === undefined ? undefined : JSON.stringify(body) });
  let r = await go(await netAuth());
  if (r.status === 401) r = await go(await netAuth(true));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json().catch(() => null);
}
async function netRegister(a, tries) {
  const key = a.uid + '|' + S.settings.myCode;
  if (NET.registered === key) return;
  const c = netCfg();
  const r = await fetch(c.url + '/owners/' + S.settings.myCode + '.json?auth=' + encodeURIComponent(a.idToken), { method: 'PUT', body: JSON.stringify(a.uid) });
  if (r.status === 401 || r.status === 403) {
    // this ID may already belong to another Firebase account: pick a fresh one ONCE.
    // If it is refused again the database rules are the problem, so stop and say so (never loop).
    if ((tries || 0) >= 1) throw new Error('Database rules refused access');
    S.settings.myCode = genCode(); save(true);
    toast('Your Workman ID changed to ' + S.settings.myCode);
    return netRegister(a, 1);
  }
  if (!r.ok) throw new Error(r.status === 404 ? 'Database URL looks wrong' : 'Could not register ID (HTTP ' + r.status + ')');
  NET.registered = key;
}
function netUi() {
  if (typeof updateChatHeader === 'function') updateChatHeader();
  renderHome(); refreshSheet();
}
function netStop() {
  NET.gen++; clearTimeout(NET.rt);
  if (NET.es) { try { NET.es.close(); } catch (e) { /* ignore */ } NET.es = null; }
}
function netRestart(ms) { netStop(); NET.rt = setTimeout(netStart, ms || 0); }
function netStart() {
  if (NET.es) return;
  if (!netReady()) { NET.state = 'off'; NET.err = ''; netUi(); return; }
  if (navigator.onLine === false) { NET.state = 'offline'; netUi(); return; }
  NET.state = 'connecting'; netUi();
  const my = ++NET.gen;
  (async () => {
    try {
      const a = await netAuth();
      await netRegister(a);
      if (my !== NET.gen) return;   // a newer start/stop replaced this attempt
      const c = netCfg();
      const es = new EventSource(c.url + '/inbox/' + S.settings.myCode + '.json?auth=' + encodeURIComponent(a.idToken));
      NET.es = es;
      es.addEventListener('open', () => { NET.state = 'online'; NET.err = ''; NET.fails = 0; netUi(); flushQueued(); setTimeout(() => sendHelloAll(false), 1500); });
      es.addEventListener('put', netEvent);
      es.addEventListener('patch', netEvent);
      es.addEventListener('auth_revoked', () => netRestart(300));
      es.addEventListener('cancel', () => { NET.err = 'Database rules refused access'; netRestart(8000); });
      es.onerror = () => {
        NET.fails++; NET.state = navigator.onLine === false ? 'offline' : 'connecting'; netUi();
        netRestart(Math.min(30000, 1500 * NET.fails));
      };
    } catch (e) {
      if (my !== NET.gen) return;
      NET.fails++; NET.state = 'offline'; NET.err = errText(e); netUi();
      netRestart(Math.min(30000, 3000 * NET.fails));
    }
  })();
}
function netEvent(ev) {
  let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
  if (!d || d.data === null || d.data === undefined) return;
  const parts = String(d.path || '/').split('/').filter(Boolean);
  if (parts.length === 0) Object.keys(d.data).forEach((k) => netGot(k, d.data[k]));
  else if (parts.length === 1) netGot(parts[0], d.data);
}
function netGot(id, pkt) {
  if (!pkt || typeof pkt !== 'object' || NET.seen.has(id)) return;
  NET.seen.add(id);
  if (NET.seen.size > 800) NET.seen = new Set([...NET.seen].slice(-400));
  try { onPacket(pkt, 'net', null); } catch (e) { /* a bad packet must never stop the stream */ }
  save(true);
  netReq('DELETE', '/inbox/' + S.settings.myCode + '/' + id).catch(() => {});
}
async function netPacket(code, pkt) {
  if (!netUsable()) throw new Error('No internet');
  await netReq('POST', '/inbox/' + code, Object.assign({ from: S.settings.myCode, nm: S.profile.name, ts: Date.now() }, pkt));
}

/* ------------------------------ Bluetooth (Android app) ------------------------------ */
function btWire() {
  if (!BT || BTX.wired) return;
  BTX.wired = true;
  try {
    BT.addListener('connected', btOnConnected);
    BT.addListener('disconnected', btOnDisconnected);
    BT.addListener('data', btOnData);
    BT.addListener('status', (e) => { BTX.status = (e && e.message) || ''; refreshSheet(); });
    BT.addListener('found', (e) => {
      const sc = BTX.scan;
      if (!e || !e.address || e.bonded || sc.found.some((x) => x.address === e.address)) return;
      sc.found.push({ name: e.name || '', address: e.address });
      sc.note = 'Tap a phone below to pair with it.';
      if (sheetRender === btSheetRender) refreshSheet();
    });
    BT.addListener('scanDone', () => {
      const sc = BTX.scan; sc.running = false;
      if (!sc.pairing) sc.note = sc.found.length ? 'Tap a phone below to pair with it.' : 'No phones found. On the other phone open Workman Chat → Pair a phone → “Let others find me”, keep it close, then tap Search again.';
      if (sheetRender === btSheetRender) refreshSheet();
    });
    BT.addListener('bond', (e) => {
      const sc = BTX.scan; if (!e) return;
      if (e.state === 12) btPaired(e.address);
      else if (e.state === 10 && sc.pairing === e.address) { sc.pairing = ''; sc.note = 'Pairing did not finish (cancelled or the codes did not match). Tap the phone to try again.'; if (sheetRender === btSheetRender) refreshSheet(); }
    });
  } catch (e) { BTX.status = 'Bluetooth plugin problem: ' + errText(e); }
}
async function btInit() {
  if (!BT) return;
  btWire();
  try { const r = await BT.requestBt(); BTX.granted = !!(r && r.granted); }
  catch (e) { BTX.granted = false; BTX.status = 'Bluetooth is not available in this build: ' + errText(e); refreshSheet(); return; }
  if (!BTX.granted) { BTX.status = 'Allow “Nearby devices” permission so Bluetooth chat can work. Tap Refresh to ask again.'; refreshSheet(); return; }
  BTX.status = '';
  await btRefreshPaired();
  if (S.settings.bluetoothOn) btListen();
}
async function btRefreshPaired() {
  if (!BT || !BTX.granted) return;
  try { const r = await BT.getPaired(); BTX.paired = (r && r.devices) || []; }
  catch (e) { BTX.status = errText(e); }
}
function btListen() {
  if (!BT || !BTX.granted) return;
  BT.startServer().then(() => { BTX.listening = true; }).catch((e) => { BTX.status = errText(e); refreshSheet(); });
}
const btPacket = (addr, pkt) => BT.send({ address: addr, data: JSON.stringify(pkt) });

async function btConnect(addr) {
  if (!BT) return;
  if (!BTX.granted) { await btInit(); if (!BTX.granted) return; }
  if (!S.settings.bluetoothOn) { S.settings.bluetoothOn = true; save(); btListen(); }
  try {
    const en = await BT.isEnabled();
    if (!en.enabled) { toast('Turn Bluetooth on first'); BT.openSettings(); return; }
  } catch (e) { /* ignore */ }
  BTX.busy[addr] = 1; BTX.status = 'Connecting…'; refreshSheet();
  try { await BT.connect({ address: addr }); BTX.status = 'Connected'; }
  catch (e) {
    BTX.status = 'Could not connect: ' + errText(e) + '. Open Workman Chat on the other phone and make sure both phones are paired in Android Bluetooth settings.';
    toast('Could not connect – see the message in the Bluetooth screen');
  }
  delete BTX.busy[addr]; refreshSheet();
}
function btDisconnect(addr) { if (BT) BT.disconnect({ address: addr }).catch(() => {}); }
function toggleBtRadio() {
  S.settings.bluetoothOn = !S.settings.bluetoothOn;
  if (S.settings.bluetoothOn) btListen();
  else { if (BT) { BT.stopServer().catch(() => {}); BT.disconnect({}).catch(() => {}); } S.devices.forEach((d) => { if (d.live) d.connected = false; }); }
  afterConn();
}
/* finds or creates the device record for a Bluetooth address and marks the link as up */
function btEnsure(addr, name) {
  let d = S.devices.find((x) => x.mac === addr);
  const fresh = !d;
  if (!d) {
    addDevice({ id: 'd_bt' + addr.replace(/[^A-Za-z0-9]/g, ''), name: name || addr, mac: addr, live: true, bt: true, rssi: 0 });
    d = S.devices[S.devices.length - 1];
  }
  const wasUp = d.connected && d.bt;
  d.live = true; d.bt = true; d.connected = true;
  if (fresh || !wasUp) { save(); afterConn(); btHello(d); }
  return { d, changed: fresh || !wasUp };
}
function helloPkt(askBack) {
  return { t: 'hello', r: askBack ? 1 : 0, from: S.settings.myCode, nm: S.profile.name, ab: S.profile.about, av: S.profile.avatar && S.profile.avatar.length < 80000 ? S.profile.avatar : null };
}
function btHello(d) { btPacket(d.mac, helloPkt(false)).catch(() => {}); }
/* tell a contact our name / photo / about (over Bluetooth and/or the internet). Everyone owns their own profile. */
function sendHello(d, force, askBack) {
  if (!d || !d.live) return;
  if (!force && d.helloAt && Date.now() - d.helloAt < 600000) return;
  let sent = false;
  if (d.bt && d.mac && d.connected && S.settings.bluetoothOn && BT) { btPacket(d.mac, helloPkt(askBack)).catch(() => {}); sent = true; }
  if (d.code && netUsable()) { netPacket(d.code, helloPkt(askBack)).catch(() => {}); sent = true; }
  if (sent) d.helloAt = Date.now();
}
function sendHelloAll(force) { S.devices.forEach((d) => sendHello(d, !!force, false)); }
function btOnConnected(e) {
  const r = btEnsure(e.address, e.name);
  toast('Bluetooth connected: ' + r.d.name);
}
function btOnDisconnected(e) {
  const d = S.devices.find((x) => x.mac === e.address); if (!d) return;
  d.connected = false; save(); afterConn();
  toast(d.name + ' left Bluetooth range' + (d.code && netUsable() ? ' – continuing over internet' : ''));
}
function btOnData(e) {
  let p; try { p = JSON.parse(e.data); } catch (x) { return; }
  try { btEnsure(e.address, null); onPacket(p, 'bt', e.address); } catch (x) { /* ignore */ }
  save(true);
}

/* ------------------------------ packets in ------------------------------ */
function onPacket(p, via, addr) {
  if (!p || !p.t) return;
  if (p.t === 'hello') return onHello(p, addr, via);
  if (p.t === 'msg') return onMsg(p, via, addr);
  if (p.t === 'part') return onPart(p);
  if (p.t === 'ack') return onAck(p);
  if (p.t === 'call') return onCallSig(p, via);
}
function peerFor(p, via, addr) {
  let d = via === 'bt' ? S.devices.find((x) => x.mac === addr) : S.devices.find((x) => x.code && x.code === p.from);
  if (!d && via === 'net' && p.from) {
    addDevice({ id: 'd_net' + p.from.replace(/[^A-Z0-9]/g, ''), name: p.nm || p.from, mac: 'Internet • ' + p.from, live: true, bt: false, code: p.from, rssi: 0 });
    d = S.devices[S.devices.length - 1];
    const ch = chatById(d.id); if (ch && ch.messages[0]) ch.messages[0].text = 'Messages go over the internet. Bluetooth is used automatically when you are near each other.';
    setTimeout(() => sendHello(d, true, true), 400);
  }
  return d;
}
function mergeDevices(keep, drop) {
  const kc = chatById(keep.id), dc = chatById(drop.id);
  if (kc && dc) { kc.messages = kc.messages.concat(dc.messages).sort((a, b) => a.ts - b.ts); kc.unread = (kc.unread || 0) + (dc.unread || 0); kc.ts = Math.max(kc.ts, dc.ts); }
  S.chats = S.chats.filter((c) => c.id !== drop.id);
  S.devices = S.devices.filter((x) => x !== drop);
  if (current === drop.id) { current = keep.id; if (typeof renderMessages === 'function') renderMessages(); }
}
function onHello(p, addr, via) {
  const d = via === 'net' ? (p.from ? S.devices.find((x) => x.code === p.from) : null) : S.devices.find((x) => x.mac === addr);
  if (!d) return;
  if (via !== 'net' && p.from) {
    const other = S.devices.find((x) => x !== d && x.code === p.from);
    if (other) mergeDevices(d, other);
    d.code = p.from;
  }
  // a person's name, photo and about always come from that person's own profile
  if (p.nm) d.name = String(p.nm).slice(0, 30);
  if (Object.prototype.hasOwnProperty.call(p, 'av')) d.avatar = p.av || null;
  d.about = p.ab || '';
  save(); renderHome(); updateChatHeader(); refreshSheet(); flushQueued();
  if (p.r) sendHello(d, true, false);
}
function onMsg(p, via, addr) {
  const d = peerFor(p, via, addr); if (!d) return;
  const c = p.g ? chatById('group') : chatById(d.id); if (!c) return;
  if (c.messages.some((m) => m.id === p.id)) { if (!p.g) sendAck(d, [p.id], 'delivered'); return; }
  if (p.parts) { asm[p.id] = { p, d, c, parts: new Array(p.parts), got: 0, via }; return; }
  finishIncoming(p, d, c, p.d ? b64ToBlob(p.d, p.mi) : null);
}
function onPart(p) {
  const a = asm[p.id]; if (!a) return;
  if (a.parts[p.i] === undefined) { a.parts[p.i] = p.d; a.got++; }
  if (a.got === a.parts.length) {
    delete asm[p.id];
    finishIncoming(a.p, a.d, a.c, b64ToBlob(a.parts.join(''), a.p.mi));
  }
}
async function finishIncoming(p, d, c, blob) {
  const part = { id: p.id, type: p.k || 'text', text: p.x, sender: p.g ? d.name : null };
  if (blob) {
    const mid = uid(); await putMedia(mid, blob); urls[mid] = URL.createObjectURL(blob);
    Object.assign(part, { mediaId: mid, name: p.fn || 'file', size: blob.size, mime: p.mi });
  }
  incoming(c, part);
  if (!p.g) {
    sendAck(d, [p.id], 'delivered');
    if (current === c.id && !document.hidden) markRead(c);
  }
}
function sendAck(d, ids, s) {
  const pkt = { t: 'ack', ids, s };
  const r = reach(d);
  const job = r === 'bt' ? btPacket(d.mac, pkt) : r === 'net' ? netPacket(d.code, pkt) : null;
  if (job) job.catch(() => {});
}
function markRead(c) {
  if (!c || c.type !== 'device') return;
  const d = dev(c.deviceId); if (!d || !d.live) return;
  const ids = c.messages.filter((m) => m.from === 'peer' && !m.rs).map((m) => m.id);
  if (!ids.length) return;
  c.messages.forEach((m) => { if (ids.includes(m.id)) m.rs = true; });
  save(); sendAck(d, ids, 'read');
}
function onAck(p) {
  (p.ids || []).forEach((id) => {
    for (const c of S.chats) {
      const m = c.messages.find((x) => x.id === id && x.from === 'me');
      if (m) { if ((ACK_RANK[p.s] || 0) > (ACK_RANK[m.status] || 0)) { m.status = p.s; patchMsg(c, m); } break; }
    }
  });
  save();
}

/* ------------------------------ packets out ------------------------------ */
async function deliverReal(c, msg, list) {
  msg.status = 'sending'; msg.progress = 0; patchMsg(c, msg);
  let ok = 0, last = null;
  for (const d of list) {
    try { await sendTo(d, msg, c); ok++; } catch (e) { last = e; }
  }
  if (ok) { if ((ACK_RANK[msg.status] || 0) < 1) msg.status = 'sent'; msg.progress = 1; }
  else { msg.status = 'queued'; toast('Couldn’t send yet' + (last ? ': ' + errText(last) : '') + ' – will retry'); }
  save(); patchMsg(c, msg);
}
async function sendTo(d, msg, c) {
  const base = { t: 'msg', id: msg.id, k: msg.type, x: msg.text, fn: msg.name, sz: msg.size, mi: msg.mime, ts: msg.ts, g: c.type === 'group' ? 1 : 0 };
  let route = reach(d);
  if (!route) throw new Error('Not reachable');
  const tryRoute = async (r) => {
    if (msg.type === 'text') return r === 'bt' ? btPacket(d.mac, base) : netPacket(d.code, base);
    const blob = await getMedia(msg.mediaId); if (!blob) throw new Error('file missing');
    if (r === 'bt') {
      if (blob.size > BT_MAX_BYTES) throw new Error('file is over 25 MB');
      const b64 = await blobToB64(blob); const n = Math.ceil(b64.length / BT_PART) || 1;
      await btPacket(d.mac, Object.assign({}, base, { parts: n }));
      for (let i = 0; i < n; i++) {
        await btPacket(d.mac, { t: 'part', id: msg.id, i, n, d: b64.slice(i * BT_PART, (i + 1) * BT_PART) });
        msg.progress = (i + 1) / n; patchProgress(c, msg);
      }
      return null;
    }
    let b = blob;
    if (msg.type === 'image') b = await shrinkImage(blob, 1280);
    if (b.size > NET_MAX_BYTES) throw new Error('too big for internet (max 700 KB). Use Bluetooth, or send a smaller file');
    return netPacket(d.code, Object.assign({}, base, { d: await blobToB64(b), mi: b.type || msg.mime }));
  };
  try { return await tryRoute(route); }
  catch (e) {
    // Bluetooth broke in the middle of sending: switch to internet automatically
    if (route === 'bt' && d.code && netUsable()) return tryRoute('net');
    throw e;
  }
}

/* ------------------------------ internet contacts ------------------------------ */
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg || 'Copied'); return true; } catch (e) { /* try the older way */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove();
    if (ok) { toast(okMsg || 'Copied'); return true; }
  } catch (e) { /* ignore */ }
  toast('Could not copy automatically – please copy it by hand'); return false;
}
function copyMyId() { return copyText(S.settings.myCode, 'ID copied: ' + S.settings.myCode); }
/* hand text to Android's own share sheet (or the browser's, or the clipboard) */
async function sysShare(text, title) {
  if (BT) { try { await BT.shareText({ text, title: title || 'Workman Chat' }); return true; } catch (e) { /* older app: try the next way */ } }
  if (navigator.share) {
    try { await navigator.share({ title: title || 'Workman Chat', text }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return true; }
  }
  return copyText(text, 'Copied – paste it into any app to send');
}
/* the ID can be typed, or buried inside a pasted invite message */
function extractId(text) {
  const s = String(text || '');
  const m = s.toUpperCase().match(/WK[-\s]?[A-Z0-9]{8}/);
  return normId(m ? m[0] : s);
}
function openAddFriend(prefill) {
  openSheet('Chat with a Workman ID', 'No pairing needed', () =>
    '<p class="muted" style="margin:0">Ask your friend for their Workman ID. It looks like <b>WK-ABCD2345</b> and is shown in their <b>Settings</b> page. You can paste a whole invite message – we find the ID inside it.</p>' +
    '<div><label class="f">Friend’s Workman ID</label><input id="afId" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="WK-ABCD2345" value="' + esc(prefill || '') + '"></div>' +
    '<div><label class="f">Name (optional)</label><input id="afName" type="text" maxlength="30" autocomplete="off" placeholder="Their name will appear once they reply"></div>' +
    '<div id="afErr" class="muted" style="color:var(--rose);min-height:1em"></div>' +
    '<button type="button" class="btn big" onclick="submitAddFriend()">💬 Start chat</button>' +
    '<button type="button" class="btn ghost" onclick="openNewChat()">← Back</button>', { static: true });
  setTimeout(() => { const i = $('afId'); if (i && !i.value) i.focus(); }, 80);
}
function addNetContact() { openAddFriend(); }
function submitAddFriend() {
  const err = (m) => { const e = $('afErr'); if (e) e.textContent = m; toast(m); };
  const id = extractId($('afId').value);
  if (!id) { err('That doesn’t look like a Workman ID (like WK-ABCD2345)'); return; }
  if (id === S.settings.myCode) { err('That is your own ID'); return; }
  const have = S.devices.find((d) => d.code === id);
  if (have) { closeSheet(); openChat(have.id); return; }
  const nm = ($('afName').value || '').trim();
  addDevice({ id: 'd_net' + id.replace(/[^A-Z0-9]/g, ''), name: (nm || id).slice(0, 30), mac: 'Internet • ' + id, live: true, bt: false, code: id, rssi: 0 });
  const d = S.devices[S.devices.length - 1];
  const ch = chatById(d.id);
  if (ch && ch.messages[0]) ch.messages[0].text = 'Say hello! Messages go over the internet, and over Bluetooth automatically when you are near each other.';
  save(); renderHome();
  sendHello(d, true, true);
  closeSheet(); openChat(d.id);
}
/* the "new chat" page, like WhatsApp's contact picker */
function openNewChat() {
  openSheet('New chat', 'Pick how you want to start', () => {
    const people = S.devices.filter((d) => d.live && chatById(d.id));
    return '<div class="card"><small>Your Workman ID (friends need it to find you)</small>' +
      '<div style="font:700 20px ui-monospace,Menlo,monospace;letter-spacing:1px;margin:4px 0">' + esc(S.settings.myCode) + '</div>' +
      '<button type="button" class="btn ghost" style="padding:6px 12px" onclick="copyMyId()">📋 Copy my ID</button></div>' +
      '<button type="button" class="prow" onclick="openAddFriend()"><span class="pi">👤</span><span class="pt"><b>Chat with a Workman ID</b><small>No pairing – works anywhere with internet</small></span><span class="pc">›</span></button>' +
      '<button type="button" class="prow" onclick="openDevices()"><span class="pi">📶</span><span class="pt"><b>Phones nearby</b><small>Pair and chat over Bluetooth, no data</small></span><span class="pc">›</span></button>' +
      '<button type="button" class="prow" onclick="openShare()"><span class="pi">📤</span><span class="pt"><b>Invite a friend</b><small>Send them the app</small></span><span class="pc">›</span></button>' +
      (people.length ? '<h5>Your contacts</h5>' + people.map((d) => '<div class="crow" style="border-radius:12px" onclick="closeSheet();openChat(\'' + d.id + '\')">' + av(d, 's') +
        '<div class="cmid"><div class="ctop"><b>' + esc(d.name) + '</b></div><div class="cbot"><span class="cprev">' + esc(d.about || d.code || d.mac) + '</span></div></div></div>').join('') : '');
  });
}

/* ------------------------------ share the app ------------------------------ */
function appLinks() {
  let owner = '', name = '';
  const repo = String(WCFG.githubRepo || '').trim();
  if (repo.indexOf('/') > 0) { owner = repo.split('/')[0]; name = repo.split('/')[1]; }
  else if (typeof repoInfo === 'function') { const i = repoInfo(); if (i) { owner = i.user; name = i.repo; } }
  const apk = String(WCFG.appLink || '').trim() || (owner && name ? 'https://github.com/' + owner + '/' + name + '/releases/latest/download/WorkmanChat.apk' : '');
  let page = String(WCFG.pageLink || '').trim() || (owner && name ? 'https://' + owner + '.github.io/' + name + '/' : '');
  if (page && !/\/$/.test(page)) page += '/';
  return { apk, page };
}
function shareMessage() {
  const L = appLinks(); const o = NETX;
  let t = 'Chat with me on Workman Chat 💬 It works over Bluetooth with no data, and over the internet too.';
  if (L.apk) t += '\n\n📥 Get the Android app:\n' + L.apk;
  if (L.page) t += '\n\n🌐 Or open it in your browser:\n' + L.page;
  if (o.shareId !== false) t += '\n\nMy Workman ID: ' + S.settings.myCode + '\n(In the app: + → Chat with a Workman ID)';
  if (o.shareCode && netReady()) t += '\n\nInternet setup code (paste it in Settings → Internet ID & contacts):\n' + setupEncode(netCfg());
  return t;
}
function openShare() {
  openSheet('Share Workman Chat', 'Send the app to a friend', () => {
    const L = appLinks(); const msg = shareMessage(); const enc = encodeURIComponent(msg);
    const link = L.apk || L.page || '';
    const own = !!(WCFG.firebaseApiKey && WCFG.firebaseDatabaseUrl);
    return '<div class="card"><small style="white-space:pre-line;overflow-wrap:anywhere">' + esc(msg) + '</small></div>' +
      '<div class="card row2b"><div><b>Include my Workman ID</b><br><small>So they can add you straight away</small></div><button type="button" class="switch ' + (NETX.shareId === false ? 'off' : '') + '" onclick="NETX.shareId=(NETX.shareId===false);refreshSheet()" aria-label="Include my ID"><i></i></button></div>' +
      (netReady() && !own ? '<div class="card row2b"><div><b>Include internet setup code</b><br><small>Lets them use internet chat with no typing</small></div><button type="button" class="switch ' + (NETX.shareCode ? '' : 'off') + '" onclick="NETX.shareCode=!NETX.shareCode;refreshSheet()" aria-label="Include setup code"><i></i></button></div>' : '') +
      '<button type="button" class="btn big" onclick="doShare()">📤 Share…</button>' +
      '<div class="sh-grid">' +
        '<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/?text=' + enc + '">🟢 WhatsApp</a>' +
        '<a class="btn ghost" target="_blank" rel="noopener" href="sms:?body=' + enc + '">💬 SMS</a>' +
        '<a class="btn ghost" target="_blank" rel="noopener" href="mailto:?subject=' + encodeURIComponent('Join me on Workman Chat') + '&body=' + enc + '">✉️ Email</a>' +
        '<a class="btn ghost" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(link || 'https://') + '&text=' + enc + '">✈️ Telegram</a>' +
        '<button type="button" class="btn ghost" onclick="copyText(shareMessage(),\'Message copied\')">📋 Copy message</button>' +
        (link ? '<button type="button" class="btn ghost" onclick="copyText(\'' + link.replace(/'/g, '') + '\',\'Link copied\')">🔗 Copy link</button>' : '') +
      '</div>' +
      (IS_NATIVE ? '<button type="button" class="prow" onclick="shareApkFile()"><span class="pi">📲</span><span class="pt"><b>Send the app file</b><small>Sends the installer itself over Bluetooth, Nearby Share or any app – no internet needed</small></span><span class="pc">›</span></button>' : '') +
      (L.apk ? '' : '<p class="muted" style="font-size:12.5px;margin:0">Tip: the download link appears here automatically once the app is built on GitHub.</p>');
  });
}
function doShare() { return sysShare(shareMessage(), 'Workman Chat'); }
async function shareApkFile() {
  if (!BT) { toast('Sending the app file works inside the Android app'); return; }
  toast('Preparing the app file…');
  try { await BT.shareApk({ title: 'Send Workman Chat', text: 'Install Workman Chat. If Android asks, allow “Install unknown apps”.' }); }
  catch (e) { toast('Could not send the file. Use “Share…” to send the link instead.'); }
}

function saveNetCfg() {
  S.settings.fbKey = ($('fbKey').value || '').trim();
  S.settings.fbUrl = ($('fbUrl').value || '').trim();
  S.settings.turn = ($('fbTurn').value || '').trim();
  save(true); NET.auth = null; NET.registered = ''; netRestart(100);
}
/* Quick Connect: one pasted code/link sets everything up */
function applySetupCode(text) {
  const d = setupDecode(text);
  if (!d) return false;
  S.settings.fbKey = d.key; S.settings.fbUrl = d.url; S.settings.turn = d.turn;
  save(true); NET.auth = null; NET.registered = ''; NET.err = ''; NET.fails = 0;
  NETX.draft = ''; NETX.test = ''; netRestart(100); refreshSheet();
  return true;
}
function quickConnect() {
  const el = $('qcCode'); const v = el ? el.value : NETX.draft;
  if (!String(v || '').trim()) { toast('Paste the setup code first'); return; }
  if (applySetupCode(v)) toast('Connecting to internet chat…');
  else toast('That code doesn’t look right – ask your friend to send it again');
}
async function pasteSetupCode() {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) { toast('Nothing copied yet'); return; }
    if (applySetupCode(t)) toast('Connecting to internet chat…');
    else { NETX.draft = t; refreshSheet(); toast('That doesn’t look like a setup code'); }
  } catch (e) { toast('Tap the box, paste the code, then tap Connect'); }
}
function shareSetupCode() {
  const c = netCfg();
  if (!(c.key && c.url)) { toast('Internet chat is not set up on this phone yet'); return; }
  const code = setupEncode(c);
  const L = appLinks();
  const text = 'Join me on Workman Chat! Open the app → ⋮ menu → Internet ID & contacts → paste this setup code and tap Connect:\n\n' + code + (L.apk ? '\n\nGet the app: ' + L.apk : '') + '\n\nMy ID: ' + S.settings.myCode;
  sysShare(text, 'Workman Chat setup code');
}
/* web version: a shared link like …/#setup=WK1-… sets the phone up automatically */
function autoSetupFromUrl() {
  const add = (location.hash + ' ' + location.search).toUpperCase().match(/ADD=(WK-?[A-Z0-9]{8})/);
  if (add) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } setTimeout(() => openAddFriend(add[1]), 900); }
  const m = (location.hash + ' ' + location.search).match(/WK1-[A-Za-z0-9_-]+/);
  if (!m) return;
  if (applySetupCode(m[0])) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } setTimeout(() => toast('Internet chat is ready'), 800); }
}
function netFriendly(m) {
  m = String(m || '');
  if (/API_KEY_INVALID|API key not valid|INVALID_API_KEY|key.*invalid/i.test(m)) return 'The internet key is not valid. Ask your friend for a fresh setup code.';
  if (/Anonymous|ADMIN_ONLY|OPERATION_NOT_ALLOWED/i.test(m)) return 'The server owner must switch on “Anonymous” sign-in in Firebase (Build → Authentication → Sign-in method).';
  if (/CONFIGURATION_NOT_FOUND/i.test(m)) return 'The server owner must open Firebase → Build → Authentication → Get started.';
  if (/rules|Permission denied|refused|HTTP 40[13]/i.test(m)) return 'The server refused access. The owner must publish the rules from firebase-rules.json (Firebase → Realtime Database → Rules → Publish).';
  if (/Database URL|HTTP 404/i.test(m)) return 'The server address looks wrong. Ask your friend for a fresh setup code.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Cannot reach the server. Check your data or Wi‑Fi.';
  return 'Could not connect (' + m + ').';
}
/* "Test connection": checks key, sign-in, address and rules one by one, in plain words */
async function netTest() {
  const c = netCfg(); const L = [];
  if (!(c.key && c.url)) { NETX.test = '⚪ Nothing to test yet – paste a setup code first.'; refreshSheet(); return; }
  NETX.test = '⏳ Testing…'; refreshSheet();
  try { await netAuth(true); L.push('✅ Key accepted and sign-in works'); }
  catch (e) { L.push('❌ ' + netFriendly(errText(e))); NETX.test = L.join('\n'); refreshSheet(); return; }
  try {
    const r = await fetch(c.url + '/owners/' + S.settings.myCode + '.json?auth=' + encodeURIComponent(NET.auth.idToken), { method: 'PUT', body: JSON.stringify(NET.auth.uid) });
    if (r.ok) L.push('✅ Server reachable and rules are correct');
    else if (r.status === 404) L.push('❌ The server address looks wrong');
    else if (r.status === 401 || r.status === 403) L.push('❌ ' + netFriendly('Permission denied'));
    else L.push('❌ Server answered with error ' + r.status);
  } catch (e) { L.push('❌ ' + netFriendly(errText(e))); }
  NETX.test = L.join('\n'); refreshSheet();
  if (L.every((x) => x.startsWith('✅'))) netRestart(100);
}
function netStatusLine() {
  if (netReady() && NET.err && NET.state !== 'online' && navigator.onLine !== false) return { ico: '🟠', txt: 'Can’t connect yet', sub: netFriendly(NET.err) };
  if (!netReady()) return { ico: '⚪', txt: 'Not switched on yet', sub: 'Bluetooth chat works as normal. To chat from anywhere, paste a setup code from a friend below.' };
  if (NET.state === 'online') return { ico: '🟢', txt: 'Connected', sub: 'You can chat and call friends from anywhere.' };
  if (NET.state === 'offline' || navigator.onLine === false) return { ico: '🟠', txt: 'No internet right now', sub: 'Messages will wait and send by themselves when your data or Wi‑Fi is back.' };
  return { ico: '🟡', txt: 'Connecting…', sub: NET.fails > 2 ? 'Still trying. Check your data or Wi‑Fi. If it keeps failing, ask your friend for a fresh setup code.' : 'Just a moment.' };
}
function openNet() {
  openSheet('Internet ID & contacts', 'Chat and call from anywhere with data', () => {
    const st = netStatusLine(); const c = netCfg();
    return '<div class="card"><small>Your Workman ID</small>' +
      '<div style="font:700 22px ui-monospace,Menlo,monospace;letter-spacing:1px;margin:4px 0">' + esc(S.settings.myCode) + '</div>' +
      '<small>Give it to a friend and add theirs below. Phones also swap IDs automatically when they connect over Bluetooth.</small></div>' +
      '<div class="btn-row"><button type="button" class="btn" onclick="copyMyId()">📋 Copy ID</button><button type="button" class="btn ghost" onclick="addNetContact()">➕ Add friend by ID</button></div>' +
      '<div class="card"><b>' + st.ico + ' ' + st.txt + '</b><br><small>' + st.sub + '</small></div>' +
      (netReady() && NET.state !== 'online' ? '<button type="button" class="btn ghost" onclick="netTest()">🩺 Test connection</button>' : '') +
      (NETX.test ? '<div class="card"><small style="white-space:pre-line">' + esc(NETX.test) + '</small></div>' : '') +
      '<h5>⚡ Quick Connect</h5>' +
      (netReady() ? '<button type="button" class="btn big" onclick="shareSetupCode()">📤 Share setup code with a friend</button>' +
        '<p class="muted" style="font-size:12.5px;margin:-6px 0 0">One code sets your friend up in a few seconds – no typing of keys.</p>' : '') +
      '<div><label class="f">' + (netReady() ? 'Got a different setup code?' : 'Got a setup code or link from a friend?') + '</label>' +
      '<input id="qcCode" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste it here (starts with WK1-)" value="' + esc(NETX.draft) + '" oninput="NETX.draft=this.value"></div>' +
      '<div class="btn-row"><button type="button" class="btn" onclick="quickConnect()">🔗 Connect</button><button type="button" class="btn ghost" onclick="pasteSetupCode()">📋 Paste &amp; connect</button></div>' +
      '<details class="gd" id="advBox"' + (NETX.adv ? ' open' : '') + ' ontoggle="NETX.adv=this.open"><summary><span>⚙️</span> Advanced / Custom Server</summary><div class="gd-b">' +
        '<p class="muted">Only for the person who sets up the internet server (a free Google Firebase project). Everyone else can ignore this and just use a setup code.</p>' +
        '<div><label class="f">Web API key</label><input id="fbKey" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Starts with AIza…" value="' + esc(c.key) + '" onchange="saveNetCfg()"></div>' +
        '<div style="margin-top:10px"><label class="f">Database URL</label><input id="fbUrl" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…firebasedatabase.app" value="' + esc(c.url) + '" onchange="saveNetCfg()"></div>' +
        '<div style="margin-top:10px"><label class="f">Call relay (TURN) – optional</label><input id="fbTurn" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="turn:host:3478|user|password" value="' + esc(c.turn) + '" onchange="saveNetCfg()">' +
        '<p class="muted" style="font-size:12px;margin:6px 0 0">Leave empty unless calls connect but have no sound/video on some mobile networks.</p></div>' +
        '<div class="btn-row" style="margin-top:12px"><a class="btn ghost" target="_blank" rel="noopener" href="https://console.firebase.google.com">🔗 Open Firebase console</a>' +
        '<button type="button" class="btn ghost" onclick="openGuide(\'net\',\'openNet\')">❓ Step-by-step guide</button></div>' +
        (NET.err ? '<p class="muted" style="font-size:12px;margin:10px 0 0">Technical detail: ' + esc(NET.err) + '</p>' : '') +
      '</div></details>';
  });
}

/* ------------------------------ Bluetooth screen (Android app) ------------------------------ */
function pairedRow(p) {
  const d = S.devices.find((x) => x.mac === p.address); const on = !!(d && d.connected); const busy = BTX.busy[p.address];
  return '<div class="dev ' + (on ? 'on' : '') + '"><div class="l"><div style="min-width:0"><b>' + esc(d ? d.name : p.name) + (on ? ' <small class="st-on">• connected</small>' : '') + '</b><small>' + esc(p.address) + '</small></div></div>' +
    '<div class="acts"><button class="btn ' + (on ? 'danger' : '') + '"' + (busy ? ' disabled' : '') + ' onclick="' + (on ? 'btDisconnect(\'' + p.address + '\')' : 'btConnect(\'' + p.address + '\')') + '">' + (busy ? 'Connecting…' : on ? 'Disconnect' : 'Connect') + '</button>' +
    (d ? '<button class="btn ghost" onclick="closeSheet();openChat(\'' + d.id + '\')">Chat</button>' : '') + '</div></div>';
}
/* "Pair a phone": searches for nearby phones inside the app and pairs with the one you tap.
   If that is impossible (permission refused, Bluetooth off...) it says why and opens Android's own Bluetooth screen. */
async function btPairClick() {
  if (!BT) return;
  const sc = BTX.scan;
  sc.open = true; sc.running = true; sc.found = []; sc.pairing = '';
  sc.note = 'Looking for phones nearby… keep the other phone close, with Bluetooth on.';
  refreshSheet();
  clearTimeout(sc.timer); sc.timer = setTimeout(() => { if (sc.running) { sc.running = false; if (!sc.found.length) sc.note = 'No phones found. Make the other phone visible (“Let others find me”) and tap Search again.'; refreshSheet(); } }, 25000);
  try {
    const p = await BT.requestScan();
    if (!p || !p.granted) throw new Error('PERM');
    if (!BTX.granted) btInit();
    await BT.startScan();
  } catch (e) {
    sc.running = false; clearTimeout(sc.timer);
    const m = errText(e);
    if (m === 'PERM') {
      sc.note = 'Android needs your permission to find nearby phones. Tap Search again and choose Allow. (If no box appears: Android Settings → Apps → Workman Chat → Permissions → Nearby devices → Allow.)';
      refreshSheet();
    } else {
      sc.note = /off/i.test(m) ? 'Bluetooth is turned off. Turn it on in the screen we just opened, come back and tap Search again.' : 'Could not search (' + m + '). We opened Android’s Bluetooth screen so you can pair there instead.';
      refreshSheet();
      btOpenAndroidSettings(true);
    }
  }
}
async function btPairWith(address) {
  if (!BT) return;
  const sc = BTX.scan; sc.pairing = address;
  sc.note = 'Look at BOTH phones: check the pairing code matches, then tap Pair on each phone.';
  refreshSheet();
  try {
    const r = await BT.pairDevice({ address });
    if (r && r.bonded) btPaired(address);
    else if (r && r.started === false) { sc.pairing = ''; sc.note = 'Android could not start pairing. Try again, or use “Open Android Bluetooth settings instead”.'; refreshSheet(); }
  } catch (e) { sc.pairing = ''; sc.note = 'Could not pair: ' + errText(e); refreshSheet(); }
}
function btPaired(address) {
  const sc = BTX.scan; const f = sc.found.find((x) => x.address === address);
  sc.found = sc.found.filter((x) => x.address !== address); sc.pairing = '';
  sc.note = 'Paired ✓ Connecting… keep Workman Chat open on the other phone too.';
  toast('Paired' + (f && f.name ? ' with ' + f.name : '') + ' ✓');
  btRefreshPaired().then(() => { refreshSheet(); btConnect(address); });
}
async function btVisible() {
  if (!BT) return;
  try {
    const p = await BT.requestScan();
    if (!p || !p.granted) { toast('Please allow “Nearby devices” first'); return; }
    await BT.makeDiscoverable();
    toast('Tap “Allow” so nearby phones can see this phone');
  } catch (e) { toast('Could not make this phone visible – open Android Bluetooth settings'); }
}
/* Permission was refused: ask again; if Android will not show the box any more, open the app's permission page */
async function btFixPermission() {
  if (!BT) return;
  try { await btInit(); } catch (e) { /* handled below */ }
  if (BTX.granted) { toast('Bluetooth allowed ✓'); refreshSheet(); return; }
  try {
    await BT.openAppSettings();
    BTX.status = 'In the page that opened: tap Permissions → Nearby devices → Allow. Then come back here.';
    toast('Tap Permissions → Nearby devices → Allow');
  } catch (e) {
    BTX.status = 'Open Android Settings → Apps → Workman Chat → Permissions → Nearby devices → Allow, then come back here.';
  }
  refreshSheet();
}
async function btOpenAndroidSettings(auto) {
  if (!BT) return;
  if (!auto) toast('Opening Android Bluetooth settings…');
  try {
    await BT.openSettings();
    BTX.status = 'In Android settings tap “Pair new device”, choose your friend’s phone and confirm on both phones. Then come back here – the list updates by itself.';
  } catch (e) {
    BTX.status = 'Could not open Bluetooth settings automatically. Open Android Settings → Connected devices → Bluetooth → Pair new device, then come back here.';
    toast('Open Android Settings → Bluetooth to pair');
  }
  refreshSheet();
}
/* "Check Bluetooth": a plain-language self-test so problems on any phone are visible */
async function btCheck() {
  if (!BT) return;
  const L = [];
  try {
    const i = await BT.getInfo();
    L.push('✅ Bluetooth module is inside this app (v' + i.pluginVersion + ', Android ' + i.sdk + ')');
    L.push(i.supported ? '✅ This phone has Bluetooth' : '❌ This phone has no Bluetooth');
    L.push(i.enabled ? '✅ Bluetooth is turned on' : '❌ Bluetooth is turned off – turn it on');
    L.push(i.permConnect ? '✅ Permission to connect: allowed' : '❌ Permission to connect: not allowed – tap Refresh and choose Allow');
    L.push(i.permScan ? '✅ Permission to find phones: allowed' : '⚠️ Permission to find phones: not yet allowed – it is asked when you tap Pair a phone');
  } catch (e) {
    L.push('❌ The Bluetooth module is missing from this app (' + errText(e) + '). Install the newest APK from the GitHub Releases page.');
  }
  BTX.report = L.join('\n'); refreshSheet();
}
/* "Refresh": reloads the paired list, and asks for the Bluetooth permission again if it was refused. */
async function btRefreshClick() {
  if (!BT || BTX.refreshing) return;
  BTX.refreshing = true; refreshSheet();
  try {
    if (!BTX.granted) await btInit(); else { BTX.status = ''; await btRefreshPaired(); }
  } catch (e) { BTX.status = errText(e); }
  BTX.refreshing = false; refreshSheet();
  if (!BTX.granted) toast('Please allow “Nearby devices” to use Bluetooth');
  else toast(BTX.paired.length ? BTX.paired.length + ' paired phone' + (BTX.paired.length > 1 ? 's' : '') + ' found' : 'No paired phones yet – tap “Pair a phone”');
}
function btFoundRow(f) {
  const busy = BTX.scan.pairing === f.address;
  return '<div class="dev"><div class="l"><div style="min-width:0"><b>' + esc(f.name || 'Unknown phone') + '</b><small>' + esc(f.address) + '</small></div></div>' +
    '<div class="acts"><button type="button" class="btn"' + (busy ? ' disabled' : '') + ' onclick="btPairWith(\'' + f.address + '\')">' + (busy ? 'Pairing…' : 'Pair') + '</button></div></div>';
}
function btSheetRender() {
  const n = S.devices.filter((d) => d.live && d.bt && d.connected).length; const sc = BTX.scan;
  return '<div class="card row2b"><div><b>Bluetooth chat</b><br><small>' + (S.settings.bluetoothOn ? n + ' connected' : 'Off') + '</small></div>' +
    '<button type="button" class="switch ' + (S.settings.bluetoothOn ? '' : 'off') + '" onclick="toggleBtRadio()" aria-label="Toggle Bluetooth chat"><i></i></button></div>' +
    '<ol class="steps"><li>On the <b>first</b> phone tap <b>Pair a phone</b>, then <b>👁️ Let others find me</b> and allow.</li>' +
    '<li>On the <b>second</b> phone tap <b>Pair a phone</b>, tap the first phone in the list, then confirm the code on both phones.</li>' +
    '<li>Open Workman Chat on both phones and tap <b>Connect</b> next to the other phone.</li></ol>' +
    '<div class="btn-row"><button type="button" class="btn" onclick="btPairClick()">📲 Pair a phone</button>' +
    '<button type="button" class="btn ghost' + (BTX.refreshing ? ' busy' : '') + '" onclick="btRefreshClick()"' + (BTX.refreshing ? ' disabled' : '') + '>' + (BTX.refreshing ? '⏳ Checking…' : '🔄 Refresh') + '</button></div>' +
    (sc.open ? '<div class="card"><b>' + (sc.running ? '🔍 Searching…' : 'Nearby phones') + '</b><br><small>' + esc(sc.note) + '</small></div>' +
      '<div>' + sc.found.map(btFoundRow).join('') + '</div>' +
      '<div class="btn-row"><button type="button" class="btn ghost"' + (sc.running ? ' disabled' : '') + ' onclick="btPairClick()">🔍 Search again</button><button type="button" class="btn ghost" onclick="btVisible()">👁️ Let others find me</button></div>' +
      '<button type="button" class="btn ghost" onclick="btOpenAndroidSettings()">⚙️ Open Android Bluetooth settings instead</button>' : '') +
    (BTX.granted ? '' : '<div class="callout">Bluetooth permission is off, so phones cannot be found or connected. Tap the button and choose <b>Allow</b> for “Nearby devices”.</div><button type="button" class="btn big" onclick="btFixPermission()">🔓 Turn on Bluetooth permission</button>') +
    (BTX.status ? '<div class="card"><small>' + esc(BTX.status) + '</small></div>' : '') +
    '<h5>Paired phones</h5>' +
    '<div>' + (BTX.paired.map(pairedRow).join('') || '<p class="muted" style="text-align:center">No paired phones yet. Tap “Pair a phone”.</p>') + '</div>' +
    (BTX.report ? '<div class="card"><small style="white-space:pre-line">' + esc(BTX.report) + '</small></div>' : '') +
    '<div class="btn-row"><button type="button" class="btn ghost" onclick="btCheck()">🩺 Check Bluetooth</button><button type="button" class="btn ghost" onclick="openGuide(\'bt\',\'openDevices\')">❓ Guide</button></div>' +
    '<p class="muted" style="font-size:12px">When a phone moves out of Bluetooth range, chat continues over the internet automatically (menu → Internet ID &amp; contacts).</p>';
}
function openDevicesNative() {
  openSheet('Bluetooth', 'Pair phones, then connect here', btSheetRender);
  btRefreshPaired().then(refreshSheet);
}

/* ------------------------------ help & user guide ------------------------------ */
/* openGuide(section, backFn): section = 'start' | 'bt' | 'net' | 'calls' | 'fix'; backFn = name of a global function to return to */
function openGuide(open, back) {
  const li = (t) => '<li>' + t + '</li>';
  const sec = (id, icon, title, body) => '<details class="gd"' + (id === open ? ' open' : '') + '><summary><span>' + icon + '</span> ' + title + '</summary><div class="gd-b">' + body + '</div></details>';
  const link = (u, t) => '<a class="link" target="_blank" rel="noopener" href="' + u + '">' + t + '</a>';
  const native = IS_NATIVE ? '' : '<div class="callout">You are in the browser preview. Bluetooth chat only works in the <b>Android app</b>.</div>';
  const html =
    (back ? '<button type="button" class="btn ghost" onclick="' + back + '()">← Back</button>' : '') +
    native +
    sec('start', '👋', 'Start here – 3 ways to chat',
      '<p>Workman Chat can reach a friend in three ways. The app picks the best one automatically.</p><ul class="steps">' +
      li('<b>📶 Bluetooth</b> – phones near each other (same room). No internet or data needed. Set up once by pairing the two phones.') +
      li('<b>🌐 Internet ID</b> – anywhere in the world, needs data. Every phone has an ID like <code>WK-ABCD2345</code>. Needs a one-time free Firebase setup.') +
      li('<b>👥 Everyone nearby</b> – a group chat that reaches every phone currently connected to you over Bluetooth.') +
      '</ul><p>Tap <b>⋮</b> (top right) to find <b>Bluetooth devices</b>, <b>Internet ID &amp; contacts</b>, your profile and settings.</p>') +
    sec('bt', '📶', 'Connect to a friend with Bluetooth',
      '<ol class="steps">' +
      li('Install Workman Chat on <b>both</b> phones and turn Bluetooth on.') +
      li('Open <b>⋮ → Bluetooth devices</b> (or tap the Bluetooth icon at the top).') +
      li('<b>First phone:</b> tap <b>📲 Pair a phone</b>, allow “Nearby devices”, then tap <b>👁️ Let others find me</b> and <b>Allow</b>.') +
      li('<b>Second phone:</b> tap <b>📲 Pair a phone</b> and allow “Nearby devices”. The first phone appears in the list – tap <b>Pair</b>.') +
      li('Both phones show a pairing code. If the codes match, tap <b>Pair</b> on <b>both</b> phones.') +
      li('Keep Workman Chat <b>open on both phones</b>, then tap <b>Connect</b> next to your friend on either phone.') +
      li('When it says <b>• connected</b>, tap <b>Chat</b> and send a message. Done!') +
      '</ol><p class="muted">Range is about 10 metres. You only pair once; next time just tap Connect. Prefer Android’s own screen? Tap <b>⚙️ Open Android Bluetooth settings instead</b>.</p>') +
    sec('net', '🌐', 'Chat from anywhere (Internet ID)',
      '<p><b>If a friend already uses the app online (easiest):</b></p><ol class="steps">' +
      li('Ask them to open <b>⋮ → Internet ID &amp; contacts</b> and tap <b>📤 Share setup code</b>, then send you the message.') +
      li('Copy the code, open <b>⋮ → Internet ID &amp; contacts</b> in your app, paste it in <b>Quick Connect</b> and tap <b>🔗 Connect</b>.') +
      li('When the status says <b>🟢 Connected</b>, tap <b>📋 Copy ID</b> and send your ID to your friend. Tap <b>➕ Add friend by ID</b> and enter theirs.') +
      '</ol><p><b>If you are the first person (one time only, free, about 5 minutes):</b></p><ol class="steps">' +
      li('Open ' + link('https://console.firebase.google.com', 'console.firebase.google.com') + ', sign in with a Google account and tap <b>Create a project</b> (name it anything, turn Analytics off).') +
      li('Left menu: <b>Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save</b>.') +
      li('Left menu: <b>Build → Realtime Database → Create database</b>, pick a location, choose <b>Start in locked mode</b>.') +
      li('Open the <b>Rules</b> tab, replace everything with the contents of <code>firebase-rules.json</code> (from the project files), then tap <b>Publish</b>.') +
      li('Copy the <b>Database URL</b> (top of the <b>Data</b> tab) and the <b>Web API key</b> (gear icon → <b>Project settings → General</b>; if not shown tap <b>Add app → Web</b> and copy the <code>apiKey</code>).') +
      li('In the app open <b>⋮ → Internet ID &amp; contacts → ⚙️ Advanced / Custom Server</b>, paste the two values, then tap <b>📤 Share setup code</b> to invite friends.') +
      '</ol><p class="muted">App owners can also put these values in <code>config.js</code> before building, so nobody has to set anything up.</p>' +
      '<p class="muted">Status: <b>⚪ Not switched on yet</b> = no setup code yet · <b>🟡 Connecting</b> = trying · <b>🟢 Connected</b> = ready · <b>🟠 No internet</b> = no data or Wi‑Fi.</p>') +
    sec('calls', '📞', 'Voice and video calls',
      '<ul class="steps">' + li('Calls need <b>internet on both phones</b> (Bluetooth cannot carry video). Finish the Internet ID setup first.') +
      li('Open a chat with your friend and tap the phone or camera icon at the top.') +
      li('Allow <b>Microphone</b> / <b>Camera</b> when Android asks.') +
      li('Connected but silent? Some mobile networks need a relay: add a <b>Call relay (TURN)</b> in Internet ID &amp; contacts.') + '</ul>') +
    sec('fix', '🛠️', 'Something is not working?',
      '<ul class="steps">' +
      li('<b>No phone appears in the list:</b> on the other phone open Workman Chat → Pair a phone → <b>Let others find me</b>, keep it close and tap <b>Search again</b>. Still nothing? Tap <b>🩺 Check Bluetooth</b> – it tells you what is wrong – or pair in <b>Android Settings → Connected devices → Bluetooth</b> and tap <b>Refresh</b>.') +
      li('<b>The list is empty after pairing:</b> tap <b>🔄 Refresh</b>. If it says permission is off, tap Refresh again and choose <b>Allow</b> for Nearby devices (or Android Settings → Apps → Workman Chat → Permissions).') +
      li('<b>“Could not connect”:</b> open Workman Chat on the <b>other</b> phone too, make sure Bluetooth is on and both are paired, then try Connect again.') +
      li('<b>Message shows 🕒:</b> it is waiting; it sends by itself when Bluetooth or internet is back.') +
      li('<b>Internet says “No internet” or keeps connecting:</b> check the phone has data or Wi‑Fi. If it still fails, ask your friend for a fresh setup code.') +
      li('<b>Photos / files:</b> up to about 700 KB over the internet and 25 MB over Bluetooth.') + '</ul>');
  openSheet('Help & user guide', 'Tap a title to open it', () => html);
}

/* ------------------------------ calls (WebRTC) ------------------------------ */
let callSt = null;

function iceServers() {
  const out = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  const t = netCfg().turn;
  if (t) { const p = t.split('|').map((s) => s.trim()); if (p[0]) out.push({ urls: p[0], username: p[1] || undefined, credential: p[2] || undefined }); }
  return out;
}
function iceDone(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const t = setTimeout(finish, 4000);
    function chk() { if (pc.iceGatheringState === 'complete') finish(); }
    function finish() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', chk); resolve(); }
    pc.addEventListener('icegatheringstatechange', chk);
  });
}
function newCall(c, d, video, dir) {
  return { cid: uid(), chat: c, dev: d, video, dir, pc: null, stream: null, t0: 0, timer: null, ringT: null, vib: null, dropT: null, muted: false, camOff: false, accepted: false, demo: false, offerSdp: null };
}
function showCall(o, state, ringing, video, incoming) {
  $('callName').textContent = o.name; $('callState').textContent = state;
  $('callAv').innerHTML = av(o, 'xl'); $('callAv').className = ringing ? 'ring' : ''; $('callAv').hidden = false;
  $('localV').hidden = true; $('remoteV').hidden = true; $('remoteV').srcObject = null;
  $('cMute').hidden = !!incoming; $('cCam').hidden = !video || !!incoming; $('cSpk').hidden = true; $('cAcc').hidden = !incoming;
  $('cMute').className = ''; $('cMute').textContent = '🎤'; $('cCam').className = ''; $('cCam').textContent = '📷';
  $('callNote').textContent = '';
  $('call').hidden = false;
}
async function prepCall(st) {
  st.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: st.video ? { facingMode: 'user' } : false });
  st.pc = new RTCPeerConnection({ iceServers: iceServers() });
  st.stream.getTracks().forEach((t) => st.pc.addTrack(t, st.stream));
  st.pc.ontrack = (ev) => {
    const rv = $('remoteV');
    if (rv.srcObject !== ev.streams[0]) rv.srcObject = ev.streams[0];
    rv.hidden = !st.video; rv.play().catch(() => {});
  };
  st.pc.onconnectionstatechange = () => {
    if (callSt !== st) return;
    const s = st.pc.connectionState;
    if (s === 'connected') { clearTimeout(st.dropT); callConnected(st); }
    else if (s === 'disconnected') { st.dropT = setTimeout(() => { if (callSt === st && st.pc.connectionState !== 'connected') endCall(true, 'lost connection'); }, 8000); }
    else if (s === 'failed') { toast('Call could not connect. Some mobile networks need a relay – see Internet ID & contacts.'); endCall(true, 'failed'); }
  };
  if (st.video) { $('localV').srcObject = st.stream; $('localV').hidden = false; }
}
function callConnected(st) {
  if (st.t0) return;
  st.t0 = Date.now(); clearTimeout(st.ringT); clearInterval(st.vib);
  $('callAv').className = ''; $('callAv').hidden = !!st.video; $('cAcc').hidden = true;
  $('cMute').hidden = false; $('cCam').hidden = !st.video;
  $('callState').textContent = '0:00';
  st.timer = setInterval(() => { $('callState').textContent = fmtDur((Date.now() - st.t0) / 1000); }, 500);
}

async function startCall(video, chatId) {
  const c = chatId ? chatById(chatId) : cur(); if (!c || c.type !== 'device' || callSt) return;
  const d = dev(c.deviceId); if (!d) return;
  if (!d.live || window.WC_SIM) return demoCall(c, d, video);
  if (!d.code) { toast('Calls use the internet. Connect over Bluetooth once, or add their Workman ID, so we can find them.'); return; }
  if (!netUsable()) { toast(netReady() ? 'No internet – calls need data on both phones' : 'Internet chat is not on yet – open ⋮ → Internet ID & contacts and paste a setup code'); return; }
  const st = callSt = newCall(c, d, video, 'out');
  showCall(cobj(c), video ? 'Video calling…' : 'Calling…', true, video, false);
  try {
    await prepCall(st);
    const offer = await st.pc.createOffer(); await st.pc.setLocalDescription(offer); await iceDone(st.pc);
    if (callSt !== st) return;
    await netPacket(d.code, { t: 'call', op: 'offer', cid: st.cid, vid: video ? 1 : 0, sdp: st.pc.localDescription.sdp });
    st.ringT = setTimeout(() => { if (callSt === st && !st.t0) endCall(true, 'not answered'); }, 45000);
  } catch (e) {
    toast(/Permission|NotAllowed|denied/i.test(errText(e)) ? 'Microphone/camera blocked – allow it in Android settings' : 'Call failed: ' + errText(e));
    if (callSt === st) endCall(false, 'failed');
  }
}
function onCallSig(p, via) {
  if (via !== 'net') return;
  const d = peerFor(p, 'net', null); if (!d) return;
  const c = chatById(d.id); if (!c) return;
  if (p.op === 'offer') {
    if (callSt) { netPacket(d.code, { t: 'call', op: 'busy', cid: p.cid }).catch(() => {}); return; }
    const st = callSt = newCall(c, d, !!p.vid, 'in'); st.cid = p.cid; st.offerSdp = p.sdp;
    showCall(cobj(c), p.vid ? 'Incoming video call' : 'Incoming voice call', true, !!p.vid, true);
    if (navigator.vibrate) { navigator.vibrate([400, 250, 400]); st.vib = setInterval(() => navigator.vibrate([400, 250, 400]), 2200); }
    st.ringT = setTimeout(() => { if (callSt === st && !st.accepted) endCall(true, 'missed'); }, 40000);
    return;
  }
  const st = callSt; if (!st || st.cid !== p.cid) return;
  if (p.op === 'answer' && st.dir === 'out' && st.pc) {
    $('callState').textContent = 'Connecting…';
    st.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }).catch(() => endCall(true, 'failed'));
  } else if (p.op === 'end' || p.op === 'decline' || p.op === 'busy') {
    endCall(false, p.op === 'decline' ? 'declined' : p.op === 'busy' ? 'busy' : (st.t0 ? null : 'missed'));
  }
}
async function acceptCall() {
  const st = callSt; if (!st || st.dir !== 'in' || st.accepted) return;
  st.accepted = true; clearInterval(st.vib); clearTimeout(st.ringT);
  $('cAcc').hidden = true; $('callAv').className = ''; $('callState').textContent = 'Connecting…';
  $('cMute').hidden = false; $('cCam').hidden = !st.video;
  try {
    await prepCall(st);
    await st.pc.setRemoteDescription({ type: 'offer', sdp: st.offerSdp });
    const ans = await st.pc.createAnswer(); await st.pc.setLocalDescription(ans); await iceDone(st.pc);
    if (callSt !== st) return;
    await netPacket(st.dev.code, { t: 'call', op: 'answer', cid: st.cid, sdp: st.pc.localDescription.sdp });
  } catch (e) {
    toast(/Permission|NotAllowed|denied/i.test(errText(e)) ? 'Microphone/camera blocked – allow it in Android settings' : 'Call failed: ' + errText(e));
    if (callSt === st) endCall(true, 'failed');
  }
}
function callToggle(w) {
  const s = callSt; if (!s) return;
  if (w === 'mute') {
    s.muted = !s.muted; if (s.stream) s.stream.getAudioTracks().forEach((t) => { t.enabled = !s.muted; });
    $('cMute').className = s.muted ? 'off' : ''; $('cMute').textContent = s.muted ? '🔇' : '🎤';
  }
  if (w === 'cam') {
    s.camOff = !s.camOff; if (s.stream) s.stream.getVideoTracks().forEach((t) => { t.enabled = !s.camOff; });
    $('cCam').className = s.camOff ? 'off' : ''; $('cCam').textContent = s.camOff ? '🚫' : '📷';
  }
}
/* notify = tell the other phone; why = text for the call log ('declined', 'missed', …) */
function endCall(notify, why) {
  const s = callSt; if (!s) return; callSt = null;
  if (notify === undefined) notify = true;
  if (!why && s.dir === 'in' && !s.accepted) why = 'declined';
  clearInterval(s.timer); clearInterval(s.vib); clearTimeout(s.ringT); clearTimeout(s.dropT);
  if (notify && !s.demo && s.dev && s.dev.code && netUsable()) {
    netPacket(s.dev.code, { t: 'call', op: s.dir === 'in' && !s.accepted && why !== 'missed' ? 'decline' : 'end', cid: s.cid }).catch(() => {});
  }
  try { if (s.pc) s.pc.close(); } catch (e) { /* ignore */ }
  if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
  $('localV').srcObject = null; $('remoteV').srcObject = null; $('call').hidden = true;
  const secs = s.t0 ? Math.round((Date.now() - s.t0) / 1000) : 0;
  const kind = s.video ? 'video call' : 'voice call';
  let label;
  if (secs) label = (s.video ? 'Video call' : 'Voice call') + ' • ' + fmtDur(secs);
  else if (why === 'missed' && s.dir === 'in') label = 'Missed ' + kind;
  else if (why === 'declined') label = (s.video ? 'Video call' : 'Voice call') + ' • declined';
  else if (why === 'busy') label = (s.video ? 'Video call' : 'Voice call') + ' • busy';
  else if (why === 'failed' || why === 'lost connection') label = (s.video ? 'Video call' : 'Voice call') + ' • ' + why;
  else label = (s.video ? 'Video call' : 'Voice call') + ' • not answered';
  s.chat.messages.push({ id: uid(), from: 'sys', type: 'call', ts: Date.now(), text: label }); s.chat.ts = Date.now();
  save(); if (current === s.chat.id) appendMsg(s.chat, s.chat.messages[s.chat.messages.length - 1]);
  renderHome();
}

/* browser-only demo call (simulated devices) */
async function demoCall(c, d, video) {
  if (!window.WC_SIM && !recipients(c).length) { toast('Connect to this device first'); return; }
  const st = callSt = newCall(c, d, video, 'out'); st.demo = true;
  showCall(cobj(c), video ? 'Video calling…' : 'Calling…', true, video, false);
  $('cSpk').hidden = false; $('cSpk').className = ''; $('cSpk').textContent = '🔊';
  $('callNote').textContent = window.WC_SIM ? 'Test mode: this shows how a call looks. Real calls need the installed app and internet on both phones.' : 'Demo call: this contact is a simulated device.';
  try {
    st.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
    if (video) { $('localV').srcObject = st.stream; $('localV').hidden = false; }
  } catch (e) { $('callNote').textContent = 'Microphone/camera unavailable or blocked – showing the call screen only.'; }
  setTimeout(() => {
    if (callSt !== st) return;
    $('callAv').className = ''; st.t0 = Date.now(); $('callState').textContent = '0:00';
    st.timer = setInterval(() => { $('callState').textContent = fmtDur((Date.now() - st.t0) / 1000); }, 500);
  }, 2200);
}

/* ------------------------------ start-up ------------------------------ */
function wcStart() {
  if (!S.settings.myCode) { S.settings.myCode = genCode(); save(true); }
  window.addEventListener('online', () => netRestart(300));
  window.addEventListener('offline', () => { NET.state = 'offline'; netStop(); netUi(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { netRestart(100); if (S.settings.bluetoothOn && BT && BTX.granted) btListen(); } });
  setInterval(() => { if (netReady() && !NET.es && navigator.onLine !== false) netStart(); flushQueued(); }, 15000);
  netStart();
  autoSetupFromUrl();
  if (IS_NATIVE) {
    btInit();
    const btResume = async () => {
      if (!BT) return;
      if (!BTX.granted) {   // the user may just have allowed it in Android settings: check without showing any box
        try { const i = await BT.getInfo(); if (i && i.permConnect) { await btInit(); refreshSheet(); } } catch (e) { /* ignore */ }
        return;
      }
      if (sheetRender === btSheetRender) btRefreshPaired().then(refreshSheet);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) btResume(); });
    window.addEventListener('focus', btResume);
  }
}
