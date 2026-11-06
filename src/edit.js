// Editing: Jellyfin, rows, renaming, Usenet quality profiles and problem reports.
// Everything here goes through the same Worker actions /admin uses, via Rust.
// Loaded before app.js; it only runs when someone opens one of these panels.

// ---------- what's inside a quality profile ----------
const resName = (r) => (r === 2160 ? '4K' : r + 'p');
const KIND_NAMES = { visual: 'Picture', quality: 'Source', audio: 'Sound', channels: 'Channels', encode: 'Encode' };

function profileLines(p) {
  if (!p) return [];
  const out = [];
  out.push(['Resolution', 'Up to ' + resName(p.maxRes) + (p.preferRes && p.preferRes !== p.maxRes ? ', prefers ' + resName(p.preferRes) : '')]);
  out.push(['HDR', p.hdr === 'prefer' ? 'Preferred' : p.hdr === 'avoid' ? 'Avoided' : 'Allowed']);
  const size = p.minSizeGb && p.maxSizeGb ? p.minSizeGb + ' to ' + p.maxSizeGb + ' GB'
    : p.maxSizeGb ? 'Up to ' + p.maxSizeGb + ' GB' : p.minSizeGb ? 'At least ' + p.minSizeGb + ' GB' : 'Any size';
  out.push(['Size', size]);
  for (const [key, label] of [['prefer', 'Prefers'], ['avoid', 'Avoids']]) {
    const by = p[key] || {};
    const kinds = Object.keys(by).filter((k) => by[k] && by[k].length);
    if (!kinds.length) continue;
    out.push([label, kinds.map((k) => KIND_NAMES[k] + ': ' + by[k].join(', ')).join(' · ')]);
  }
  if (p.avoid && Object.keys(p.avoid).length) out.push(['Avoided go', p.avoidMode === 'last' ? 'To the very end of the list' : 'Down within their resolution']);
  return out;
}

function profileTable(p) {
  return '<table class="inside">' + profileLines(p).map((l) => '<tr><th>' + esc(l[0]) + '</th><td>' + esc(l[1]) + '</td></tr>').join('') + '</table>';
}

// The profile a household's pick resolves to, including Auto.
function householdProfile(name, choice) {
  const profiles = (opts && opts.backupProfiles) || data.backupProfiles || [];
  if (choice === 'auto') {
    const t = (opts && opts.tv && opts.tv[name]) || {};
    return { auto: true, made: t.made || null, using: t.using || null };
  }
  return { profile: profiles.find((p) => p.id === choice) || profiles.find((p) => p.default) || profiles[0] };
}

function insideHtml(name, choice) {
  const r = householdProfile(name, choice);
  if (!r.auto) return r.profile ? profileTable(r.profile) : '';
  if (r.made) return '<p class="hint">Auto, made for their TV:</p>' + profileTable(r.made);
  return '<p class="hint flex">' + shape('caution') + ' Auto needs their TV. Until then it uses ' + esc((r.using && r.using.name) || 'the default') + '.</p>';
}

