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

const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const cols = ['client_id', 'client_name', 'region', 'team', 'account_owner', 'annual_budget_usd', 'kyc_status',
  'kyc_completed_date', 'q_primary_objective', 'q_decision_timeline', 'q_current_provider', 'q_key_pain_point',
  'q_decision_maker', 'notes'];
const rows = [cols.join(',')];
const used = new Set();
const start = Date.UTC(2025, 0, 1), end = Date.UTC(2026, 9, 31);
for (let i = 1; i <= 220; i++) {
  let name;
  do { name = `${pick(prefixes)} ${pick(suffixes)}`; } while (used.has(name));
  used.add(name);
  const done = rnd() < 0.68;
  const date = done ? new Date(start + rnd() * (end - start)).toISOString().slice(0, 10) : '';
  const budget = Math.round((pick([25, 50, 80, 120, 250, 400, 750, 1500]) * (0.7 + rnd() * 0.6))) * 1000;
  rows.push([
    `C${String(i).padStart(4, '0')}`, name, pick(regions), pick(teams), pick(owners), budget,
    done ? 'Completed' : pick(['Not started', 'In progress']), date,
    done ? pick(objectives) : '', done ? pick(timelines) : '', done ? pick(providers) : '',
    done ? pick(pains) : '', done ? pick(deciders) : '', '',
  ].map(esc).join(','));
}
console.log(rows.join('\n'));
