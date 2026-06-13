// storage.js -- all localStorage read/write. Every read is defensive:
// missing or corrupt data falls back to sensible defaults.

import { todayISO, addMonths, addDays } from './utils.js';

export const KEYS = {
  transactions: 'budget_transactions',
  categories: 'budget_categories',
  monthlyLimit: 'budget_monthly_limit',
  settings: 'budget_settings',
  accounts: 'budget_accounts',
  recurring: 'budget_recurring',
  categoryLimits: 'budget_category_limits',
};

export const DEFAULT_CATEGORIES = {
  expense: [
    'Housing',
    'Food',
    'Transport',
    'Entertainment',
    'Health',
    'Personal',
    'Savings',
    'Other',
  ],
  income: ['Salary', 'Freelance', 'Other Income'],
};

export const DEFAULT_SETTINGS = {
  currency: 'GBP',
  currencySymbol: '£',
};

// --- low-level helpers -------------------------------------------------

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    console.warn(`storage: could not read ${key}, using default`, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`storage: could not write ${key}`, e);
    return false;
  }
}

// --- transactions ------------------------------------------------------

export function getTransactions() {
  const data = readJSON(KEYS.transactions, []);
  if (!Array.isArray(data)) return [];
  // Keep only well-formed records.
  return data.filter(
    (t) =>
      t &&
      typeof t.id === 'string' &&
      typeof t.date === 'string' &&
      (t.type === 'income' || t.type === 'expense') &&
      isFinite(Number(t.amount))
  );
}

export function saveTransactions(list) {
  return writeJSON(KEYS.transactions, list);
}

export function addTransaction(tx) {
  const list = getTransactions();
  list.push(tx);
  saveTransactions(list);
  return tx;
}

export function updateTransaction(id, patch) {
  const list = getTransactions();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, id };
  saveTransactions(list);
  return list[idx];
}

export function deleteTransaction(id) {
  const list = getTransactions();
  const next = list.filter((t) => t.id !== id);
  saveTransactions(next);
  return next.length !== list.length;
}

export function getTransaction(id) {
  return getTransactions().find((t) => t.id === id) || null;
}

// --- categories --------------------------------------------------------

export function getCategories() {
  const data = readJSON(KEYS.categories, null);
  if (
    !data ||
    !Array.isArray(data.expense) ||
    !Array.isArray(data.income)
  ) {
    return { expense: [...DEFAULT_CATEGORIES.expense], income: [...DEFAULT_CATEGORIES.income] };
  }
  return {
    expense: data.expense.filter((c) => typeof c === 'string' && c.trim()),
    income: data.income.filter((c) => typeof c === 'string' && c.trim()),
  };
}

export function saveCategories(categories) {
  return writeJSON(KEYS.categories, categories);
}

