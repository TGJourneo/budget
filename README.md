# Budget

A personal budgeting Progressive Web App. Installs on an iPhone via Safari,
works fully offline, and keeps all data on-device in `localStorage`. No backend,
no accounts, no sync, no tracking, no build step, no dependencies.

## Features

- **Quick add** — amount (numeric keypad), description, category, type, date,
  account. One tap to save; the form resets ready for the next entry.
- **Accounts & carry-over** — add multiple accounts (e.g. Current, Savings),
  each with a starting balance and overdraft limit. The dashboard shows a
  single **available balance** that carries over across months (opening
  balances + all income − all expenses) and goes **negative/red** when you're
  into overdraft, plus a per-account breakdown and "available incl. overdraft".
- **Recurring payments** — set up repeats (rent, car payment, subscriptions)
  as monthly or weekly templates tied to a category and account. On launch the
  app automatically creates any that have come due since you last opened it
  (catching up missed months) and tells you what it added. Each generated entry
  is a normal, editable transaction.
- **Per-category budgets** — cap spending per category (e.g. Food £400) on top
  of the overall monthly budget. The dashboard tracks each capped category's
  spend this month with amber/red warnings.
- **Pattern recognition (offline, no cost)** — detects likely-recurring
  transactions (badge in the list; "not logged yet this month" heads-up on the
  dashboard), flags anomalies (a charge 2×+ the category average), shows a
  6-month trend per category with biggest movers in the Summary, and a margin
  finder ("£X unallocated this month" = budget − spent − goal earmarks) with a
  simple cash-flow forecast of bills still to come.
- **Account types & overdrafts** — each account is current / savings / credit
  card, with an optional overdraft limit. Negative balances show in red ("−£120
  of −£500 overdraft") with a near-limit warning, and a net-worth total sums all
  accounts.
- **Savings goals** — track a goal against a savings account or the wedding pot
  (two separate pots), with a progress bar and an "on track for …" projection;
  the monthly set-aside feeds the margin finder.
- **AI insights (optional)** — an Insights card on Home with a manual "Get
  insights" button (24h cooldown, cached result). Sends a small *summary* (never
  raw transactions) to Claude — defaults to cheap Haiku — and writes a short
  plain-English read on your month. Reuses the same on-device API key as
  screenshot import.
- **CSV export** — export all transactions to a CSV (Date, Description,
  Category, Type, Account, Amount) from the Transactions screen. Uses the iOS
  share sheet (save to Files, email, etc.) or a download on desktop. Handy for
  pasting into Claude for spending insights without any API key or cost.
- **Scan a screenshot (optional, AI)** — from the Add screen, import transactions
  from a bank-app screenshot. It uses Claude vision: you paste your **own**
  Anthropic API key (stored only on your device), the image is sent to Anthropic,
  Claude extracts the transactions, and you review/edit an editable list before
  anything is saved. Online-only and costs a few pence per scan; everything else
  in the app stays fully offline. Pick Opus (most accurate) / Sonnet / Haiku
  (cheapest) per scan.
- **Wedding tracker** — a fully separate mini-budget on its own tab, ring-fenced
  from day-to-day spending. Its own total budget, categories, costs and
  contributions, with budget progress, a "pot" balance (contributions − costs)
  and a costs-by-category breakdown. Stored under separate `budget_wedding_*`
  keys so it never touches the main budget.
- **Dashboard** — available balance, accounts, this-month income/spend, an
  overall budget bar, per-category budgets, recurring payments, and your 10
  most recent transactions. Updates live.
- **Monthly budget** — set a total monthly spend limit (editable inline on the
  dashboard). Bar turns amber over 80% and red over 100%.
- **Transactions** — full history, filterable by month, type and category.
  Tap any row to edit or delete it.
- **Summary** — per-month spending breakdown by category as a donut chart and a
  ranked bar list, income vs expenses, and a month-on-month comparison.
- **Custom categories** — add your own from the Add screen.
- **Dark theme**, mobile-first, large touch targets, currency in GBP (`£`).

## Running it

The app uses ES modules and a service worker, both of which require it to be
served over **HTTP(S) or `localhost`** — opening `index.html` directly via
`file://` will not work.

From this folder, start any static file server, e.g.:

```bash
# Python 3
python -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000>.

## Installing on iPhone

1. Open the hosted URL (or your local server) in **Safari**.
2. Tap the **Share** button → **Add to Home Screen**.
3. Launch it from the home screen — it opens full-screen (standalone), works
   offline, and keeps your data between sessions.

## Deploying

It's just static files — deploy the whole folder to GitHub Pages, Netlify,
Vercel, or any static host. All paths are relative, so it works at a domain
root *or* a subpath (e.g. `username.github.io/budget/`).

> If you change any asset, bump `CACHE_VERSION` in `sw.js` so clients pick up
> the new files instead of the cached ones.

## Data & privacy

Everything lives in your browser's `localStorage` under these keys:

| Key                    | Contents                                          |
| ---------------------- | ------------------------------------------------- |
| `budget_transactions`  | array of transactions (each with an `accountId`)  |
| `budget_accounts`      | array of `{ name, openingBalance, overdraftLimit }` |
| `budget_recurring`     | array of recurring templates (freq, next date, etc.) |
| `budget_category_limits` | `{ categoryName: monthlyLimit }`                   |
| `budget_wedding_*`     | separate wedding ledger (budget, categories, items)  |
| `budget_goals`         | savings goals (source, target, date, monthly)        |
| `budget_claude_key`    | your Anthropic API key (insights + screenshot import) |
| `budget_insight_text` / `_ts` | cached AI insight text + timestamp            |
| `budget_categories`    | `{ expense: [...], income: [...] }`               |
| `budget_monthly_limit` | total monthly budget (number as string)           |
| `budget_settings`      | `{ currency, currencySymbol }`                     |

Nothing leaves the device. Clearing Safari's site data (or the browser cache)
will erase your transactions, so this is intended as a personal tool, not a
system of record.

## Project structure

```
index.html        app shell + all four views + iOS meta tags
manifest.json     PWA manifest
sw.js             service worker (cache-first, offline)
css/app.css       dark-first mobile styles
js/
  app.js          routing, bottom nav, service-worker registration
  storage.js      localStorage read/write (defensive defaults)
  utils.js        formatting, dates, UUID, DOM helpers
  transactions.js add/edit form + filterable list
  categories.js   category selects + colours
  accounts.js     account picker + balance/accounts cards + manager
  recurring.js    recurring payments card + manager
  wedding.js      self-contained wedding mini-budget (own ledger)
  import-scan.js  screenshot import via Claude vision (own API key)
  patterns.js     offline pattern recognition (recurring/anomaly/trends/margin)
  goals.js        savings goals (account or wedding pot) + projection
  insights.js     Claude-powered insights card (summary payload, Haiku, cached)
  dashboard.js    home overview + live calculations
  summary.js      monthly breakdown, donut + bars, comparison
icons/            app icons (192, 512, 180)
```
