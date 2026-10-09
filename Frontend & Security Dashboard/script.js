"use strict";

/* =====================================================
   SETTINGS  (the only part you may need to change)
   - USE_BACKEND = false  -> page uses built-in demo data
   - USE_BACKEND = true   -> page asks Member 2's backend
   ===================================================== */
const USE_BACKEND = false;
const API_URL = "http://localhost:8000/api";
const WS_URL = "ws://localhost:8000/ws";
const DEMO_USER = "admin";
const DEMO_PASS = "admin123";

const MIN = 60 * 1000;

/* =====================================================
   WORDS: plain-language names for technical things
   ===================================================== */
const LEVELS = {
  LOW:      { label: "Low",      meaning: "Good to know. No rush.", rank: 1 },
  MEDIUM:   { label: "Medium",   meaning: "Take a look today.",     rank: 2 },
  HIGH:     { label: "High",     meaning: "Look at this soon.",     rank: 3 },
  CRITICAL: { label: "Critical", meaning: "Act right now.",         rank: 4 }
};
const STATUSES = { NEW: "New", LOOKING: "Looking into it", DONE: "Resolved" };

const KINDS = {
  password_guessing: {
    title: "Someone may be guessing passwords",
    what: w => `There were ${w.count || "several"} wrong password attempts for the account "${w.user}", all from one address (${w.ip}), in about a minute.`,
    why: "A real person rarely types a wrong password this many times this fast. A program trying many passwords looks exactly like this.",
    todo: ["Check if you or a teammate was trying to sign in.", "If not, block this address in your firewall.", "Make sure that account uses a strong password."]
  },
  file_changed: {
    title: "An important file was changed",
    what: w => `The file ${w.file} on ${w.computer} is different from the last time it was checked.`,
    why: "Important system files rarely change on their own. It can be a normal update, or someone changing settings they should not.",
    todo: ["Ask your team: did anyone update this computer today?", "If nobody did, compare the file with a backup.", "Mark this as resolved once you know the reason."]
  },
  odd_program: {
    title: "An unusual program is running",
    what: w => `A program called "${w.program}" is running on ${w.computer} under the account "${w.user}".`,
    why: "It is not on the usual list of programs for this computer. Unusual does not always mean harmful, but it is worth a quick look.",
    todo: ["Find out who started the program and why.", "If you do not recognise it, stop it and tell your team.", "Mark this as resolved when you are sure it is safe."]
  }
};
const UNKNOWN_KIND = {
  title: "Something unusual was noticed",
  what: w => `Something unusual was seen on ${w.computer}.`,
  why: "It does not match the normal pattern for this computer.",
  todo: ["Look at the details below.", "Ask your team if they know about it."]
};

const PAGES = {
  overview:  { title: "Overview",  hint: "A quick look at how safe your computers are right now." },
  computers: { title: "Computers", hint: "The Linux computers being watched." },
  warnings:  { title: "Warnings",  hint: "Things that look unusual. Click one to see what it means." },
  logins:    { title: "Sign-ins",  hint: "Who tried to sign in to your computers." }
};

/* =====================================================
   DATA
   ===================================================== */
const state = {
  computers: [], warnings: [], logins: [],
  view: "overview", openId: null, nextId: 100,
  demo: true, demoRunning: false, toastTimer: null
};

function loadDemoData() {
  const now = Date.now();
  state.computers = [
    { id: 1, name: "web-server-01", os: "Ubuntu 22.04", online: true,  cpu: 34, ram: 61, disk: 48, seen: now - 8000 },
    { id: 2, name: "database-01",   os: "Debian 12",    online: true,  cpu: 22, ram: 84, disk: 71, seen: now - 20000 },
    { id: 3, name: "test-machine",  os: "Ubuntu 20.04", online: false, cpu: 0,  ram: 0,  disk: 0,  seen: now - 120 * MIN }
  ];
  state.warnings = [
    { id: 1, kind: "password_guessing", level: "HIGH",   computer: "web-server-01", ip: "203.0.113.45", user: "root", count: 8, time: now - 6 * MIN,   status: "NEW" },
    { id: 2, kind: "file_changed",      level: "MEDIUM", computer: "database-01",   file: "/etc/passwd", time: now - 48 * MIN,  status: "LOOKING" },
    { id: 3, kind: "file_changed",      level: "MEDIUM", computer: "web-server-01", file: "/etc/ssh/sshd_config", time: now - 3 * 60 * MIN, status: "NEW" },
    { id: 4, kind: "odd_program",       level: "LOW",    computer: "web-server-01", program: "backup-tool", user: "www-data", time: now - 7 * 60 * MIN, status: "DONE" }
  ];
  state.logins = [
    { computer: "web-server-01", user: "root",  ip: "203.0.113.45", ok: false, time: now - 6 * MIN },
    { computer: "web-server-01", user: "root",  ip: "203.0.113.45", ok: false, time: now - 6 * MIN - 5000 },
    { computer: "web-server-01", user: "root",  ip: "203.0.113.45", ok: false, time: now - 6 * MIN - 9000 },
    { computer: "database-01",   user: "admin", ip: "192.168.1.20", ok: true,  time: now - 25 * MIN },
    { computer: "web-server-01", user: "rupesh", ip: "192.168.1.31", ok: true, time: now - 40 * MIN },
    { computer: "database-01",   user: "admin", ip: "192.168.1.20", ok: true,  time: now - 2 * 60 * MIN },
    { computer: "web-server-01", user: "guest", ip: "198.51.100.7", ok: false, time: now - 5 * 60 * MIN }
  ];
}

