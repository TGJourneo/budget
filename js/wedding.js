// wedding.js -- a fully self-contained mini-budget, ring-fenced from the main
// app. Its own localStorage keys, its own categories, costs and contributions.
// Reuses only pure helpers (formatting, DOM, colours) from the shared modules.

import { categoryColor } from './categories.js';
import {
  $,
  el,
  clear,
  formatCurrency,
  formatSigned,
  formatDate,
  todayISO,
  parseAmount,
  emitChange,
  toast,
} from './utils.js';

const KEYS = {
  budget: 'budget_wedding_budget',
  categories: 'budget_wedding_categories',
  transactions: 'budget_wedding_transactions',
};

const DEFAULT_CATEGORIES = [
  'Venue', 'Catering', 'Attire', 'Photography', 'Flowers', 'Music',
  'Rings', 'Stationery', 'Transport', 'Honeymoon', 'Other',
];

// --- tiny defensive storage (local to the wedding ledger) --------------

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* ignore */
  }
}

function getBudget() {
  const n = Number(localStorage.getItem(KEYS.budget));
  return isFinite(n) && n >= 0 ? n : 0;
}
function setBudget(v) {
  const n = Number(v);
  localStorage.setItem(KEYS.budget, String(isFinite(n) && n >= 0 ? n : 0));
}

function getCategories() {
  const data = readJSON(KEYS.categories, null);
  if (!Array.isArray(data)) return [...DEFAULT_CATEGORIES];
  const list = data.filter((c) => typeof c === 'string' && c.trim());
  return list.length ? list : [...DEFAULT_CATEGORIES];
}
function addCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const list = getCategories();
  if (list.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return false;
  list.push(trimmed);
  writeJSON(KEYS.categories, list);
  return true;
}

function getTransactions() {
  const data = readJSON(KEYS.transactions, []);
  if (!Array.isArray(data)) return [];
  return data.filter(
    (t) =>
      t &&
      typeof t.id === 'string' &&
      (t.type === 'income' || t.type === 'expense') &&
      isFinite(Number(t.amount))
  );
}
function saveTransactions(list) {
  writeJSON(KEYS.transactions, list);
}
function getTransaction(id) {
  return getTransactions().find((t) => t.id === id) || null;
}

// --- view state --------------------------------------------------------

let editId = '';
let type = 'expense'; // 'expense' = cost, 'income' = contribution
let budgetEditing = false;
let newCatOpen = false;

// --- render ------------------------------------------------------------

export function renderWedding() {
  const root = $('#view-wedding');
  clear(root);

  const txns = getTransactions();
  const spent = sum(txns.filter((t) => t.type === 'expense'));
  const saved = sum(txns.filter((t) => t.type === 'income'));
  const pot = saved - spent;
  const budget = getBudget();
  const remaining = budget - spent;

  root.appendChild(el('header', { class: 'view-header' }, [el('h1', { text: 'Wedding' })]));

  // Budget remaining card.
  const remNeg = budget > 0 && remaining < 0;
  const balChildren = [
    el('div', { class: 'balance-label', text: budget > 0 ? 'Budget remaining' : 'Total cost so far' }),
    el('div', {
      class: `balance-value num ${remNeg ? 'expense' : ''}`,
      text: formatCurrency(budget > 0 ? remaining : spent),
    }),
  ];
  if (budget > 0) {
    balChildren.push(
      el('div', { class: 'balance-sub' }, [
        el('span', { class: 'dim', text: `${formatCurrency(spent)} of ${formatCurrency(budget)} spent` }),
      ])
    );
  }
  root.appendChild(el('div', { class: 'balance-card' }, balChildren));

  // Budget progress.
  if (budget > 0) {
    const pct = (spent / budget) * 100;
    const over = pct > 100;
    const warn = pct > 80 && pct <= 100;
    root.appendChild(
      el('div', { class: 'budget-card' }, [
        el('div', { class: 'budget-top' }, [
          el('span', { class: 'label', text: 'Budget used' }),
          el('span', {
            class: 'budget-pct',
            style: over ? 'color:var(--red)' : warn ? 'color:var(--amber)' : '',
            text: `${Math.round(pct)}%`,
          }),
        ]),
        el('div', { class: 'progress' }, [
          el('div', { class: `progress-bar ${over ? 'over' : warn ? 'warn' : ''}`, style: `width:${Math.min(pct, 100)}%` }),
        ]),
        budgetFoot(budget, spent),
      ])
    );
  } else {
    root.appendChild(budgetSetCard());
  }

  // Stats: saved (contributions) / in the pot.
  root.appendChild(
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: 'Saved / contributed' }),
        el('div', { class: 'stat-value num income', text: formatCurrency(saved) }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: 'In the pot' }),
        el('div', { class: `stat-value num ${pot < 0 ? 'expense' : ''}`, text: formatCurrency(pot) }),
      ]),
    ])
  );

  if (budgetEditing) root.appendChild(budgetEditor(budget));

  // Add / edit form.
  root.appendChild(addForm());

  // Category breakdown of costs.
  const byCat = groupCosts(txns);
  if (byCat.length) {
    root.appendChild(el('div', { class: 'section-head' }, [el('h2', { text: 'Costs by category' })]));
    root.appendChild(catBars(byCat, spent));
  }

  // Full list.
  root.appendChild(el('div', { class: 'section-head' }, [el('h2', { text: 'All wedding items' })]));
  const list = el('ul', { class: 'tx-list' });
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.tx-item');
    if (item && item.dataset.id) loadForEdit(item.dataset.id);
  });
  const sorted = txns.slice().sort(byDateDesc);
  if (sorted.length === 0) {
    list.appendChild(
      el('li', { class: 'empty' }, [
        el('span', { class: 'emoji', text: '💍' }),
        el('div', { text: 'No wedding items yet. Add a cost or a contribution above.' }),
      ])
    );
  } else {
    for (const t of sorted) list.appendChild(txItem(t));
  }
  root.appendChild(list);
}

