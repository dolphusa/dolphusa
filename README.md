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

The dashboard has tabs in the header. Each tab's address is a link you can share or bookmark: `#overview` (main tab), `#followup` and `#search`.
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
- Click a slice or legend row to open those clients in **Client search** (same region/team, filtered by completion quarter).

**2. Market overview**: answers and budget of **KYC-completed clients** (only they have answers). It follows the region/team selection above.
- Tiles: total budget of KYC-completed clients (and its share of the book's budget), average and median budget, and the budget of clients not yet KYC'd.
- Laid out like KYC coverage: **budget distribution** chart on the left, and **by region** and **by team** summary tables on the right
  (KYC'd clients, total budget, average budget, share of clients or budget). Clicking a row filters the whole overview, and the
  selection is shared with KYC coverage.
- Budget bands, and the bands for number questions, are set from the whole book, so they don't change when you filter.
- **Key questions**: small charts of preselected questions (`PRESET_QUESTIONS` at the top of `market.js`).
- **Explore any question**: pick any KYC question. Number questions are grouped into bands automatically.
- A **Clients / Budget** toggle switches every chart between client counts and total budget.
- Click any bar to open those clients in Client search, which lists all clients (the old client lookup table now lives there).
- Answers with a natural order are listed in that order (`ANSWER_ORDER` in `market.js`, e.g. decision timeline).

The bottom of the KYC coverage card shows how many clients need follow-up, for the current region/team selection,
with an **Open KYC follow-up →** button that carries that selection over.

### KYC follow-up tab (`followup.js`)

Shows who needs action and why. A client can fall into more than one group.

| Group | Rule |
|---|---|
| **KYC not completed** | status is not "Completed…" (split into not started and in progress) |
| **KYC refresh overdue** | last KYC completed more than **12 months** ago. The tile also shows how many fall due in the next 60 days |
| **Data quality issues** | any of the checks below |

Data quality checks: missing required field (ID, name, region, team, owner, budget); budget not a number or negative;
blank KYC status; completed with no date, an invalid date, or a date in the future; a completion date set on a not-completed client;
blank KYC answers on a completed client; text in a number question (e.g. "approx 500"); spelling variants
that differ only by case or spacing (e.g. "Emea" vs "EMEA", where the most common spelling is assumed correct); duplicate IDs or names.

- Tiles, the **by account owner** table and the **issues by type** table all filter the detailed list. The list also has
  region, team and owner dropdowns plus a text search.
- Each row shows badges (Needs KYC, Refresh, Data) and plain-English details of what to fix. Click a row for the client profile.
- **Export CSV** downloads the list with yes/no flags and details, e.g. to send to each owner.
- Filters are kept in the URL (`#followup?owner=J.%20Chen&cat=refresh`), so a link opens the same view.
- Change `REFRESH_AFTER_MONTHS` / `DUE_SOON_DAYS` at the top of `followup.js` to adjust the rules.

### Client search tab (`search.js`)

This is also the full client list: with no filters it shows every client. Its filters are kept in the URL
(`#search?region=APAC&q_industry=Retail&q_employee_count=100..500`), so any search can be shared as a link.
Other views link into it with filters already set.

Filters are generated from the CSV, so new question columns appear automatically. Each column's filter type is detected from its values:

| column values | filter |
|---|---|
| at least 80% of answers are numbers (`$`, `,`, `%` allowed; the rest are flagged on the follow-up tab) | **min – max** range. Accepts `1500`, `1.5k`, `2M`. Leaving a side empty means no limit, and clients with no answer are excluded once a range is set |
| up to 40 distinct answers | **multi-select dropdown** with a count next to each answer, plus a find box for long lists |
| more than 40 distinct answers (free text) | **"contains"** text box |

- Filters are grouped as *Account* (region, team, owner, KYC status, budget), *KYC questions: choices* and *KYC questions: numbers*.
- Answers picked in one dropdown are combined with **OR**, and different filters with **AND**. A dropdown's count is
  how many clients you would get by picking that answer, given your other filters.
- The summary shows **clients found**, **total budget** and average budget. Active filters appear as chips, and clicking one removes it.
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