async function getJson(path) {
  const res = await fetch(API_URL + path);
  if (!res.ok) throw new Error("Request failed: " + path);
  return res.json();
}

async function loadData() {
  if (USE_BACKEND) {
    try {
      const [c, w, l] = await Promise.all([getJson("/servers"), getJson("/alerts"), getJson("/login-events")]);
      state.computers = c; state.warnings = w; state.logins = l;
      state.demo = false;
      connectLive();
      return;
    } catch (err) {
      console.warn(err);
      showToast("Could not reach the backend. Showing demo data instead.", "MEDIUM");
    }
  }
  state.demo = true;
  loadDemoData();
}

function connectLive() {
  try {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = e => { try { addWarning(JSON.parse(e.data)); } catch (err) { console.warn(err); } };
    ws.onclose = () => setTimeout(connectLive, 5000);
  } catch (err) { console.warn(err); }
}

/* =====================================================
   SMALL HELPERS
   ===================================================== */
const $ = id => document.getElementById(id);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function timeAgo(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
  if (s < 86400) { const h = Math.round(s / 3600); return h + (h === 1 ? " hour ago" : " hours ago"); }
  const d = Math.round(s / 86400);
  return d + (d === 1 ? " day ago" : " days ago");
}
const lvl = key => LEVELS[key] || LEVELS.LOW;
const kind = key => KINDS[key] || UNKNOWN_KIND;
const isOpen = w => w.status !== "DONE";
const isSerious = w => w.level === "HIGH" || w.level === "CRITICAL";

/* =====================================================
   DRAWING THE PAGES
   ===================================================== */
function warningRow(w) {
  return `<button class="row" data-open="${esc(w.id)}">
    <span class="badge ${esc(w.level)}">${esc(lvl(w.level).label)}</span>
    <span class="row-main"><strong>${esc(kind(w.kind).title)}</strong><small>${esc(w.computer)} · ${timeAgo(w.time)}</small></span>
    <span class="chip ${esc(w.status)}">${esc(STATUSES[w.status] || w.status)}</span>
  </button>`;
}

function renderOverview() {
  const open = state.warnings.filter(isOpen);
  const serious = open.filter(isSerious);
  const offline = state.computers.filter(c => !c.online).length;

  let cls, head, sub;
  if (serious.length) {
    cls = "bad";
    head = serious.length === 1 ? "1 serious warning needs your attention" : serious.length + " serious warnings need your attention";
    sub = "Open it to see what happened and what you can do.";
  } else if (open.length) {
    cls = "warn"; head = "Some warnings are waiting for you";
    sub = "Nothing urgent, but please take a look when you can.";
  } else {
    cls = "ok"; head = "All clear";
    sub = "No open warnings. Your computers look safe right now.";
  }
  if (offline) sub += offline === 1 ? " 1 computer is offline." : " " + offline + " computers are offline.";
  $("banner").className = "banner " + cls;
  $("banner").innerHTML = `<div><h3>${esc(head)}</h3><p>${esc(sub)}</p></div>` +
    (open.length ? `<button class="btn" data-go="warnings">Review warnings</button>` : "");

  const online = state.computers.filter(c => c.online).length;
  const wrong = state.logins.filter(l => !l.ok && Date.now() - l.time < 60 * MIN).length;
  $("stats").innerHTML = [
    [online + " of " + state.computers.length, "Computers online"],
    [open.length, "Open warnings"],
    [serious.length, "Serious warnings"],
    [wrong, "Wrong passwords (last hour)"]
  ].map(s => `<div class="stat"><b>${esc(s[0])}</b><span>${esc(s[1])}</span></div>`).join("");

  const top = open.slice().sort((a, b) => lvl(b.level).rank - lvl(a.level).rank || b.time - a.time).slice(0, 4);
  $("attention").innerHTML = top.length ? top.map(warningRow).join("") : `<p class="empty">Nothing needs attention right now.</p>`;

  const counts = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(k => [k, open.filter(w => w.level === k).length]);
  const max = Math.max(1, ...counts.map(c => c[1]));
  $("levels").innerHTML = counts.map(c => `<div class="level-row">
    <span>${LEVELS[c[0]].label}</span>
    <div class="level-bar"><i class="${c[0]}" style="width:${(c[1] / max) * 100}%"></i></div>
    <b>${c[1]}</b></div>`).join("");
}