// ---------- household tabs ----------
let hhTab = 'overview';
const HH_TABS = [['overview', 'Overview'], ['tv', 'TV'], ['jellyfin', 'Jellyfin'], ['rows', 'Rows']];
function tabsHtml() {
  return '<div class="tabs" role="tablist">' + HH_TABS.map((t) => '<button role="tab" class="tab' + (hhTab === t[0] ? ' on' : '') + '" aria-selected="' + (hhTab === t[0]) + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
}
function bindTabs() {
  for (const b of document.querySelectorAll('#drawerBody .tab')) b.onclick = () => { hhTab = b.dataset.tab; $('drawerBody').scrollTop = 0; renderDrawer(); };
}

function renameHtml(name) {
  return '<div class="cap">NAME</div><div class="inline"><input id="renameIn" maxlength="40" spellcheck="false" value="' + esc(name) + '" aria-label="Household name"><button class="ghost" id="renameBtn">Rename</button></div>' +
    '<p class="fine">Their links keep working: Smart remembers the old name.</p>';
}
function bindRename(name) {
  $('renameBtn').onclick = async (e) => {
    const to = $('renameIn').value.trim();
    if (!to || to === name) return;
    const r = await runAction({ action: 'rename_profile', name: name, newName: to }, { button: e.target, refresh: false, confirm: 'Rename ' + name + ' to ' + to + '?' });
    if (r && r.ok !== false) { openHousehold = to; $('drawerTitle').textContent = to; await refresh(); await loadOpts(); renderDrawer(); }
  };
}

// ---------- Jellyfin tab ----------
function loginHtml(r) {
  return '<table class="inside"><tr><th>Username</th><td class="mono">' + esc(r.username) + '</td><td><button class="ghost sm" data-copy="' + esc(r.username) + '">Copy</button></td></tr>' +
    '<tr><th>Password</th><td class="mono">' + esc(r.password) + '</td><td><button class="ghost sm" data-copy="' + esc(r.password) + '">Copy</button></td></tr></table>';
}
function bindCopy(root) {
  for (const b of root.querySelectorAll('[data-copy]')) b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied.'); } catch (e) { toast('Couldn\'t copy. Select it instead.', true); }
  };
}

function renderJellyfinTab(name, h) {
  const box = $('tabBody');
  if (!h.jellyfin) {
    box.innerHTML = '<p>Jellyfin is off for ' + esc(name) + '. Turning it on makes a Jellyfin login for apps like Infuse, using their AIOStreams config.</p>' +
      '<label>THEIR AIOSTREAMS CONFIG PASSWORD<input id="jfPw" type="password" autocomplete="off" spellcheck="false"></label>' +
      '<div class="err" id="jfErr"></div><div><button class="primary" id="jfOn">Turn on Jellyfin</button></div>';
    $('jfOn').onclick = async (e) => {
      const pw = $('jfPw').value;
      if (!pw) { $('jfErr').textContent = 'Type their AIOStreams config password first.'; return; }
      const r = await runAction({ action: 'jellyfin_on', name: name, password: pw }, { button: e.target, quiet: true });
      $('jfPw').value = '';
      if (r && r.ok !== false && r.username) { h.jellyfin = true; box.innerHTML = '<p>Jellyfin is on. Their login:</p>' + loginHtml(r); bindCopy(box); }
      else if (r) $('jfErr').textContent = r.message || 'That didn\'t work.';
    };
    return;
  }
  box.innerHTML = '<p>Jellyfin is on for ' + esc(name) + '.</p><div id="jfLogin"></div>' +
    '<div class="btnrow"><button class="ghost" id="jfShow">Show login</button><button class="ghost" id="jfNew">New password</button><button class="ghost danger" id="jfOff">Turn off</button></div>';
  const show = (r) => { if (r && r.ok !== false && r.username) { $('jfLogin').innerHTML = loginHtml(r); bindCopy($('jfLogin')); } };
  $('jfShow').onclick = async (e) => show(await runAction({ action: 'jellyfin_login', name: name }, { button: e.target, quiet: true, refresh: false }));
  $('jfNew').onclick = async (e) => show(await runAction({ action: 'jellyfin_new_password', name: name }, { button: e.target, quiet: true, refresh: false, confirm: 'Make a new Jellyfin password for ' + name + '? Their apps sign out until they type the new one.' }));
  $('jfOff').onclick = async (e) => {
    const r = await runAction({ action: 'jellyfin_off', name: name }, { button: e.target, confirm: 'Turn off Jellyfin for ' + name + '? Their login and rows are removed.' });
    if (r && r.ok !== false) { h.jellyfin = false; renderJellyfinTab(name, h); }
  };
}

// ---------- Rows tab ----------
let rows = null;          // { name, views, newHidden, dirty }
let rowSets = null;

