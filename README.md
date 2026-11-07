# KYC Client Dashboard

A dependency-free, static dashboard for the sales team to review KYC coverage and look up client details.

## Run it

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

It loads `data/clients.csv` on start. You can also click **Load CSV…** to open any export with the same columns
(the file is read in the browser and is never uploaded).

> `data/clients.csv` is **fictional sample data** made by `scripts/generate_sample_data.js`.
> Replace it with your real KYC export. Don't commit real client data to a public repository.

## Tabs

The dashboard has tabs in the header. Each tab's address is a link you can share or bookmark: `#overview` (main tab) and `#search`.
To add a tab, add a `<main id="tab-NAME" class="tab-panel" hidden>` and a link `<a href="#NAME">` to `index.html`,
then put its logic in its own script. Data and helpers are shared through `window.KYC` (see the end of `app.js`),
and the `kyc:data` event fires whenever data is (re)loaded.

### Overview tab

**1. KYC coverage**
- KPI tiles: clients in book, KYC completed, not completed, and completed in the latest quarter.
- Donut chart: *Not completed* (gray) plus completed clients split by the quarter they completed
  (blue, darker = more recent). The 5 most recent quarters each get their own slice. Older ones are grouped as *Earlier*.
- Breakdown lists **by region** and **by team**: clients, completed, not completed, budget, and completion rate.
  Click a row to filter the chart (and everything else). Region and team can be combined, and each list's counts
  respect the other list's selection. Click the row again, or the chip at the top, to clear it.
- Click a slice or legend row to filter the client lookup to that group (for example, every client with KYC not completed).

**2. Client lookup**: a searchable, sortable table (search covers names, owners and KYC answers).
Click a client to see the budget and every KYC answer.

### Client search tab (`search.js`)

- Each KYC question (every `q_` column) becomes a filter card listing its answers. Region, team, account owner
  and KYC status are filters too, along with a keyword box and min/max budget.
- Answers picked within one question are combined with **OR**, and different questions with **AND**.
  The number next to each answer is how many clients you would get by picking it, given your other choices.
- A question with more than 30 distinct answers (i.e. free text) gets an "answer contains" text box instead of checkboxes.
- The summary shows **clients found**, **total budget** and average budget.
- **Export CSV** downloads the matching clients with every original column, in the on-screen sort order.

## CSV columns

| column | notes |
|---|---|
| `client_id` | unique id |
| `client_name` | |
| `region`, `team`, `account_owner` | blanks show as "Unassigned" |
| `annual_budget_usd` | number; `$` and `,` are allowed |
| `kyc_status` | anything starting with "Complete" counts as completed |
| `kyc_completed_date` | `YYYY-MM-DD`; sets the completion quarter |
| `q_*` | each KYC question gets its own column, e.g. `q_primary_objective`. All `q_` columns appear in the client detail. |
| `notes` | optional |

Header names are case-insensitive, and spaces become `_`.
