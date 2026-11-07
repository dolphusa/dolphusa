/* Client search tab: filter clients by KYC answers (and a few account fields), summarize, export CSV.
   Depends on window.KYC from app.js. */
(() => {
  'use strict';

  // A question with more distinct answers than this is treated as free text (a "contains" box)
  // instead of a checkbox list.
  const MAX_CHOICES = 30;

  // Account fields offered as criteria alongside the q_* question columns.
  const BASE_FIELDS = [
    { key: 'region', label: 'Region' },
    { key: 'team', label: 'Team' },
    { key: 'account_owner', label: 'Account owner' },
    { key: '_kyc', label: 'KYC status' },
  ];

  const $ = (s) => document.querySelector(s);
  const st = {
    fields: [],              // [{ key, label, type: 'choice'|'text', options: [{ value }] , isQuestion }]
    picked: {},              // key -> Set of values (choice) or string (text)
    keyword: '', min: null, max: null,
    sort: { key: 'annual_budget_usd', asc: false },
    results: [],
  };

  const valueOf = (r, key) => (key === '_kyc' ? (r._done ? 'Completed' : (r.kyc_status || KYC.NOT_DONE)) : (r[key] || ''));

  function setup() {
    const rows = KYC.rows;
    const qKeys = KYC.headers.filter((h) => h.startsWith('q_'));
    const defs = [
      ...qKeys.map((k) => ({ key: k, label: KYC.prettyKey(k), isQuestion: true })),
      ...BASE_FIELDS.filter((f) => f.key === '_kyc' || KYC.headers.includes(f.key)),
    ];
    st.fields = defs.map((f) => {
      const vals = [...new Set(rows.map((r) => valueOf(r, f.key)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      return { ...f, type: vals.length > MAX_CHOICES ? 'text' : 'choice', options: vals };
    });
    reset(false);
    renderCriteria();
    run();
  }

  function reset(rerender = true) {
    st.picked = {};
    st.keyword = ''; st.min = null; st.max = null;
    $('#s-keyword').value = ''; $('#s-min').value = ''; $('#s-max').value = '';
    if (rerender) { renderCriteria(); run(); }
  }

  // ---------- matching ----------
  function matchField(r, f) {
    const p = st.picked[f.key];
    if (f.type === 'choice') return !p || p.size === 0 || p.has(valueOf(r, f.key));
    return !p || valueOf(r, f.key).toLowerCase().includes(p.toLowerCase());
  }
  function matchBase(r) {
    const b = r.annual_budget_usd;
    if (st.min != null && !(b >= st.min)) return false;
    if (st.max != null && !(b <= st.max)) return false;
    if (st.keyword) {
      const q = st.keyword.toLowerCase();
      if (!Object.entries(r).some(([k, v]) => !k.startsWith('_') && String(v).toLowerCase().includes(q))) return false;
    }
    return true;
  }
  const matchAll = (r, skipKey) => matchBase(r) && st.fields.every((f) => f.key === skipKey || matchField(r, f));

  // ---------- render ----------
  function renderCriteria() {
    const html = st.fields.map((f) => {
      const p = st.picked[f.key];
      const on = f.type === 'choice' ? p && p.size > 0 : !!p;
      const body = f.type === 'choice'
        ? `<div class="opts">${f.options.map((v) => `<label class="opt" data-key="${KYC.esc(f.key)}" data-val="${KYC.esc(v)}">
              <input type="checkbox" ${p && p.has(v) ? 'checked' : ''}><span>${KYC.esc(v)}</span><span class="n"></span></label>`).join('')}</div>`
        : `<label class="text">Answer contains<input type="search" data-key="${KYC.esc(f.key)}" value="${KYC.esc(p || '')}"></label>`;
      return `<fieldset class="crit ${on ? 'on' : ''}" data-key="${KYC.esc(f.key)}">
        <h4><span>${KYC.esc(f.label)}</span><span class="tag">${f.isQuestion ? 'KYC question' : 'Account'}</span></h4>${body}</fieldset>`;
    }).join('');
    $('#s-criteria').innerHTML = html || '<p class="sub">No question columns (q_…) found in the data.</p>';
  }

  // Facet counts: for each option, how many clients would match if it were the (only) answer chosen
  // for that question, given every other criterion.
  function updateCounts() {
    const rows = KYC.rows;
    for (const f of st.fields) {
      if (f.type !== 'choice') continue;
      const base = rows.filter((r) => matchAll(r, f.key));
      const counts = new Map();
      for (const r of base) { const v = valueOf(r, f.key); counts.set(v, (counts.get(v) || 0) + 1); }
      document.querySelectorAll(`.crit[data-key="${CSS.escape(f.key)}"] .opt`).forEach((el) => {
        const n = counts.get(el.dataset.val) || 0;
        el.querySelector('.n').textContent = n.toLocaleString();
        el.classList.toggle('zero', n === 0);
      });
      document.querySelector(`.crit[data-key="${CSS.escape(f.key)}"]`)
        ?.classList.toggle('on', !!(st.picked[f.key] && st.picked[f.key].size));
    }
    st.fields.filter((f) => f.type === 'text').forEach((f) =>
      document.querySelector(`.crit[data-key="${CSS.escape(f.key)}"]`)?.classList.toggle('on', !!st.picked[f.key]));
  }

  function run() {
    const all = KYC.rows;
    st.results = all.filter((r) => matchAll(r));
    updateCounts();
    renderChips();
    renderSummary(all.length);
    renderResults();
  }

  function renderChips() {
    const chips = [];
    for (const f of st.fields) {
      const p = st.picked[f.key];
      if (f.type === 'choice' && p) p.forEach((v) => chips.push([`${f.label}: ${v}`, f.key, v]));
      if (f.type === 'text' && p) chips.push([`${f.label} contains “${p}”`, f.key, '']);
    }
    if (st.keyword) chips.push([`Keyword: “${st.keyword}”`, '_keyword', '']);
    if (st.min != null) chips.push([`Budget ≥ ${KYC.fmtMoney(st.min)}`, '_min', '']);
    if (st.max != null) chips.push([`Budget ≤ ${KYC.fmtMoney(st.max)}`, '_max', '']);
    $('#s-chips').innerHTML = chips.length
      ? chips.map(([t, k, v]) => `<button class="chip" data-skey="${KYC.esc(k)}" data-sval="${KYC.esc(v)}">${KYC.esc(t)}</button>`).join('')
      : '<span class="sub">No criteria selected, so every client is shown.</span>';
  }

  function renderSummary(total) {
    const n = st.results.length;
    const budgets = st.results.map((r) => r.annual_budget_usd).filter(Number.isFinite);
    const sum = budgets.reduce((a, b) => a + b, 0);
    const tiles = [
      ['Clients found', KYC.fmtInt(n), `of ${KYC.fmtInt(total)} in book (${total ? Math.round((n / total) * 100) : 0}%)`],
      ['Total budget', `$${KYC.fmtInt(sum)}`, budgets.length < n ? `${n - budgets.length} without a budget` : 'annual, USD'],
      ['Average budget', budgets.length ? KYC.fmtMoney(Math.round(sum / budgets.length)) : '–', 'per client with a budget'],
    ];
    $('#s-summary').innerHTML = tiles.map(([l, v, note]) =>
      `<div class="kpi"><div class="label">${KYC.esc(l)}</div><div class="value">${v}</div><div class="note">${KYC.esc(note)}</div></div>`).join('');
    $('#s-export').disabled = n === 0;
    $('#s-export').textContent = n ? `Export CSV (${KYC.fmtInt(n)})` : 'Export CSV';
  }

  function sorted() {
    const { key, asc } = st.sort;
    return [...st.results].sort((a, b) => {
      const x = key === 'kyc_status' ? valueOf(a, '_kyc') : a[key];
      const y = key === 'kyc_status' ? valueOf(b, '_kyc') : b[key];
      const c = typeof x === 'number' && typeof y === 'number' ? (Number.isFinite(x) ? x : -1) - (Number.isFinite(y) ? y : -1)
        : String(x ?? '').localeCompare(String(y ?? ''));
      return asc ? c : -c;
    });
  }

  function renderResults() {
    const { key, asc } = st.sort;
    document.querySelectorAll('#s-results th').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === key);
      th.classList.toggle('asc', th.dataset.sort === key && asc);
    });
    const e = KYC.esc;
    $('#s-results tbody').innerHTML = sorted().map((r) => `<tr data-id="${e(r.client_id)}">
      <td>${e(r.client_name)}</td><td>${e(r.region)}</td><td>${e(r.team)}</td><td>${e(r.account_owner)}</td>
      <td class="num">${KYC.fmtMoney(r.annual_budget_usd)}</td>
      <td><span class="status ${r._done ? 'done' : ''}">${e(valueOf(r, '_kyc'))}</span></td></tr>`).join('') ||
      '<tr><td colspan="6" style="color:var(--muted)">No clients match these criteria.</td></tr>';
  }

  // ---------- export ----------
  function exportCSV() {
    const headers = KYC.headers.length ? KYC.headers : Object.keys(st.results[0] || {}).filter((k) => !k.startsWith('_'));
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; // guard against spreadsheet formula injection
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const val = (r, h) => (h === 'annual_budget_usd' ? (Number.isFinite(r[h]) ? r[h] : '') : r[h]);
    const lines = [headers.map(cell).join(','), ...sorted().map((r) => headers.map((h) => cell(val(r, h))).join(','))];
    const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads UTF-8
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kyc-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- events ----------
  $('#s-criteria').addEventListener('change', (e) => {
    const opt = e.target.closest('.opt');
    if (!opt) return;
    const { key, val } = opt.dataset;
    const set = st.picked[key] || (st.picked[key] = new Set());
    if (e.target.checked) set.add(val); else set.delete(val);
    run();
  });
  $('#s-criteria').addEventListener('input', (e) => {
    if (e.target.matches('input[type=search][data-key]')) { st.picked[e.target.dataset.key] = e.target.value.trim(); run(); }
  });
  $('#s-keyword').addEventListener('input', (e) => { st.keyword = e.target.value.trim(); run(); });
  const num = (v) => (v === '' ? null : Number(v));
  $('#s-min').addEventListener('input', (e) => { st.min = num(e.target.value); run(); });
  $('#s-max').addEventListener('input', (e) => { st.max = num(e.target.value); run(); });
  $('#s-reset').addEventListener('click', () => reset());
  $('#s-export').addEventListener('click', exportCSV);
  $('#s-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const { skey, sval } = c.dataset;
    if (skey === '_keyword') { st.keyword = ''; $('#s-keyword').value = ''; }
    else if (skey === '_min') { st.min = null; $('#s-min').value = ''; }
    else if (skey === '_max') { st.max = null; $('#s-max').value = ''; }
    else {
      const f = st.fields.find((x) => x.key === skey);
      if (f.type === 'choice') st.picked[skey].delete(sval); else delete st.picked[skey];
    }
    renderCriteria(); run();
  });
  document.querySelector('#s-results thead').addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;
    const k = th.dataset.sort;
    st.sort = { key: k, asc: st.sort.key === k ? !st.sort.asc : k !== 'annual_budget_usd' };
    renderResults();
  });

  document.addEventListener('kyc:data', setup);
  if (window.KYC && KYC.rows.length) setup();
})();