async function loadRows(name) {
  const r = await act({ action: 'categories', name: name });
  if (!r || r.ok === false) throw new Error((r && r.message) || 'Couldn\'t load their rows.');
  rows = { name: name, views: r.views || [], newHidden: !!r.newHidden, dirty: false };
}

async function renderRowsTab(name, h) {
  const box = $('tabBody');
  if (!h.jellyfin) { box.innerHTML = '<p class="hint flex">' + shape('note') + ' Rows are Jellyfin\'s home screen. Turn on Jellyfin for ' + esc(name) + ' first.</p>'; return; }
  if (!rows || rows.name !== name) {
    box.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel short"></div>';
    try { await loadRows(name); } catch (e) { box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; return; }
    if (openHousehold !== name || hhTab !== 'rows') return;
  }
  drawRows(name);
  if (!rowSets) act({ action: 'sets' }).then((r) => { if (r && r.ok !== false) { rowSets = r; if (openHousehold === name && hhTab === 'rows') drawRowTools(name); } }).catch(() => {});
}

function drawRows(name) {
  const box = $('tabBody');
  const v = rows.views;
  box.innerHTML = '<p class="hint">Top to bottom as they show in Jellyfin. Hidden rows stay saved.</p>' +
    '<ol class="rowlist">' + v.map((r, i) =>
      '<li class="' + (r.hidden ? 'off' : '') + '">' +
        '<span class="mv"><button class="icon-btn sm" data-up="' + i + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="icon-btn sm" data-down="' + i + '" aria-label="Move down"' + (i === v.length - 1 ? ' disabled' : '') + '>↓</button></span>' +
        '<span class="nm"><input data-name="' + i + '" value="' + esc(r.shownAs || r.name) + '" aria-label="Row name" spellcheck="false"><small>' + esc(r.from + (r.type ? ' · ' + (r.type === 'movie' ? 'movies' : r.type === 'series' ? 'shows' : 'movies and shows') : '') + (r.backupSince ? ' · on backup since ' + clock(r.backupSince) : '')) + '</small></span>' +
        '<button class="ghost sm" data-hide="' + i + '">' + (r.hidden ? 'Show' : 'Hide') + '</button>' +
        (r.added ? '<button class="ghost sm danger" data-rm="' + i + '" aria-label="Remove ' + esc(r.shownAs || r.name) + '">Remove</button>' : '<span class="sm-gap"></span>') +
      '</li>').join('') + '</ol>' +
    '<label class="check"><input type="checkbox" id="newHidden"' + (rows.newHidden ? ' checked' : '') + '> Keep new AIOStreams rows hidden</label>' +
    '<div id="rowTools"></div>';
  const mark = () => { rows.dirty = true; $('drawerFoot').hidden = false; };
  for (const b of box.querySelectorAll('[data-up],[data-down]')) b.onclick = () => {
    const i = +(b.dataset.up ?? b.dataset.down), j = b.dataset.up != null ? i - 1 : i + 1;
    [v[i], v[j]] = [v[j], v[i]]; mark(); drawRows(name);
  };
  for (const b of box.querySelectorAll('[data-hide]')) b.onclick = () => { const r = v[+b.dataset.hide]; r.hidden = !r.hidden; mark(); drawRows(name); };
  for (const inp of box.querySelectorAll('[data-name]')) inp.oninput = () => { const r = v[+inp.dataset.name]; r.shownAs = inp.value.trim() === r.name ? '' : inp.value; mark(); };
  for (const b of box.querySelectorAll('[data-rm]')) b.onclick = async () => {
    const r = v[+b.dataset.rm];
    const res = await runAction({ action: 'category_remove', name: name, id: r.id }, { button: b, refresh: false, confirm: 'Remove the row "' + (r.shownAs || r.name) + '" from ' + name + '?' });
    if (res && res.ok !== false) { await loadRows(name); drawRows(name); }
  };
  $('newHidden').onchange = (e) => { rows.newHidden = e.target.checked; mark(); };
  $('drawerFoot').hidden = !rows.dirty;
  $('drawerFoot').innerHTML = '<button class="ghost" id="rowsUndo">Undo changes</button><button class="primary" id="rowsSave">Save rows</button>';
  $('rowsUndo').onclick = async () => { await loadRows(name); drawRows(name); };
  $('rowsSave').onclick = async (e) => {
    const r = await runAction({ action: 'categories_save', name: name, views: rows.views.map((x) => ({ id: x.id, hidden: !!x.hidden, shownAs: x.shownAs || '' })), newHidden: rows.newHidden }, { button: e.target, refresh: false });
    if (r && r.ok !== false) { await loadRows(name); drawRows(name); }
  };
  drawRowTools(name);
}