export function addCategory(type, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const cats = getCategories();
  const list = type === 'income' ? cats.income : cats.expense;
  if (list.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return false;
  list.push(trimmed);
  saveCategories(cats);
  return true;
}

export function removeCategory(type, name) {
  const cats = getCategories();
  if (type === 'income') {
    cats.income = cats.income.filter((c) => c !== name);
  } else {
    cats.expense = cats.expense.filter((c) => c !== name);
  }
  saveCategories(cats);
  return true;
}

// --- monthly budget limit ----------------------------------------------

export function getMonthlyLimit() {
  try {
    const raw = localStorage.getItem(KEYS.monthlyLimit);
    if (raw == null) return 0;
    const n = Number(raw);
    return isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

export function setMonthlyLimit(value) {
  const n = Number(value);
  const safe = isFinite(n) && n >= 0 ? n : 0;
  try {
    localStorage.setItem(KEYS.monthlyLimit, String(safe));
    return true;
  } catch (e) {
    console.error('storage: could not write monthly limit', e);
    return false;
  }
}

// --- settings ----------------------------------------------------------

export function getSettings() {
  const data = readJSON(KEYS.settings, null);
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    currency: typeof data.currency === 'string' ? data.currency : DEFAULT_SETTINGS.currency,
    currencySymbol:
      typeof data.currencySymbol === 'string' ? data.currencySymbol : DEFAULT_SETTINGS.currencySymbol,
  };
}

export function saveSettings(settings) {
  return writeJSON(KEYS.settings, settings);
}

// --- accounts ----------------------------------------------------------

function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'a-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export function getAccounts() {
  const data = readJSON(KEYS.accounts, []);
  if (!Array.isArray(data)) return [];
  return data
    .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string')
    .map((a) => ({
      id: a.id,
      name: a.name,
      openingBalance: isFinite(Number(a.openingBalance)) ? Number(a.openingBalance) : 0,
      overdraftLimit: isFinite(Number(a.overdraftLimit)) && Number(a.overdraftLimit) >= 0
        ? Number(a.overdraftLimit)
        : 0,
      createdAt: a.createdAt || 0,
    }));
}

export function saveAccounts(list) {
  return writeJSON(KEYS.accounts, list);
}

export function addAccount({ name, openingBalance = 0, overdraftLimit = 0 }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const list = getAccounts();
  const account = {
    id: genId(),
    name: trimmed,
    openingBalance: Number(openingBalance) || 0,
    overdraftLimit: Math.max(0, Number(overdraftLimit) || 0),
    createdAt: Date.now(),
  };
  list.push(account);
  saveAccounts(list);
  return account;
}

export function updateAccount(id, patch) {
  const list = getAccounts();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const next = { ...list[idx], ...patch, id };
  next.name = String(next.name || '').trim() || list[idx].name;
  next.openingBalance = Number(next.openingBalance) || 0;
  next.overdraftLimit = Math.max(0, Number(next.overdraftLimit) || 0);
  list[idx] = next;
  saveAccounts(list);
  return next;
}

// Delete an account. Its transactions are reassigned to another account so no
// money silently vanishes. The last remaining account cannot be deleted.
export function deleteAccount(id) {
  const list = getAccounts();
  if (list.length <= 1) return false;
  const remaining = list.filter((a) => a.id !== id);
  if (remaining.length === list.length) return false;
  const fallbackId = remaining[0].id;
  const txns = getTransactions();
  let changed = false;
  for (const t of txns) {
    if (t.accountId === id) {
      t.accountId = fallbackId;
      changed = true;
    }
  }
  if (changed) saveTransactions(txns);
  saveAccounts(remaining);
  return true;
}

// Accounts with their live balances derived from opening balance + transactions.
export function getAccountsWithBalances() {
  const accounts = getAccounts();
  const txns = getTransactions();
  return accounts.map((a) => {
    let balance = Number(a.openingBalance) || 0;
    for (const t of txns) {
      if (t.accountId !== a.id) continue;
      balance += t.type === 'income' ? Number(t.amount) : -Number(t.amount);
    }
    const overdraftLimit = Number(a.overdraftLimit) || 0;
    return {
      ...a,
      balance,
      available: balance + overdraftLimit,
      overdraftUsed: balance < 0 ? Math.min(-balance, overdraftLimit) : 0,
    };
  });
}

// Whole-picture totals across every account (carry over across months).
export function getTotals() {
  const accounts = getAccountsWithBalances();
  const balance = accounts.reduce((s, a) => s + a.balance, 0);
  const overdraftLimit = accounts.reduce((s, a) => s + (Number(a.overdraftLimit) || 0), 0);
  return { balance, overdraftLimit, available: balance + overdraftLimit, accounts };
}

// Ensure at least one account exists so the Add form always has a target.
export function ensureDefaultAccount() {
  let list = getAccounts();
  if (list.length === 0) {
    addAccount({ name: 'Current', openingBalance: 0, overdraftLimit: 0 });
    list = getAccounts();
  }
  return list;
}

// One-time/idempotent migration: guarantee a default account and attach any
// transaction that has no (or a dangling) accountId to it.
export function migrateData() {
  const accounts = ensureDefaultAccount();
  const validIds = new Set(accounts.map((a) => a.id));
  const defaultId = accounts[0].id;
  const txns = getTransactions();
  let changed = false;
  for (const t of txns) {
    if (!t.accountId || !validIds.has(t.accountId)) {
      t.accountId = defaultId;
      changed = true;
    }
  }
  if (changed) saveTransactions(txns);
}

// --- per-category budget limits ---------------------------------------

// Returns an object of { categoryName: monthlyLimit }. Only positive limits
// are kept; everything else falls back to "no limit".
export function getCategoryLimits() {
  const data = readJSON(KEYS.categoryLimits, {});
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const [cat, val] of Object.entries(data)) {
    const n = Number(val);
    if (isFinite(n) && n > 0) out[cat] = n;
  }
  return out;
}

