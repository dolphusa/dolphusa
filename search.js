/* Client search tab: filter clients by KYC answers (and account fields), summarize, export CSV.
   Depends on window.KYC from app.js.

   Filter types are detected from the data:
   - numeric: >= 80% of non-empty values are numbers (see app.js) -> min / max range
   - choice:  up to MAX_CHOICES distinct values                  -> multi-select dropdown
   - text:    more distinct values than that (free text)         -> "contains" box */
(() => {
  'use strict';

  const MAX_CHOICES = 40;
  const SEARCH_IN_DROPDOWN_AFTER = 8; // show a search box inside dropdowns with more options than this

  const ACCOUNT_FIELDS = [
    { key: 'region', label: 'Region' },
    { key: 'team', label: 'Team' },
    { key: 'account_owner', label: 'Account owner' },
    { key: '_kyc', label: 'KYC status' },
    { key: '_quarter', label: 'KYC completed (quarter)' },
    { key: 'annual_budget_usd', label: 'Annual budget ($)', money: true },
  ];

  const $ = (s) => document.querySelector(s);
  const e = (s) => KYC.esc(s);
  const st = {
    fields: [],
    picked: {},   // choice: key -> Set; text: key -> string; numeric: key -> { min, max }
    keyword: '',
    open: null,   // key of the open dropdown
    sort: { key: 'annual_budget_usd', asc: false },
    results: [],
  };

  const raw = (r, key) => (key === '_kyc' ? (r._done ? 'Completed' : (r.kyc_status || KYC.NOT_DONE))
    : key === '_quarter' ? KYC.quarterOf(r) : r[key]);
  // "Q3 2026" sorts by year then quarter; anything else after, alphabetically.
  const qSort = (v) => { const m = /^Q(\d) (\d{4})$/.exec(v); return m ? Number(m[2]) * 10 + Number(m[1]) : Infinity; };
  const toNum = (v) => KYC.toNum(v);

  // "1500", "1,500", "$1.5k", "2M", "-4", "12%" -> number; '' -> null; anything else -> NaN
  function parseAmount(text) {
    const s = String(text).trim().toLowerCase().replace(/[$,%\s]/g, '');
    if (s === '') return null;
    const m = s.match(/^(-?\d*\.?\d+)([kmb]?)$/);
    return m ? Number(m[1]) * { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]] : NaN;
  }

  // ---------- setup ----------
  function setup() {
    const rows = KYC.rows;
    const has = (k) => k.startsWith('_') || KYC.headers.includes(k);
    const defs = [
      ...ACCOUNT_FIELDS.filter((f) => has(f.key)).map((f) => ({ ...f, group: 'account' })),
      ...KYC.headers.filter((h) => h.startsWith('q_')).map((k) => ({ key: k, label: KYC.prettyKey(k), group: 'question' })),
    ];
    st.fields = defs.map((f) => {
      const vals = rows.map((r) => raw(r, f.key)).filter((v) => v !== '' && v != null && !(typeof v === 'number' && isNaN(v)));
      const nums = vals.map(toNum).filter(Number.isFinite);
      if (KYC.numericCols.has(f.key) && nums.length) {
        return { ...f, type: 'numeric', lo: Math.min(...nums), hi: Math.max(...nums), money: f.money || /_usd$/.test(f.key) };
      }
      const opts = [...new Set(vals.map(String))].sort((a, b) => (f.key === '_quarter' ? qSort(b) - qSort(a) || 0 : 0)
        || a.localeCompare(b, undefined, { numeric: true }));
      return { ...f, type: opts.length > MAX_CHOICES ? 'text' : 'choice', options: opts };
    });
    st.picked = {}; st.keyword = ''; st.open = null;
    $('#s-keyword').value = '';
    readHash();
    renderCriteria();
    run();
  }

  // ---------- matching ----------
  function active(f) {
    const p = st.picked[f.key];
    if (!p) return false;
    if (f.type === 'choice') return p.size > 0;
    if (f.type === 'numeric') return p.min != null || p.max != null;
    return p !== '';
  }
  function matchField(r, f) {
    if (!active(f)) return true;
    const p = st.picked[f.key];
    if (f.type === 'choice') return p.has(String(raw(r, f.key) ?? ''));
    if (f.type === 'text') return String(raw(r, f.key) ?? '').toLowerCase().includes(p.toLowerCase());
    const n = toNum(raw(r, f.key));
    return Number.isFinite(n) && (p.min == null || n >= p.min) && (p.max == null || n <= p.max);
  }
  function matchKeyword(r) {
    if (!st.keyword) return true;
    const q = st.keyword.toLowerCase();
    return Object.entries(r).some(([k, v]) => !k.startsWith('_') && String(v).toLowerCase().includes(q));
  }
  const matchAll = (r, skipKey) => matchKeyword(r) && st.fields.every((f) => f.key === skipKey || matchField(r, f));

  // ---------- criteria UI ----------
  const fmtNum = (f, n) => (f.money ? KYC.fmtMoney(n) : Number(n).toLocaleString());

  function renderCriteria() {
    const groups = [
      ['Account', st.fields.filter((f) => f.group === 'account')],
      ['KYC questions: choices', st.fields.filter((f) => f.group === 'question' && f.type !== 'numeric')],
      ['KYC questions: numbers', st.fields.filter((f) => f.group === 'question' && f.type === 'numeric')],
    ].filter(([, list]) => list.length);
    $('#s-criteria').innerHTML = groups.map(([title, list]) => `<div class="f-group"><h3>${e(title)}</h3>
      <div class="f-grid">${list.map(fieldHTML).join('')}</div></div>`).join('');
    syncButtons();
  }

  function fieldHTML(f) {
    const k = e(f.key);
    const id = `f-${f.key.replace(/\W/g, '')}`;
    if (f.type === 'choice') {
      return `<div class="f-item" data-key="${k}"><span class="f-label" id="${id}-l">${e(f.label)}</span>
        <button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-l ${id}-b" id="${id}-b"></button></div>`;
    }
    if (f.type === 'numeric') {
      const p = st.picked[f.key] || {};
      return `<div class="f-item" data-key="${k}"><span class="f-label" title="${e(f.label)}">${e(f.label)}</span>
        <div class="f-range">
          <input type="text" inputmode="decimal" data-bound="min" aria-label="${e(f.label)} minimum" placeholder="${e(fmtNum(f, f.lo))}" value="${p.min ?? ''}" title="Accepts 1500, 1.5k, 2M">
          <span>–</span>
          <input type="text" inputmode="decimal" data-bound="max" aria-label="${e(f.label)} maximum" placeholder="${e(fmtNum(f, f.hi))}" value="${p.max ?? ''}" title="Accepts 1500, 1.5k, 2M">
        </div></div>`;
    }
    return `<div class="f-item" data-key="${k}"><span class="f-label">${e(f.label)}</span>
      <input type="search" data-text placeholder="Contains…" aria-label="${e(f.label)} contains" value="${e(st.picked[f.key] || '')}"></div>`;
  }

  // Button captions + "on" state; cheap, so it runs after every change.
  function syncButtons() {
    for (const f of st.fields) {
      const item = document.querySelector(`.f-item[data-key="${CSS.escape(f.key)}"]`);
      if (!item) continue;
      item.classList.toggle('on', active(f));
      if (f.type !== 'choice') continue;
      const p = st.picked[f.key];
      const btn = item.querySelector('.dd-btn');
      btn.innerHTML = !p || !p.size ? '<span class="any">Any</span>'
        : p.size === 1 ? e([...p][0]) : `${p.size} selected`;
      btn.title = p && p.size ? [...p].join(', ') : '';
      btn.setAttribute('aria-expanded', String(st.open === f.key));
    }
  }

  function openDropdown(key) {
    closeDropdown();
    const f = st.fields.find((x) => x.key === key);
    const item = document.querySelector(`.f-item[data-key="${CSS.escape(key)}"]`);
    st.open = key;
    const pop = document.createElement('div');
    pop.className = 'dd-pop';
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-multiselectable', 'true');
    pop.innerHTML = `${f.options.length > SEARCH_IN_DROPDOWN_AFTER ? '<input type="search" class="dd-find" placeholder="Find…" aria-label="Find option">' : ''}
      <div class="dd-opts">${f.options.map((v) => `<label class="opt" data-val="${e(v)}">
        <input type="checkbox" ${st.picked[key]?.has(v) ? 'checked' : ''}><span>${e(v)}</span><span class="n"></span></label>`).join('')}</div>
      <div class="dd-foot"><button type="button" class="link" data-act="clear">Clear</button><button type="button" class="link" data-act="done">Done</button></div>`;
    item.appendChild(pop);
    // keep the popover on-screen
    const r = pop.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) { pop.style.left = 'auto'; pop.style.right = '0'; }
    updateCounts();
    syncButtons();
    (pop.querySelector('.dd-find') || pop.querySelector('input')).focus();
  }
  function closeDropdown(focusBtn) {
    const pop = document.querySelector('.dd-pop');
    if (!pop) { st.open = null; return; }
    const btn = pop.parentElement.querySelector('.dd-btn');
    pop.remove(); st.open = null; syncButtons();
    if (focusBtn) btn.focus();
  }

  // Counts in the open dropdown: clients you'd get by picking that answer, given every other filter.
  function updateCounts() {
    if (!st.open) return;
    const counts = new Map();
    for (const r of KYC.rows) {
      if (!matchAll(r, st.open)) continue;
      const v = String(raw(r, st.open) ?? '');
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    document.querySelectorAll('.dd-pop .opt').forEach((el) => {
      const n = counts.get(el.dataset.val) || 0;
      el.querySelector('.n').textContent = n.toLocaleString();
      el.classList.toggle('zero', n === 0);
    });
  }

  // ---------- results ----------
  function run() {
    st.results = KYC.rows.filter((r) => matchAll(r));
    syncButtons();
    updateCounts();
    renderChips();
    renderSummary(KYC.rows.length);
    renderResults();
    writeHash();
  }

  // ---------- URL state ----------
  // #search?region=APAC&q_industry=Retail&q_industry=Energy&q_employee_count=100..500&kw=foo
  // Repeated keys = several answers. Lets other tabs (and colleagues) link straight to a search.
  let writing = false;
  function readHash() {
    const [tab, qs] = location.hash.slice(1).split('?');
    if (tab !== 'search' || !qs) return false;
    const p = new URLSearchParams(qs);
    st.picked = {};
    for (const f of st.fields) {
      const vals = p.getAll(f.key);
      if (!vals.length) continue;
      if (f.type === 'choice') st.picked[f.key] = new Set(vals);
      else if (f.type === 'text') st.picked[f.key] = vals[0];
      else {
        const [lo, hi] = vals[0].split('..');
        st.picked[f.key] = { min: lo === '' || lo == null ? null : Number(lo), max: hi === '' || hi == null ? null : Number(hi) };
      }
    }
    st.keyword = p.get('kw') || '';
    $('#s-keyword').value = st.keyword;
    return true;
  }
  function writeHash() {
    if (!location.hash.startsWith('#search')) return;
    const p = new URLSearchParams();
    for (const f of st.fields) {
      if (!active(f)) continue;
      const v = st.picked[f.key];
      if (f.type === 'choice') v.forEach((x) => p.append(f.key, x));
      else if (f.type === 'text') p.append(f.key, v);
      else p.append(f.key, `${v.min ?? ''}..${v.max ?? ''}`);
    }
    if (st.keyword) p.set('kw', st.keyword);
    const h = `#search${p.toString() ? `?${p}` : ''}`;
    if (location.hash !== h) { writing = true; history.replaceState(null, '', h); writing = false; }
  }
  window.addEventListener('hashchange', () => {
    if (writing || !st.fields.length) return;
    if (readHash()) { closeDropdown(); renderCriteria(); run(); }
  });

  function renderChips() {
    const chips = [];
    for (const f of st.fields) {
      if (!active(f)) continue;
      const p = st.picked[f.key];
      if (f.type === 'choice') p.forEach((v) => chips.push([`${f.label}: ${v}`, f.key, v]));
      else if (f.type === 'text') chips.push([`${f.label} contains “${p}”`, f.key, '']);
      else {
        const t = p.min != null && p.max != null ? `${fmtNum(f, p.min)}–${fmtNum(f, p.max)}`
          : p.min != null ? `≥ ${fmtNum(f, p.min)}` : `≤ ${fmtNum(f, p.max)}`;
        chips.push([`${f.label}: ${t}`, f.key, '']);
      }
    }
    if (st.keyword) chips.push([`Keyword: “${st.keyword}”`, '_keyword', '']);
    $('#s-chips').innerHTML = chips.length
      ? chips.map(([t, k, v]) => `<button class="chip" data-skey="${e(k)}" data-sval="${e(v)}">${e(t)}</button>`).join('')
      : '<span class="sub">No filters, so every client is shown.</span>';
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
      `<div class="kpi"><div class="label">${e(l)}</div><div class="value">${v}</div><div class="note">${e(note)}</div></div>`).join('');
    $('#s-export').disabled = n === 0;
    $('#s-export').textContent = n ? `Export CSV (${KYC.fmtInt(n)})` : 'Export CSV';
  }

  function sorted() {
    const { key, asc } = st.sort;
    const get = (r) => (key === 'kyc_status' ? raw(r, '_kyc') : key === '_qKey' ? (r._qKey ?? -1) : r[key]);
    return [...st.results].sort((a, b) => {
      const x = get(a), y = get(b);
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
    $('#s-results tbody').innerHTML = sorted().map((r) => `<tr data-id="${e(r.client_id)}">
      <td>${e(r.client_name)}</td><td>${e(r.region)}</td><td>${e(r.team)}</td><td>${e(r.account_owner)}</td>
      <td class="num">${KYC.fmtMoney(r.annual_budget_usd)}</td>
      <td><span class="status ${r._done ? 'done' : ''}">${e(raw(r, '_kyc'))}</span></td>
      <td>${e(r._qLabel || '')}</td></tr>`).join('') ||
      '<tr><td colspan="7" style="color:var(--muted)">No clients match these filters.</td></tr>';
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
  const crit = $('#s-criteria');
  crit.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.dd-btn');
    if (btn) {
      const key = btn.closest('.f-item').dataset.key;
      return st.open === key ? closeDropdown(true) : openDropdown(key);
    }
    const act = ev.target.closest('.dd-foot .link');
    if (act) {
      if (act.dataset.act === 'clear') {
        delete st.picked[st.open];
        document.querySelectorAll('.dd-pop .opt input').forEach((i) => { i.checked = false; });
        return run();
      }
      return closeDropdown(true);
    }
  });
  crit.addEventListener('change', (ev) => {
    const opt = ev.target.closest('.dd-pop .opt');
    if (!opt) return;
    const set = st.picked[st.open] || (st.picked[st.open] = new Set());
    if (ev.target.checked) set.add(opt.dataset.val); else set.delete(opt.dataset.val);
    run();
  });
  crit.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.classList.contains('dd-find')) {
      const q = t.value.toLowerCase();
      document.querySelectorAll('.dd-pop .opt').forEach((o) => { o.hidden = !o.dataset.val.toLowerCase().includes(q); });
      return;
    }
    const key = t.closest('.f-item')?.dataset.key;
    if (!key) return;
    if (t.dataset.bound) {
      const p = st.picked[key] || (st.picked[key] = {});
      const v = parseAmount(t.value);
      t.setAttribute('aria-invalid', String(Number.isNaN(v)));
      p[t.dataset.bound] = Number.isFinite(v) ? v : null;
    } else if (t.hasAttribute('data-text')) st.picked[key] = t.value.trim();
    run();
  });
  document.addEventListener('click', (ev) => {
    if (st.open && !ev.target.closest('.dd-pop, .dd-btn')) closeDropdown(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && st.open) { ev.preventDefault(); closeDropdown(true); }
  });

  $('#s-keyword').addEventListener('input', (ev) => { st.keyword = ev.target.value.trim(); run(); });
  $('#s-reset').addEventListener('click', () => {
    st.picked = {}; st.keyword = ''; $('#s-keyword').value = '';
    closeDropdown(); renderCriteria(); run();
  });
  $('#s-export').addEventListener('click', exportCSV);
  $('#s-chips').addEventListener('click', (ev) => {
    const c = ev.target.closest('.chip');
    if (!c) return;
    const { skey, sval } = c.dataset;
    if (skey === '_keyword') { st.keyword = ''; $('#s-keyword').value = ''; }
    else {
      const f = st.fields.find((x) => x.key === skey);
      if (f.type === 'choice') st.picked[skey].delete(sval); else delete st.picked[skey];
    }
    closeDropdown(); renderCriteria(); run();
  });
  document.querySelector('#s-results thead').addEventListener('click', (ev) => {
    const th = ev.target.closest('th');
    if (!th) return;
    const k = th.dataset.sort;
    st.sort = { key: k, asc: st.sort.key === k ? !st.sort.asc : k !== 'annual_budget_usd' };
    renderResults();
  });

  document.addEventListener('kyc:data', setup);
  if (window.KYC && KYC.rows.length) setup();
})();