function drawRowTools(name) {
  const box = $('rowTools');
  if (!box) return;
  const others = (data.households || []).filter((x) => x.name !== name && x.jellyfin);
  const sets = rowSets ? [].concat(rowSets.builtin || [], rowSets.mine || []) : [];
  box.innerHTML =
    '<div class="cap">ADD FROM MDBLIST</div>' +
    '<div class="inline"><input id="mdbQ" placeholder="Search lists, e.g. Oscar winners" spellcheck="false" aria-label="Search MDBList"><button class="ghost" id="mdbGo">Search</button></div>' +
    '<div id="mdbOut"></div>' +
    (sets.length ? '<div class="cap">STARTER SET</div><div class="inline"><select id="setSel" aria-label="Starter set">' + sets.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name || s.title) + (s.rows ? ' (' + s.rows.length + ' rows)' : '') + '</option>').join('') + '</select>' +
      '<button class="ghost" id="setAdd">Add rows</button><button class="ghost danger" id="setReplace">Replace all</button></div>' : '') +
    (others.length ? '<div class="cap">COPY ROWS</div><div class="inline"><select id="copySel" aria-label="Copy rows from">' + others.map((x) => '<option>' + esc(x.name) + '</option>').join('') + '</select><button class="ghost" id="copyGo">Copy their rows</button></div>' : '');
  const after = async (r) => { if (r && r.ok !== false) { await loadRows(name); drawRows(name); } };
  const search = async () => {
    const q = $('mdbQ').value.trim();
    if (!q) return;
    $('mdbOut').innerHTML = '<div class="skel short"></div>';
    let r;
    try { r = await act({ action: 'lists_search', query: q }); } catch (e) { return handleError(e); }
    if (!$('mdbOut')) return;
    if (!r || r.ok === false) { $('mdbOut').innerHTML = '<p class="err">' + esc((r && r.message) || 'MDBList didn\'t answer.') + '</p>'; return; }
    const lists = (r.lists || []).slice(0, 12);
    $('mdbOut').innerHTML = lists.length ? '<ul class="found">' + lists.map((l, i) => '<li><span><b>' + esc(l.name) + '</b><small>' + esc((l.by ? 'by ' + l.by + ' · ' : '') + l.items + ' titles · ' + (l.type === 'movie' ? 'movies' : l.type === 'series' ? 'shows' : 'mixed')) + '</small></span><button class="ghost sm" data-add="' + i + '">Add</button></li>').join('') + '</ul>' : '<p class="hint">No lists found.</p>';
    for (const b of $('mdbOut').querySelectorAll('[data-add]')) b.onclick = async () => {
      const l = lists[+b.dataset.add];
      after(await runAction({ action: 'list_add', name: name, id: l.id, title: l.name }, { button: b, refresh: false }));
    };
  };
  $('mdbGo').onclick = search;
  $('mdbQ').onkeydown = (e) => { if (e.key === 'Enter') search(); };
  if ($('setAdd')) {
    const label = () => $('setSel').selectedOptions[0].textContent;
    $('setAdd').onclick = async (e) => after(await runAction({ action: 'set_apply', name: name, set: $('setSel').value, mode: 'add' }, { button: e.target, refresh: false }));
    $('setReplace').onclick = async (e) => after(await runAction({ action: 'set_apply', name: name, set: $('setSel').value, mode: 'replace' }, { button: e.target, refresh: false, confirm: 'Replace all of ' + name + '\'s added rows with ' + label() + '?' }));
  }
  if ($('copyGo')) $('copyGo').onclick = async (e) => after(await runAction({ action: 'rows_copy', name: name, from: $('copySel').value }, { button: e.target, refresh: false, confirm: 'Copy ' + $('copySel').value + '\'s rows to ' + name + '?' }));
}