export function saveCategoryLimits(limits) {
  return writeJSON(KEYS.categoryLimits, limits);
}

// Set (or, with 0/blank, clear) the monthly limit for one category.
export function setCategoryLimit(category, amount) {
  const limits = getCategoryLimits();
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) delete limits[category];
  else limits[category] = n;
  saveCategoryLimits(limits);
  return limits;
}

// --- recurring transactions -------------------------------------------

export function getRecurring() {
  const data = readJSON(KEYS.recurring, []);
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        (r.type === 'income' || r.type === 'expense') &&
        isFinite(Number(r.amount)) &&
        typeof r.startDate === 'string'
    )
    .map((r) => ({
      id: r.id,
      description: typeof r.description === 'string' ? r.description : '',
      amount: Number(r.amount),
      type: r.type,
      category: typeof r.category === 'string' ? r.category : 'Other',
      accountId: typeof r.accountId === 'string' ? r.accountId : null,
      frequency: r.frequency === 'weekly' ? 'weekly' : 'monthly',
      startDate: r.startDate,
      count: Number.isInteger(r.count) && r.count >= 0 ? r.count : 0,
      active: r.active !== false,
      createdAt: r.createdAt || 0,
    }));
}

export function saveRecurring(list) {
  return writeJSON(KEYS.recurring, list);
}

export function addRecurring(template) {
  const list = getRecurring();
  const rec = {
    id: genId(),
    description: String(template.description || '').trim(),
    amount: Math.abs(Number(template.amount) || 0),
    type: template.type === 'income' ? 'income' : 'expense',
    category: template.category || 'Other',
    accountId: template.accountId || null,
    frequency: template.frequency === 'weekly' ? 'weekly' : 'monthly',
    startDate: template.startDate || todayISO(),
    count: 0,
    active: true,
    createdAt: Date.now(),
  };
  list.push(rec);
  saveRecurring(list);
  return rec;
}

export function updateRecurring(id, patch) {
  const list = getRecurring();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const next = { ...list[idx], ...patch, id };
  next.amount = Math.abs(Number(next.amount) || 0);
  next.description = String(next.description || '').trim();
  // Editing the schedule (date/frequency) re-anchors future generation.
  if (patch.startDate || patch.frequency) next.count = 0;
  list[idx] = next;
  saveRecurring(list);
  return next;
}

export function deleteRecurring(id) {
  const list = getRecurring();
  const next = list.filter((r) => r.id !== id);
  saveRecurring(next);
  return next.length !== list.length;
}

// The date of the next not-yet-generated occurrence for a template.
export function nextDueDate(template) {
  return occurrenceDate(template.startDate, template.frequency, template.count || 0);
}

function occurrenceDate(startDate, frequency, index) {
  if (!startDate) return null;
  return frequency === 'weekly'
    ? addDays(startDate, 7 * index)
    : addMonths(startDate, index);
}

// Create any recurring transactions that have come due up to today (catch-up
// for missed app opens). Returns how many were created.
export function generateDueTransactions() {
  const templates = getRecurring();
  if (templates.length === 0) return 0;
  const today = todayISO();
  const validAccountIds = new Set(getAccounts().map((a) => a.id));
  const fallbackAccount = getAccounts()[0] ? getAccounts()[0].id : null;
  let created = 0;
  let changed = false;

  for (const t of templates) {
    if (!t.active) continue;
    let count = t.count || 0;
    let occ = occurrenceDate(t.startDate, t.frequency, count);
    let guard = 0;
    while (occ && occ <= today && guard < 1000) {
      const accountId = validAccountIds.has(t.accountId) ? t.accountId : fallbackAccount;
      addTransaction({
        id: genId(),
        date: occ,
        description: t.description || t.category,
        amount: t.amount,
        type: t.type,
        category: t.category,
        accountId,
        recurringId: t.id,
        createdAt: Date.now(),
      });
      created++;
      count++;
      changed = true;
      occ = occurrenceDate(t.startDate, t.frequency, count);
      guard++;
    }
    t.count = count;
  }
  if (changed) saveRecurring(templates);
  return created;
}

// --- data management (used by settings view) ---------------------------

export function clearAllData() {
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }
}
