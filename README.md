<!DOCTYPE html>
<html lang="en" class="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
  <title>Workman Chat • Bluetooth, Media, Lock & Gemini AI</title>
  <meta name="description" content="Workman Chat – messenger with text, video, chat lock, profile photo, call UI, multi-Bluetooth manager, and Gemini AI." />
  <meta name="theme-color" content="#075E54" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Workman Chat" />
  <style>
    :root {
      --teal: #075E54;
      --header: #075E54;
      --accent: #00A884;
      --accent-dark: #008f70;
      --green: #25D366;
      --bg: #EFEAE2;
      --out: #D9FDD3;
      --in: #FFFFFF;
      --text: #111B21;
      --muted: #667781;
      --panel: #FFFFFF;
      --panel-2: #F0F2F5;
      --border: rgba(0, 0, 0, .09);
      --tick: #53BDEB;
      --notice-bg: #FFEECD;
      --notice-text: #54656F;
      --rose: #F43F5E;
      --amber: #F59E0B;
      --gemini: #4F46E5;
    }
    html.dark {
      --header: #1F2C34;
      --bg: #0B141A;
      --out: #005C4B;
      --in: #202C33;
      --text: #E9EDEF;
      --muted: #8696A0;
      --panel: #1F2C34;
      --panel-2: #111B21;
      --border: rgba(255, 255, 255, .09);
      --notice-bg: #182229;
      --notice-text: #FFD279;
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    [hidden] { display: none !important; }
    html, body { margin: 0; height: 100%; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #0B141B;
      color: var(--text);
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }
    button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }
    input, textarea, select { font: inherit; color: inherit; }

    /* Stage */
    #stage { height: 100dvh; display: flex; align-items: center; justify-content: center; gap: 22px; }
    .phone {
      position: relative; display: flex; flex-direction: column;
      width: 100%; height: 100%; background: var(--bg); overflow: hidden;
    }
    @media (min-width: 600px) {
      #stage { padding: 16px; background: linear-gradient(135deg, #0f172a, #1e293b 55%, #064e3b); }
      .phone { width: 430px; height: min(840px, 100%); border-radius: 28px; border: 6px solid #1e293b; box-shadow: 0 25px 60px rgba(0, 0, 0, .55); }
    }

    /* Top bar */
    .topbar {
      flex: none; background: var(--header); color: #fff; z-index: 5;
      padding: calc(8px + env(safe-area-inset-top)) 6px 8px 8px;
      display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(0, 0, 0, .25);
    }
    .iconbtn { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; position: relative; flex: none; font-size: 16px; }
    .iconbtn:hover, .iconbtn:active { background: rgba(255, 255, 255, .14); }
    .avatar-wrap { position: relative; flex: none; margin-right: 4px; }
    .avatar {
      width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
      font-size: 19px; font-weight: 700; overflow: hidden;
      background: linear-gradient(135deg, #0ea5e9, #6366f1); border: 1.5px solid rgba(255, 255, 255, .35);
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .badge { position: absolute; right: -2px; bottom: -2px; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--header); background: var(--green); }
    .badge.warn { background: var(--amber); }
    .who { flex: 1; min-width: 0; }
    .who .name { display: block; width: 100%; text-align: left; font-weight: 600; font-size: 15.5px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who .sub { font-size: 11.5px; margin: 2px 0 0; color: #a7f3d0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Peer strip */
    .peerstrip {
      flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      background: var(--panel); border-bottom: 1px solid var(--border); overflow-x: auto; font-size: 11.5px;
    }
    .peerpill {
      display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px;
      background: var(--panel-2); border: 1px solid var(--border); white-space: nowrap; font-weight: 500;
    }
    .peerpill i { width: 7px; height: 7px; border-radius: 50%; background: var(--green); display: inline-block; }
    .peerpill.add { background: rgba(0, 168, 132, .14); color: var(--accent); font-weight: 700; }

    /* Chat */
    .chat { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .notice {
      margin: 2px auto 6px; max-width: 94%; text-align: center; font-size: 11.5px; line-height: 1.35;
      padding: 6px 12px; border-radius: 8px; background: var(--notice-bg); color: var(--notice-text);
    }
    .row { display: flex; }
    .row.out { justify-content: flex-end; }
    .bubble {
      position: relative; max-width: 82%; padding: 7px 10px 6px; border-radius: 10px;
      box-shadow: 0 1px 1px rgba(0, 0, 0, .13); background: var(--in); color: var(--text);
    }
    .bubble.out { background: var(--out); border-top-right-radius: 2px; }
    .bubble.in { border-top-left-radius: 2px; }
    .bubble.ai { border-left: 3px solid var(--gemini); }
    .bubble .sender { font-size: 11px; font-weight: 700; color: var(--accent); margin-bottom: 2px; }
    .bubble.ai .sender { color: var(--gemini); }
    .bubble .txt { font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
    .bubble video { width: 100%; max-height: 220px; border-radius: 8px; margin-top: 4px; background: #000; display: block; }
    .meta { display: flex; justify-content: flex-end; align-items: center; gap: 4px; margin-top: 3px; font-size: 10.5px; color: var(--muted); }

    /* Chat lock screen */
    #lockscreen {
      position: absolute; inset: 0; z-index: 40;
      background: linear-gradient(160deg, #075E54, #0b141a 70%);
      color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 24px; text-align: center; gap: 12px;
    }
    #lockscreen input {
      width: 180px; text-align: center; letter-spacing: 6px; font-size: 20px; font-weight: 700;
      padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.3);
      background: rgba(255,255,255,.12); color: #fff; outline: none;
    }

    /* Input bar */
    .inputbar {
      flex: none; display: flex; align-items: center; gap: 6px;
      padding: 6px 8px calc(8px + env(safe-area-inset-bottom)); background: var(--bg);
    }
    .pill {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;
      background: var(--in); border-radius: 24px; padding: 4px 10px; border: 1px solid var(--border);
    }
    .pill input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: 15px; padding: 7px 0; color: var(--text); }
    .fab {
      width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: #fff;
      display: grid; place-items: center; font-size: 17px; flex: none;
    }
    .fab.ai-btn { background: var(--gemini); }

    /* Modals */
    .overlay {
      position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, .62);
      display: flex; align-items: flex-end; justify-content: center;
    }
    @media (min-width: 600px) { .overlay { align-items: center; padding: 16px; } }
    .sheet {
      width: 100%; max-width: 450px; max-height: 90dvh; display: flex; flex-direction: column; overflow: hidden;
      background: var(--panel); color: var(--text); border-radius: 20px 20px 0 0;
    }
    @media (min-width: 600px) { .sheet { border-radius: 16px; } }
    .sheet-head {
      background: var(--header); color: #fff; padding: 14px 16px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .sheet-head h3 { margin: 0; font-size: 16px; }
    .sheet-body {
      padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-size: 13.5px;
    }
    .card { background: var(--panel-2); border-radius: 12px; padding: 12px; }
    .btn { padding: 9px 14px; border-radius: 10px; font-weight: 600; font-size: 13px; background: var(--teal); color: #fff; }
    .btn.accent { background: var(--accent); }
    .btn.gemini { background: var(--gemini); }
    .btn.ghost { background: var(--panel-2); color: var(--text); }
    .btn.danger { background: rgba(244, 63, 94, .15); color: var(--rose); }
    .row-btns { display: flex; gap: 8px; flex-wrap: wrap; }
    .field { width: 100%; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel); }

    /* Call overlay */
    #callModal .sheet { background: #0f172a; color: #fff; text-align: center; }
    .call-ring {
      width: 86px; height: 86px; border-radius: 50%; margin: 12px auto;
      display: grid; place-items: center; font-size: 32px; background: rgba(37, 211, 102, .2);
      border: 2px solid var(--green);
    }

    #toast {
      position: fixed; left: 50%; top: 16px; transform: translateX(-50%); z-index: 120;
      background: rgba(15, 23, 42, .95); color: #fff; padding: 8px 16px; border-radius: 999px;
      font-size: 12.5px; opacity: 0; pointer-events: none; transition: opacity .25s;
    }
    #toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div id="toast"></div>

  <div id="stage">
    <div class="phone" id="app">
      <!-- Chat Lock Screen -->
      <div id="lockscreen" hidden>
        <div style="font-size:44px">🔒</div>
        <h2 style="margin:0">Chat Locked</h2>
        <p style="margin:0;color:#cbd5e1;font-size:13px">Enter your PIN to unlock messages</p>
        <input id="unlockPinInput" type="password" inputmode="numeric" maxlength="8" placeholder="••••" />
        <div class="row-btns">
          <button class="btn accent" id="unlockBtn">Unlock</button>
          <button class="btn ghost" style="color:#111" id="resetPinHintBtn">Forgot PIN?</button>
        </div>
      </div>

      <!-- Top Bar -->
      <header class="topbar">
        <div class="avatar-wrap">
          <button class="avatar" id="profileBtn" title="Change profile picture">
            <span id="profileEmoji">😎</span>
            <img id="profileImg" alt="Profile" hidden />
          </button>
          <span class="badge" id="btBadge"></span>
        </div>
        <div class="who">
          <button class="name" id="meNameDisplay">Me (Workman)</button>
          <p class="sub" id="statusSub">Tap + BT to add peers • Gemini AI ready</p>
        </div>
        <button class="iconbtn" id="callVoiceBtn" title="Voice Call">📞</button>
        <button class="iconbtn" id="callVideoBtn" title="Video Call">🎥</button>
        <button class="iconbtn" id="lockNowBtn" title="Lock Chat">🔒</button>
        <button class="iconbtn" id="settingsBtn" title="Settings & AI">⚙️</button>
      </header>

      <!-- Bluetooth Peers Bar -->
      <div class="peerstrip" id="peerStrip">
        <button class="peerpill add" id="openBtModalBtn">+ Bluetooth Peers</button>
      </div>

      <!-- Messages -->
      <main class="chat" id="chatArea">
        <div class="notice">
          Send text or videos, lock your chat with a PIN, change your profile photo, place calls, connect multiple Bluetooth peers, or ask Gemini AI.
        </div>
        <div id="messages"></div>
      </main>

      <!-- Input Bar -->
      <div class="inputbar">
        <div class="pill">
          <button id="attachVideoBtn" title="Send Video">🎬</button>
          <input type="file" id="videoInput" accept="video/*" hidden />
          <input type="text" id="msgInput" placeholder="Type a message or @ai question..." autocomplete="off" />
        </div>
        <button class="fab ai-btn" id="askAiBtn" title="Ask Gemini AI">✨</button>
        <button class="fab" id="sendBtn" title="Send">➤</button>
      </div>
    </div>
  </div>

  <!-- Profile Picture & Name Modal -->
  <div class="overlay" id="profileModal" hidden>
    <div class="sheet">
      <div class="sheet-head">
        <h3>Profile & Picture</h3>
        <button data-close="profileModal">✕</button>
      </div>
      <div class="sheet-body">
        <div class="card" style="text-align:center">
          <div class="avatar" style="width:78px;height:78px;margin:0 auto 10px;font-size:34px" id="modalAvatarPreview">😎</div>
          <div class="row-btns" style="justify-content:center">
            <label class="btn accent" style="cursor:pointer">
              Upload Photo
              <input type="file" id="avatarFileInput" accept="image/*" hidden />
            </label>
            <button class="btn ghost" id="clearAvatarBtn">Use Emoji</button>
          </div>
        </div>
        <div class="card">
          <label style="display:block;font-weight:600;margin-bottom:6px">Display Name</label>
          <input type="text" id="displayNameInput" class="field" maxlength="32" />
        </div>
        <button class="btn accent" id="saveProfileBtn">Save Profile</button>
      </div>
    </div>
  </div>

  <!-- Multi-Bluetooth Manager Modal -->
  <div class="overlay" id="btModal" hidden>
    <div class="sheet">
      <div class="sheet-head">
        <h3>Bluetooth Peers (Multi-Connect)</h3>
        <button data-close="btModal">✕</button>
      </div>
      <div class="sheet-body">
        <div class="card">
          <b>Nearby / Saved Bluetooth Nodes</b>
          <p style="margin:4px 0 10px;color:var(--muted);font-size:12px">
            Select multiple peers to connect or broadcast at once, or trigger real Web Bluetooth pairing.
          </p>
          <div id="btPeerList" style="display:flex;flex-direction:column;gap:8px"></div>
        </div>
        <div class="row-btns">
          <button class="btn accent" id="connectSelectedBtBtn">Connect Selected</button>
          <button class="btn" id="scanWebBtBtn">Scan Real Web Bluetooth</button>
        </div>
        <div class="card">
          <b>Add Custom Peer Name</b>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input type="text" id="customPeerInput" class="field" placeholder="e.g. Field Unit B" />
            <button class="btn accent" id="addCustomPeerBtn">Add</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Call Modal -->
  <div class="overlay" id="callModal" hidden>
    <div class="sheet">
      <div class="sheet-head">
        <h3 id="callTypeLabel">Voice Call</h3>
        <button id="endCallBtn">✕</button>
      </div>
      <div class="sheet-body">
        <div class="call-ring" id="callAvatarIcon">📞</div>
        <h3 style="margin:4px 0" id="callPeerName">Connected Bluetooth Peers</h3>
        <p style="margin:0;color:#94a3b8" id="callTimerText">Ringing...</p>
        <div class="row-btns" style="justify-content:center;margin-top:16px">
          <button class="btn ghost" style="color:#111" id="toggleMuteBtn">Mute</button>
          <button class="btn danger" id="hangupBtn">End Call</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Settings, Chat Lock & Gemini AI Modal -->
  <div class="overlay" id="settingsModal" hidden>
    <div class="sheet">
      <div class="sheet-head">
        <h3>Chat Lock, Gemini AI & Theme</h3>
        <button data-close="settingsModal">✕</button>
      </div>
      <div class="sheet-body">
        <div class="card">
          <b>🔒 Chat Lock PIN</b>
          <p style="margin:4px 0 8px;color:var(--muted);font-size:12px">Set a 4–8 digit PIN to lock the chat screen.</p>
          <div style="display:flex;gap:8px">
            <input type="password" inputmode="numeric" id="lockPinSetInput" class="field" maxlength="8" placeholder="New PIN (e.g. 1234)" />
            <button class="btn accent" id="savePinBtn">Save PIN</button>
          </div>
          <button class="btn ghost" style="margin-top:8px;width:100%" id="lockNowFromSettingsBtn">Lock Chat Now</button>
        </div>

        <div class="card">
          <b>✨ Gemini AI API Key</b>
          <p style="margin:4px 0 8px;color:var(--muted);font-size:12px">
            Stored locally in your browser. Used when you click ✨ or start a message with <code>@ai</code>.
          </p>
          <input type="password" id="geminiKeyInput" class="field" placeholder="AIza..." />
          <button class="btn gemini" style="margin-top:8px;width:100%" id="saveGeminiKeyBtn">Save Gemini Key</button>
        </div>

        <div class="row-btns">
          <button class="btn ghost" id="toggleThemeBtn">Toggle Dark / Light</button>
          <button class="btn danger" id="clearChatBtn">Clear Messages</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const STORAGE_KEY = "workman_chat_v2_state";
    const defaultPeers = [
      { id: "p1", name: "Crew Device 1", connected: true, selected: true },
      { id: "p2", name: "Drone / Cam Rig", connected: true, selected: true },
      { id: "p3", name: "Field Phone 2", connected: false, selected: false }
    ];

    const state = {
      name: "Me (Workman)",
      avatarDataUrl: "",
      emoji: "😎",
      dark: false,
      lockPin: "",
      geminiApiKey: "",
      peers: defaultPeers,
      messages: []
    };

    function loadState() {
      try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (raw) Object.assign(state, raw);
      } catch (_) {}
      document.documentElement.classList.toggle("dark", !!state.dark);
    }

    function saveState() {
      try {
        // Avoid storing huge base64 videos in localStorage quota
        const leanMessages = state.messages.slice(-60).map(m => ({
          ...m,
          videoSrc: m.videoSrc && m.videoSrc.startsWith("data:") ? "" : m.videoSrc
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, messages: leanMessages }));
      } catch (_) {}
    }

    function toast(msg) {
      const el = document.getElementById("toast");
      el.textContent = msg;
      el.classList.add("show");
      clearTimeout(toast._t);
      toast._t = setTimeout(() => el.classList.remove("show"), 2400);
    }

    function nowTime() {
      return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function renderProfile() {
      document.getElementById("meNameDisplay").textContent = state.name;
      document.getElementById("displayNameInput").value = state.name;
      const img = document.getElementById("profileImg");
      const emo = document.getElementById("profileEmoji");
      const prev = document.getElementById("modalAvatarPreview");
      if (state.avatarDataUrl) {
        img.src = state.avatarDataUrl;
        img.hidden = false;
        emo.hidden = true;
        prev.innerHTML = `<img src="${state.avatarDataUrl}" style="width:100%;height:100%;object-fit:cover" />`;
      } else {
        img.hidden = true;
        emo.hidden = false;
        emo.textContent = state.emoji;
        prev.textContent = state.emoji;
      }
    }

    function renderPeers() {
      const strip = document.getElementById("peerStrip");
      const connected = state.peers.filter(p => p.connected);
      document.getElementById("statusSub").textContent =
        connected.length ? `${connected.length} Bluetooth peer(s) active` : "No active BT peers • Tap + BT";
      document.getElementById("btBadge").classList.toggle("warn", connected.length === 0);

      strip.innerHTML = `<button class="peerpill add" id="openBtModalBtn">+ Bluetooth Peers</button>`;
      document.getElementById("openBtModalBtn").onclick = () => openModal("btModal");

      state.peers.forEach(p => {
        const pill = document.createElement("span");
        pill.className = "peerpill";
        pill.innerHTML = `<i style="background:${p.connected ? "var(--green)" : "#94a3b8"}"></i>${escapeHtml(p.name)}`;
        strip.appendChild(pill);
      });

      const list = document.getElementById("btPeerList");
      list.innerHTML = "";
      state.peers.forEach(p => {
        const div = document.createElement("label");
        div.className = "card";
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.justifyContent = "space-between";
        div.style.cursor = "pointer";
        div.innerHTML = `
          <span><b>${escapeHtml(p.name)}</b><br><small style="color:var(--muted)">${p.connected ? "Connected" : "Available"}</small></span>
          <input type="checkbox" ${p.selected ? "checked" : ""} data-peer-id="${p.id}" />
        `;
        div.querySelector("input").onchange = (e) => {
          p.selected = e.target.checked;
          saveState();
        };
        list.appendChild(div);
      });
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function renderMessages() {
      const box = document.getElementById("messages");
      box.innerHTML = "";
      state.messages.forEach(m => {
        const row = document.createElement("div");
        row.className = `row ${m.dir}`;
        const bubble = document.createElement("div");
        bubble.className = `bubble ${m.dir} ${m.isAi ? "ai" : ""}`;
        let mediaHtml = "";
        if (m.videoSrc) {
          mediaHtml = `<video src="${m.videoSrc}" controls playsinline></video>`;
        } else if (m.videoName) {
          mediaHtml = `<div class="card" style="margin-top:4px;font-size:12px">🎬 Video: ${escapeHtml(m.videoName)}</div>`;
        }
        bubble.innerHTML = `
          ${m.sender ? `<div class="sender">${escapeHtml(m.sender)}</div>` : ""}
          ${m.text ? `<div class="txt">${escapeHtml(m.text)}</div>` : ""}
          ${mediaHtml}
          <div class="meta"><span>${escapeHtml(m.time)}</span>${m.dir === "out" ? `<span style="color:var(--tick)">✓✓</span>` : ""}</div>
        `;
        row.appendChild(bubble);
        box.appendChild(row);
      });
      const area = document.getElementById("chatArea");
      area.scrollTop = area.scrollHeight;
    }

    function addMessage({ dir = "out", sender = "", text = "", videoSrc = "", videoName = "", isAi = false }) {
      state.messages.push({
        id: Date.now() + Math.random(),
        dir,
        sender: sender || (dir === "out" ? state.name : "Peer"),
        text,
        videoSrc,
        videoName,
        isAi,
        time: nowTime()
      });
      saveState();
      renderMessages();
    }

    async function askGemini(promptText) {
      const cleanQ = promptText.replace(/^@ai\s*/i, "").trim();
      if (!cleanQ) {
        toast("Type a question for Gemini AI first");
        return;
      }
      addMessage({ dir: "out", text: cleanQ });

      if (!state.geminiApiKey) {
        addMessage({
          dir: "in",
          sender: "Gemini AI (Local Mode)",
          isAi: true,
          text: `No Gemini API key saved yet. Open ⚙️ Settings to add your Gemini API key for live answers.\n\nDraft response for "${cleanQ}": Break the task into clear steps, test on one device first, and save your progress.`
        });
        return;
      }

      addMessage({ dir: "in", sender: "Gemini AI", isAi: true, text: "Thinking..." });
      const idx = state.messages.length - 1;

      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(state.geminiApiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: cleanQ }] }]
            })
          }
        );
        const data = await res.json();
        const reply =
          data?.candidates?.[0]?.content?.parts?.[0]?.text ||
          data?.error?.message ||
          "No response received from Gemini.";
        state.messages[idx].text = reply;
        saveState();
        renderMessages();
      } catch (err) {
        state.messages[idx].text = `Offline or network error reaching Gemini: ${err.message}`;
        saveState();
        renderMessages();
      }
    }

    function openModal(id) { document.getElementById(id).hidden = false; }
    function closeModal(id) { document.getElementById(id).hidden = true; }

    document.querySelectorAll("[data-close]").forEach(btn => {
      btn.onclick = () => closeModal(btn.getAttribute("data-close"));
    });

    // Send text / @ai
    function handleSend() {
      const input = document.getElementById("msgInput");
      const val = input.value.trim();
      if (!val) return;
      input.value = "";
      if (/^@ai\b/i.test(val)) {
        askGemini(val);
      } else {
        const activePeers = state.peers.filter(p => p.connected).map(p => p.name);
        addMessage({ dir: "out", text: val });
        if (activePeers.length) {
          toast(`Sent to ${activePeers.length} BT peer(s)`);
        }
      }
    }

    document.getElementById("sendBtn").onclick = handleSend;
    document.getElementById("msgInput").onkeydown = (e) => {
      if (e.key === "Enter") handleSend();
    };
    document.getElementById("askAiBtn").onclick = () => {
      const input = document.getElementById("msgInput");
      const q = input.value.trim();
      input.value = "";
      askGemini(q || "Give me a quick 3-bullet tip for field production.");
    };

    // Video sending
    document.getElementById("attachVideoBtn").onclick = () => document.getElementById("videoInput").click();
    document.getElementById("videoInput").onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      addMessage({
        dir: "out",
        text: `Shared video (${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
        videoSrc: url,
        videoName: file.name
      });
      e.target.value = "";
    };

    // Profile picture & name
    document.getElementById("profileBtn").onclick = () => openModal("profileModal");
    document.getElementById("avatarFileInput").onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.avatarDataUrl = reader.result;
        renderProfile();
      };
      reader.readAsDataURL(file);
    };
    document.getElementById("clearAvatarBtn").onclick = () => {
      state.avatarDataUrl = "";
      renderProfile();
    };
    document.getElementById("saveProfileBtn").onclick = () => {
      const n = document.getElementById("displayNameInput").value.trim();
      if (n) state.name = n;
      saveState();
      renderProfile();
      closeModal("profileModal");
      toast("Profile updated");
    };

    // Multi-Bluetooth peers
    document.getElementById("connectSelectedBtBtn").onclick = () => {
      let count = 0;
      state.peers.forEach(p => {
        if (p.selected) {
          p.connected = true;
          count++;
        }
      });
      saveState();
      renderPeers();
      toast(count ? `Connected ${count} Bluetooth peer(s)` : "Tick peers to connect");
    };

    document.getElementById("addCustomPeerBtn").onclick = () => {
      const inp = document.getElementById("customPeerInput");
      const label = inp.value.trim();
      if (!label) return;
      state.peers.push({ id: "p_" + Date.now(), name: label, connected: true, selected: true });
      inp.value = "";
      saveState();
      renderPeers();
      toast(`Added ${label}`);
    };

    document.getElementById("scanWebBtBtn").onclick = async () => {
      if (!navigator.bluetooth || !navigator.bluetooth.requestDevice) {
        toast("Web Bluetooth not supported here; use peer list above");
        return;
      }
      try {
        const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
        state.peers.push({
          id: device.id || "bt_" + Date.now(),
          name: device.name || "Bluetooth Device",
          connected: true,
          selected: true
        });
        saveState();
        renderPeers();
        toast(`Paired: ${device.name || "Bluetooth Device"}`);
      } catch (err) {
        toast(err.message || "Bluetooth scan cancelled");
      }
    };

    // Call UI
    let callInterval = null;
    function startCall(isVideo) {
      const active = state.peers.filter(p => p.connected);
      document.getElementById("callTypeLabel").textContent = isVideo ? "Video Call" : "Voice Call";
      document.getElementById("callAvatarIcon").textContent = isVideo ? "🎥" : "📞";
      document.getElementById("callPeerName").textContent =
        active.length ? active.map(p => p.name).join(", ") : "Standby Peer";
      document.getElementById("callTimerText").textContent = "Connecting...";
      openModal("callModal");

      let sec = 0;
      clearInterval(callInterval);
      callInterval = setInterval(() => {
        sec++;
        const mm = String(Math.floor(sec / 60)).padStart(2, "0");
        const ss = String(sec % 60).padStart(2, "0");
        document.getElementById("callTimerText").textContent = `In call • ${mm}:${ss}`;
      }, 1000);
    }

    function endCall() {
      clearInterval(callInterval);
      closeModal("callModal");
    }

    document.getElementById("callVoiceBtn").onclick = () => startCall(false);
    document.getElementById("callVideoBtn").onclick = () => startCall(true);
    document.getElementById("endCallBtn").onclick = endCall;
    document.getElementById("hangupBtn").onclick = endCall;
    document.getElementById("toggleMuteBtn").onclick = (e) => {
      e.target.textContent = e.target.textContent === "Mute" ? "Unmute" : "Mute";
    };

    // Chat Lock & Settings
    document.getElementById("settingsBtn").onclick = () => {
      document.getElementById("lockPinSetInput").value = state.lockPin || "";
      document.getElementById("geminiKeyInput").value = state.geminiApiKey || "";
      openModal("settingsModal");
    };

    document.getElementById("savePinBtn").onclick = () => {
      const pin = document.getElementById("lockPinSetInput").value.trim();
      if (pin && pin.length < 4) {
        toast("PIN must be at least 4 digits");
        return;
      }
      state.lockPin = pin;
      saveState();
      toast(pin ? "Chat Lock PIN saved" : "Chat Lock PIN cleared");
    };

    function lockChat() {
      if (!state.lockPin) {
        toast("Set a PIN in ⚙️ Settings first");
        openModal("settingsModal");
        return;
      }
      document.getElementById("unlockPinInput").value = "";
      document.getElementById("lockscreen").hidden = false;
    }

    document.getElementById("lockNowBtn").onclick = lockChat;
    document.getElementById("lockNowFromSettingsBtn").onclick = () => {
      closeModal("settingsModal");
      lockChat();
    };

    document.getElementById("unlockBtn").onclick = () => {
      const entered = document.getElementById("unlockPinInput").value.trim();
      if (entered === state.lockPin) {
        document.getElementById("lockscreen").hidden = true;
        toast("Unlocked");
      } else {
        toast("Incorrect PIN");
      }
    };

    document.getElementById("resetPinHintBtn").onclick = () => {
      state.lockPin = "";
      saveState();
      document.getElementById("lockscreen").hidden = true;
      toast("PIN reset for local demo");
    };

    document.getElementById("saveGeminiKeyBtn").onclick = () => {
      state.geminiApiKey = document.getElementById("geminiKeyInput").value.trim();
      saveState();
      toast("Gemini API key saved");
    };

    document.getElementById("toggleThemeBtn").onclick = () => {
      state.dark = !state.dark;
      document.documentElement.classList.toggle("dark", state.dark);
      saveState();
    };

    document.getElementById("clearChatBtn").onclick = () => {
      state.messages = [];
      saveState();
      renderMessages();
      closeModal("settingsModal");
      toast("Chat cleared");
    };

    loadState();
    renderProfile();
    renderPeers();
    renderMessages();
  </script>
</body>
</html>
# workman-house