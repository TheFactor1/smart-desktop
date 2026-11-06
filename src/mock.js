// Example data so the page can be previewed in a plain browser (outside the app).
// The app itself never uses this: inside Tauri every call goes to the real server.
(function () {
  if (window.__TAURI__) return;
  const now = new Date();
  const ago = (min) => new Date(now.getTime() - min * 60000).toISOString();
  const checks = [];
  for (let i = 0; i < 48; i++) checks.push({ at: ago(i), pingMs: 150 + Math.round(40 * Math.sin(i / 4)) + (i % 7) * 3, up: true });
  const titles = ['Dune: Part Two', 'Severance S2E4', 'The Bear S3E2', 'Arrival', 'Andor S2E1', 'Paddington in Peru', 'Shogun S1E5', 'Heat'];
  const outcomes = ['ok', 'ok', 'ok', 'ok', 'rescued', 'ok', 'failed', 'backup_addon', 'ok', 'topped_up'];
  const people = ['Household A', 'Household B', 'Household C', 'Household D'];
  const searches = [];
  for (let i = 0; i < 63; i++) {
    const min = Math.round((i / 63) * (now.getHours() * 60 + now.getMinutes()));
    searches.push({ at: ago(min), profile: people[i % 4], title: titles[i % titles.length], what: null, outcome: outcomes[i % outcomes.length], results: 12, ms: 2400, reason: null });
  }
  const hh = (name, total, extra) => Object.assign({ name, lastActive: ago(total % 50), forcedNext: false, jellyfin: false, backupProfile: '4k', backupChoice: 'auto', tv: null, today: { total, fallback: Math.round(total / 12), forced: 0, rescued: 2, toppedUp: 1, failed: 0, slow: 0 } }, extra || {});
  const summary = {
    now: now.toISOString(), date: now.toISOString().slice(0, 10),
    routing: { status: 'up', pinned: false, downSince: null },
    lastCheck: { at: ago(0.4), consensus: 'up', livePing: 'up', livePingMs: 184, statusPage: 'up', homeProbe: 'up' },
    maintenance: null,
    households: [
      hh('Household A', 24),
      hh('Household B', 17, { today: { total: 17, fallback: 1, forced: 0, rescued: 1, toppedUp: 0, failed: 0, slow: 1 } }),
      hh('Household C', 8, { forcedNext: true, today: { total: 8, fallback: 2, forced: 1, rescued: 0, toppedUp: 0, failed: 2, slow: 0 } }),
      hh('Household D', 14),
    ],
    backupProfiles: [{ id: '4k', name: '4K Balanced' }, { id: 'safe', name: '1080p Safe' }],
    failures: [{ at: ago(42), profile: 'Household C', outcome: 'failed', reason: 'no results', what: 'Severance S2E4' }],
    searches, checks,
    week: '', weekly: { attention: [], torbox: { uptimePct: 99.6, outages: 1, downMinutes: 38, longestMinutes: 38, longestCause: 'API timeouts', asked: 0 }, households: people.map((n, i) => ({ name: n, total: 80 + i * 20, fallback: 6 + i, forced: i, rescued: 4, toppedUp: 2, firstTryPct: 96 - i, avgSeconds: 2.1 + i / 5, failed: i === 2 ? 3 : 0 })) },
    uptime7d: 99.6,
    usenet: { at: ago(300), text: 'Usenet healthy: 4 of 4 providers answering', stale: false, problems: [] },
    inbox: [{ at: ago(70), text: 'TorBox back up after 38 min on Usenet.', buttons: [] }],
    notifications: { deviceCount: 3, telegramMuted: false },
  };
  if (/[?&]down=1/.test(location.search)) { summary.routing = { status: 'down', pinned: false, downSince: ago(38) }; summary.lastCheck.livePing = 'down'; summary.checks.slice(0, 6).forEach((c) => { c.up = false; c.pingMs = null; }); }
  const setups = {
    'Household A': { setup: { catalog: { brand: 'LG', series: 'C3', year: 2023 }, box: 'shield-pro', sound: 'atmos' }, check: { tv: { brand: 'LG', series: 'C3' }, box: { name: 'Shield TV Pro' }, sound: 'atmos', rows: [], notes: [] }, auto: true, using: { name: 'Auto', auto: true, summary: '4K, Dolby Vision, Atmos' } },
    'Household B': { setup: { catalog: { brand: 'Samsung', series: 'Q60', year: 2022 } }, check: { tv: { brand: 'Samsung', series: 'Q60' }, box: null, sound: null, rows: [], notes: [] }, auto: true, using: { name: 'Auto', auto: true, summary: '4K, HDR10+' } },
    'Household C': { setup: null, check: null, auto: false, using: { name: '1080p Safe' } },
    'Household D': { setup: { catalog: { brand: 'TCL', series: 'C845', year: 2024 }, box: 'firetv-4k-max' }, check: { tv: { brand: 'TCL', series: 'C845' }, box: { name: 'Fire TV 4K Max' }, sound: null, rows: [], notes: [] }, auto: false, using: { name: '4K Balanced' } },
  };
  const rows = [
    { key: 'res', label: 'Resolution', tv: '4K', box: '4K', result: '4K', corrected: false },
    { key: 'hdr10', label: 'HDR10', tv: true, box: true, result: true, corrected: false },
    { key: 'hdr10plus', label: 'HDR10+', tv: false, box: false, result: false, corrected: false },
    { key: 'dolbyVision', label: 'Dolby Vision', tv: true, box: true, result: true, corrected: false },
    { key: 'earc', label: 'Atmos', tv: true, box: true, result: true, corrected: false },
  ];
  window.MOCK = {
    summary,
    action(body) {
      const a = body.action;
      if (a === 'backup_profiles') return { ok: true, backupProfiles: summary.backupProfiles, households: {}, tv: setups };
      if (a === 'tv_options') return { ok: true, boxes: [{ id: 'shield-pro', group: 'Nvidia', name: 'Shield TV Pro' }, { id: 'firetv-4k-max', group: 'Amazon', name: 'Fire TV 4K Max' }, { id: 'atv-4k', group: 'Apple', name: 'Apple TV 4K' }], catalog: [{ brand: 'LG', series: 'C3', year: 2023, label: 'LG C3 (2023)' }, { brand: 'Samsung', series: 'Q60', year: 2022, label: 'Samsung Q60 (2022)' }, { brand: 'TCL', series: 'C845', year: 2024, label: 'TCL C845 (2024)' }], sounds: [{ id: 'tv', name: 'TV speakers' }, { id: 'soundbar', name: 'Soundbar or receiver, no Atmos' }, { id: 'atmos', name: 'Atmos soundbar or receiver' }] };
      if (a === 'tv_check') return { ok: true, setup: body.setup, check: { rows, notes: ['Example check: not a real server.'] }, auto: { name: 'Auto', summary: '4K, Dolby Vision, Atmos' } };
      return { ok: true, message: 'Example only: nothing was changed.' };
    },
  };
})();
