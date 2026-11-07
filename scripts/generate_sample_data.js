// Generates fictional sample KYC data so the dashboard can be previewed.
// Replace data/clients.csv with your real export (same columns) for production use.
// Usage: node scripts/generate_sample_data.js > data/clients.csv
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const prefixes = ['Northwind', 'Bluecrest', 'Ironleaf', 'Silverline', 'Harbor', 'Summit', 'Redwood', 'Lakeside',
  'Granite', 'Brightpath', 'Cedar', 'Pinnacle', 'Oakmont', 'Riverstone', 'Clearwater', 'Evergreen', 'Highland',
  'Westgate', 'Sterling', 'Meridian', 'Atlas', 'Beacon', 'Copperfield', 'Driftwood', 'Falcon', 'Horizon'];
const suffixes = ['Logistics', 'Holdings', 'Manufacturing', 'Health', 'Foods', 'Analytics', 'Retail Group',
  'Energy', 'Capital', 'Systems', 'Partners', 'Labs', 'Industries', 'Hospitality', 'Builders'];
const regions = ['North America', 'EMEA', 'APAC', 'LATAM'];
const teams = ['Enterprise', 'Mid-Market', 'SMB', 'Strategic Accounts'];
const owners = ['A. Rivera', 'J. Chen', 'M. Okafor', 'S. Patel', 'L. Novak', 'D. Kim', 'R. Haddad', 'T. Silva'];
const objectives = ['Reduce operating cost', 'Expand into new markets', 'Modernize legacy systems',
  'Improve customer retention', 'Regulatory compliance', 'Scale operations'];
const timelines = ['< 3 months', '3-6 months', '6-12 months', '12+ months'];
const providers = ['None', 'In-house', 'Competitor A', 'Competitor B', 'Multiple vendors'];
const pains = ['Manual processes', 'Poor reporting visibility', 'High vendor cost', 'Slow onboarding',
  'Data quality issues', 'Limited integrations'];
const deciders = ['CEO', 'CFO', 'COO', 'CTO', 'Head of Procurement', 'VP Operations'];
const industries = ['Manufacturing', 'Healthcare', 'Retail', 'Financial services', 'Logistics', 'Technology', 'Energy', 'Hospitality'];
const contracts = ['Monthly', 'Annual', 'Multi-year'];
const procurement = ['Single approver', 'Committee', 'RFP required'];
const integrations = ['ERP', 'CRM', 'Data warehouse', 'None'];
const residency = ['No requirement', 'In-country', 'EU only', 'US only'];
const int = (lo, hi) => Math.round(lo + rnd() * (hi - lo));

const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const cols = ['client_id', 'client_name', 'region', 'team', 'account_owner', 'annual_budget_usd', 'kyc_status',
  'kyc_completed_date', 'q_primary_objective', 'q_decision_timeline', 'q_current_provider', 'q_key_pain_point',
  'q_decision_maker', 'q_industry', 'q_preferred_contract', 'q_procurement_process', 'q_integration_needs',
  'q_data_residency', 'q_employee_count', 'q_years_in_business', 'q_number_of_locations', 'q_expected_users',
  'q_current_annual_spend_usd', 'q_satisfaction_current_provider', 'q_expected_growth_pct', 'notes'];