function meter(label, value, off) {
  const cls = off ? "ok" : value >= 85 ? "bad" : value >= 70 ? "warn" : "ok";
  return `<div><div class="meter-top"><span>${label}</span><span>${off ? "–" : value + "%"}</span></div>
    <div class="track"><div class="fill ${cls}" style="width:${off ? 0 : clamp(value, 0, 100)}%"></div></div></div>`;
}

function renderComputers() {
  $("computerGrid").innerHTML = state.computers.map(c => {
    const open = state.warnings.filter(w => w.computer === c.name && isOpen(w)).length;
    return `<article class="computer ${c.online ? "" : "off"}">
      <header>
        <div><h3>${esc(c.name)}</h3><span class="muted">${esc(c.os || "Linux")}</span></div>
        <span class="state"><i class="dot ${c.online ? "good" : "bad"}"></i>${c.online ? "Online" : "Offline"}</span>
      </header>
      ${meter("Processor use", c.cpu, !c.online)}
      ${meter("Memory use", c.ram, !c.online)}
      ${meter("Disk space used", c.disk, !c.online)}
      <footer><span>Last seen ${timeAgo(c.seen)}</span><span>${open} open warning${open === 1 ? "" : "s"}</span></footer>
    </article>`;
  }).join("") || `<p class="empty">No computers are connected yet.</p>`;
}

function renderWarnings() {
  const q = $("search").value.trim().toLowerCase();
  const lv = $("levelFilter").value;
  const st = $("statusFilter").value;
  const list = state.warnings.filter(w => {
    const text = [kind(w.kind).title, w.computer, w.ip, w.user, w.file, w.program].join(" ").toLowerCase();
    return (!q || text.includes(q)) && (!lv || w.level === lv) && (!st || w.status === st);
  }).sort((a, b) => b.time - a.time);
  $("warningList").innerHTML = list.length ? list.map(warningRow).join("")
    : `<p class="empty">No warnings match. Try clearing the search or filters.</p>`;
}

function renderLogins() {
  const bad = state.logins.filter(l => !l.ok).length;
  $("loginSummary").textContent = `${state.logins.length - bad} successful sign-ins and ${bad} wrong-password attempts.`;
  $("loginList").innerHTML = state.logins.slice(0, 30).map(l => `<div class="row">
    <i class="dot ${l.ok ? "good" : "bad"}"></i>
    <span class="row-main"><strong>${l.ok ? esc(l.user) + " signed in" : "Wrong password for " + esc(l.user)}</strong>
      <small>${esc(l.computer)} · from ${esc(l.ip)} · ${timeAgo(l.time)}</small></span>
    <span class="chip ${l.ok ? "DONE" : "NEW"}">${l.ok ? "OK" : "Failed"}</span></div>`).join("")
    || `<p class="empty">No sign-ins recorded yet.</p>`;
}

function renderAll() {
  const open = state.warnings.filter(isOpen).length;
  $("navCount").textContent = open;
  $("navCount").hidden = open === 0;
  renderOverview(); renderComputers(); renderWarnings(); renderLogins();
}

/* =====================================================
   NAVIGATION, DETAILS PANEL, MESSAGES
   ===================================================== */
function setView(name) {
  if (!PAGES[name]) name = "overview";
  state.view = name;
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== "view-" + name; });
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  $("pageTitle").textContent = PAGES[name].title;
  $("pageHint").textContent = PAGES[name].hint;
  window.scrollTo(0, 0);
}

function openDrawer(id) {
  const w = state.warnings.find(x => String(x.id) === String(id));
  if (!w) return;
  state.openId = w.id;
  const k = kind(w.kind), L = lvl(w.level);
  const facts = [["Computer", w.computer], ["From address", w.ip], ["Account", w.user], ["File", w.file], ["Program", w.program],
    ["How serious", L.label + " – " + L.meaning], ["When", timeAgo(w.time)]].filter(f => f[1]);
  $("drawer").innerHTML = `
    <button class="close" data-close>Close</button>
    <span class="badge ${esc(w.level)}" style="justify-self:start">${esc(L.label)}</span>
    <h3>${esc(k.title)}</h3>
    <h4>What happened</h4><p>${esc(k.what(w))}</p>
    <h4>Why it matters</h4><p>${esc(k.why)}</p>
    <h4>What you can do</h4><ul>${k.todo.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
    <h4>Details</h4><dl class="facts">${facts.map(f => `<dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd>`).join("")}</dl>
    <h4>Where are you with this?</h4>
    <div class="seg">${Object.keys(STATUSES).map(s =>
      `<button data-status="${s}" class="${w.status === s ? "on" : ""}">${STATUSES[s]}</button>`).join("")}</div>`;
  $("drawerWrap").hidden = false;
  $("drawer").querySelector(".close").focus();
}

