// Smart desktop: the Atomic Flight Deck.
// All server calls go through the Rust side (invoke); the token never reaches this page.
'use strict';

const T = window.__TAURI__;
const POLL_MS = 60000;
const OPTS_MS = 5 * 60000;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/^[ \t]+/gm, '');
const clock = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!isFinite(m)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 36) return h + ' h ago';
  return Math.round(h / 24) + ' days ago';
}
const isToday = (iso) => { const d = new Date(iso); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };
const shape = (level) => '<span class="shape ' + level + '" aria-hidden="true"></span>';

// ---------- calls ----------
async function call(cmd, args) {
  if (T) return T.core.invoke(cmd, args || {});
  if (cmd === 'get_config') return { base_url: 'https://smart.example.com', connected: true, default_base: 'https://smart.mattshosted.com' };
  if (cmd === 'summary') return JSON.parse(JSON.stringify(window.MOCK.summary));
  if (cmd === 'action') return window.MOCK.action(args.body);
  if (cmd === 'save_connection') return window.MOCK.summary;
  return null;
}
const act = (body) => call('action', { body });

// ---------- state ----------
let data = null;
let opts = null;          // backup_profiles: quality names and decoded TV setups
let optsAt = 0;
let tvOptions = null;
let lastRouting = null;
let timer = null;
let offline = false;

// ---------- small UI helpers ----------
let toastTimer;
function toast(msg, bad) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (bad ? ' bad' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, bad ? 6000 : 3500);
}

function confirmBox(text, yes) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="scrim"></div><div class="drawer narrow" role="alertdialog" style="top:30%;right:50%;transform:translateX(50%)"><div class="drawer-body"><p style="font-size:15px">' + esc(text) + '</p><div style="display:flex;gap:10px;justify-content:flex-end"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="yes">' + esc(yes || 'Yes, do it') + '</button></div></div></div>';
    document.body.appendChild(wrap);
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', key);
    wrap.addEventListener('click', (e) => { const a = e.target.dataset && e.target.dataset.a; if (a) done(a === 'yes'); else if (e.target.classList.contains('scrim')) done(false); });
    wrap.querySelector('[data-a="yes"]').focus();
  });
}

async function runAction(body, opt) {
  const o = opt || {};
  if (o.confirm && !(await confirmBox(o.confirm, o.yes))) return null;
  if (o.button) o.button.disabled = true;
  try {
    const r = await act(body);
    if (r && r.ok === false) { toast(r.message || 'That didn\'t work.', true); return r; }
    if (!o.quiet) toast((r && r.message) || 'Done.');
    if (o.refresh !== false) refresh();
    return r;
  } catch (e) {
    handleError(e);
    return null;
  } finally {
    if (o.button) o.button.disabled = false;
  }
}

function handleError(e) {
  const msg = String(e && e.message || e);
  if (msg === 'NOT_CONNECTED') return showConnect('');
  if (msg === 'BAD_TOKEN') return showConnect('Smart no longer accepts the saved token. Paste the current one.');
  if (msg.startsWith('OFFLINE:')) { setOffline(msg.slice(8).trim()); return; }
  toast(msg, true);
}

function setOffline(msg) {
  offline = !!msg;
  let bar = document.querySelector('.offline');
  if (!msg) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'offline';
    document.querySelector('.top').after(bar);
  }
  bar.innerHTML = shape('caution') + '<span>' + esc(msg) + (data ? ' Showing what it said ' + esc(ago(data.now)) + '.' : '') + '</span>';
}

// ---------- screens ----------
async function boot() {
  $('refreshBtn').onclick = () => refresh(true);
  $('settingsBtn').onclick = openSettings;
  $('settingsClose').onclick = closeDrawers;
  $('drawerClose').onclick = closeDrawers;
  $('scrim').onclick = closeDrawers;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawers(); });
  $('signOutBtn').onclick = signOut;
  $('connectForm').onsubmit = connect;
  setDateCap(new Date());
  try {
    if (T && T.app) $('versionLine').textContent = 'Smart desktop ' + (await T.app.getVersion());
  } catch (e) {}
  const cfg = await call('get_config');
  $('baseInput').value = cfg.base_url || cfg.default_base;
  if (!cfg.connected) return showConnect('');
  showDeck();
  refresh();
}

function showConnect(msg) {
  clearInterval(timer);
  $('deck').hidden = true;
  $('connect').hidden = false;
  $('stateLine').textContent = '';
  $('stateChip').hidden = true;
  $('refreshBtn').hidden = true;
  $('settingsBtn').hidden = true;
  setOffline('');
  $('connectErr').textContent = msg || '';
  $('tokenInput').value = '';
  setTimeout(() => ($('baseInput').value ? $('tokenInput') : $('baseInput')).focus(), 50);
}

