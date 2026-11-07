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
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtInt = (n) => n.toLocaleString();
  const fmtPct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '–');
  const fmtMoney = (n) => {
    if (!Number.isFinite(n)) return '–';
    if (n < 0) return `−${fmtMoney(-n)}`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
    return `$${n}`;
  };
  const prettyKey = (k) => k.replace(/^q_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bUsd\b/g, '(USD)').replace(/\bPct\b/g, '(%)');

  // "$1,500" -> 1500, "12%" -> 12, "" / "TBD" -> NaN
  const toNum = (v) => {
    if (typeof v === 'number') return v;
    const s = String(v ?? '').replace(/[$,%\s]/g, '');
    return s === '' ? NaN : Number(s);
  };

  // A column is numeric when at least 80% of its non-empty values are numbers. The threshold
  // (rather than 100%) keeps one typo like "approx 500" from turning a number question into text;
  // such values are reported on the KYC follow-up tab.
  function detectNumericCols(rows, headers) {
    const out = new Set();
    for (const h of headers) {
      if (!h.startsWith('q_') && h !== 'annual_budget_usd') continue;
      const vals = rows.map((r) => r._raw[h]).filter((v) => v !== '' && v != null);
      const n = vals.filter((v) => Number.isFinite(toNum(v))).length;
      if (vals.length && n >= 5 && n / vals.length >= 0.8) out.add(h);
    }
    return out;
  }

  // Revenue columns: rev_cy_<product> (current year) and rev_py_<product> (prior year), in USD.
  function detectProducts(headers) {
    const slugs = [...new Set(headers.map((h) => /^rev_(?:cy|py)_(.+)$/.exec(h)?.[1]).filter(Boolean))];
    return slugs.map((slug) => ({
      slug,
      label: slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      cy: headers.includes(`rev_cy_${slug}`) ? `rev_cy_${slug}` : null,
      py: headers.includes(`rev_py_${slug}`) ? `rev_py_${slug}` : null,
    }));
  }
  // Revenue for one client; blank or non-numeric counts as 0 (non-numeric is flagged on the follow-up tab).
  const revOf = (r, period, product) => {
    let sum = 0;
    for (const p of state.products || []) {
      if (product && p.slug !== product) continue;
      const v = toNum(r._raw[p[period]]);
      if (Number.isFinite(v)) sum += v;
    }
    return sum;
  };

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
    // A future date is a data error (flagged on the follow-up tab), so it doesn't create a quarter.
    if (done && date && !isNaN(date) && date <= Date.now()) {
      const y = date.getUTCFullYear(), q = Math.floor(date.getUTCMonth() / 3) + 1;
      qKey = y * 10 + q; qLabel = `Q${q} ${y}`;
    }
    return {
      ...r,
      region: r.region || 'Unassigned',
      team: r.team || 'Unassigned',
      annual_budget_usd: toNum(r.annual_budget_usd),
      _done: !!done, _qKey: qKey, _qLabel: qLabel,
      _raw: r, // values exactly as they appear in the sheet (used by data-quality checks)
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
    document.dispatchEvent(new CustomEvent('kyc:overview', { detail: { rows, region: state.region, team: state.team } }));
  }

  function scopeLabel() {
    const parts = [state.region, state.team].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'All clients';
  }

  function renderChips() {
    const els = document.querySelectorAll('#active-filters, #m-chips'); // KYC coverage + Market overview
    const chips = [];
    if (state.region) chips.push(`<button class="chip" data-clear="region">Region: ${esc(state.region)}</button>`);
    if (state.team) chips.push(`<button class="chip" data-clear="team">Team: ${esc(state.team)}</button>`);
    if (chips.length > 1) chips.push('<button class="chip clear" data-clear="all">Clear all</button>');
    els.forEach((el) => { el.innerHTML = chips.join(''); });
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
        tabindex="0" role="link" aria-label="${esc(d.label)}: ${d.n} clients. Open in Client search"></path>`);
      a += sweep;
    });
    const done = rows.filter((r) => r._done).length;
    svg.innerHTML = `${paths.join('')}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="center-value">${fmtPct(done, total)}</text>
      <text x="${cx}" y="${cy + 26}" text-anchor="middle" class="center-label">KYC completed</text>`;

    // Legend doubles as the data table.
    const leg = $('#legend');
    const row = (d) => `<tr data-key="${d.key}" tabindex="0" title="Open these clients in Client search">
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
        svg.querySelectorAll('path').forEach((q) => q.classList.remove('hot'));
        svg.classList.remove('has-hover');
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
      ${(state.products || []).length ? `<div class="detail-sec"><h3>Revenue</h3><dl class="kv">
        ${state.products.map((p) => {
          const cy = revOf(r, 'cy', p.slug), py = revOf(r, 'py', p.slug);
          return cy || py ? `<dt>${esc(p.label)}</dt><dd>${fmtMoney(cy)} this year · ${fmtMoney(py)} last year</dd>` : '';
        }).join('') || '<dt>Total</dt><dd>No revenue recorded</dd>'}
        ${Number.isFinite(r.annual_budget_usd) && r.annual_budget_usd > 0 ? `<dt>Share of wallet</dt><dd>${fmtPct(revOf(r, 'cy'), r.annual_budget_usd)} of budget</dd>` : ''}
      </dl></div>` : ''}
      ${r.notes ? `<div class="detail-sec"><h3>Notes</h3><p>${esc(r.notes)}</p></div>` : ''}`;
    $('#detail').showModal();
  }

  // ---------- events ----------
  // Quarter label used for the "KYC completed (quarter)" filter on the Client search tab.
  const quarterOf = (r) => r._qLabel || (r._done ? 'Completed (no date)' : NOT_DONE);

  // Slice / legend click: open Client search with the same region, team and quarter(s).
  function openSlice(key) {
    const slice = sliceDefs.find((s) => s.key === key);
    if (!slice) return;
    const p = new URLSearchParams();
    if (state.region) p.append('region', state.region);
    if (state.team) p.append('team', state.team);
    [...new Set(state.rows.filter(slice.match).map(quarterOf))].forEach((q) => p.append('_quarter', q));
    location.hash = `#search?${p}`;
  }

  document.addEventListener('click', (e) => {
    const bd = e.target.closest('.bd-table tbody tr[data-dim]');
    if (bd) { const { dim, val } = bd.dataset; state[dim] = state[dim] === val ? null : val; return render(); }
    const sl = e.target.closest('#pie path, #legend tr[data-key]');
    if (sl) return openSlice(sl.dataset.key);
    const chip = e.target.closest('.chip[data-clear]');
    if (chip) {
      const k = chip.dataset.clear;
      if (k === 'all') { state.region = state.team = null; } else state[k] = null;
      return render();
    }
    const tr = e.target.closest('#s-results tbody tr[data-id]');
    if (tr) showDetail(tr.dataset.id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('.bd-table tbody tr[data-dim], #pie path, #legend tr[data-key]');
    if (t) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

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
    state.numericCols = detectNumericCols(state.rows, state.headers || []);
    state.products = detectProducts(state.headers || []);
    state.region = state.team = null;
    buildSliceDefs();
    $('#data-source').textContent = `${fmtInt(state.rows.length)} clients · source: ${source}`;
    document.dispatchEvent(new CustomEvent('kyc:data')); // other tabs prepare first...
    render(); // ...so they can react to the overview's 'kyc:overview' event
  }

  // ---------- tabs (hash routing: #overview, #followup, #search; params after '?') ----------
  function route() {
    const tab = location.hash.slice(1).split('?')[0] || 'overview';
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
    get numericCols() { return state.numericCols || new Set(); },
    get overview() { return { region: state.region, team: state.team }; },
    get products() { return state.products || []; },
    revOf,
    esc, fmtInt, fmtMoney, fmtPct, prettyKey, showDetail, toNum, quarterOf, NOT_DONE,
  };

  fetch('data/clients.csv')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then((t) => load(t, 'data/clients.csv'))
    .catch(() => { $('#data-source').textContent = 'Could not load data/clients.csv — use “Load CSV…” to pick a file.'; });
})();