// ---------- side panels: quality profiles and reports ----------
let panelMode = null;     // 'quality' | 'reports'
function openSidePanel(mode) {
  panelMode = mode;
  openHousehold = null;
  $('drawerBody').scrollTop = 0;
  if (mode === 'quality') renderQualityPanel(); else renderReportsPanel();
  openPanel($('scrim'));
  openPanel($('drawer'));
  if (mode === 'quality' && !opts) loadOpts().then(() => { if (panelMode === 'quality') renderQualityPanel(); });
}

let qEdit = null;         // index being edited, or 'new'
let qDraft = null;
function renderQualityPanel() {
  $('drawerTitle').textContent = 'Usenet quality';
  const list = (opts && opts.backupProfiles) || data.backupProfiles || [];
  if (qEdit != null) return renderQualityForm(list);
  const used = (id) => (data.households || []).filter((h) => ((opts && opts.households && opts.households[h.name]) || h.backupChoice) === id).map((h) => h.name);
  $('drawerBody').innerHTML = '<p class="hint">What Usenet looks for when TorBox has nothing. Each household picks one, or Auto from their TV.</p>' +
    list.map((p, i) => '<div class="qcard"><div class="qhead"><b>' + esc(p.name) + '</b>' + (p.default ? '<span class="chip">DEFAULT</span>' : '') + '<span class="sp"></span><button class="ghost sm" data-edit="' + i + '">Edit</button></div>' +
      profileTable(p) + '<p class="fine">' + (used(p.id).length ? 'Used by ' + esc(used(p.id).join(', ')) : 'No household picks it') + '</p></div>').join('');
  $('drawerFoot').hidden = false;
  $('drawerFoot').innerHTML = '<span></span><button class="primary" id="qNew"' + (list.length >= 10 ? ' disabled title="Ten is the most"' : '') + '>New profile</button>';
  for (const b of document.querySelectorAll('#drawerBody [data-edit]')) b.onclick = () => { qEdit = +b.dataset.edit; qDraft = JSON.parse(JSON.stringify(list[qEdit])); renderQualityPanel(); };
  $('qNew').onclick = () => { qEdit = 'new'; qDraft = { name: '', maxRes: 1080, preferRes: 1080, hdr: 'allow', maxSizeGb: null, default: false }; renderQualityPanel(); };
}

