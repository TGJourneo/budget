// insights.js -- Claude-powered spending insights. Manual only. Sends a small
// summarised payload (never raw transactions), caches the result, and enforces
// a 24h cooldown. Reuses the same on-device API key as screenshot import.

import {
  getTransactions,
  getMonthlyLimit,
  getCategoryLimits,
  getTotals,
  getGoals,
} from './storage.js';
import {
  monthlyTrends,
  biggestMovers,
  marginFinder,
  dueButUnlogged,
  anomalyIds,
} from './patterns.js';
import { goalProgress } from './goals.js';
import { $, el, monthKey, formatCurrency, emitChange } from './utils.js';

const KEY_STORE = 'budget_claude_key';
const TEXT_STORE = 'budget_insight_text';
const TS_STORE = 'budget_insight_ts';
const MODEL = 'claude-haiku-4-5'; // cheap + sufficient for summarisation
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

let navigate = () => {};
let loading = false;
let errorMsg = '';

export function initInsights(deps = {}) {
  if (deps.navigate) navigate = deps.navigate;
}

function getKey() {
  return localStorage.getItem(KEY_STORE) || '';
}
function cachedText() {
  return localStorage.getItem(TEXT_STORE) || '';
}
function lastTs() {
  return Number(localStorage.getItem(TS_STORE) || 0);
}

export function renderInsightsCard() {
  const card = el('div', { class: 'accounts-card' });
  card.appendChild(el('div', { class: 'section-head' }, [el('h2', { text: 'Insights' })]));

  if (!getKey()) {
    card.appendChild(el('div', { class: 'recurring-empty dim', text: 'AI insights use Claude. Add your Anthropic API key (the same one used for screenshot import) to enable them.' }));
    card.appendChild(el('button', { class: 'add-account-btn', type: 'button', text: 'Set up Claude', onClick: () => navigate('scan') }));
    return card;
  }

  if (loading) {
    card.appendChild(el('div', { class: 'empty' }, [el('span', { class: 'emoji', text: '✨' }), el('div', { text: 'Asking Claude…' })]));
    return card;
  }

  const text = cachedText();
  if (text) {
    card.appendChild(el('p', { class: 'insight-text', text }));
    card.appendChild(el('div', { class: 'dim', style: 'font-size:0.78rem;margin-top:6px', text: `Generated ${timeAgo(lastTs())}` }));
  } else {
    card.appendChild(el('div', { class: 'recurring-empty dim', text: 'Get a short, plain-English read on your spending this month — changes vs last month, budget and goal progress, and anything unusual.' }));
  }

  if (errorMsg) card.appendChild(el('p', { class: 'form-error', text: errorMsg }));

  const within24h = Date.now() - lastTs() < COOLDOWN_MS && lastTs() > 0;
  card.appendChild(
    el('button', {
      class: text ? 'budget-set' : 'btn-primary',
      style: text ? '' : 'width:100%',
      type: 'button',
      text: text ? 'Refresh insights' : 'Get insights',
      onClick: () => {
        if (within24h && !confirm(`Last insight was ${timeAgo(lastTs())}. Refresh anyway? This makes another API call.`)) return;
        runInsights();
      },
    })
  );
  return card;
}

async function runInsights() {
  errorMsg = '';
  loading = true;
  emitChange();
  try {
    const payload = buildPayload();
    const text = await callClaude(payload);
    localStorage.setItem(TEXT_STORE, text);
    localStorage.setItem(TS_STORE, String(Date.now()));
  } catch (e) {
    errorMsg = e && e.message ? e.message : 'Could not get insights.';
  }
  loading = false;
  emitChange();
}

// Compact summary — category totals per month, budgets, goals, patterns.
function buildPayload() {
  const txns = getTransactions();
  const trends = monthlyTrends(txns, 6);
  const incomePerMonth = trends.months.map((m) => round(sumWhere(txns, 'income', m)));
  const expensePerMonth = trends.months.map((m) => round(sumWhere(txns, 'expense', m)));
  const spendByCategory = {};
  for (const c of trends.categories) spendByCategory[c.category] = c.totals.map(round);
  const totals = getTotals();
  const margin = marginFinder(txns);

  return {
    currency: 'GBP',
    this_month: monthKey(),
    months: trends.months,
    income_per_month: incomePerMonth,
    expense_per_month: expensePerMonth,
    spend_by_category_per_month: spendByCategory,
    monthly_budget: getMonthlyLimit() || null,
    category_budgets: getCategoryLimits(),
    net_worth: round(totals.balance),
    accounts: totals.accounts.map((a) => ({ name: a.name, type: a.type, balance: round(a.balance), overdraft: a.overdraftLimit })),
    unallocated_this_month: round(margin.margin),
    goals: getGoals().map((g) => {
      const { saved } = goalProgress(g);
      return { name: g.name, saved: round(saved), target: g.target, monthly: g.monthly, target_date: g.targetDate };
    }),
    biggest_movers: biggestMovers(txns).map((m) => ({ category: m.category, pct_vs_prev: m.pctVsPrev })),
    recurring_due_unlogged: dueButUnlogged(txns).map((p) => ({ description: p.description, amount: round(p.typicalAmount), usual_day: p.typicalDay })),
    anomalies_count: anomalyIds(txns).size,
  };
}

async function callClaude(payload) {
  const prompt =
    `You are a concise personal-finance assistant. All amounts are in GBP (£). ` +
    `Below is a JSON summary of the user's budget. Write a short, friendly insight of 4-6 sentences in plain text (no markdown, no headings, no bullet lists). ` +
    `Cover: the most notable category changes vs last month (with figures and likely cause if obvious), progress against the monthly budget and any savings goals, and anything unusual (large anomalies, recurring bills not yet logged this month, or overdraft risk). ` +
    `Be specific with numbers and percentages. Do not just repeat the data back.\n\n` +
    JSON.stringify(payload);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('Your API key was rejected.');
    if (res.status === 429) throw new Error('Rate limited — try again shortly.');
    let msg = `API error (${res.status}).`;
    try {
      const e = await res.json();
      if (e && e.error && e.error.message) msg = e.error.message;
    } catch (err) {
      /* default */
    }
    throw new Error(msg);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('No insight was returned.');
  return text;
}

// --- helpers ----------------------------------------------------------

function sumWhere(txns, type, month) {
  return txns
    .filter((t) => t.type === type && t.date.slice(0, 7) === month)
    .reduce((a, t) => a + Number(t.amount || 0), 0);
}
function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function timeAgo(ts) {
  if (!ts) return 'just now';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