function budgetFoot(budget, spent) {
  const remaining = budget - spent;
  if (remaining < 0) {
    return el('div', { class: 'budget-foot' }, [
      el('span', { style: 'color:var(--red)', text: `Over by ${formatCurrency(-remaining)}` }),
      el('button', { class: 'budget-set', type: 'button', text: 'Edit', onClick: openBudgetEditor }),
    ]);
  }
  return el('div', { class: 'budget-foot' }, [
    el('span', { text: `${formatCurrency(remaining)} left in budget` }),
    el('button', { class: 'budget-set', type: 'button', text: 'Edit', onClick: openBudgetEditor }),
  ]);
}

function budgetSetCard() {
  return el('div', { class: 'budget-card' }, [
    el('div', { class: 'budget-top' }, [el('span', { class: 'label', text: 'Wedding budget' })]),
    el('button', { class: 'budget-set', type: 'button', text: '+ Set a total wedding budget', onClick: openBudgetEditor }),
  ]);
}

function openBudgetEditor() {
  budgetEditing = true;
  emitChange();
}

function budgetEditor(budget) {
  const input = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 15000', value: budget > 0 ? String(budget) : '' });
  const save = () => {
    setBudget(input.value.replace(/[^0-9.]/g, ''));
    budgetEditing = false;
    emitChange();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  return el('div', { class: 'budget-edit' }, [
    input,
    el('button', { class: 'btn-small', type: 'button', text: 'Save', onClick: save }),
  ]);
}

// --- add / edit form ---------------------------------------------------

function addForm() {
  const wrap = el('div', { class: 'account-form', style: 'margin-top:18px' });

  wrap.appendChild(
    el('div', { class: 'account-form-hint dim', text: editId ? 'Edit wedding item' : 'Add a wedding item' })
  );

  // Type toggle (Cost / Contribution) -- mutates in place, no re-render.
  const costBtn = el('button', { type: 'button', class: 'type-btn', dataset: { type: 'expense' }, text: 'Cost' });
  const contribBtn = el('button', { type: 'button', class: 'type-btn', dataset: { type: 'income' }, text: 'Contribution' });
  const toggle = el('div', { class: 'type-toggle' }, [costBtn, contribBtn]);

  const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
  const desc = el('input', { type: 'text', placeholder: 'Description (e.g. Venue deposit)', maxlength: '80' });
  const category = el('select', { class: 'select' });
  const date = el('input', { type: 'date', value: todayISO() });

  const applyType = () => {
    costBtn.classList.toggle('is-active', type === 'expense');
    contribBtn.classList.toggle('is-active', type === 'income');
  };
  costBtn.addEventListener('click', () => { type = 'expense'; applyType(); });
  contribBtn.addEventListener('click', () => { type = 'income'; applyType(); });
  applyType();
  populateCatSelect(category);

  // Prefill when editing.
  if (editId) {
    const t = getTransaction(editId);
    if (t) {
      type = t.type;
      applyType();
      amount.value = String(t.amount);
      desc.value = t.description || '';
      populateCatSelect(category, t.category);
      date.value = t.date;
    }
  }

  // Inline "new category".
  const newCatName = el('input', { type: 'text', placeholder: 'New category', maxlength: '30' });
  const newCatRow = el('div', { class: 'new-cat-row', hidden: newCatOpen ? null : 'hidden' }, [
    newCatName,
    el('button', {
      class: 'btn-small',
      type: 'button',
      text: 'Add',
      onClick: () => {
        if (addCategory(newCatName.value)) {
          newCatOpen = false;
          emitChange();
        } else {
          newCatName.focus();
        }
      },
    }),
  ]);

  const save = () => {
    const amt = parseAmount(amount.value);
    if (amt == null) {
      amount.focus();
      return;
    }
    const data = {
      amount: amt,
      description: desc.value.trim() || category.value,
      category: category.value,
      type,
      date: date.value || todayISO(),
    };
    if (editId) {
      const list = getTransactions();
      const idx = list.findIndex((t) => t.id === editId);
      if (idx !== -1) list[idx] = { ...list[idx], ...data, id: editId };
      saveTransactions(list);
      toast('Saved');
    } else {
      const list = getTransactions();
      list.push({ id: crypto.randomUUID(), createdAt: Date.now(), ...data });
      saveTransactions(list);
      toast('Added');
    }
    editId = '';
    type = 'expense';
    emitChange();
  };

  const actions = [el('button', { class: 'btn-small', type: 'button', text: editId ? 'Save' : 'Add', onClick: save })];
  if (editId) {
    actions.push(
      el('button', {
        class: 'btn-ghost',
        type: 'button',
        text: 'Delete',
        onClick: () => {
          if (confirm('Delete this wedding item?')) {
            saveTransactions(getTransactions().filter((t) => t.id !== editId));
            editId = '';
            toast('Deleted');
            emitChange();
          }
        },
      })
    );
    actions.push(
      el('button', {
        class: 'btn-ghost',
        type: 'button',
        text: 'Cancel',
        onClick: () => {
          editId = '';
          type = 'expense';
          emitChange();
        },
      })
    );
  }

  wrap.append(
    toggle,
    amount,
    desc,
    el('div', { class: 'cat-with-add' }, [
      category,
      el('button', {
        class: 'link-btn',
        type: 'button',
        text: '+ New',
        onClick: () => {
          newCatOpen = !newCatOpen;
          emitChange();
        },
      }),
    ]),
    newCatRow,
    date,
    el('div', { class: 'account-form-actions' }, actions)
  );
  return wrap;
}

function populateCatSelect(select, selected) {
  clear(select);
  for (const c of getCategories()) {
    const opt = el('option', { value: c, text: c });
    if (c === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

function loadForEdit(id) {
  editId = id;
  emitChange();
  // Bring the form into view.
  const form = $('#view-wedding .account-form');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// --- breakdown + list --------------------------------------------------

function catBars(byCat, total) {
  const wrap = el('div', { class: 'cat-bars' });
  const max = byCat[0] ? byCat[0].amount : 0;
  for (const { category, amount } of byCat) {
    const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
    const width = max > 0 ? (amount / max) * 100 : 0;
    const color = categoryColor(category);
    wrap.appendChild(
      el('div', { class: 'cat-bar-row' }, [
        el('div', { class: 'cat-bar-top' }, [
          el('span', { class: 'cat-name' }, [
            el('span', { class: 'tx-cat-dot', style: `background:${color}` }),
            el('span', { text: category }),
            el('span', { class: 'dim', text: ` ${pct}%` }),
          ]),
          el('span', { class: 'cat-amt num', text: formatCurrency(amount) }),
        ]),
        el('div', { class: 'cat-bar-track' }, [
          el('div', { class: 'cat-bar-fill', style: `width:${width}%;background:${color}` }),
        ]),
      ])
    );
  }
  return wrap;
}

function txItem(t) {
  return el('li', { class: 'tx-item', dataset: { id: t.id } }, [
    el('span', { class: 'tx-cat-dot', style: `background:${categoryColor(t.category)}` }),
    el('div', { class: 'tx-main' }, [
      el('div', { class: 'tx-desc', text: t.description || t.category }),
      el('div', { class: 'tx-meta', text: `${formatDate(t.date)} · ${t.category} · ${t.type === 'income' ? 'Contribution' : 'Cost'}` }),
    ]),
    el('div', {
      class: `tx-amount num ${t.type === 'income' ? 'income' : 'expense'}`,
      text: formatSigned(t.amount, t.type),
    }),
  ]);
}

function groupCosts(txns) {
  const map = new Map();
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    map.set(t.category, (map.get(t.category) || 0) + Number(t.amount || 0));
  }
  return Array.from(map, ([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

function sum(list) {
  return list.reduce((acc, t) => acc + Number(t.amount || 0), 0);
}
function byDateDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}