function renderQualityForm(list) {
  const p = qDraft;
  const tags = (opts && opts.backupTags) || {};
  const res = (opts && opts.backupRes) || [480, 720, 1080, 1440, 2160];
  const state = (kind, t) => ((p.prefer || {})[kind] || []).includes(t) ? 'prefer' : ((p.avoid || {})[kind] || []).includes(t) ? 'avoid' : '';
  $('drawerTitle').textContent = qEdit === 'new' ? 'New profile' : p.name || 'Profile';
  $('drawerBody').innerHTML =
    '<label>NAME<input id="qName" maxlength="40" value="' + esc(p.name) + '" spellcheck="false"></label>' +
    '<div class="two"><label>HIGHEST<select id="qMax">' + res.map((r) => '<option value="' + r + '"' + (p.maxRes === r ? ' selected' : '') + '>' + resName(r) + '</option>').join('') + '</select></label>' +
    '<label>PREFERRED<select id="qPref">' + res.filter((r) => r <= p.maxRes).map((r) => '<option value="' + r + '"' + ((p.preferRes || p.maxRes) === r ? ' selected' : '') + '>' + resName(r) + '</option>').join('') + '</select></label></div>' +
    '<label>HDR<select id="qHdr">' + [['allow', 'Allowed'], ['prefer', 'Preferred'], ['avoid', 'Avoided']].map((o) => '<option value="' + o[0] + '"' + (p.hdr === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
    '<div class="two"><label>SMALLEST (GB)<input id="qMin" type="number" min="0" step="0.5" inputmode="decimal" value="' + (p.minSizeGb || '') + '" placeholder="No limit"></label>' +
    '<label>LARGEST (GB)<input id="qMaxGb" type="number" min="0" step="0.5" inputmode="decimal" value="' + (p.maxSizeGb || '') + '" placeholder="No limit"></label></div>' +
    '<div class="cap">TAGS</div><p class="hint">Click a tag once to prefer it, again to avoid it, again to clear it.</p>' +
    Object.keys(tags).map((kind) => '<div class="tagrow"><small>' + esc(KIND_NAMES[kind] || kind) + '</small><div class="tags">' +
      tags[kind].map((t) => '<button class="tag ' + state(kind, t) + '" data-kind="' + kind + '" data-tag="' + esc(t) + '" aria-label="' + esc(t) + ': ' + (state(kind, t) || 'neither') + '">' + (state(kind, t) === 'prefer' ? '+ ' : state(kind, t) === 'avoid' ? '− ' : '') + esc(t) + '</button>').join('') + '</div></div>').join('') +
    '<label>AVOIDED RELEASES GO<select id="qMode"><option value="tier"' + (p.avoidMode !== 'last' ? ' selected' : '') + '>Down within their resolution</option><option value="last"' + (p.avoidMode === 'last' ? ' selected' : '') + '>To the very end</option></select></label>' +
    '<label class="check"><input type="checkbox" id="qDefault"' + (p.default ? ' checked' : '') + '> Default for households that haven\'t picked one</label>' +
    '<div class="err" id="qErr"></div>' +
    (qEdit !== 'new' && list.length > 1 ? '<div><button class="ghost danger" id="qDel">Delete this profile</button></div>' : '');
  const read = () => {
    p.name = $('qName').value.trim();
    p.maxRes = +$('qMax').value;
    p.preferRes = Math.min(+$('qPref').value || p.maxRes, p.maxRes);
    p.hdr = $('qHdr').value;
    p.minSizeGb = $('qMin').value ? +$('qMin').value : null;
    p.maxSizeGb = $('qMaxGb').value ? +$('qMaxGb').value : null;
    p.avoidMode = $('qMode').value;
    p.default = $('qDefault').checked;
  };
  $('qMax').onchange = () => { read(); renderQualityForm(list); };
  for (const b of document.querySelectorAll('#drawerBody .tag')) b.onclick = () => {
    read();
    const k = b.dataset.kind, t = b.dataset.tag, now = state(k, t);
    p.prefer = p.prefer || {}; p.avoid = p.avoid || {};
    p.prefer[k] = (p.prefer[k] || []).filter((x) => x !== t);
    p.avoid[k] = (p.avoid[k] || []).filter((x) => x !== t);
    if (now === '') p.prefer[k].push(t); else if (now === 'prefer') p.avoid[k].push(t);
    const top = $('drawerBody').scrollTop;
    renderQualityForm(list);
    $('drawerBody').scrollTop = top;
  };
  const save = async (next, btn, msg) => {
    const r = await runAction({ action: 'backup_profiles_save', profiles: next }, { button: btn, refresh: false, quiet: true, confirm: msg });
    if (!r) return;
    if (r.ok === false) { $('qErr').textContent = r.message || 'That didn\'t save.'; return; }
    toast('Saved.');
    qEdit = null; qDraft = null;
    await loadOpts(); refresh(); renderQualityPanel();
  };
  $('drawerFoot').hidden = false;
  $('drawerFoot').innerHTML = '<button class="ghost" id="qCancel">Cancel</button><button class="primary" id="qSave">Save profile</button>';
  $('qCancel').onclick = () => { qEdit = null; qDraft = null; renderQualityPanel(); };
  $('qSave').onclick = (e) => {
    read();
    if (!p.name) { $('qErr').textContent = 'Give it a name.'; return; }
    for (const k of ['prefer', 'avoid']) if (p[k]) for (const kind of Object.keys(p[k])) if (!p[k][kind].length) delete p[k][kind];
    const clean = Object.assign({}, p);
    if (clean.avoidMode === 'tier') delete clean.avoidMode;
    if (!clean.minSizeGb) delete clean.minSizeGb;
    clean.prefer = clean.prefer || {};
    clean.avoid = clean.avoid || {};
    let next = list.map((x) => JSON.parse(JSON.stringify(x)));
    if (qEdit === 'new') next.push(clean); else next[qEdit] = clean;
    if (clean.default) next.forEach((x) => { x.default = x === clean; });
    save(next, e.target);
  };
  if ($('qDel')) $('qDel').onclick = (e) => {
    const next = list.filter((x, i) => i !== qEdit);
    if (p.default && next.length) next[0].default = true;
    save(next, e.target, 'Delete ' + p.name + '? Households that use it go to the default.');
  };
}

// Problem reports: the summary only carries them inside the weekly "needs a look" list
// (with their log). Failed searches come from the failures list.
function reportItems() {
  const att = ((data.weekly || {}).attention || []);
  return {
    reports: att.filter((a) => a.log && a.log.length || / reported a problem/.test(a.text)),
    other: att.filter((a) => !(a.log && a.log.length) && !/ reported a problem/.test(a.text)),
    failures: (data.failures || []).slice(0, 20),
  };
}

function renderReportsPanel() {
  $('drawerTitle').textContent = 'Problem reports';
  const it = reportItems();
  $('drawerBody').innerHTML =
    '<p class="hint">When someone picks "Report a problem" in their app, Smart saves what it saw at that moment.</p>' +
    (it.reports.length ? it.reports.map((r) => '<div class="report"><b class="flex">' + shape('warning') + ' ' + esc(r.text) + '</b>' + (r.log && r.log.length ? '<ul class="loglines">' + r.log.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '<p class="fine">No log was saved with this one.</p>') + '</div>').join('')
      : '<p class="calm">No problem reports in the last 7 days.</p>') +
    '<div class="cap">FAILED SEARCHES</div>' +
    (it.failures.length ? '<div class="log">' + it.failures.map((f) => '<div class="e"><span class="t">' + esc(clock(f.at)) + '</span><span class="w"><b>' + esc(f.profile) + '</b> · ' + esc(searchName(f)) + (f.reason ? '<small class="why">' + esc(f.reason) + '</small>' : '') + '</span><span class="o">' + esc(OUTCOME[f.outcome] ? OUTCOME[f.outcome][1] : f.outcome) + '</span></div>').join('') + '</div>'
      : '<p class="hint">None recently.</p>') +
    (it.other.length ? '<div class="cap">ALSO NEEDS A LOOK</div><ul class="loglines">' + it.other.map((a) => '<li>' + esc(a.text) + '</li>').join('') + '</ul>' : '');
  $('drawerFoot').hidden = true;
}

// Under the knobs: the two panels that aren't about one household.
function renderTools() {
  const n = reportItems().reports.length;
  $('tools').innerHTML =
    '<button class="tool" id="toolQuality"><b>Usenet quality</b><small>See and edit what each profile looks for</small></button>' +
    '<button class="tool" id="toolReports"><b>Problem reports' + (n ? ' · ' + n : '') + '</b><small>' + (n ? 'With what Smart saw at the time' : 'None in the last 7 days') + '</small></button>';
  $('toolQuality').onclick = () => { qEdit = null; openSidePanel('quality'); };
  $('toolReports').onclick = () => openSidePanel('reports');
}