const data = [];
const used = new Set();
const start = Date.UTC(2025, 0, 1), end = Date.UTC(2026, 9, 31);
for (let i = 1; i <= 220; i++) {
  let name;
  do { name = `${pick(prefixes)} ${pick(suffixes)}`; } while (used.has(name));
  used.add(name);
  const done = rnd() < 0.68;
  const date = done ? new Date(start + rnd() * (end - start)).toISOString().slice(0, 10) : '';
  const budget = Math.round((pick([25, 50, 80, 120, 250, 400, 750, 1500]) * (0.7 + rnd() * 0.6))) * 1000;
  data.push([
    `C${String(i).padStart(4, '0')}`, name, pick(regions), pick(teams), pick(owners), budget,
    done ? 'Completed' : pick(['Not started', 'In progress']), date,
    done ? pick(objectives) : '', done ? pick(timelines) : '', done ? pick(providers) : '',
    done ? pick(pains) : '', done ? pick(deciders) : '',
    done ? pick(industries) : '', done ? pick(contracts) : '', done ? pick(procurement) : '',
    done ? pick(integrations) : '', done ? pick(residency) : '',
    done ? pick([int(10, 99), int(100, 999), int(1000, 20000)]) : '', done ? int(1, 60) : '', done ? int(1, 120) : '',
    done ? int(5, 5000) : '', done ? Math.round(budget * (0.3 + rnd())) : '', done ? int(1, 10) : '', done ? int(-5, 40) : '',
    '',
  ]);
}

// Seed a few realistic data-quality problems so the KYC follow-up tab has something to show.
const col = (name) => cols.indexOf(name);
const completed = data.filter((r) => r[col('kyc_status')] === 'Completed');
const notDone = data.filter((r) => r[col('kyc_status')] !== 'Completed');
data[6][col('account_owner')] = '';                         // missing owner
data[18][col('annual_budget_usd')] = 'TBD';                 // budget not a number
data[29][col('annual_budget_usd')] = '';                    // missing budget
data[32][col('region')] = 'Emea';                           // inconsistent spelling
data[47][col('team')] = 'mid-market';                       // inconsistent spelling
completed[3][col('q_key_pain_point')] = '';                 // missing KYC answers
completed[3][col('q_decision_maker')] = '';
completed[9][col('q_industry')] = '';
completed[14][col('q_employee_count')] = 'approx 500';      // text in a numeric question
completed[21][col('kyc_completed_date')] = '';              // completed, no date
completed[27][col('kyc_completed_date')] = '2027-02-14';    // date in the future
notDone[5][col('kyc_completed_date')] = '2026-03-02';       // status/date mismatch
data[150][col('client_name')] = data[12][col('client_name')]; // possible duplicate
data[200][col('kyc_status')] = '';                          // blank status

// Revenue by product: current year (rev_cy_*) and prior year (rev_py_*). Uses its own random
// generator so the client data above stays the same.
let seed2 = 7;
const rnd2 = () => ((seed2 = (seed2 * 1664525 + 1013904223) % 4294967296) / 4294967296);
const products = ['payments', 'analytics', 'advisory', 'platform'];
products.forEach((p) => cols.splice(cols.indexOf('notes'), 0, `rev_cy_${p}`, `rev_py_${p}`));
const r100 = (v) => Math.round(v / 100) * 100;
data.forEach((row) => {
  const done = row[col('kyc_status')] === 'Completed';
  const budget = Number(row[col('annual_budget_usd')]) || 200000;
  const active = rnd2() < (done ? 0.78 : 0.3);
  const total = active ? budget * (0.04 + rnd2() * 0.5) : 0;
  const use = products.map(() => rnd2() < 0.55);
  if (active && !use.some(Boolean)) use[Math.floor(rnd2() * products.length)] = true;
  const w = products.map((_, i) => (use[i] ? 0.2 + rnd2() : 0));
  const wSum = w.reduce((a, b) => a + b, 0) || 1;
  const rev = [];
  products.forEach((_, i) => {
    let cy = r100(total * (w[i] / wSum));
    let py = 0;
    if (cy) {
      const x = rnd2();
      py = x < 0.15 ? 0 : r100(cy / (0.75 + rnd2() * 0.85)); // 15% new this year; others -25%..+60%
    } else if (active && rnd2() < 0.06) {
      py = r100(budget * 0.05 * (0.5 + rnd2())); // churned product
    }
    rev.push(cy || '', py || '');
  });
  row.splice(col('notes') - rev.length, 0, ...rev);
});
data[40][col('rev_cy_payments')] = 'pending'; // a data-quality example

console.log([cols.join(','), ...data.map((r) => r.map(esc).join(','))].join('\n'));