function closeDrawer() { $("drawerWrap").hidden = true; state.openId = null; }

async function setStatus(status) {
  const w = state.warnings.find(x => x.id === state.openId);
  if (!w || !STATUSES[status]) return;
  w.status = status;
  if (USE_BACKEND && !state.demo) {
    try {
      await fetch(`${API_URL}/alerts/${encodeURIComponent(w.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status })
      });
    } catch (err) { showToast("Saved on this page only. Could not reach the backend.", "MEDIUM"); }
  }
  renderAll();
  openDrawer(w.id);
}

function showToast(message, level) {
  const t = $("toast");
  t.textContent = message;
  t.className = "toast " + (level || "");
  t.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

/* =====================================================
   NEW EVENTS (live warnings and the demo)
   ===================================================== */
function addWarning(w) {
  if (!w.id) w.id = state.nextId++;
  w.time = w.time || Date.now();
  w.status = w.status || "NEW";
  state.warnings.unshift(w);
  renderAll();
  showToast("New warning: " + kind(w.kind).title, w.level);
}
function addLogin(l) {
  state.logins.unshift(l);
  if (state.logins.length > 60) state.logins.pop();
  renderAll();
}

function runDemo() {
  if (state.demoRunning || !state.computers.length) return;
  state.demoRunning = true;
  const btn = $("demoBtn");
  btn.disabled = true; btn.textContent = "Demo running…";
  const comp = state.computers.find(c => c.online) || state.computers[0];
  const ip = "203.0.113." + rand(10, 200);
  showToast("Demo started: pretending someone is guessing passwords…", "MEDIUM");
  let n = 0;
  const timer = setInterval(() => {
    n++;
    addLogin({ computer: comp.name, user: "root", ip: ip, ok: false, time: Date.now() });
    if (n === 6) {
      clearInterval(timer);
      addWarning({ kind: "password_guessing", level: "HIGH", computer: comp.name, ip: ip, user: "root", count: 6 });
      btn.disabled = false; btn.textContent = "Try a demo";
      state.demoRunning = false;
    }
  }, 500);
}

/* Makes the demo feel alive: computers report in every few seconds */
function startDemoTicker() {
  setInterval(() => {
    if (!state.demo) return;
    state.computers.forEach(c => {
      if (!c.online) return;
      c.seen = Date.now() - rand(0, 15000);
      c.cpu = clamp(c.cpu + rand(-6, 6), 5, 95);
      c.ram = clamp(c.ram + rand(-2, 2), 20, 95);
    });
    renderAll();
  }, 5000);
}

/* =====================================================
   START-UP
   ===================================================== */
/* Remember the sign-in for this browser tab (safe even if storage is blocked) */
function remember(yes) {
  try { yes ? sessionStorage.setItem("ids_signed_in", "yes") : sessionStorage.removeItem("ids_signed_in"); } catch (err) { /* ignore */ }
}
function wasSignedIn() {
  try { return sessionStorage.getItem("ids_signed_in") === "yes"; } catch (err) { return false; }
}

let started = false;
async function startApp() {
  $("login").hidden = true;
  $("app").hidden = false;
  if (started) return;
  started = true;
  await loadData();
  renderAll();
  setView("overview");
  startDemoTicker();
}

function bindEvents() {
  $("loginForm").addEventListener("submit", e => {
    e.preventDefault();
    if ($("user").value.trim() === DEMO_USER && $("pass").value === DEMO_PASS) {
      remember(true);
      $("loginError").hidden = true;
      startApp();
    } else {
      $("loginError").textContent = "That username or password is not right. Please try again.";
      $("loginError").hidden = false;
    }
  });
  $("logoutBtn").addEventListener("click", () => { remember(false); location.reload(); });
  $("demoBtn").addEventListener("click", runDemo);
  ["search", "levelFilter", "statusFilter"].forEach(id => {
    $(id).addEventListener("input", renderWarnings);
    $(id).addEventListener("change", renderWarnings);
  });
  $("shade").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

  document.addEventListener("click", e => {
    const t = e.target;
    const nav = t.closest("[data-view]");   if (nav) return setView(nav.dataset.view);
    const go = t.closest("[data-go]");      if (go) return setView(go.dataset.go);
    const op = t.closest("[data-open]");    if (op) return openDrawer(op.dataset.open);
    const st = t.closest("[data-status]");  if (st) return setStatus(st.dataset.status);
    if (t.closest("[data-close]")) closeDrawer();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  if (wasSignedIn()) startApp();
});
