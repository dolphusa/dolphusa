/* Overview tab, section 2: Market overview of KYC-completed clients.
   Follows the region/team selection of the KYC coverage section. Depends on window.KYC (app.js). */
(() => {
  'use strict';

  // ---- configuration --------------------------------------------------------------------------
  // Questions always shown as small charts. Missing ones are skipped; if none exist, the first
  // four categorical questions are used.
  const PRESET_QUESTIONS = ['q_primary_objective', 'q_key_pain_point', 'q_industry', 'q_decision_timeline'];
  // Answers with a natural order are always listed in that order instead of largest-first.
  const ANSWER_ORDER = {
    q_decision_timeline: ['< 3 months', '3-6 months', '6-12 months', '12+ months'],
  };
  const MAX_BARS = 12; // more answers than this are folded into "Other"
  // ----------------------------------------------------------------------------------------------

  const $ = (s) => document.querySelector(s);
  const e = (s) => KYC.esc(s);
  const st = { measure: 'clients', question: null, sort: 'value', scope: { region: null, team: null }, rows: [] };

  const budgetOf = (r) => (Number.isFinite(r.annual_budget_usd) ? r.annual_budget_usd : 0);
  const isMoney = (k) => k === 'annual_budget_usd' || /_usd$/.test(k);
  const fmtVal = (k, n) => (isMoney(k) ? KYC.fmtMoney(n) : Number(n).toLocaleString());

  // ---------- bins for numeric distributions ----------
  // Skewed data (budgets, headcount) gets 1-2.5-5 log-style edges; everything else gets "nice" linear steps.
  function edgesFor(values) {
    const min = Math.min(...values), max = Math.max(...values);
    if (min === max) return [min, min + 1];
    // Short whole-number scales (e.g. 1–10 ratings): one bar per value.
    if (values.every(Number.isInteger) && max - min <= 12) return Array.from({ length: max - min + 2 }, (_, i) => min + i);
    const pos = values.filter((v) => v > 0);
    const minPos = pos.length ? Math.min(...pos) : 0;
    if (min >= 0 && minPos && max / minPos > 30) {
      for (const seq of [[1, 2.5, 5], [1, 5], [1]]) {
        const steps = [];
        for (let k = Math.floor(Math.log10(minPos)) - 1; k <= Math.ceil(Math.log10(max)) + 1; k++) {
          seq.forEach((m) => steps.push(+(m * 10 ** k).toPrecision(6)));
        }
        const start = steps.filter((x) => x <= minPos).pop();
        const end = steps.find((x) => x > max);
        const edges = steps.filter((x) => x >= start && x <= end);
        if (min === 0) edges.unshift(0);
        if (edges.length - 1 <= 8) return edges;
      }
    }
    const raw = (max - min) / 6;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
    const edges = [];
    for (let v = Math.floor(min / step) * step; ; v += step) { edges.push(+v.toFixed(10)); if (v > max) break; }
    return edges;
  }

  const edgeCache = new Map();
  function bookEdges(key) {
    if (!edgeCache.has(key)) {
      const vals = KYC.rows.filter((r) => r._done)
        .map((r) => KYC.toNum(key === 'annual_budget_usd' ? r.annual_budget_usd : r._raw[key])).filter(Number.isFinite);
      edgeCache.set(key, vals.length ? edgesFor(vals) : [0, 1]);
    }
    return edgeCache.get(key);
  }

  // ---------- distributions ----------
  // Returns [{ label, n, budget, link }] for one question over the given rows.
  function distribution(key, rows) {
    const numeric = KYC.numericCols.has(key);
    const answered = rows.filter((r) => (key === 'annual_budget_usd' ? Number.isFinite(r.annual_budget_usd) : r._raw[key]));
    if (numeric) {
      const vals = answered.map((r) => KYC.toNum(key === 'annual_budget_usd' ? r.annual_budget_usd : r._raw[key])).filter(Number.isFinite);
      if (!vals.length) return { items: [], answered: 0 };
      // Bands come from the whole book, so they stay the same when region/team filters change.
      const edges = bookEdges(key);
      // Whole-number data reads better as inclusive ranges: "2–3" rather than "2–4" for [2, 4).
      const ints = !isMoney(key) && edges.every(Number.isInteger) && edges[edges.length - 1] - edges[0] > 0
        && KYC.rows.every((r) => { const v = KYC.toNum(r._raw[key]); return !Number.isFinite(v) || Number.isInteger(v); });
      const label = (lo, hi) => (!ints ? `${fmtVal(key, lo)}–${fmtVal(key, hi)}`
        : hi - 1 === lo ? fmtVal(key, lo) : `${fmtVal(key, lo)}–${fmtVal(key, hi - 1)}`);
      const items = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1], label: label(lo, edges[i + 1]), n: 0, budget: 0, rows: [] }));
      for (const r of answered) {
        const v = KYC.toNum(key === 'annual_budget_usd' ? r.annual_budget_usd : r._raw[key]);
        if (!Number.isFinite(v)) continue;
        let i = edges.findIndex((x, j) => j > 0 && v < x) - 1;
        if (i < 0) i = items.length - 1;
        items[i].n++; items[i].budget += budgetOf(r); items[i].rows.push(r);
      }
      items.forEach((it) => { it.link = [[key, `${it.lo}..${it.hi - 1e-6}`]]; });
      return { items, answered: vals.length, ordered: true };
    }
    const m = new Map();
    for (const r of answered) {
      const v = r._raw[key];
      const g = m.get(v) || { label: v, n: 0, budget: 0, link: [[key, v]], rows: [] };
      g.n++; g.budget += budgetOf(r); g.rows.push(r);
      m.set(v, g);
    }
    return { items: [...m.values()], answered: answered.length, ordered: false };
  }

  function sortItems(key, d, mode) {
    if (d.ordered) return d.items;
    const order = ANSWER_ORDER[key];
    const items = [...d.items];
    if (order) items.sort((a, b) => ((order.indexOf(a.label) + 1 || 999) - (order.indexOf(b.label) + 1 || 999)) || a.label.localeCompare(b.label));
    else if (mode === 'label') items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    else items.sort((a, b) => (st.measure === 'budget' ? b.budget - a.budget : b.n - a.n) || a.label.localeCompare(b.label));
    if (items.length > MAX_BARS) {
      const rest = items.splice(MAX_BARS - 1);
      items.push({ label: `Other (${rest.length} answers)`, n: rest.reduce((a, x) => a + x.n, 0), budget: rest.reduce((a, x) => a + x.budget, 0), link: null });
    }
    return items;
  }

  // Shared with penetration.js: group rows by the answers of a question (or budget bands).
  // Items come back in their natural order when the question has one (bands, ANSWER_ORDER).
  KYC.segment = (key, rows) => {
    const d = distribution(key, rows);
    const fixed = d.ordered || !!ANSWER_ORDER[key];
    const items = fixed && !d.ordered ? sortItems(key, { ...d, items: d.items }, 'label') : d.items;
    return { items, answered: d.answered, fixed };
  };
  KYC.searchLink = (pairs, scope) => {
    const p = new URLSearchParams();
    if (scope.region) p.append('region', scope.region);
    if (scope.team) p.append('team', scope.team);
    for (const [k, v] of pairs) p.append(k, v);
    return `#search?${p}`;
  };

  // ---------- rendering ----------
  function hbars(key, d, mode) {
    const items = sortItems(key, d, mode);
    if (!items.length) return '<p class="sub">No answers yet.</p>';
    const val = (it) => (st.measure === 'budget' ? it.budget : it.n);
    const total = items.reduce((a, it) => a + val(it), 0);
    const max = Math.max(...items.map(val), 1);
    return items.map((it) => {
      const v = val(it);
      const tip = `${it.label}: ${KYC.fmtInt(it.n)} client${it.n === 1 ? '' : 's'} · ${KYC.fmtMoney(it.budget)} budget`;
      const href = it.link ? searchLink(it.link) : null;
      const tag = href ? 'a' : 'div';
      return `<${tag} class="hbar" ${href ? `href="${e(href)}"` : ''} data-tip="${e(tip)}" aria-label="${e(tip)}">
        <span class="hb-label" title="${e(it.label)}">${e(it.label)}</span>
        <span class="hb-track"><span class="hb-fill" style="width:${(v / max) * 100}%"></span></span>
        <span class="hb-val">${st.measure === 'budget' ? KYC.fmtMoney(v) : KYC.fmtInt(v)} <span class="hb-pct">${KYC.fmtPct(v, total)}</span></span>
      </${tag}>`;
    }).join('');
  }

  function searchLink(pairs) {
    const p = new URLSearchParams();
    if (st.scope.region) p.append('region', st.scope.region);
    if (st.scope.team) p.append('team', st.scope.team);
    p.append('_kyc', 'Completed');
    for (const [k, v] of pairs) p.append(k, v);
    return `#search?${p}`;
  }

  function caption(d, n) {
    const missing = n - d.answered;
    return `${KYC.fmtInt(d.answered)} of ${KYC.fmtInt(n)} KYC-completed clients answered${missing ? ` · ${KYC.fmtInt(missing)} blank` : ''}`;
  }

  function presetKeys() {
    const qs = KYC.headers.filter((h) => h.startsWith('q_'));
    const picked = PRESET_QUESTIONS.filter((k) => qs.includes(k));
    return picked.length ? picked : qs.filter((k) => !KYC.numericCols.has(k)).slice(0, 4);
  }

  function render() {
    const scopeRows = st.rows;
    const done = scopeRows.filter((r) => r._done);
    const scope = [st.scope.region, st.scope.team].filter(Boolean).join(' · ') || 'All clients';
    $('#m-sub').textContent = `${scope}. Based on ${KYC.fmtInt(done.length)} clients with KYC completed (answers exist only for them).`;

    // KPI tiles
    const budgets = done.map((r) => r.annual_budget_usd).filter(Number.isFinite).sort((a, b) => a - b);
    const sum = budgets.reduce((a, b) => a + b, 0);
    const bookSum = scopeRows.reduce((a, r) => a + budgetOf(r), 0);
    const median = budgets.length ? (budgets[(budgets.length - 1) >> 1] + budgets[budgets.length >> 1]) / 2 : NaN;
    const notDoneSum = scopeRows.filter((r) => !r._done).reduce((a, r) => a + budgetOf(r), 0);
    const tiles = [
      ['Total budget, KYC completed', KYC.fmtMoney(sum), `${KYC.fmtInt(done.length)} clients · ${KYC.fmtPct(sum, bookSum)} of book budget`],
      ['Average budget', budgets.length ? KYC.fmtMoney(Math.round(sum / budgets.length)) : '–', 'per KYC-completed client'],
      ['Median budget', KYC.fmtMoney(Math.round(median)), 'half of clients are below this'],
      ['Budget not yet KYC’d', KYC.fmtMoney(notDoneSum), `${KYC.fmtInt(scopeRows.length - done.length)} clients still to complete KYC`],
    ];
    $('#m-kpis').innerHTML = tiles.map(([l, v, n]) =>
      `<div class="kpi"><div class="label">${e(l)}</div><div class="value">${v}</div><div class="note">${e(n)}</div></div>`).join('');

    // Budget distribution
    const bd = distribution('annual_budget_usd', done);
    $('#m-budget-cap').textContent = `${st.measure === 'budget' ? 'Total budget' : 'Clients'} by annual budget band · ${caption(bd, done.length).replace(' answered', ' with a budget')}`;
    $('#m-budget').innerHTML = hbars('annual_budget_usd', bd);

    // Region / team summary tables (same cross-filter behaviour as KYC coverage)
    renderBreakdown('region', 'Region', '#m-bd-region');
    renderBreakdown('team', 'Team', '#m-bd-team');

    // Preset questions
    $('#m-presets').innerHTML = presetKeys().map((k) => {
      const d = distribution(k, done);
      return `<div class="m-card"><h4>${e(KYC.prettyKey(k))}</h4><p class="sub m-cap">${e(caption(d, done.length))}</p>
        <div class="hbars">${hbars(k, d, 'value')}</div></div>`;
    }).join('');

    // Explorer
    if (st.question) {
      const d = distribution(st.question, done);
      $('#m-sort').disabled = d.ordered || !!ANSWER_ORDER[st.question];
      $('#m-explore-cap').textContent = `${KYC.prettyKey(st.question)} · ${caption(d, done.length)}`;
      $('#m-explore').innerHTML = hbars(st.question, d, st.sort);
    }
  }

  // One row per region (or team) with KYC-completed clients, budget, average and share of budget.
  // Counts respect the *other* dimension's selection, like the KYC coverage tables.
  function renderBreakdown(dim, title, sel) {
    const other = dim === 'region' ? 'team' : 'region';
    const base = KYC.rows.filter((r) => r._done && (!st.scope[other] || r[other] === st.scope[other]));
    const groups = new Map();
    for (const r of KYC.rows) if (!groups.has(r[dim])) groups.set(r[dim], { n: 0, budget: 0, withBudget: 0 });
    for (const r of base) {
      const g = groups.get(r[dim]);
      g.n++;
      if (Number.isFinite(r.annual_budget_usd)) { g.budget += r.annual_budget_usd; g.withBudget++; }
    }
    const totalBudget = [...groups.values()].reduce((a, g) => a + g.budget, 0);
    const totalN = [...groups.values()].reduce((a, g) => a + g.n, 0);
    const key = st.measure === 'budget' ? 'budget' : 'n';
    const list = [...groups].sort((a, b) => b[1][key] - a[1][key] || a[0].localeCompare(b[0]));
    const share = (g) => (st.measure === 'budget' ? [g.budget, totalBudget] : [g.n, totalN]);
    $(sel).innerHTML = `<h3>By ${title.toLowerCase()}</h3>
      <table class="bd-table"><thead><tr>
        <th>${title}</th><th class="num">KYC’d clients</th><th class="num">Total budget</th>
        <th class="num col-budget">Avg budget</th><th class="num">Share of ${st.measure === 'budget' ? 'budget' : 'clients'}</th></tr></thead><tbody>
      ${list.map(([name, g]) => {
        const [v, t] = share(g);
        const on = st.scope[dim] === name;
        return `<tr data-dim="${dim}" data-val="${e(name)}" tabindex="0" class="${on ? 'sel' : ''} ${g.n ? '' : 'empty'}" aria-pressed="${on}">
          <td>${e(name)}</td><td class="num">${KYC.fmtInt(g.n)}</td><td class="num">${KYC.fmtMoney(g.budget)}</td>
          <td class="num col-budget">${g.withBudget ? KYC.fmtMoney(Math.round(g.budget / g.withBudget)) : '–'}</td>
          <td class="num"><span class="rate"><span class="bar"><span style="width:${t ? (v / t) * 100 : 0}%"></span></span>${KYC.fmtPct(v, t)}</span></td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function setupQuestions() {
    const qs = KYC.headers.filter((h) => h.startsWith('q_'));
    const presets = presetKeys();
    const opt = (k) => `<option value="${e(k)}">${e(KYC.prettyKey(k))}</option>`;
    const choices = qs.filter((k) => !KYC.numericCols.has(k));
    const nums = qs.filter((k) => KYC.numericCols.has(k));
    $('#m-question').innerHTML = `${choices.length ? `<optgroup label="Choice questions">${choices.map(opt).join('')}</optgroup>` : ''}
      ${nums.length ? `<optgroup label="Number questions">${nums.map(opt).join('')}</optgroup>` : ''}`;
    if (!qs.includes(st.question)) st.question = qs.find((k) => !presets.includes(k)) || qs[0] || null;
    $('#m-question').value = st.question || '';
  }

  // ---------- tooltip ----------
  const tip = document.createElement('div');
  tip.className = 'tooltip fixed';
  tip.hidden = true;
  document.body.appendChild(tip);
  const section = $('#m-title').closest('section');
  const showTip = (ev) => {
    const bar = ev.target.closest('.hbar');
    if (!bar) { tip.hidden = true; return; }
    tip.textContent = bar.dataset.tip;
    tip.hidden = false;
    const x = ev.clientX ?? bar.getBoundingClientRect().left;
    const y = ev.clientY ?? bar.getBoundingClientRect().bottom;
    tip.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${y + 14}px`;
  };
  section.addEventListener('mousemove', showTip);
  section.addEventListener('focusin', showTip);
  section.addEventListener('mouseleave', () => { tip.hidden = true; });
  section.addEventListener('focusout', () => { tip.hidden = true; });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  // ---------- events ----------
  section.querySelector('.seg').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-measure]');
    if (!b) return;
    st.measure = b.dataset.measure;
    section.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  });
  $('#m-question').addEventListener('change', (ev) => { st.question = ev.target.value; render(); });
  $('#m-sort').addEventListener('change', (ev) => { st.sort = ev.target.value; render(); });

  document.addEventListener('kyc:data', () => { edgeCache.clear(); setupQuestions(); });
  document.addEventListener('kyc:overview', (ev) => {
    st.rows = ev.detail.rows;
    st.scope = { region: ev.detail.region, team: ev.detail.team };
    render();
  });
})();
