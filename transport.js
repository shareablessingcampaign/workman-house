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

const WCFG = Object.assign({ firebaseApiKey: '', firebaseDatabaseUrl: '' }, window.WC_CONFIG || {});
const IS_NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
const BT = IS_NATIVE && typeof window.Capacitor.registerPlugin === 'function' ? window.Capacitor.registerPlugin('WorkmanBT') : null;

const NET = { state: 'off', err: '', es: null, rt: null, auth: null, seen: new Set(), fails: 0, registered: '', gen: 0 };
const BTX = { granted: false, status: '', paired: [], busy: {}, listening: false };
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
    url: String(S.settings.fbUrl || WCFG.firebaseDatabaseUrl || '').trim().replace(/\/+$/, '')
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
async function netRegister(a) {
  const key = a.uid + '|' + S.settings.myCode;
  if (NET.registered === key) return;
  const c = netCfg();
  const r = await fetch(c.url + '/owners/' + S.settings.myCode + '.json?auth=' + encodeURIComponent(a.idToken), { method: 'PUT', body: JSON.stringify(a.uid) });
  if (r.status === 401 || r.status === 403) {
    // this ID already belongs to another Firebase account: pick a fresh one
    S.settings.myCode = genCode(); save(true);
    toast('Your Workman ID changed to ' + S.settings.myCode);
    return netRegister(a);
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
      es.addEventListener('open', () => { NET.state = 'online'; NET.err = ''; NET.fails = 0; netUi(); flushQueued(); });
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
async function btInit() {
  if (!BT) return;
  try {
    BT.addListener('connected', btOnConnected);
    BT.addListener('disconnected', btOnDisconnected);
    BT.addListener('data', btOnData);
    BT.addListener('status', (e) => { BTX.status = (e && e.message) || ''; refreshSheet(); });
    const r = await BT.requestBt(); BTX.granted = !!(r && r.granted);
  } catch (e) { BTX.granted = false; }
  if (!BTX.granted) { BTX.status = 'Allow “Nearby devices” permission so Bluetooth chat can work.'; refreshSheet(); return; }
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
function btHello(d) {
  btPacket(d.mac, { t: 'hello', from: S.settings.myCode, nm: S.profile.name, ab: S.profile.about, av: S.profile.avatar && S.profile.avatar.length < 80000 ? S.profile.avatar : null }).catch(() => {});
}
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
  if (p.t === 'hello') return onHello(p, addr);
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
function onHello(p, addr) {
  const d = S.devices.find((x) => x.mac === addr); if (!d) return;
  if (p.from) {
    const other = S.devices.find((x) => x !== d && x.code === p.from);
    if (other) mergeDevices(d, other);
    d.code = p.from;
  }
  if (p.nm && !d.renamed) d.name = String(p.nm).slice(0, 30);
  if (p.av && !d.avatarSet) d.avatar = p.av;
  d.about = p.ab || '';
  save(); renderHome(); updateChatHeader(); refreshSheet(); flushQueued();
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
function copyMyId() {
  const id = S.settings.myCode;
  const done = () => toast('ID copied: ' + id);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id).then(done, () => prompt('Your Workman ID', id));
  else prompt('Your Workman ID', id);
}
function addNetContact() {
  const raw = prompt('Friend’s Workman ID (like WK-ABCD2345)'); if (raw === null) return;
  const id = normId(raw);
  if (!id) { toast('That doesn’t look like a Workman ID'); return; }
  if (id === S.settings.myCode) { toast('That is your own ID'); return; }
  const have = S.devices.find((d) => d.code === id);
  if (have) { closeSheet(); openChat(have.id); return; }
  const nm = prompt('Name for this friend', id); if (nm === null) return;
  addDevice({ id: 'd_net' + id.replace(/[^A-Z0-9]/g, ''), name: (nm.trim() || id).slice(0, 30), mac: 'Internet • ' + id, live: true, bt: false, code: id, renamed: !!nm.trim(), rssi: 0 });
  const ch = chatById(S.devices[S.devices.length - 1].id);
  if (ch && ch.messages[0]) ch.messages[0].text = 'Messages go over the internet. Bluetooth is used automatically when you are near each other.';
  save(); renderHome(); refreshSheet(); toast('Friend added');
}
function saveNetCfg() {
  S.settings.fbKey = ($('fbKey').value || '').trim();
  S.settings.fbUrl = ($('fbUrl').value || '').trim();
  S.settings.turn = ($('fbTurn').value || '').trim();
  save(true); NET.auth = null; NET.registered = ''; netRestart(100);
}
function openNet() {
  openSheet('Internet ID & contacts', 'Chat and call from anywhere with data', () => {
    const st = { off: 'Not set up yet', connecting: 'Connecting…', online: 'Online ✓', offline: 'Offline' }[NET.state] || NET.state;
    return '<div class="card"><small>Your Workman ID</small>' +
      '<div style="font:700 22px ui-monospace,Menlo,monospace;letter-spacing:1px;margin:4px 0">' + esc(S.settings.myCode) + '</div>' +
      '<small>Give it to a friend and add theirs below. Phones also swap IDs automatically when they connect over Bluetooth.</small></div>' +
      '<div class="btn-row"><button class="btn" onclick="copyMyId()">📋 Copy ID</button><button class="btn ghost" onclick="addNetContact()">➕ Add friend by ID</button></div>' +
      '<div class="card"><small>Internet status: <b>' + st + '</b>' + (NET.err ? '<br>' + esc(NET.err) : '') + '</small></div>' +
      '<h5>☁️ Firebase (free) – see SETUP.md</h5>' +
      '<div><label class="f">Web API key</label><input id="fbKey" type="text" autocomplete="off" value="' + esc(S.settings.fbKey || WCFG.firebaseApiKey) + '" onchange="saveNetCfg()"></div>' +
      '<div><label class="f">Database URL</label><input id="fbUrl" type="text" autocomplete="off" placeholder="https://…firebasedatabase.app" value="' + esc(S.settings.fbUrl || WCFG.firebaseDatabaseUrl) + '" onchange="saveNetCfg()"></div>' +
      '<div><label class="f">Call relay (TURN) – optional</label><input id="fbTurn" type="text" autocomplete="off" placeholder="turn:host:3478|user|password" value="' + esc(S.settings.turn || '') + '" onchange="saveNetCfg()">' +
      '<p class="muted" style="font-size:12px;margin:6px 0 0">Only needed if calls connect but have no sound/video on some mobile networks.</p></div>';
  });
}

/* ------------------------------ Bluetooth screen (Android app) ------------------------------ */
function pairedRow(p) {
  const d = S.devices.find((x) => x.mac === p.address); const on = !!(d && d.connected); const busy = BTX.busy[p.address];
  return '<div class="dev ' + (on ? 'on' : '') + '"><div class="l"><div style="min-width:0"><b>' + esc(d ? d.name : p.name) + (on ? ' <small class="st-on">• connected</small>' : '') + '</b><small>' + esc(p.address) + '</small></div></div>' +
    '<div class="acts"><button class="btn ' + (on ? 'danger' : '') + '"' + (busy ? ' disabled' : '') + ' onclick="' + (on ? 'btDisconnect(\'' + p.address + '\')' : 'btConnect(\'' + p.address + '\')') + '">' + (busy ? 'Connecting…' : on ? 'Disconnect' : 'Connect') + '</button>' +
    (d ? '<button class="btn ghost" onclick="closeSheet();openChat(\'' + d.id + '\')">Chat</button>' : '') + '</div></div>';
}
function openDevicesNative() {
  btRefreshPaired().then(refreshSheet);
  openSheet('Bluetooth', 'Pair in Android settings, then connect here', () => {
    const n = S.devices.filter((d) => d.live && d.bt && d.connected).length;
    return '<div class="card row2b"><div><b>Bluetooth chat</b><br><small>' + (S.settings.bluetoothOn ? n + ' connected' : 'Off') + '</small></div>' +
      '<button class="switch ' + (S.settings.bluetoothOn ? '' : 'off') + '" onclick="toggleBtRadio()" aria-label="Toggle Bluetooth chat"><i></i></button></div>' +
      '<ol class="steps"><li>On <b>both</b> phones: <b>Pair a phone</b> below and pair them in Android.</li><li>Open Workman Chat on both phones.</li><li>On either phone tap <b>Connect</b> next to the other phone.</li></ol>' +
      '<div class="btn-row"><button class="btn" onclick="BT.openSettings()">⚙️ Pair a phone</button><button class="btn ghost" onclick="btRefreshPaired().then(refreshSheet)">🔄 Refresh</button></div>' +
      (BTX.status ? '<div class="card"><small>' + esc(BTX.status) + '</small></div>' : '') +
      '<div>' + (BTX.paired.map(pairedRow).join('') || '<p class="muted" style="text-align:center">No paired phones yet. Tap “Pair a phone”.</p>') + '</div>' +
      '<p class="muted" style="font-size:12px">When a phone moves out of Bluetooth range, chat continues over the internet automatically (menu → Internet ID &amp; contacts).</p>';
  });
}

/* ------------------------------ calls (WebRTC) ------------------------------ */
let callSt = null;

function iceServers() {
  const out = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  const t = String(S.settings.turn || '').trim();
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

async function startCall(video) {
  const c = cur(); if (!c || c.type !== 'device' || callSt) return;
  const d = dev(c.deviceId); if (!d) return;
  if (!d.live) return demoCall(c, d, video);
  if (!d.code) { toast('Calls use the internet. Connect over Bluetooth once, or add their Workman ID, so we can find them.'); return; }
  if (!netUsable()) { toast(netReady() ? 'No internet – calls need data on both phones' : 'Set up internet first: menu → Internet ID & contacts'); return; }
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
  if (!recipients(c).length) { toast('Connect to this device first'); return; }
  const st = callSt = newCall(c, d, video, 'out'); st.demo = true;
  showCall(cobj(c), video ? 'Video calling…' : 'Calling…', true, video, false);
  $('cSpk').hidden = false; $('cSpk').className = ''; $('cSpk').textContent = '🔊';
  $('callNote').textContent = 'Demo call: this contact is a simulated device.';
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
  if (IS_NATIVE) btInit();
}
