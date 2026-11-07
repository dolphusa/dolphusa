/* KYC Client Dashboard — no dependencies. Loads data/clients.csv (or a CSV picked by the user). */
(() => {
  'use strict';

  // Number of most-recent completion quarters shown as their own slice; older ones fold into "Earlier".
  const RECENT_QUARTERS = 5;
  const NOT_DONE = 'Not completed';

  const state = {
    rows: [],
    region: null,      // selected region (cross-filter)
    team: null,        // selected team (cross-filter)
    slice: null,       // selected pie slice key (filters the lookup table only)
    search: '',
    sort: { key: 'client_name', asc: true },
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtInt = (n) => n.toLocaleString();
  const fmtPct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '–');
  const fmtMoney = (n) => {
    if (!Number.isFinite(n)) return '–';
    if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
    return `$${n}`;
  };
  const prettyKey = (k) => k.replace(/^q_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bUsd\b/g, '(USD)').replace(/\bPct\b/g, '(%)');

  // ---------- CSV ----------
  function parseCSV(text) {
    const out = []; let row = []; let f = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; if (row.some((v) => v !== '')) out.push(row); row = [];
      } else f += c;
    }
    row.push(f); if (row.some((v) => v !== '')) out.push(row);
    const head = (out.shift() || []).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    state.headers = head;
    return out.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  }

  function normalize(r) {
    const status = r.kyc_status || '';
    const date = r.kyc_completed_date ? new Date(r.kyc_completed_date) : null;
    const done = /^complete/i.test(status) || (!status && date && !isNaN(date));
    let qKey = null, qLabel = null;
    if (done && date && !isNaN(date)) {
      const y = date.getUTCFullYear(), q = Math.floor(date.getUTCMonth() / 3) + 1;
      qKey = y * 10 + q; qLabel = `Q${q} ${y}`;
    }
    return {
      ...r,
      region: r.region || 'Unassigned',
      team: r.team || 'Unassigned',
      annual_budget_usd: Number(String(r.annual_budget_usd || '').replace(/[$,\s]/g, '')),
      _done: !!done, _qKey: qKey, _qLabel: qLabel,
    };
  }

  // ---------- slices ----------
  // Built from the whole book so slice colors and the quarter set stay fixed while filtering.
  let sliceDefs = [];
  function buildSliceDefs() {
    const qs = [...new Set(state.rows.filter((r) => r._qKey).map((r) => r._qKey))].sort((a, b) => a - b);
    const recent = qs.slice(-RECENT_QUARTERS);
    const hasEarlier = qs.length > recent.length;
    const hasUndated = state.rows.some((r) => r._done && !r._qKey);
    const completed = [];
    if (hasEarlier) completed.push({ key: 'earlier', label: `Earlier (before ${labelOf(recent[0])})` });
    recent.forEach((k) => completed.push({ key: String(k), label: `Completed ${labelOf(k)}` }));
    if (hasUndated) completed.push({ key: 'undated', label: 'Completed (no date)' });
    // Ordinal ramp: latest quarter gets the strongest step.
    const ramp = ['--q0', '--q1', '--q2', '--q3', '--q4', '--q5'];
    const offset = ramp.length - completed.length;
    completed.forEach((s, i) => { s.color = `var(${ramp[Math.max(0, i + offset)]})`; s.done = true; });
    sliceDefs = [{ key: 'not', label: NOT_DONE, color: 'var(--not-done)', done: false }, ...completed.reverse()];
    function labelOf(k) { return `Q${k % 10} ${Math.floor(k / 10)}`; }
    sliceDefs.forEach((s) => { s.match = matcher(s.key, recent[0]); });
  }
  function matcher(key, firstRecent) {
    if (key === 'not') return (r) => !r._done;
    if (key === 'undated') return (r) => r._done && !r._qKey;
    if (key === 'earlier') return (r) => r._done && r._qKey && r._qKey < firstRecent;
    return (r) => r._qKey === Number(key);
  }

  // ---------- filtering ----------
  const byRegionTeam = (r, skip) =>
    (skip === 'region' || !state.region || r.region === state.region) &&
    (skip === 'team' || !state.team || r.team === state.team);
  const filtered = () => state.rows.filter((r) => byRegionTeam(r));

  // ---------- render ----------
  function render() {
    const rows = filtered();
    renderChips();
    renderKpis(rows);
    renderPie(rows);
    renderBreakdown('region', 'Region', '#bd-region');
    renderBreakdown('team', 'Team', '#bd-team');
    renderTable(rows);
  }

  function scopeLabel() {
    const parts = [state.region, state.team].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'All clients';
  }

  function renderChips() {
    const el = $('#active-filters');
    const chips = [];
    if (state.region) chips.push(`<button class="chip" data-clear="region">Region: ${esc(state.region)}</button>`);
    if (state.team) chips.push(`<button class="chip" data-clear="team">Team: ${esc(state.team)}</button>`);
    if (state.slice) chips.push(`<button class="chip" data-clear="slice">${esc(sliceDefs.find((s) => s.key === state.slice)?.label)}</button>`);
    if (chips.length > 1) chips.push('<button class="chip clear" data-clear="all">Clear all</button>');
    el.innerHTML = chips.join('');
  }

  function renderKpis(rows) {
    const done = rows.filter((r) => r._done);
    const latest = sliceDefs.find((s) => s.done && /^\d+$/.test(s.key));
    const latestN = latest ? rows.filter(latest.match).length : 0;
    const tiles = [
      ['Clients in book', fmtInt(rows.length), scopeLabel()],
      ['KYC completed', fmtInt(done.length), `${fmtPct(done.length, rows.length)} of book`],
      ['KYC not completed', fmtInt(rows.length - done.length), `${fmtPct(rows.length - done.length, rows.length)} of book`],
      [latest ? `Completed in ${latest.label.replace('Completed ', '')}` : 'Latest quarter', fmtInt(latestN), 'most recent quarter'],
    ];
    $('#kpis').innerHTML = tiles.map(([l, v, n]) =>
      `<div class="kpi"><div class="label">${esc(l)}</div><div class="value">${v}</div><div class="note">${esc(n)}</div></div>`).join('');
  }

  function renderPie(rows) {
    $('#pie-title').textContent = scopeLabel();
    const data = sliceDefs.map((s) => ({ ...s, n: rows.filter(s.match).length }));
    const total = rows.length;
    const svg = $('#pie');
    const cx = 160, cy = 160, R = 150, r0 = 92;
    let a = -Math.PI / 2;
    const paths = [];
    const visible = data.filter((d) => d.n > 0);
    visible.forEach((d) => {
      const sweep = (d.n / total) * Math.PI * 2;
      paths.push(`<path d="${arc(cx, cy, R, r0, a, a + sweep)}" fill="${d.color}" data-key="${d.key}"
        class="${state.slice === d.key ? 'hot' : ''}" tabindex="0" aria-label="${esc(d.label)}: ${d.n}"></path>`);
      a += sweep;
    });
    const done = rows.filter((r) => r._done).length;
    svg.innerHTML = `${paths.join('')}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="center-value">${fmtPct(done, total)}</text>
      <text x="${cx}" y="${cy + 26}" text-anchor="middle" class="center-label">KYC completed</text>`;
    svg.classList.toggle('has-hover', !!state.slice);

    // Legend doubles as the data table.
    const leg = $('#legend');
    const row = (d) => `<tr data-key="${d.key}" class="${state.slice === d.key ? 'sel' : ''}">
      <td><span class="swatch" style="background:${d.color}"></span>${esc(d.label)}</td>
      <td class="num">${fmtInt(d.n)}</td><td class="num">${fmtPct(d.n, total)}</td></tr>`;
    leg.innerHTML = `<tbody>${row(data[0])}
      <tr class="group"><td colspan="3">Completed by quarter · ${fmtInt(done)}</td></tr>
      ${data.slice(1).map(row).join('')}</tbody>`;

    // Hover tooltips
    const tip = $('#tooltip');
    svg.querySelectorAll('path').forEach((p) => {
      const d = data.find((x) => x.key === p.dataset.key);
      const show = (ev) => {
        svg.classList.add('has-hover');
        svg.querySelectorAll('path').forEach((q) => q.classList.toggle('hot', q === p));
        tip.innerHTML = `<strong>${esc(d.label)}</strong>${fmtInt(d.n)} client${d.n === 1 ? '' : 's'} · ${fmtPct(d.n, total)}`;
        tip.hidden = false;
        const box = svg.parentElement.getBoundingClientRect();
        const x = ev.clientX ? ev.clientX - box.left : box.width / 2;
        const y = ev.clientY ? ev.clientY - box.top : box.height / 2;
        tip.style.left = `${Math.min(x + 12, box.width - tip.offsetWidth)}px`;
        tip.style.top = `${y + 12}px`;
      };
      const hide = () => {
        tip.hidden = true;
        svg.querySelectorAll('path').forEach((q) => q.classList.toggle('hot', q.dataset.key === state.slice));
        svg.classList.toggle('has-hover', !!state.slice);
      };
      p.addEventListener('mousemove', show);
      p.addEventListener('focus', show);
      p.addEventListener('mouseleave', hide);
      p.addEventListener('blur', hide);
    });
  }

  function arc(cx, cy, R, r0, a0, a1) {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4; // full ring
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    return `M${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
  }

  function renderBreakdown(dim, title, sel) {
    // Counts respect the *other* dimension's selection, so Region × Team cross-filter.
    const base = state.rows.filter((r) => byRegionTeam(r, dim));
    const groups = new Map();
    for (const r of state.rows) if (!groups.has(r[dim])) groups.set(r[dim], { total: 0, done: 0, budget: 0 });
    for (const r of base) {
      const g = groups.get(r[dim]);
      g.total++; if (r._done) g.done++;
      if (Number.isFinite(r.annual_budget_usd)) g.budget += r.annual_budget_usd;
    }
    const list = [...groups].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
    $(sel).innerHTML = `<h3>By ${title.toLowerCase()}</h3>
      <table class="bd-table"><thead><tr>
        <th>${title}</th><th class="num">Clients</th><th class="num">Completed</th><th class="num">Not completed</th>
        <th class="num col-budget">Budget</th><th class="num">Completion</th></tr></thead><tbody>
      ${list.map(([name, g]) => `<tr data-dim="${dim}" data-val="${esc(name)}" tabindex="0"
          class="${state[dim] === name ? 'sel' : ''} ${g.total ? '' : 'empty'}" aria-pressed="${state[dim] === name}">
        <td>${esc(name)}</td><td class="num">${fmtInt(g.total)}</td><td class="num">${fmtInt(g.done)}</td>
        <td class="num">${fmtInt(g.total - g.done)}</td><td class="num col-budget">${fmtMoney(g.budget)}</td>
        <td class="num"><span class="rate"><span class="bar"><span style="width:${g.total ? (g.done / g.total) * 100 : 0}%"></span></span>${fmtPct(g.done, g.total)}</span></td>
      </tr>`).join('')}</tbody></table>`;
  }

  function renderTable(rows) {
    const slice = sliceDefs.find((s) => s.key === state.slice);
    const q = state.search.toLowerCase();
    let list = rows.filter((r) => (!slice || slice.match(r)) &&
      (!q || Object.entries(r).some(([k, v]) => !k.startsWith('_') && String(v).toLowerCase().includes(q))));
    const { key, asc } = state.sort;
    list = list.sort((a, b) => {
      const x = a[key], y = b[key];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
      return asc ? c : -c;
    });
    $('#dir-sub').textContent = `${fmtInt(list.length)} of ${fmtInt(state.rows.length)} clients · ${scopeLabel()}${slice ? ` · ${slice.label}` : ''}. Click a client for budget and KYC answers.`;
    document.querySelectorAll('#clients th').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === key);
      th.classList.toggle('asc', th.dataset.sort === key && asc);
    });
    $('#clients tbody').innerHTML = list.map((r) => `<tr data-id="${esc(r.client_id)}">
      <td>${esc(r.client_name)}</td><td>${esc(r.region)}</td><td>${esc(r.team)}</td><td>${esc(r.account_owner)}</td>
      <td class="num">${fmtMoney(r.annual_budget_usd)}</td>
      <td><span class="status ${r._done ? 'done' : ''}">${esc(r._done ? 'Completed' : (r.kyc_status || NOT_DONE))}</span></td>
      <td>${esc(r._qLabel || '')}</td></tr>`).join('') ||
      '<tr><td colspan="7" style="color:var(--muted)">No clients match.</td></tr>';
  }

  function showDetail(id) {
    const r = state.rows.find((x) => x.client_id === id);
    if (!r) return;
    const answers = Object.keys(r).filter((k) => k.startsWith('q_'));
    $('#detail-body').innerHTML = `<h2>${esc(r.client_name)}</h2>
      <p class="sub">${esc(r.client_id)} · ${esc(r.region)} · ${esc(r.team)}</p>
      <dl class="kv">
        <dt>Account owner</dt><dd>${esc(r.account_owner || '–')}</dd>
        <dt>Annual budget</dt><dd>${Number.isFinite(r.annual_budget_usd) ? `$${fmtInt(r.annual_budget_usd)}` : '–'}</dd>
        <dt>KYC status</dt><dd>${esc(r.kyc_status || (r._done ? 'Completed' : NOT_DONE))}</dd>
        <dt>KYC completed</dt><dd>${esc(r.kyc_completed_date ? `${r.kyc_completed_date} (${r._qLabel})` : '–')}</dd>
      </dl>
      <div class="detail-sec"><h3>KYC answers</h3>
        ${answers.some((k) => r[k]) ? `<dl class="kv">${answers.map((k) => `<dt>${esc(prettyKey(k))}</dt><dd>${esc(r[k] || '–')}</dd>`).join('')}</dl>`
          : '<p class="sub">No answers recorded yet.</p>'}
      </div>
      ${r.notes ? `<div class="detail-sec"><h3>Notes</h3><p>${esc(r.notes)}</p></div>` : ''}`;
    $('#detail').showModal();
  }

  // ---------- events ----------
  function toggleSlice(key) { state.slice = state.slice === key ? null : key; render(); }

  document.addEventListener('click', (e) => {
    const bd = e.target.closest('.bd-table tbody tr');
    if (bd) { const { dim, val } = bd.dataset; state[dim] = state[dim] === val ? null : val; return render(); }
    const sl = e.target.closest('#pie path, #legend tr[data-key]');
    if (sl) return toggleSlice(sl.dataset.key);
    const chip = e.target.closest('.chip[data-clear]');
    if (chip) {
      const k = chip.dataset.clear;
      if (k === 'all') { state.region = state.team = state.slice = null; } else state[k] = null;
      return render();
    }
    const th = e.target.closest('#clients th');
    if (th) {
      const k = th.dataset.sort;
      state.sort = { key: k, asc: state.sort.key === k ? !state.sort.asc : k !== 'annual_budget_usd' };
      return renderTable(filtered());
    }
    const tr = e.target.closest('#clients tbody tr[data-id], #s-results tbody tr[data-id]');
    if (tr) showDetail(tr.dataset.id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('.bd-table tbody tr, #pie path');
    if (t) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  $('#search').addEventListener('input', (e) => { state.search = e.target.value.trim(); renderTable(filtered()); });

  $('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('kyc-theme', root.dataset.theme); } catch (_) { /* ignore */ }
  });
  try { const t = localStorage.getItem('kyc-theme'); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* ignore */ }

  $('#file-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) load(await f.text(), f.name);
  });

  function load(text, source) {
    state.rows = parseCSV(text).map(normalize);
    state.region = state.team = state.slice = null;
    buildSliceDefs();
    $('#data-source').textContent = `${fmtInt(state.rows.length)} clients · source: ${source}`;
    render();
    document.dispatchEvent(new CustomEvent('kyc:data'));
  }

  // ---------- tabs (hash routing: #overview, #search) ----------
  function route() {
    const tab = (location.hash.slice(1) || 'overview');
    const known = [...document.querySelectorAll('.tab-panel')].map((el) => el.id.replace('tab-', ''));
    const active = known.includes(tab) ? tab : 'overview';
    document.querySelectorAll('.tab-panel').forEach((el) => { el.hidden = el.id !== `tab-${active}`; });
    document.querySelectorAll('.tabs a').forEach((a) => {
      const on = a.getAttribute('href') === `#${active}`;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', route);
  route();

  // Shared API for other tabs (search.js).
  window.KYC = {
    get rows() { return state.rows; },
    get headers() { return state.headers || []; },
    esc, fmtInt, fmtMoney, prettyKey, showDetail, NOT_DONE,
  };

  fetch('data/clients.csv')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then((t) => load(t, 'data/clients.csv'))
    .catch(() => { $('#data-source').textContent = 'Could not load data/clients.csv — use “Load CSV…” to pick a file.'; });
})();
