// patterns.js -- client-side pattern recognition (no API cost).
// Recurring detection, month-over-month trends, anomaly flagging, margin
// finder and a simple cash-flow forecast. Feeds the dashboard, summary and
// the insights payload.

import { getTransactions, getMonthlyLimit, getGoals } from './storage.js';
import {
  monthKey,
  previousMonthKey,
  isInMonth,
  parseISO,
  todayISO,
  addMonths,
} from './utils.js';

// --- small stats helpers ----------------------------------------------

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mode(nums) {
  const counts = new Map();
  let best = nums[0],
    bestN = 0;
  for (const n of nums) {
    const c = (counts.get(n) || 0) + 1;
    counts.set(n, c);
    if (c > bestN) {
      bestN = c;
      best = n;
    }
  }
  return best;
}
function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}
function normalizeDesc(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function sum(list) {
  return list.reduce((acc, t) => acc + Number(t.amount || 0), 0);
}

// --- recurring detection ----------------------------------------------

// Group by normalized description + type, keep groups that recur ~monthly
// with consistent amounts.
export function detectRecurring(txns = getTransactions()) {
  const groups = new Map();
  for (const t of txns) {
    const key = t.type + '|' + normalizeDesc(t.description || t.category);
    if (!normalizeDesc(t.description || t.category)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const out = [];
  const today = todayISO();
  const curMonth = monthKey();

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));

    const intervals = [];
    for (let i = 1; i < list.length; i++) intervals.push(daysBetween(list[i - 1].date, list[i].date));
    const medInterval = median(intervals);
    if (!(medInterval >= 24 && medInterval <= 38)) continue; // ~monthly

    const amounts = list.map((t) => Number(t.amount));
    const typicalAmount = median(amounts);
    if (typicalAmount <= 0) continue;
    const consistent = amounts.filter((a) => Math.abs(a - typicalAmount) <= typicalAmount * 0.2).length;
    if (consistent < Math.ceil(list.length * 0.6)) continue;

    const last = list[list.length - 1];
    const typicalDay = mode(list.map((t) => parseISO(t.date).getDate()));
    out.push({
      key,
      description: last.description || last.category,
      typicalAmount,
      typicalDay,
      category: last.category,
      type: last.type,
      accountId: last.accountId,
      count: list.length,
      lastDate: last.date,
      expectedNext: addMonths(last.date, 1),
      loggedThisMonth: list.some((t) => isInMonth(t.date, curMonth)),
      ids: list.map((t) => t.id),
    });
  }
  return out;
}

// Set of transaction ids that belong to a detected recurring series (for badges).
export function recurringIds(txns = getTransactions()) {
  const set = new Set();
  for (const p of detectRecurring(txns)) for (const id of p.ids) set.add(id);
  return set;
}

// Detected recurring EXPENSES not yet logged in the current month.
export function dueButUnlogged(txns = getTransactions()) {
  return detectRecurring(txns).filter((p) => p.type === 'expense' && !p.loggedThisMonth);
}

// --- month-over-month trends ------------------------------------------

function lastNMonthKeys(n) {
  const keys = [];
  let k = monthKey();
  for (let i = 0; i < n; i++) {
    keys.unshift(k);
    k = previousMonthKey(k);
  }
  return keys;
}

// Per expense category: spend per month over the last n months, with % change
// vs previous month and vs the 3-month average.
export function monthlyTrends(txns = getTransactions(), n = 6) {
  const months = lastNMonthKeys(n);
  const byCat = new Map();
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    const m = t.date.slice(0, 7);
    if (!months.includes(m)) continue;
    if (!byCat.has(t.category)) byCat.set(t.category, months.map(() => 0));
    const arr = byCat.get(t.category);
    arr[months.indexOf(m)] += Number(t.amount || 0);
  }
  const categories = [];
  for (const [category, totals] of byCat) {
    const cur = totals[totals.length - 1];
    const prev = totals[totals.length - 2] || 0;
    const prior3 = totals.slice(-4, -1);
    const avg3 = prior3.length ? prior3.reduce((a, b) => a + b, 0) / prior3.length : 0;
    categories.push({
      category,
      totals,
      current: cur,
      pctVsPrev: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null,
      pctVs3m: avg3 > 0 ? Math.round(((cur - avg3) / avg3) * 100) : null,
    });
  }
  return { months, categories };
}

// Biggest movers this month (by absolute % change vs previous month).
export function biggestMovers(txns = getTransactions(), limit = 4) {
  const { categories } = monthlyTrends(txns);
  return categories
    .filter((c) => c.pctVsPrev !== null && (c.current > 0 || c.totals[c.totals.length - 2] > 0))
    .sort((a, b) => Math.abs(b.pctVsPrev) - Math.abs(a.pctVsPrev))
    .slice(0, limit);
}

// --- anomaly flagging --------------------------------------------------

// Flag an expense whose amount is >= 2x the average of other expenses in the
// same category (needs at least 3 priors to be meaningful).
export function anomalyIds(txns = getTransactions()) {
  const byCat = new Map();
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    byCat.get(t.category).push(t);
  }
  const flagged = new Set();
  for (const [, list] of byCat) {
    if (list.length < 4) continue;
    for (const t of list) {
      const others = list.filter((o) => o.id !== t.id).map((o) => Number(o.amount));
      const avg = others.reduce((a, b) => a + b, 0) / others.length;
      if (avg > 0 && Number(t.amount) >= avg * 2) flagged.add(t.id);
    }
  }
  return flagged;
}

// --- margin finder + cash flow ----------------------------------------

// Unallocated this month = monthly budget - spent this month - goal earmarks.
export function marginFinder(txns = getTransactions()) {
  const budget = getMonthlyLimit();
  const spent = sum(txns.filter((t) => t.type === 'expense' && isInMonth(t.date, monthKey())));
  const earmarks = getGoals().reduce((acc, g) => acc + (Number(g.monthly) || 0), 0);
  return { budget, spent, earmarks, margin: budget - spent - earmarks };
}

// Known outgoings still to come this month, from detected recurring expenses
// that haven't been logged yet.
export function cashFlowRemaining(txns = getTransactions()) {
  const items = dueButUnlogged(txns);
  return {
    total: items.reduce((acc, p) => acc + p.typicalAmount, 0),
    items,
  };
}
