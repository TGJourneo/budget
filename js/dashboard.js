// dashboard.js -- current-month overview with live calculations.

import {
  getTransactions,
  getMonthlyLimit,
  setMonthlyLimit,
} from './storage.js';
import { txItem, accountLabeller } from './transactions.js';
import { renderBalanceCard, renderAccountsCard } from './accounts.js';
import { renderRecurringCard } from './recurring.js';
import {
  $,
  el,
  clear,
  formatCurrency,
  monthKey,
  monthLabel,
  isInMonth,
  emitChange,
} from './utils.js';

let navigate = () => {};
let editingBudget = false;

export function initDashboard(deps = {}) {
  if (deps.navigate) navigate = deps.navigate;
}

export function renderDashboard() {
  const root = $('#view-home');
  clear(root);

  const key = monthKey();
  const txns = getTransactions().filter((t) => isInMonth(t.date, key));
  const income = sum(txns.filter((t) => t.type === 'income'));
  const spent = sum(txns.filter((t) => t.type === 'expense'));
  const limit = getMonthlyLimit();

  // Header.
  root.appendChild(
    el('div', { class: 'dash-head' }, [
      el('h1', { text: 'Budget' }),
      el('span', { class: 'dash-month', text: monthLabel(key) }),
    ])
  );

  // Available balance (carries over across all months) + accounts breakdown.
  root.appendChild(renderBalanceCard());
  root.appendChild(renderAccountsCard());

  // This-month income / spent.
  root.appendChild(
    el('div', { class: 'section-head' }, [el('h2', { text: monthLabel(key) })])
  );
  root.appendChild(
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: 'Income' }),
        el('div', { class: 'stat-value num income', text: formatCurrency(income) }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: 'Spent' }),
        el('div', { class: 'stat-value num expense', text: formatCurrency(spent) }),
      ]),
    ])
  );

  // Budget card.
  root.appendChild(budgetCard(spent, limit));

  // Recurring payments.
  root.appendChild(renderRecurringCard());

  // Recent transactions.
  root.appendChild(
    el('div', { class: 'section-head' }, [
      el('h2', { text: 'Recent' }),
      el('button', { type: 'button', text: 'See all', onClick: () => navigate('transactions') }),
    ])
  );

  const recent = getTransactions().sort(sortByDateDesc).slice(0, 10);
  if (recent.length === 0) {
    root.appendChild(
      el('div', { class: 'empty' }, [
        el('span', { class: 'emoji', text: '💸' }),
        el('div', { text: 'No transactions yet.' }),
        el('button', {
          class: 'btn-primary cta',
          type: 'button',
          text: 'Add your first',
          onClick: () => navigate('add'),
        }),
      ])
    );
  } else {
    const list = el('ul', { class: 'tx-list' });
    // Delegated click -> edit.
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.tx-item');
      if (item && item.dataset.id) navigate('add', { editId: item.dataset.id });
    });
    const labelOf = accountLabeller();
    for (const tx of recent) list.appendChild(txItem(tx, labelOf(tx)));
    root.appendChild(list);
  }
}

function budgetCard(spent, limit) {
  const card = el('div', { class: 'budget-card' });

  if (limit <= 0 && !editingBudget) {
    card.appendChild(
      el('div', { class: 'budget-top' }, [
        el('span', { class: 'label', text: 'Monthly budget' }),
      ])
    );
    card.appendChild(
      el('button', {
        class: 'budget-set',
        type: 'button',
        text: '+ Set a monthly budget',
        onClick: () => {
          editingBudget = true;
          renderDashboard();
        },
      })
    );
    return card;
  }

  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  const clamped = Math.min(pct, 100);
  const over = pct > 100;
  const warn = pct > 80 && pct <= 100;

  card.appendChild(
    el('div', { class: 'budget-top' }, [
      el('span', { class: 'label', text: 'Budget used' }),
      el('span', {
        class: `budget-pct ${over ? 'expense' : warn ? '' : ''}`,
        style: over ? 'color:var(--red)' : warn ? 'color:var(--amber)' : '',
        text: limit > 0 ? `${Math.round(pct)}%` : '—',
      }),
    ])
  );

  const bar = el('div', { class: 'progress' }, [
    el('div', {
      class: `progress-bar ${over ? 'over' : warn ? 'warn' : ''}`,
      style: `width:${clamped}%`,
    }),
  ]);
  card.appendChild(bar);

  const remainingBudget = limit - spent;
  card.appendChild(
    el('div', { class: 'budget-foot' }, [
      el('span', {
        text:
          limit > 0
            ? `${formatCurrency(spent)} of ${formatCurrency(limit)}`
            : 'No budget set',
      }),
      el('button', {
        class: 'budget-set',
        type: 'button',
        text: editingBudget ? 'Close' : 'Edit',
        onClick: () => {
          editingBudget = !editingBudget;
          renderDashboard();
        },
      }),
    ])
  );

  if (over) {
    card.appendChild(
      el('div', { class: 'budget-foot' }, [
        el('span', { style: 'color:var(--red)', text: `Over by ${formatCurrency(-remainingBudget)}` }),
      ])
    );
  } else if (limit > 0) {
    card.appendChild(
      el('div', { class: 'budget-foot' }, [
        el('span', { text: `${formatCurrency(remainingBudget)} left to spend` }),
      ])
    );
  }

  if (editingBudget) {
    const input = el('input', {
      type: 'text',
      inputmode: 'decimal',
      placeholder: 'e.g. 2000',
      value: limit > 0 ? String(limit) : '',
    });
    const save = () => {
      const v = Number(String(input.value).replace(/[^0-9.]/g, ''));
      setMonthlyLimit(isFinite(v) ? v : 0);
      editingBudget = false;
      emitChange();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    card.appendChild(
      el('div', { class: 'budget-edit' }, [
        input,
        el('button', { class: 'btn-small', type: 'button', text: 'Save', onClick: save }),
      ])
    );
  }

  return card;
}

function sum(list) {
  return list.reduce((acc, t) => acc + Number(t.amount || 0), 0);
}
function sortByDateDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}
