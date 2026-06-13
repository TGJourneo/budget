// storage.js -- all localStorage read/write. Every read is defensive:
// missing or corrupt data falls back to sensible defaults.

export const KEYS = {
  transactions: 'budget_transactions',
  categories: 'budget_categories',
  monthlyLimit: 'budget_monthly_limit',
  settings: 'budget_settings',
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