function showDeck() {
  $('connect').hidden = true;
  $('deck').hidden = false;
  $('refreshBtn').hidden = false;
  $('settingsBtn').hidden = false;
  clearInterval(timer);
  timer = setInterval(refresh, POLL_MS);
}

async function connect(e) {
  e.preventDefault();
  const btn = $('connectBtn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  $('connectErr').textContent = '';
  try {
    const s = await call('save_connection', { baseUrl: $('baseInput').value, token: $('tokenInput').value });
    $('tokenInput').value = '';
    data = s;
    showDeck();
    render();
    loadOpts(true);
    toast('Connected. The token is in the keychain.');
  } catch (err) {
    $('connectErr').textContent = String(err && err.message || err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

async function openSettings() {
  const cfg = await call('get_config');
  $('settingsBase').textContent = cfg.base_url;
  $('scrim').hidden = false;
  $('settings').hidden = false;
}

async function signOut() {
  if (!(await confirmBox('Forget the admin token on this computer? You\'ll need to paste it again to reconnect.', 'Forget it'))) return;
  try { await call('forget'); } catch (e) { return toast(String(e), true); }
  closeDrawers();
  data = null; opts = null;
  showConnect('Signed out. The token was removed from the keychain.');
}

function closeDrawers() {
  $('scrim').hidden = true;
  $('drawer').hidden = true;
  $('settings').hidden = true;
  openHousehold = null;
}

// ---------- data ----------
let refreshing = false;
async function refresh(manual) {
  if (refreshing || $('deck').hidden) return;
  refreshing = true;
  $('refreshBtn').classList.add('spin');
  try {
    data = await call('summary');
    setOffline('');
    render();
    notifyFlip();
    if (Date.now() - optsAt > OPTS_MS) loadOpts();
    if (manual) toast('Up to date.');
  } catch (e) {
    handleError(e);
  } finally {
    refreshing = false;
    $('refreshBtn').classList.remove('spin');
  }
}

async function loadOpts() {
  try {
    const r = await act({ action: 'backup_profiles' });
    if (r && r.ok) { opts = r; optsAt = Date.now(); if (data) renderHouseholds(); }
  } catch (e) { /* the deck still works without it */ }
}

async function notifyFlip() {
  const r = data.routing || {};
  const key = r.status + (r.pinned ? '-pinned' : '');
  const was = lastRouting;
  lastRouting = key;
  if (!was || was === key || !T || !T.notification) return;
  const text = r.status === 'down' ? (r.pinned ? 'Pinned to Usenet.' : 'TorBox is down. Searches are going to Usenet.') : 'TorBox is back. Searches are on TorBox again.';
  try {
    let ok = await T.notification.isPermissionGranted();
    if (!ok) ok = (await T.notification.requestPermission()) === 'granted';
    if (ok) T.notification.sendNotification({ title: 'Smart', body: text });
  } catch (e) {}
}

// ---------- render ----------
function setDateCap(d) {
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
  const dm = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
  $('dateCap').textContent = 'FLIGHT DECK · ' + wd + ' ' + dm;
}

function totals() {
  const t = { total: 0, fallback: 0, forced: 0, rescued: 0, toppedUp: 0, failed: 0, slow: 0 };
  for (const h of data.households || []) for (const k of Object.keys(t)) t[k] += (h.today && h.today[k]) || 0;
  return t;
}

function render() {
  setDateCap(new Date());
  renderState();
  renderAttitude();
  renderReadouts();
  renderCounts();
  renderAlarms();
  renderHouseholds();
  renderLog();
  renderTape();
  renderKnobs();
  renderWeek();
  renderPaper();
}

function renderState() {
  const r = data.routing || {};
  const chip = $('stateChip');
  chip.hidden = false;
  let line, label, cls;
  if (r.pinned) { line = 'Pinned to Usenet by hand'; label = 'PINNED'; cls = 'chip m'; }
  else if (r.status === 'down') { line = 'TorBox down' + (r.downSince ? ' since ' + clock(r.downSince) : '') + ', on Usenet'; label = 'DETOUR'; cls = 'chip o'; }
  else if (data.maintenance) { line = 'TorBox maintenance: ' + data.maintenance.title; label = 'MAINTENANCE'; cls = 'chip m'; }
  else { line = 'All systems go'; label = 'ON COURSE'; cls = 'chip'; }
  $('stateLine').textContent = line;
  chip.textContent = label;
  chip.className = cls;
}

function renderAttitude() {
  const t = totals();
  const usenetShare = t.total ? Math.min(1, (t.fallback + t.forced) / t.total) : 0;
  const torPct = Math.round((1 - usenetShare) * 100);
  // The circle runs from y=20 to y=160; the horizon sits where TorBox's share ends.
  const horizon = 20 + 140 * (1 - usenetShare);
  const hy = Math.min(150, Math.max(30, horizon));
  const label = t.total ? torPct + '%' : '—';
  $('attitude').innerHTML =
    '<svg viewBox="0 0 180 180" width="190" role="img" aria-label="' + (t.total ? torPct + ' percent of today\'s searches on TorBox, ' + (100 - torPct) + ' percent on Usenet' : 'No searches yet today') + '">' +
    '<defs><clipPath id="atc"><circle cx="90" cy="90" r="70"/></clipPath></defs>' +
    '<g clip-path="url(#atc)"><rect x="0" y="0" width="180" height="' + hy + '" fill="#2A9D8F"/><rect x="0" y="' + hy + '" width="180" height="' + (180 - hy) + '" fill="#D1593A"/>' +
    '<line x1="0" y1="' + hy + '" x2="180" y2="' + hy + '" stroke="#fff" stroke-width="2"/>' +
    '<g stroke="#ffffff" stroke-opacity=".5" stroke-width="1.4"><line x1="70" y1="' + (hy - 18) + '" x2="110" y2="' + (hy - 18) + '"/><line x1="78" y1="' + (hy - 36) + '" x2="102" y2="' + (hy - 36) + '"/></g></g>' +
    '<circle cx="90" cy="90" r="70" fill="none" stroke="#2B2118" stroke-width="6"/>' +
    '<g stroke="#2B2118" stroke-width="2"><line x1="90" y1="8" x2="90" y2="16"/><line x1="49" y1="19" x2="53" y2="26"/><line x1="131" y1="19" x2="127" y2="26"/><line x1="19" y1="49" x2="26" y2="53"/><line x1="161" y1="49" x2="154" y2="53"/></g>' +
    '<path d="M60 92 H82 L90 100 L98 92 H120" fill="none" stroke="#F4ECD8" stroke-width="4" stroke-linejoin="round"/>' +
    '<text x="90" y="56" text-anchor="middle" fill="#fff" font-family="B612" font-weight="700" font-size="21">' + label + '</text>' +
    '<text x="90" y="72" text-anchor="middle" fill="#fff" font-family="Jost" font-size="10" letter-spacing="2">TORBOX</text>' +
    (t.total ? '<text x="90" y="150" text-anchor="middle" fill="#fff" font-family="Jost" font-size="10" letter-spacing="2" ' + (hy > 138 ? 'opacity="0"' : '') + '>USENET ' + (100 - torPct) + '%</text>' : '') +
    '</svg>';
}

function ro(label, value, bad) {
  return '<div class="ro"><span>' + esc(label) + '</span><span class="' + (bad ? 'bad' : '') + '">' + (bad ? shape('warning') + ' ' : '') + esc(value) + '</span></div>';
}

function renderReadouts() {
  const c = data.lastCheck;
  let h = '';
  if (c) {
    h += ro('TorBox ping', c.livePing === 'up' ? (c.livePingMs != null ? c.livePingMs + ' ms' : 'up') : 'down', c.livePing !== 'up');
    h += ro('Status page', c.statusPage, c.statusPage === 'down');
    h += ro('Home server', c.homeProbe == null ? 'no report' : c.homeProbe, c.homeProbe === 'down');
    h += ro('Last check', ago(c.at), Date.now() - Date.parse(c.at) > 10 * 60000);
  } else h += ro('Last check', 'none yet');
  if (data.uptime7d != null) h += ro('7-day uptime', data.uptime7d.toFixed(1) + '%', data.uptime7d < 98);
  if (data.usenet) h += '<div class="hint" style="margin-top:4px">' + esc(data.usenet.text) + (data.usenet.stale ? ' (old report)' : '') + '</div>';
  $('readouts').innerHTML = h;
}

function renderCounts() {
  const t = totals();
  const week = data.weekly && data.weekly.torbox ? data.weekly.torbox.uptimePct : data.uptime7d;
  $('counts').innerHTML =
    '<div><div class="cap">SEARCHES</div><div class="big">' + t.total + '</div></div>' +
    '<div><div class="cap">ON USENET</div><div class="mid-n">' + (t.fallback + t.forced) + '</div></div>' +
    '<div><div class="cap">RESCUED</div><div class="mid-n">' + (t.rescued + t.toppedUp) + '</div></div>' +
    '<div><div class="cap">FAILED</div><div class="mid-n' + (t.failed ? ' o' : '') + '">' + t.failed + '</div></div>' +
    (week != null ? '<div><div class="cap">WEEK UPTIME</div><div class="mid-n">' + week.toFixed(1) + '%</div></div>' : '');
}

function alarms() {
  const out = [];
  const r = data.routing || {};
  if (r.status === 'down' && !r.pinned) out.push({ level: 'warning', text: 'TorBox is down' + (r.downSince ? ' since ' + clock(r.downSince) : '') + '. Every search is going to Usenet.' });
  if (r.pinned) out.push({ level: 'caution', text: 'Pinned to Usenet by hand. Use the Route knob to go back to TorBox.' });
  if (data.lastCheck && Date.now() - Date.parse(data.lastCheck.at) > 10 * 60000) out.push({ level: 'warning', text: 'No TorBox check for ' + ago(data.lastCheck.at).replace(' ago', '') + '. The cron may have stopped.' });
  for (const h of data.households || []) {
    const t = h.today || {};
    if (t.failed) out.push({ level: 'warning', text: h.name + ': ' + t.failed + ' search' + (t.failed === 1 ? '' : 'es') + ' found nothing today.' });
  }
  if (data.maintenance) out.push({ level: 'caution', text: 'TorBox maintenance: ' + data.maintenance.title + (data.maintenance.endsAt ? ', until ' + clock(data.maintenance.endsAt) : '') });
  if (data.usenet) {
    for (const p of data.usenet.problems || []) out.push({ level: 'caution', text: p });
    if (data.usenet.stale) out.push({ level: 'caution', text: 'The home server\'s Usenet report is ' + ago(data.usenet.at).replace(' ago', '') + ' old.' });
  }
  for (const h of data.households || []) {
    const t = h.today || {};
    if (t.slow) out.push({ level: 'caution', text: h.name + ': ' + t.slow + ' slow search' + (t.slow === 1 ? '' : 'es') + ' today.' });
  }
  for (const m of (data.inbox || []).filter((m) => Date.now() - Date.parse(m.at) < 24 * 3600000).slice(0, 3)) {
    out.push({ level: 'note', text: stripEmoji(m.text), at: m.at, buttons: m.buttons || [] });
  }
  const rank = { warning: 0, caution: 1, note: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

function renderAlarms() {
  const list = alarms();
  const el = $('alarms');
  if (!list.length) { el.innerHTML = '<div class="calm">' + shape('note') + '<span><b>Nothing needs a look.</b> Alerts and problems show up here.</span></div>'; return; }
  el.innerHTML = list.map((a, i) => '<div class="alarm">' + shape(a.level) + '<div class="txt">' + esc(a.text) +
    (a.buttons && a.buttons.length ? '<div>' + a.buttons.map((b, j) => '<button data-alarm="' + i + '" data-btn="' + j + '">' + esc(b.label) + '</button>').join('') + '</div>' : '') +
    '</div>' + (a.at ? '<span class="when">' + clock(a.at) + '</span>' : '') + '</div>').join('');
  el.querySelectorAll('button[data-alarm]').forEach((b) => {
    const a = list[+b.dataset.alarm], btn = a.buttons[+b.dataset.btn];
    b.onclick = () => runAction({ action: btn.action }, { button: b, confirm: 'Run "' + btn.label + '"? This alert is from ' + clock(a.at) + '.' });
  });
}

function setupLine(name) {
  const t = opts && opts.tv && opts.tv[name];
  const c = t && t.check;
  if (!c) return null;
  const bits = [];
  if (c.tv) bits.push([c.tv.brand, c.tv.series].filter(Boolean).join(' ') || 'TV');
  else if (t.setup && t.setup.model) bits.push(t.setup.model);
  if (c.box) bits.push(c.box.name);
  if (c.sound === 'atmos') bits.push('Atmos');
  else if (c.sound === 'soundbar') bits.push('Soundbar');
  return bits.join(' · ') || null;
}

function qualityChip(h) {
  const t = opts && opts.tv && opts.tv[h.name];
  if (!t) {
    const p = (data.backupProfiles || []).find((p) => p.id === h.backupProfile);
    return h.backupChoice === 'auto' ? 'Auto' : (p ? p.name : '');
  }
  const u = t.using || {};
  return u.auto ? 'Auto · ' + (u.summary || '') : (u.name || '');
}

function renderHouseholds() {
  const el = $('households');
  const list = data.households || [];
  if (!list.length) { el.innerHTML = '<div class="hint">No households yet. Add one on the Smart admin page.</div>'; return; }
  el.innerHTML = list.map((h, i) => {
    const t = h.today || {};
    const setup = setupLine(h.name);
    const q = qualityChip(h);
    const noTv = opts && opts.tv && opts.tv[h.name] && !opts.tv[h.name].setup;
    let flags = '';
    if (t.failed) flags += '<span class="flag">' + shape('warning') + ' ' + t.failed + ' failed</span>';
    else if (t.slow) flags += '<span class="flag">' + shape('caution') + ' ' + t.slow + ' slow</span>';
    return '<button class="hh" data-i="' + i + '"><div class="row" style="margin:0"><b>' + esc(h.name) + '</b><span class="n">' + (t.total || 0) + '</span></div>' +
      '<small>' + esc(setup || (opts ? 'No TV on file' : '…')) + '</small>' +
      '<small>Active ' + esc(ago(h.lastActive)) + '</small>' +
      '<div class="row">' + (noTv ? '<span class="chip o">▲ Add TV</span>' : q ? '<span class="chip">' + esc(q) + '</span>' : '') +
      (h.forcedNext ? '<span class="chip m">NEXT → USENET</span>' : '') + flags + '</div></button>';
  }).join('');
  el.querySelectorAll('.hh').forEach((b) => { b.onclick = () => openHouseholdDrawer(list[+b.dataset.i].name); });
}

const OUTCOME = {
  ok: [null, 'found'],
  rescued: ['note', 'rescued'],
  topped_up: ['note', 'topped up'],
  backup_addon: ['caution', 'backup addon'],
  failed: ['warning', 'nothing found'],
};

function renderLog() {
  const list = (data.searches || []).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 14);
  if (!list.length) { $('log').innerHTML = '<div class="hint">No searches yet.</div>'; return; }
  $('log').innerHTML = list.map((s) => {
    const o = OUTCOME[s.outcome] || [null, s.outcome || ''];
    return '<div class="e"><span class="t">' + clock(s.at) + '</span><span class="w"><b>' + esc(s.profile) + '</b> · ' + esc(s.title || s.what || 'search') + '</span><span class="o">' + (o[0] ? shape(o[0]) : '') + esc(o[1]) + (s.ms ? ' · ' + (s.ms / 1000).toFixed(1) + 's' : '') + '</span></div>';
  }).join('');
}

function renderTape() {
  const checks = data.checks || [];
  const c = checks[0];
  const cur = c && c.up && c.pingMs != null ? c.pingMs : null;
  const step = 40;
  let h = '';
  if (cur == null) {
    h = '<span class="dim">—</span><span class="cur bad">DOWN</span><span class="dim">—</span>';
  } else {
    const r10 = (v) => Math.max(0, Math.round(v / 10) * 10);
    h += '<span class="dim">' + r10(cur + 2 * step) + '</span><span class="dim">' + r10(cur + step) + '</span>';
    h += '<span class="cur' + (cur > 1500 ? ' bad' : '') + '">' + cur + '</span>';
    h += '<span class="dim">' + r10(cur - step) + '</span><span class="dim">' + r10(cur - 2 * step) + '</span>';
  }
  h += '<span class="unit">MS · LAST CHECK</span>';
  // A little trace of the last 48 checks, oldest on the left.
  const pts = checks.slice().reverse();
  if (pts.length > 1) {
    const vals = pts.map((p) => (p.up && p.pingMs != null ? p.pingMs : null));
    const good = vals.filter((v) => v != null);
    const max = Math.max(200, ...good), min = Math.min(...good, max);
    const W = 180, H = 34;
    let d = '', down = '';
    vals.forEach((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      if (v == null) { down += '<rect x="' + (x - 2) + '" y="0" width="4" height="' + H + '" fill="#D1593A"/>'; return; }
      const y = H - 3 - ((v - min) / Math.max(1, max - min)) * (H - 6);
      d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    h += '<svg viewBox="0 0 ' + W + ' ' + H + '" width="88%" height="' + H + '" aria-label="Ping over the last ' + vals.length + ' checks">' + down + '<path d="' + d + '" fill="none" stroke="#F4ECD8" stroke-width="1.5"/></svg>';
  }
  $('tape').innerHTML = h;
}

function renderKnobs() {
  const r = data.routing || {};
  const n = data.notifications || {};
  const onUsenet = r.pinned;
  const knobs = [
    { label: 'Route: ' + (onUsenet ? 'Usenet' : r.status === 'down' ? 'Usenet (auto)' : 'TorBox'), sub: onUsenet ? 'Turn to go back to TorBox' : 'Turn to pin to Usenet', rot: onUsenet ? 200 : 0,
      run: (b) => onUsenet
        ? runAction({ action: 'restore_normal' }, { button: b, confirm: 'Unpin and re-check TorBox now?' })
        : runAction({ action: 'pin_fallback' }, { button: b, confirm: 'Switch every household to Usenet-only now?' }) },
    { label: 'Clear search cache', sub: 'Every household', rot: 90,
      run: (b) => runAction({ action: 'clear_cache' }, { button: b, confirm: 'Clear the Prowlarr search cache for every household?' }) },
    { label: 'Telegram: ' + (n.telegramMuted ? 'quiet' : 'on'), sub: n.telegramMuted ? 'Phones only. Turn to send to Telegram too' : 'Turn to send alerts to phones only', rot: n.telegramMuted ? 200 : 0,
      run: (b) => runAction({ action: 'telegram_mute', muted: !n.telegramMuted }, { button: b, confirm: n.telegramMuted ? null : 'Stop sending Smart alerts to Telegram? If a push fails, Telegram still gets it.' }) },
  ];
  $('knobs').innerHTML = knobs.map((k, i) => '<button class="knob" data-k="' + i + '"><i style="transform:rotate(' + k.rot + 'deg)"></i><span>' + esc(k.label) + '<small>' + esc(k.sub) + '</small></span></button>').join('');
  $('knobs').querySelectorAll('.knob').forEach((b) => { b.onclick = () => knobs[+b.dataset.k].run(b); });
}

function renderWeek() {
  const w = data.weekly || {};
  const tb = w.torbox || {};
  let h = '';
  if (tb.uptimePct != null) h += ro('TorBox uptime', tb.uptimePct.toFixed(1) + '%');
  if (tb.outages != null) h += ro('Outages', tb.outages + (tb.downMinutes ? ' · ' + tb.downMinutes + ' min' : ''));
  for (const x of w.households || []) {
    h += ro(x.name, (x.firstTryPct != null ? Math.round(x.firstTryPct) + '% first try' : x.total + ' searches'), x.failed > 0);
  }
  for (const a of (w.attention || []).slice(0, 4)) h += '<div class="hint">' + shape('caution') + ' ' + esc(a.text) + '</div>';
  $('week').innerHTML = h || '<div class="hint">No weekly figures yet.</div>';
}

function renderPaper() {
  const today = (data.searches || []).filter((s) => isToday(s.at)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const W = 960, H = 86, top = 14, bottom = 70;
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const x = (ms) => ((ms - dayStart) / 86400000) * W;
  const total = Math.max(10, today.length);
  const y = (n) => bottom - (n / total) * (bottom - top);
  let g = '<g stroke="#ead9b8">';
  for (let i = 1; i < 24; i++) g += '<line x1="' + x(dayStart + i * 3600000) + '" y1="' + top + '" x2="' + x(dayStart + i * 3600000) + '" y2="' + bottom + '"/>';
  for (let i = 0; i <= 3; i++) g += '<line x1="0" y1="' + (top + i * (bottom - top) / 3) + '" x2="' + W + '" y2="' + (top + i * (bottom - top) / 3) + '"/>';
  g += '</g>';
  let labels = '<g fill="#6B4A2F" font-family="Courier Prime" font-size="10">';
  for (const hr of [0, 3, 6, 9, 12, 15, 18, 21]) labels += '<text x="' + (x(dayStart + hr * 3600000) + 2) + '" y="' + (H - 4) + '">' + String(hr).padStart(2, '0') + ':00</text>';
  labels += '</g>';
  // Cumulative searches through the day, like a pen on a drum.
  let d = 'M0 ' + bottom, n = 0, marks = '';
  for (const s of today) {
    const xs = x(Date.parse(s.at));
    d += ' L' + xs.toFixed(1) + ' ' + y(n).toFixed(1);
    n++;
    d += ' L' + xs.toFixed(1) + ' ' + y(n).toFixed(1);
    if (s.outcome === 'failed') marks += '<rect x="' + (xs - 4) + '" y="' + (y(n) - 4) + '" width="8" height="8" fill="#B3261E" transform="rotate(45 ' + xs + ' ' + y(n) + ')"/>';
  }
  const xn = x(now.getTime());
  d += ' L' + xn.toFixed(1) + ' ' + y(n).toFixed(1);
  // Notes: today's outage periods (if the server lists them) and the latest failure.
  let notes = '';
  const fails = today.filter((s) => s.outcome === 'failed');
  if (fails.length) {
    const f = fails[fails.length - 1];
    const fx = Math.max(4, Math.min(W - 300, x(Date.parse(f.at)) - 150));
    notes += '<text x="' + fx + '" y="' + (top - 2) + '" fill="#B3261E" font-family="Courier Prime" font-size="11">' + esc(clock(f.at) + ' ' + f.profile + ': ' + (f.title || f.what || 'search') + ' found nothing') + '</text>';
  } else if (data.routing && data.routing.status === 'down' && data.routing.downSince) {
    const dx = Math.max(0, x(Date.parse(data.routing.downSince)));
    notes += '<rect x="' + dx + '" y="' + top + '" width="' + Math.max(2, xn - dx) + '" height="' + (bottom - top) + '" fill="#D1593A" opacity=".12"/>';
    notes += '<text x="' + Math.min(W - 200, dx + 4) + '" y="' + (top - 2) + '" fill="#6B4A2F" font-family="Courier Prime" font-size="11">' + esc(clock(data.routing.downSince)) + ' detour to Usenet</text>';
  }
  $('paper').innerHTML = '<div class="cap" style="display:flex;justify-content:space-between"><span>CHART PAPER · SEARCHES TODAY</span><span>' + today.length + ' so far</span></div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Searches through the day: ' + today.length + ' so far, ' + fails.length + ' found nothing">' +
    g + notes + '<path d="' + d + '" fill="none" stroke="#D1593A" stroke-width="2" vector-effect="non-scaling-stroke"/>' + marks +
    '<circle cx="' + xn + '" cy="' + y(n) + '" r="3.5" fill="#D1593A"/>' + labels + '</svg>';
}

// ---------- household drawer ----------
let openHousehold = null;
let draft = null;

async function openHouseholdDrawer(name) {
  openHousehold = name;
  $('drawerTitle').textContent = name;
  $('scrim').hidden = false;
  $('drawer').hidden = false;
  $('drawerBody').innerHTML = '<div class="hint">Loading…</div>';
  try {
    if (!tvOptions) { const r = await act({ action: 'tv_options' }); if (r && r.ok) tvOptions = r; }
    if (!opts) await loadOpts();
  } catch (e) { handleError(e); }
  if (openHousehold !== name) return;
  const t = (opts && opts.tv && opts.tv[name]) || {};
  draft = JSON.parse(JSON.stringify(t.setup || {}));
  renderDrawer();
}

function renderDrawer() {
  const name = openHousehold;
  const h = (data.households || []).find((x) => x.name === name);
  if (!h) return closeDrawers();
  const t = h.today || {};
  const tvInfo = (opts && opts.tv && opts.tv[name]) || {};
  const profiles = (opts && opts.backupProfiles) || data.backupProfiles || [];
  const choice = (opts && opts.households && opts.households[name]) || h.backupChoice;
  const tvo = tvOptions || { boxes: [], catalog: [], sounds: [] };

  const catIdx = draft.catalog ? tvo.catalog.findIndex((c) => c.brand === draft.catalog.brand && c.series === draft.catalog.series && (c.year == null ? null : c.year) === (draft.catalog.year == null ? null : draft.catalog.year)) : -1;
  const brands = [...new Set(tvo.catalog.map((c) => c.brand))];
  const groups = [...new Set(tvo.boxes.map((b) => b.group))];

  $('drawerBody').innerHTML =
    '<div class="stats">' +
      '<div class="stat"><b>' + (t.total || 0) + '</b><span>searches</span></div>' +
      '<div class="stat"><b>' + ((t.fallback || 0) + (t.forced || 0)) + '</b><span>on Usenet</span></div>' +
      '<div class="stat"><b>' + ((t.rescued || 0) + (t.toppedUp || 0)) + '</b><span>rescued</span></div>' +
      '<div class="stat"><b style="color:' + (t.failed ? '#B3261E' : 'inherit') + '">' + (t.failed || 0) + '</b><span>failed</span></div>' +
    '</div>' +
    '<p class="hint">Last active ' + esc(ago(h.lastActive)) + (h.jellyfin ? ' · Jellyfin login on' : '') + '</p>' +
    '<div class="toggle"><span><b>Next search on Usenet</b><small>' + (h.forcedNext ? 'On: their next search skips TorBox.' : 'Off: searches go the normal way.') + '</small></span>' +
      '<button class="ghost" id="forceBtn">' + (h.forcedNext ? 'Turn off' : 'Turn on') + '</button></div>' +
    '<label>USENET QUALITY<select id="qualitySel">' +
      '<option value="auto"' + (choice === 'auto' ? ' selected' : '') + '>Auto, from their TV' + (tvInfo.using && tvInfo.using.auto ? ' (' + esc(tvInfo.using.summary) + ')' : '') + '</option>' +
      profiles.map((p) => '<option value="' + esc(p.id) + '"' + (choice === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
    '</select></label>' +
    '<div class="cap">TV SETUP</div>' +
    '<label>TV MODEL NUMBER<input id="modelIn" spellcheck="false" placeholder="e.g. OLED65C3PUA" value="' + esc(draft.model || '') + '"></label>' +
    '<div class="or">or</div>' +
    '<label>PICK THE TV<select id="catSel"><option value="-1">Not picked</option>' +
      brands.map((b) => '<optgroup label="' + esc(b) + '">' + tvo.catalog.map((c, i) => c.brand === b ? '<option value="' + i + '"' + (i === catIdx ? ' selected' : '') + '>' + esc(c.label) + '</option>' : '').join('') + '</optgroup>').join('') +
    '</select></label>' +
    '<div class="two">' +
      '<label>BOX<select id="boxSel"><option value="">None, the TV\'s own apps</option>' +
        groups.map((g) => '<optgroup label="' + esc(g) + '">' + tvo.boxes.filter((b) => b.group === g).map((b) => '<option value="' + esc(b.id) + '"' + (draft.box === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</optgroup>').join('') +
      '</select></label>' +
      '<label>SOUND<select id="soundSel"><option value="">Not set</option>' +
        tvo.sounds.map((s) => '<option value="' + esc(s.id) + '"' + (draft.sound === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') +
      '</select></label>' +
    '</div>' +
    '<div id="checkOut"></div>' +
    '<div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap">' +
      (tvInfo.setup ? '<button class="ghost danger" id="tvClear">Remove TV</button>' : '<span></span>') +
      '<button class="primary" id="tvSave">Save TV setup</button></div>';

  $('forceBtn').onclick = (e) => runAction({ action: h.forcedNext ? 'unforce' : 'force', household: name }, { button: e.target }).then(() => refreshDrawerSoon());
  $('qualitySel').onchange = async (e) => {
    await runAction({ action: 'household_profile_set', household: name, profile: e.target.value }, { refresh: false });
    await loadOpts(); refresh();
  };
  const changed = () => {
    const m = $('modelIn').value.trim();
    const ci = +$('catSel').value;
    draft = {};
    if (m) draft.model = m;
    else if (ci >= 0) { const c = tvo.catalog[ci]; draft.catalog = { brand: c.brand, series: c.series, year: c.year == null ? null : c.year }; }
    if ($('boxSel').value) draft.box = $('boxSel').value;
    if ($('soundSel').value) draft.sound = $('soundSel').value;
    checkSoon();
  };
  $('modelIn').oninput = () => { if ($('modelIn').value.trim()) $('catSel').value = '-1'; changed(); };
  $('catSel').onchange = () => { if (+$('catSel').value >= 0) $('modelIn').value = ''; changed(); };
  $('boxSel').onchange = changed;
  $('soundSel').onchange = changed;
  $('tvSave').onclick = async (e) => {
    const r = await runAction({ action: 'household_tv_set', household: name, setup: Object.keys(draft).length ? draft : null }, { button: e.target, refresh: false });
    if (r && r.ok) { await loadOpts(); refresh(); }
  };
  if ($('tvClear')) $('tvClear').onclick = async (e) => {
    const r = await runAction({ action: 'household_tv_set', household: name, setup: null }, { button: e.target, refresh: false, confirm: 'Remove ' + name + '\'s TV setup? Auto quality falls back to the default profile.' });
    if (r && r.ok) { draft = {}; await loadOpts(); refresh(); renderDrawer(); }
  };
  checkSoon(0);
}

function refreshDrawerSoon() { setTimeout(() => { if (openHousehold) renderDrawer(); }, 1500); }

let checkTimer, checkSeq = 0;
function checkSoon(delay) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runCheck, delay == null ? 450 : delay);
}
async function runCheck() {
  const out = $('checkOut');
  if (!out) return;
  if (!Object.keys(draft).length) { out.innerHTML = '<p class="hint">' + shape('caution') + ' No TV on file. Add it so Auto can pick the right quality.</p>'; return; }
  const seq = ++checkSeq;
  let r;
  try { r = await act({ action: 'tv_check', setup: draft }); } catch (e) { return handleError(e); }
  if (seq !== checkSeq || !$('checkOut')) return;
  if (!r || r.ok === false) { out.innerHTML = '<p class="err">' + esc((r && r.message) || 'Couldn\'t check that setup.') + '</p>'; return; }
  const c = r.check || {};
  const cell = (v) => v == null ? '<span class="no">?</span>' : v === true ? '<span class="yes">Yes</span>' : v === false ? '<span class="no">No</span>' : esc(v);
  const hasBox = (c.rows || []).some((x) => x.box !== undefined);
  out.innerHTML = '<table class="checkt"><tr><th></th><th>TV</th>' + (hasBox ? '<th>BOX</th>' : '') + '<th>RESULT</th></tr>' +
    (c.rows || []).map((x) => '<tr><td>' + esc(x.label) + (x.corrected ? ' *' : '') + '</td><td>' + cell(x.tv) + '</td>' + (hasBox ? '<td>' + cell(x.box) + '</td>' : '') + '<td><b>' + cell(x.result) + '</b></td></tr>').join('') + '</table>' +
    (r.auto ? '<p class="hint" style="margin-top:6px">Auto would use: <b>' + esc(r.auto.summary || r.auto.name) + '</b></p>' : '') +
    ((c.notes || []).length ? '<ul class="notes">' + c.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '');
}

boot();
