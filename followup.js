/* KYC follow-up tab: who needs KYC, who needs a KYC refresh, whose data needs fixing.
   Depends on window.KYC from app.js. Also fills the summary strip under "KYC coverage" on the overview. */
(() => {
  'use strict';

  const REFRESH_AFTER_MONTHS = 12; // KYC must be refreshed this long after the last completion
  const DUE_SOON_DAYS = 60;        // "due soon" window shown on the refresh tile

  const CATS = {
    not: { label: 'KYC not completed', badge: 'b-not' },
    refresh: { label: 'KYC refresh overdue', badge: 'b-refresh' },
    dq: { label: 'Data quality issue', badge: 'b-dq' },
  };
  const REQUIRED = [
    ['client_id', 'client ID'], ['client_name', 'client name'], ['region', 'region'], ['team', 'team'],
    ['account_owner', 'account owner'], ['annual_budget_usd', 'budget'],
  ];
  const SPELLING_FIELDS = ['region', 'team', 'account_owner', 'kyc_status'];

  const $ = (s) => document.querySelector(s);
  const e = (s) => KYC.esc(s);
  const st = {
    items: [],          // [{ r, cats: Set, issues: [{rule, text}], details: [] , dueSoon }]
    asOf: null,
    cat: null, rule: null, region: '', team: '', owner: '', q: '',
    sort: { key: '_priority', asc: false },
  };

  // ---------- analysis ----------
  const DAY = 86400000;
  const today = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const parseDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN);
  const addMonths = (t, m) => { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + m); return d.getTime(); };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const ago = (days) => (days < 60 ? `${days} days ago` : `${Math.floor(days / 30.44)} months ago`);

  function analyze() {
    const rows = KYC.rows;
    const headers = new Set(KYC.headers);
    const qCols = KYC.headers.filter((h) => h.startsWith('q_'));
    const numeric = KYC.numericCols;
    const now = today();
    st.asOf = now;

    // Spelling variants: values that differ only by case/spacing. The most common spelling wins.
    const canon = {};
    for (const f of [...SPELLING_FIELDS, ...qCols.filter((q) => !numeric.has(q))]) {
      if (!headers.has(f)) continue;
      const groups = new Map();
      for (const r of rows) {
        const v = r._raw[f];
        if (!v) continue;
        const k = v.toLowerCase().replace(/\s+/g, ' ').trim();
        const g = groups.get(k) || new Map();
        g.set(v, (g.get(v) || 0) + 1);
        groups.set(k, g);
      }
      canon[f] = new Map();
      for (const g of groups.values()) {
        if (g.size < 2) continue;
        const best = [...g].sort((a, b) => b[1] - a[1])[0][0];
        for (const v of g.keys()) if (v !== best) canon[f].set(v, best);
      }
    }
    const idCount = new Map();
    const byName = new Map();
    for (const r of rows) {
      const id = r._raw.client_id;
      if (id) idCount.set(id, (idCount.get(id) || 0) + 1);
      const n = (r._raw.client_name || '').toLowerCase().trim();
      if (n) byName.set(n, [...(byName.get(n) || []), r]);
    }

    st.items = rows.map((r) => {
      const raw = r._raw;
      const cats = new Set();
      const details = [];
      const issues = [];
      const issue = (rule, text) => issues.push({ rule, text });

      // 1. KYC not completed
      if (!r._done) {
        cats.add('not');
        details.push(`KYC ${(raw.kyc_status || 'not started').toLowerCase()}`);
      }

      // 2. KYC refresh
      const dateRaw = raw.kyc_completed_date || '';
      const t = parseDate(dateRaw);
      let dueSoon = false;
      if (r._done && Number.isFinite(t) && t <= now) {
        const due = addMonths(t, REFRESH_AFTER_MONTHS);
        if (due < now) {
          cats.add('refresh');
          details.push(`Last KYC ${dateRaw} (${ago(Math.round((now - t) / DAY))}); refresh was due ${iso(due)}`);
        } else if (due - now <= DUE_SOON_DAYS * DAY) {
          dueSoon = true;
        }
      }

      // 3. Data quality
      for (const [k, label] of REQUIRED) {
        if (headers.has(k) && !raw[k]) issue('Missing required field', `Missing ${label}`);
      }
      if (headers.has('annual_budget_usd') && raw.annual_budget_usd) {
        const b = KYC.toNum(raw.annual_budget_usd);
        if (!Number.isFinite(b)) issue('Budget not a number', `Budget is "${raw.annual_budget_usd}", expected a number`);
        else if (b < 0) issue('Budget not a number', `Budget is negative (${raw.annual_budget_usd})`);
      }
      if (headers.has('kyc_status') && !raw.kyc_status) {
        issue('KYC status / date problem', Number.isFinite(t)
          ? 'KYC status is blank (counted as completed because a date is set)' : 'KYC status is blank');
      }
      if (r._done && !dateRaw) issue('KYC status / date problem', 'KYC completed but no completion date');
      if (dateRaw && !Number.isFinite(t)) issue('KYC status / date problem', `Completion date "${dateRaw}" is not a valid YYYY-MM-DD date`);
      if (Number.isFinite(t) && t > now) issue('KYC status / date problem', `Completion date ${dateRaw} is in the future`);
      if (!r._done && dateRaw) issue('KYC status / date problem', `Status is "${raw.kyc_status || 'blank'}" but a completion date is set (${dateRaw})`);
      for (const [f, map] of Object.entries(canon)) {
        if (map.has(raw[f])) issue('Inconsistent spelling', `${f.startsWith('q_') ? KYC.prettyKey(f) : f[0].toUpperCase() + f.slice(1).replace(/_/g, ' ')} "${raw[f]}" — should it be "${map.get(raw[f])}"?`);
      }
      if (r._done) {
        const blank = qCols.filter((q) => !raw[q]);
        if (blank.length) {
          const names = blank.map(KYC.prettyKey);
          issue('Missing KYC answers', `${blank.length} of ${qCols.length} KYC answers blank: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}`);
        }
      }
      for (const q of qCols) {
        if (numeric.has(q) && raw[q] && !Number.isFinite(KYC.toNum(raw[q]))) {
          issue('Text in a number question', `${KYC.prettyKey(q)} is "${raw[q]}", expected a number`);
        }
      }
      if (raw.client_id && idCount.get(raw.client_id) > 1) issue('Possible duplicate', `Client ID ${raw.client_id} appears ${idCount.get(raw.client_id)} times`);
      const twins = (byName.get((raw.client_name || '').toLowerCase().trim()) || []).filter((x) => x !== r);
      if (twins.length) issue('Possible duplicate', `Same name as ${twins.map((x) => x._raw.client_id || '(no ID)').join(', ')}`);

      if (issues.length) cats.add('dq');
      return { r, cats, issues, details, dueSoon, _priority: cats.size * 1e12 + (Number.isFinite(r.annual_budget_usd) ? r.annual_budget_usd : 0) };
    });

    fillSelect('#fu-region', 'region', 'All regions');
    fillSelect('#fu-team', 'team', 'All teams');
    fillSelect('#fu-owner', 'account_owner', 'All owners');
    $('#fu-asof').textContent = `As of ${iso(now)}. KYC needs a refresh ${REFRESH_AFTER_MONTHS} months after it was last completed.`;
  }

  function fillSelect(sel, key, any) {
    const vals = [...new Set(KYC.rows.map((r) => (key === 'account_owner' ? r.account_owner || 'Unassigned' : r[key])))]
      .sort((a, b) => a.localeCompare(b));
    $(sel).innerHTML = `<option value="">${any}</option>${vals.map((v) => `<option>${e(v)}</option>`).join('')}`;
  }

  // ---------- filtering ----------
  const ownerOf = (r) => r.account_owner || 'Unassigned';
  const inScope = (it, skip) =>
    (!st.region || it.r.region === st.region) && (!st.team || it.r.team === st.team) &&
    (skip === 'owner' || !st.owner || ownerOf(it.r) === st.owner);
  const matchCat = (it) => (st.cat ? it.cats.has(st.cat) : it.cats.size > 0) &&
    (!st.rule || it.issues.some((x) => x.rule === st.rule));
  const matchQ = (it) => !st.q || [it.r.client_name, it.r.client_id, ownerOf(it.r), ...it.details, ...it.issues.map((x) => x.text)]
    .some((v) => String(v || '').toLowerCase().includes(st.q.toLowerCase()));

  // ---------- render ----------
  function render() {
    if (!st.items.length && !KYC.rows.length) return;
    const scope = st.items.filter((it) => inScope(it));
    renderKpis(scope);
    renderOwners(st.items.filter((it) => inScope(it, 'owner')));
    renderRules(scope);
    renderChips();
    renderList(scope.filter((it) => matchCat(it) && matchQ(it)));
    writeHash();
  }

  function sumBudget(list) {
    return list.reduce((a, it) => a + (Number.isFinite(it.r.annual_budget_usd) ? it.r.annual_budget_usd : 0), 0);
  }

  function renderKpis(scope) {
    const need = scope.filter((it) => it.cats.size);
    const of = (c) => scope.filter((it) => it.cats.has(c));
    const not = of('not'), ref = of('refresh'), dq = of('dq');
    const notStarted = not.filter((it) => !/progress/i.test(it.r._raw.kyc_status || '')).length;
    const soon = scope.filter((it) => it.dueSoon).length;
    const nIssues = dq.reduce((a, it) => a + it.issues.length, 0);
    const tile = (key, label, value, note, badge) => `<button type="button" class="kpi ${st.cat === key && !st.rule ? 'sel' : ''}" data-cat="${key}">
      <div class="label">${badge ? `<span class="badge ${badge}" aria-hidden="true" style="border:none;padding:0"></span>` : ''}${e(label)}</div>
      <div class="value">${KYC.fmtInt(value)}</div><div class="note">${e(note)}</div></button>`;
    $('#fu-kpis').innerHTML = [
      tile('', 'Clients needing action', need.length, `of ${KYC.fmtInt(scope.length)} · ${KYC.fmtMoney(sumBudget(need))} budget`),
      tile('not', CATS.not.label, not.length, `${notStarted} not started · ${not.length - notStarted} in progress`, 'b-not'),
      tile('refresh', CATS.refresh.label, ref.length, soon ? `+${soon} more due in the next ${DUE_SOON_DAYS} days` : `last KYC over ${REFRESH_AFTER_MONTHS} months ago`, 'b-refresh'),
      tile('dq', 'Data quality issues', dq.length, `${nIssues} issue${nIssues === 1 ? '' : 's'} to fix`, 'b-dq'),
    ].join('');
  }

  function renderOwners(list) {
    const m = new Map();
    for (const it of list) {
      const o = ownerOf(it.r);
      const g = m.get(o) || { not: 0, refresh: 0, dq: 0, total: 0, budget: 0 };
      if (it.cats.size) {
        g.total++;
        if (Number.isFinite(it.r.annual_budget_usd)) g.budget += it.r.annual_budget_usd;
        for (const c of it.cats) g[c]++;
      }
      m.set(o, g);
    }
    const rows = [...m].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
    $('#fu-owners').innerHTML = `<thead><tr><th>Owner</th><th class="num">Not completed</th><th class="num">Refresh overdue</th>
      <th class="num">Data issues</th><th class="num">Clients</th><th class="num col-budget">Budget</th></tr></thead><tbody>
      ${rows.map(([o, g]) => `<tr data-owner="${e(o)}" tabindex="0" class="${st.owner === o ? 'sel' : ''}" aria-pressed="${st.owner === o}">
        <td>${e(o)}</td><td class="num">${g.not}</td><td class="num">${g.refresh}</td><td class="num">${g.dq}</td>
        <td class="num"><b>${g.total}</b></td><td class="num col-budget">${KYC.fmtMoney(g.budget)}</td></tr>`).join('')}</tbody>`;
  }

  function renderRules(scope) {
    const m = new Map();
    for (const it of scope) {
      for (const rule of new Set(it.issues.map((x) => x.rule))) m.set(rule, (m.get(rule) || 0) + 1);
    }
    const rows = [...m].sort((a, b) => b[1] - a[1]);
    $('#fu-rules').innerHTML = `<thead><tr><th>Issue</th><th class="num">Clients</th></tr></thead><tbody>
      ${rows.map(([rule, n]) => `<tr data-rule="${e(rule)}" tabindex="0" class="${st.rule === rule ? 'sel' : ''}" aria-pressed="${st.rule === rule}">
        <td>${e(rule)}</td><td class="num">${n}</td></tr>`).join('') ||
      '<tr class="empty"><td colspan="2">No data quality issues 🎉</td></tr>'}</tbody>`;
  }

  function renderChips() {
    const chips = [];
    if (st.cat) chips.push(['cat', st.cat === 'dq' ? 'Data quality issues' : CATS[st.cat].label]);
    if (st.rule) chips.push(['rule', `Issue: ${st.rule}`]);
    if (st.region) chips.push(['region', `Region: ${st.region}`]);
    if (st.team) chips.push(['team', `Team: ${st.team}`]);
    if (st.owner) chips.push(['owner', `Owner: ${st.owner}`]);
    $('#fu-chips').innerHTML = chips.length
      ? chips.map(([k, t]) => `<button class="chip" data-fclear="${k}">${e(t)}</button>`).join('')
      : '<span class="sub">Showing every client that needs at least one action.</span>';
  }

  let lastList = [];
  function renderList(list) {
    const { key, asc } = st.sort;
    const get = (it) => (key === '_priority' ? it._priority : key === '_nActions' ? it.cats.size * 100 + it.issues.length
      : key === 'account_owner' ? ownerOf(it.r) : it.r[key]);
    list.sort((a, b) => {
      const x = get(a), y = get(b);
      const c = typeof x === 'number' && typeof y === 'number' ? (Number.isFinite(x) ? x : -1) - (Number.isFinite(y) ? y : -1)
        : String(x ?? '').localeCompare(String(y ?? ''));
      return asc ? c : -c;
    });
    lastList = list;
    document.querySelectorAll('#fu-list th').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === key);
      th.classList.toggle('asc', th.dataset.sort === key && asc);
    });
    $('#fu-export').disabled = !list.length;
    $('#fu-export').textContent = list.length ? `Export CSV (${KYC.fmtInt(list.length)})` : 'Export CSV';
    $('#fu-list tbody').innerHTML = list.map((it) => `<tr data-id="${e(it.r.client_id)}">
      <td>${e(it.r.client_name || '(no name)')}</td><td>${e(ownerOf(it.r))}</td><td>${e(it.r.region)}</td><td>${e(it.r.team)}</td>
      <td class="num">${KYC.fmtMoney(it.r.annual_budget_usd)}</td>
      <td><div class="badges">${['not', 'refresh', 'dq'].filter((c) => it.cats.has(c))
        .map((c) => `<span class="badge ${CATS[c].badge}">${c === 'dq' ? `Data (${it.issues.length})` : c === 'not' ? 'Needs KYC' : 'Refresh'}</span>`).join('')}</div></td>
      <td class="details">${[...it.details, ...it.issues.map((x) => x.text)].map((t) => `<div>${e(t)}</div>`).join('')}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:var(--muted)">Nothing to follow up on for these filters.</td></tr>';
  }

  // ---------- overview strip ----------
  function renderStrip(ev) {
    const { region, team } = ev.detail;
    const list = st.items.filter((it) => (!region || it.r.region === region) && (!team || it.r.team === team));
    const n = (c) => list.filter((it) => it.cats.has(c)).length;
    const need = list.filter((it) => it.cats.size).length;
    const params = new URLSearchParams();
    if (region) params.set('region', region);
    if (team) params.set('team', team);
    const qs = params.toString();
    $('#fu-strip').innerHTML = `<span class="lead">${KYC.fmtInt(need)} client${need === 1 ? '' : 's'} need follow-up</span>
      <span class="items"><span class="badge b-not"><b>${n('not')}</b>&nbsp;KYC not completed</span>
      <span class="badge b-refresh"><b>${n('refresh')}</b>&nbsp;refresh overdue</span>
      <span class="badge b-dq"><b>${n('dq')}</b>&nbsp;data issues</span></span>
      <a class="btn primary" href="#followup${qs ? `?${qs}` : ''}">Open KYC follow-up →</a>`;
  }

  // ---------- URL state (#followup?region=..&team=..&owner=..&cat=..) ----------
  let writing = false;
  function readHash() {
    const [tab, qs] = location.hash.slice(1).split('?');
    if (tab !== 'followup') return false;
    const p = new URLSearchParams(qs || '');
    st.region = p.get('region') || ''; st.team = p.get('team') || ''; st.owner = p.get('owner') || '';
    st.cat = CATS[p.get('cat')] ? p.get('cat') : null; st.rule = p.get('issue') || null;
    $('#fu-region').value = st.region; $('#fu-team').value = st.team; $('#fu-owner').value = st.owner;
    return true;
  }
  function writeHash() {
    if (!location.hash.startsWith('#followup')) return;
    const p = new URLSearchParams();
    for (const [k, v] of [['region', st.region], ['team', st.team], ['owner', st.owner], ['cat', st.cat], ['issue', st.rule]]) if (v) p.set(k, v);
    const h = `#followup${p.toString() ? `?${p}` : ''}`;
    if (location.hash !== h) { writing = true; history.replaceState(null, '', h); writing = false; }
  }

  // ---------- export ----------
  function exportCSV() {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['client_id', 'client_name', 'account_owner', 'region', 'team', 'annual_budget_usd', 'kyc_status',
      'kyc_completed_date', 'needs_kyc', 'refresh_overdue', 'data_issues', 'details'];
    const lines = [head.join(','), ...lastList.map((it) => [
      it.r._raw.client_id, it.r._raw.client_name, it.r._raw.account_owner, it.r._raw.region, it.r._raw.team,
      it.r._raw.annual_budget_usd, it.r._raw.kyc_status, it.r._raw.kyc_completed_date,
      it.cats.has('not') ? 'yes' : '', it.cats.has('refresh') ? 'yes' : '', it.issues.length || '',
      [...it.details, ...it.issues.map((x) => x.text)].join('; '),
    ].map(cell).join(','))];
    const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kyc-follow-up-${iso(st.asOf)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- events ----------
  $('#fu-kpis').addEventListener('click', (ev) => {
    const t = ev.target.closest('.kpi');
    if (!t) return;
    const c = t.dataset.cat || null;
    st.cat = st.cat === c && !st.rule ? null : c; st.rule = null;
    render();
  });
  const pick = (ev, attr, apply) => {
    const tr = ev.target.closest(`tr[${attr}]`);
    if (tr) { apply(tr.getAttribute(attr)); render(); }
  };
  $('#fu-owners').addEventListener('click', (ev) => pick(ev, 'data-owner', (o) => {
    st.owner = st.owner === o ? '' : o; $('#fu-owner').value = st.owner;
  }));
  $('#fu-rules').addEventListener('click', (ev) => pick(ev, 'data-rule', (r) => {
    st.rule = st.rule === r ? null : r; st.cat = st.rule ? 'dq' : st.cat;
  }));
  ['#fu-owners', '#fu-rules'].forEach((s) => $(s).addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('tr')) { ev.preventDefault(); ev.target.click(); }
  }));
  $('#fu-region').addEventListener('change', (ev) => { st.region = ev.target.value; render(); });
  $('#fu-team').addEventListener('change', (ev) => { st.team = ev.target.value; render(); });
  $('#fu-owner').addEventListener('change', (ev) => { st.owner = ev.target.value; render(); });
  $('#fu-search').addEventListener('input', (ev) => { st.q = ev.target.value.trim(); render(); });
  $('#fu-export').addEventListener('click', exportCSV);
  $('#fu-chips').addEventListener('click', (ev) => {
    const c = ev.target.closest('.chip');
    if (!c) return;
    const k = c.dataset.fclear;
    if (k === 'cat') { st.cat = null; st.rule = null; } else if (k === 'rule') st.rule = null;
    else { st[k] = ''; $(`#fu-${k}`).value = ''; }
    render();
  });
  document.querySelector('#fu-list thead').addEventListener('click', (ev) => {
    const th = ev.target.closest('th[data-sort]');
    if (!th) return;
    const k = th.dataset.sort;
    st.sort = { key: k, asc: st.sort.key === k ? !st.sort.asc : !['annual_budget_usd', '_nActions'].includes(k) };
    render();
  });
  $('#fu-list tbody').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (tr) KYC.showDetail(tr.dataset.id);
  });

  window.addEventListener('hashchange', () => { if (!writing && readHash()) render(); });
  document.addEventListener('kyc:data', () => { analyze(); readHash(); render(); });
  document.addEventListener('kyc:overview', renderStrip);
})();
