/* Overview tab, section 3: Market penetration — our revenue vs. client budgets (share of wallet) and
   revenue growth, by segment (answers to a question), region, team and product.

   Data: revenue columns rev_cy_<product> (current year) and rev_py_<product> (prior year), in USD.
   Share of wallet = our current-year revenue ÷ the client's annual budget (clients with a budget only).
   Revenue growth  = (current year − prior year) ÷ prior year. */
(() => {
  'use strict';

  const DEFAULT_SEGMENT = 'q_industry';
  const MAX_ROWS = 12;

  const $ = (s) => document.querySelector(s);
  const e = (s) => KYC.esc(s);
  const st = { product: null, question: null, rows: [], scope: { region: null, team: null } };

  // ---------- metrics ----------
  function metrics(rows, product = st.product) {
    let cy = 0, py = 0, wallet = 0, cyInWallet = 0, active = 0;
    for (const r of rows) {
      const c = KYC.revOf(r, 'cy', product), p = KYC.revOf(r, 'py', product);
      cy += c; py += p;
      if (c > 0) active++;
      if (Number.isFinite(r.annual_budget_usd) && r.annual_budget_usd > 0) { wallet += r.annual_budget_usd; cyInWallet += c; }
    }
    return {
      n: rows.length, cy, py, active, wallet, cyInWallet,
      sow: wallet ? cyInWallet / wallet : null,
      growth: py ? (cy - py) / py : cy ? 'new' : null,
    };
  }
  const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
  function growthHTML(g) {
    if (g == null) return '<span class="delta">–</span>';
    if (g === 'new') return '<span class="delta up">New</span>';
    const up = g >= 0;
    return `<span class="delta ${up ? 'up' : 'down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${pct(Math.abs(g), Math.abs(g) < 0.1 ? 1 : 0)}<span class="sr"> ${up ? 'growth' : 'decline'}</span></span>`;
  }
  const growthText = (g) => (g == null ? '–' : g === 'new' ? 'new' : `${g >= 0 ? '+' : '−'}${pct(Math.abs(g), 1)}`);
  const sowBar = (sow, max) => `<span class="rate"><span class="bar"><span style="width:${sow != null && max ? (sow / max) * 100 : 0}%"></span></span>${sow == null ? '–' : pct(sow, 1)}</span>`;

  // ---------- render ----------
  function render() {
    const products = KYC.products;
    const has = products.length > 0;
    $('#p-body').hidden = !has;
    const prod = products.find((p) => p.slug === st.product);
    const scope = [st.scope.region, st.scope.team].filter(Boolean).join(' · ') || 'All clients';
    if (!has) {
      $('#p-sub').innerHTML = 'Add revenue columns to the sheet to use this section: <code>rev_cy_&lt;product&gt;</code> (this year) and <code>rev_py_&lt;product&gt;</code> (last year), e.g. <code>rev_cy_payments</code>, <code>rev_py_payments</code>.';
      $('#p-chips').innerHTML = '';
      return;
    }
    $('#p-sub').textContent = `${scope}${prod ? ` · ${prod.label} only` : ''}. Share of wallet = our revenue this year ÷ client annual budget. Growth = this year vs last year.`;
    renderChips(prod);
    renderKpis(prod);
    renderSegments();
    renderBreakdown('region', 'Region', '#p-bd-region');
    renderBreakdown('team', 'Team', '#p-bd-team');
    renderProducts();
  }

  function renderChips(prod) {
    const chips = [];
    if (st.scope.region) chips.push(`<button class="chip" data-clear="region">Region: ${e(st.scope.region)}</button>`);
    if (st.scope.team) chips.push(`<button class="chip" data-clear="team">Team: ${e(st.scope.team)}</button>`);
    if (prod) chips.push(`<button class="chip" data-pclear="product">Product: ${e(prod.label)}</button>`);
    if (chips.length > 1) chips.push('<button class="chip clear" data-clear="all">Clear all</button>');
    $('#p-chips').innerHTML = chips.join('');
  }

  function renderKpis(prod) {
    const m = metrics(st.rows);
    const name = prod ? `${prod.label} revenue` : 'Revenue';
    const delta = m.cy - m.py;
    const tiles = [
      [`${name} this year`, KYC.fmtMoney(m.cy), `vs ${KYC.fmtMoney(m.py)} last year`],
      ['Revenue growth', growthHTML(m.growth), `${delta >= 0 ? '+' : '−'}${KYC.fmtMoney(Math.abs(delta))} year over year`],
      ['Share of wallet', m.sow == null ? '–' : pct(m.sow, 1), `of ${KYC.fmtMoney(m.wallet)} client budget`],
      ['Untapped wallet', KYC.fmtMoney(m.wallet - m.cyInWallet), `${KYC.fmtInt(m.active)} of ${KYC.fmtInt(m.n)} clients buy ${prod ? prod.label : 'from us'}`],
    ];
    $('#p-kpis').innerHTML = tiles.map(([l, v, n]) =>
      `<div class="kpi"><div class="label">${e(l)}</div><div class="value">${v}</div><div class="note">${e(n)}</div></div>`).join('');
  }

  function renderSegments() {
    const key = st.question;
    if (!key) return;
    const seg = KYC.segment(key, st.rows);
    let items = seg.items.map((it) => ({ ...it, m: metrics(it.rows) }));
    if (!seg.fixed) items.sort((a, b) => b.m.cy - a.m.cy || a.label.localeCompare(b.label));
    if (items.length > MAX_ROWS) {
      const rest = items.splice(MAX_ROWS - 1);
      const rows = rest.flatMap((x) => x.rows || []);
      items.push({ label: `Other (${rest.length} answers)`, rows, m: metrics(rows), link: null });
    }
    const maxSow = Math.max(0, ...items.map((it) => it.m.sow || 0));
    const answeredRows = items.flatMap((it) => it.rows || []);
    const all = metrics(st.rows);
    const ans = metrics(answeredRows);
    const unanswered = st.rows.length - answeredRows.length;
    $('#p-seg-cap').textContent = key === 'annual_budget_usd'
      ? `${KYC.fmtInt(answeredRows.length)} clients with a budget, in budget bands.`
      : `${KYC.fmtInt(answeredRows.length)} of ${KYC.fmtInt(st.rows.length)} clients answered this question${unanswered ? ` (the other ${KYC.fmtInt(unanswered)}, ${KYC.fmtMoney(all.cy - ans.cy)} revenue, aren't shown)` : ''}.`;
    const row = (it, isTotal) => {
      const href = it.link ? KYC.searchLink(it.link, st.scope) : null;
      const tip = `${it.label}: ${KYC.fmtInt(it.m.n)} clients · revenue ${KYC.fmtMoney(it.m.cy)} (last year ${KYC.fmtMoney(it.m.py)}, ${growthText(it.m.growth)}) · share of wallet ${it.m.sow == null ? '–' : pct(it.m.sow, 1)} of ${KYC.fmtMoney(it.m.wallet)}`;
      return `<tr class="${isTotal ? 'total' : ''}" ${href ? `data-href="${e(href)}" tabindex="0"` : ''} title="${e(tip)}">
        <td class="lbl">${e(it.label)}</td><td class="num col-sm-hide">${KYC.fmtInt(it.m.n)}</td><td class="num">${KYC.fmtMoney(it.m.cy)}</td>
        <td class="num">${growthHTML(it.m.growth)}</td><td class="num">${sowBar(it.m.sow, isTotal ? Math.max(maxSow, it.m.sow || 0) : maxSow)}</td></tr>`;
    };
    $('#p-seg').innerHTML = `<thead><tr><th>${e(key === 'annual_budget_usd' ? 'Budget band' : KYC.prettyKey(key))}</th>
      <th class="num col-sm-hide">Clients</th><th class="num">Revenue</th><th class="num">Growth</th><th class="num">Share of wallet</th></tr></thead>
      <tbody>${items.length ? items.map((it) => row(it)).join('') : '<tr><td colspan="5" class="sub">No answers yet.</td></tr>'}</tbody>
      <tfoot>${row({ label: key === 'annual_budget_usd' ? 'Total' : 'Total answered', m: ans }, true)}</tfoot>`;
  }

  // Region / team: same cross-filter behaviour as the other overview tables.
  function renderBreakdown(dim, title, sel) {
    const other = dim === 'region' ? 'team' : 'region';
    const base = KYC.rows.filter((r) => !st.scope[other] || r[other] === st.scope[other]);
    const names = [...new Set(KYC.rows.map((r) => r[dim]))];
    const list = names.map((name) => [name, metrics(base.filter((r) => r[dim] === name))])
      .sort((a, b) => b[1].cy - a[1].cy || a[0].localeCompare(b[0]));
    const maxSow = Math.max(0, ...list.map(([, m]) => m.sow || 0));
    $(sel).innerHTML = `<h3>By ${title.toLowerCase()}</h3>
      <table class="bd-table"><thead><tr><th>${title}</th><th class="num">Revenue</th><th class="num">Growth</th>
        <th class="num">Share of wallet</th></tr></thead><tbody>
      ${list.map(([name, m]) => {
        const on = st.scope[dim] === name;
        return `<tr data-dim="${dim}" data-val="${e(name)}" tabindex="0" class="${on ? 'sel' : ''} ${m.n ? '' : 'empty'}" aria-pressed="${on}">
          <td>${e(name)}</td><td class="num">${KYC.fmtMoney(m.cy)}</td><td class="num">${growthHTML(m.growth)}</td>
          <td class="num">${sowBar(m.sow, maxSow)}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  // Products: revenue, growth, how many clients buy it (penetration) and its share of our revenue.
  function renderProducts() {
    const total = metrics(st.rows, null).cy;
    const list = KYC.products.map((p) => [p, metrics(st.rows, p.slug)]).sort((a, b) => b[1].cy - a[1].cy);
    $('#p-bd-product').innerHTML = `<h3>By product</h3>
      <table class="bd-table"><thead><tr><th>Product</th><th class="num">Clients buying</th><th class="num">Revenue</th>
        <th class="num">Growth</th><th class="num">Share of revenue</th></tr></thead><tbody>
      ${list.map(([p, m]) => {
        const on = st.product === p.slug;
        return `<tr data-product="${e(p.slug)}" tabindex="0" class="${on ? 'sel' : ''}" aria-pressed="${on}"
            title="${e(`${p.label}: ${m.active} of ${m.n} clients (${KYC.fmtPct(m.active, m.n)}) · share of wallet ${m.sow == null ? '–' : pct(m.sow, 1)}`)}">
          <td>${e(p.label)}</td><td class="num">${KYC.fmtInt(m.active)} <span class="hb-pct">${KYC.fmtPct(m.active, m.n)}</span></td>
          <td class="num">${KYC.fmtMoney(m.cy)}</td><td class="num">${growthHTML(m.growth)}</td>
          <td class="num"><span class="rate"><span class="bar"><span style="width:${total ? (m.cy / total) * 100 : 0}%"></span></span>${KYC.fmtPct(m.cy, total)}</span></td></tr>`;
      }).join('')}</tbody></table>`;
  }

  function setupQuestions() {
    const qs = KYC.headers.filter((h) => h.startsWith('q_'));
    const opt = (k, label) => `<option value="${e(k)}">${e(label || KYC.prettyKey(k))}</option>`;
    const choices = qs.filter((k) => !KYC.numericCols.has(k));
    const nums = qs.filter((k) => KYC.numericCols.has(k));
    $('#p-question').innerHTML = `<optgroup label="Account">${KYC.headers.includes('annual_budget_usd') ? opt('annual_budget_usd', 'Annual budget band') : ''}</optgroup>
      ${choices.length ? `<optgroup label="Choice questions">${choices.map((k) => opt(k)).join('')}</optgroup>` : ''}
      ${nums.length ? `<optgroup label="Number questions">${nums.map((k) => opt(k)).join('')}</optgroup>` : ''}`;
    const all = ['annual_budget_usd', ...qs];
    if (!all.includes(st.question)) st.question = qs.includes(DEFAULT_SEGMENT) ? DEFAULT_SEGMENT : (choices[0] || qs[0] || 'annual_budget_usd');
    if (!KYC.products.some((p) => p.slug === st.product)) st.product = null;
    $('#p-question').value = st.question;
  }

  // ---------- events ----------
  $('#p-question').addEventListener('change', (ev) => { st.question = ev.target.value; render(); });
  const section = $('#p-title').closest('section');
  section.addEventListener('click', (ev) => {
    const prod = ev.target.closest('tr[data-product]');
    if (prod) { st.product = st.product === prod.dataset.product ? null : prod.dataset.product; return render(); }
    const chip = ev.target.closest('.chip[data-pclear], .chip.clear');
    if (chip) { st.product = null; if (chip.dataset.pclear) render(); return; } // "Clear all" re-renders via app.js
    const seg = ev.target.closest('#p-seg tr[data-href]');
    if (seg) location.hash = seg.dataset.href;
  });
  section.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const t = ev.target.closest('tr[data-product], #p-seg tr[data-href]');
    if (t) { ev.preventDefault(); t.click(); }
  });

  document.addEventListener('kyc:data', setupQuestions);
  document.addEventListener('kyc:overview', (ev) => {
    st.rows = ev.detail.rows;
    st.scope = { region: ev.detail.region, team: ev.detail.team };
    render();
  });
})();
