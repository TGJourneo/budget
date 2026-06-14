// accounts.js -- account select population + dashboard balance/accounts cards
// with an inline add/edit/delete manager.

import {
  getAccounts,
  getAccountsWithBalances,
  getTotals,
  addAccount,
  updateAccount,
  deleteAccount,
  ACCOUNT_TYPES,
} from './storage.js';

const TYPE_LABELS = { current: 'Current', savings: 'Savings', credit_card: 'Credit card' };
import { el, clear, formatCurrency, emitChange } from './utils.js';

// Manager UI state (persists across dashboard re-renders).
let panelOpen = false;
let editingId = null;
let adding = false;

// Fill an account <select>, pre-selecting one if given (or the first account).
export function populateAccountSelect(select, selectedId) {
  const accounts = getAccounts();
  clear(select);
  for (const a of accounts) {
    const opt = el('option', { value: a.id, text: a.name });
    if (a.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
  if (selectedId && accounts.some((a) => a.id === selectedId)) select.value = selectedId;
}

// --- the headline "Available balance" card ---------------------------

export function renderBalanceCard() {
  const totals = getTotals();
  const negative = totals.balance < 0;

  const children = [
    el('div', { class: 'balance-label', text: 'Available balance' }),
    el('div', {
      class: `balance-value num ${negative ? 'expense' : ''}`,
      text: formatCurrency(totals.balance),
    }),
  ];

  if (totals.overdraftLimit > 0) {
    children.push(
      el('div', { class: 'balance-sub' }, [
        el('span', { class: 'dim', text: `${formatCurrency(totals.available)} available incl. overdraft` }),
      ])
    );
  }
  if (negative) {
    children.push(
      el('div', { class: 'balance-sub' }, [
        el('span', { style: 'color:var(--red);font-weight:600', text: 'In overdraft' }),
      ])
    );
  }

  return el('div', { class: 'balance-card' }, children);
}

// --- accounts breakdown + manager -------------------------------------

export function renderAccountsCard() {
  const accounts = getAccountsWithBalances();
  const card = el('div', { class: 'accounts-card' });

  card.appendChild(
    el('div', { class: 'section-head' }, [
      el('h2', { text: 'Accounts' }),
      el('button', {
        type: 'button',
        text: panelOpen ? 'Done' : 'Manage',
        onClick: () => {
          panelOpen = !panelOpen;
          if (!panelOpen) {
            editingId = null;
            adding = false;
          }
          emitChange();
        },
      }),
    ])
  );

  for (const a of accounts) {
    if (panelOpen && editingId === a.id) {
      card.appendChild(accountForm(a));
    } else {
      card.appendChild(accountRow(a));
    }
  }

  // Net worth = sum of all balances (positive and negative).
  if (accounts.length > 1) {
    const netWorth = accounts.reduce((s, a) => s + a.balance, 0);
    card.appendChild(
      el('div', { class: 'networth-row' }, [
        el('span', { class: 'dim', text: 'Net worth' }),
        el('span', { class: `num ${netWorth < 0 ? 'expense' : ''}`, style: 'font-weight:700', text: formatCurrency(netWorth) }),
      ])
    );
  }

  if (panelOpen) {
    if (adding) {
      card.appendChild(accountForm(null));
    } else {
      card.appendChild(
        el('button', {
          class: 'add-account-btn',
          type: 'button',
          text: '+ Add account',
          onClick: () => {
            adding = true;
            editingId = null;
            emitChange();
          },
        })
      );
    }
  }

  return card;
}

function accountRow(a) {
  const negative = a.balance < 0;
  const meta = [];
  if (a.type && a.type !== 'current') meta.push(TYPE_LABELS[a.type] || a.type);
  if (negative && a.overdraftLimit > 0) {
    meta.push(`${formatCurrency(a.balance)} of ${formatCurrency(-a.overdraftLimit)} overdraft`);
  } else if (a.overdraftLimit > 0) {
    meta.push(`${formatCurrency(a.available)} available`);
  }

  // Within 10% of the overdraft limit (or already over it).
  const nearLimit = a.overdraftLimit > 0 && a.available <= a.overdraftLimit * 0.1;

  const left = [el('div', { class: 'account-name', text: a.name })];
  if (meta.length) left.push(el('div', { class: 'account-meta dim', text: meta.join(' · ') }));
  if (nearLimit) {
    left.push(
      el('div', {
        class: 'account-meta',
        style: 'color:var(--red);font-weight:600',
        text: a.available <= 0 ? 'Overdraft limit reached' : 'Near overdraft limit',
      })
    );
  }

  const right = [
    el('div', {
      class: `account-balance num ${negative ? 'expense' : ''}`,
      text: formatCurrency(a.balance),
    }),
  ];
  if (panelOpen) {
    right.push(
      el('div', { class: 'account-actions' }, [
        el('button', {
          class: 'link-btn',
          type: 'button',
          text: 'Edit',
          onClick: () => {
            editingId = a.id;
            adding = false;
            emitChange();
          },
        }),
        el('button', {
          class: 'link-btn danger',
          type: 'button',
          text: 'Delete',
          onClick: () => onDelete(a),
        }),
      ])
    );
  }

  return el('div', { class: 'account-row' }, [
    el('div', { class: 'account-left' }, left),
    el('div', { class: 'account-right' }, right),
  ]);
}

// Shared add/edit form. Pass an account to edit, or null to add.
function accountForm(account) {
  const isEdit = !!account;
  const nameInput = el('input', {
    type: 'text',
    placeholder: 'Account name',
    maxlength: '30',
    value: isEdit ? account.name : '',
  });
  const openingInput = el('input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder: 'Current balance (e.g. 1200 or -50)',
    value: isEdit ? String(account.openingBalance) : '',
  });
  const typeSelect = el('select', { class: 'select' }, ACCOUNT_TYPES.map((t) =>
    el('option', { value: t, text: TYPE_LABELS[t] })
  ));
  typeSelect.value = isEdit ? account.type || 'current' : 'current';

  const overdraftInput = el('input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder: 'Overdraft limit (e.g. 500)',
    value: isEdit && account.overdraftLimit ? String(account.overdraftLimit) : '',
  });

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const opening = parseSigned(openingInput.value);
    const overdraft = Math.max(0, parseSigned(overdraftInput.value));
    const type = typeSelect.value;
    if (isEdit) {
      updateAccount(account.id, { name, type, openingBalance: opening, overdraftLimit: overdraft });
    } else {
      addAccount({ name, type, openingBalance: opening, overdraftLimit: overdraft });
    }
    editingId = null;
    adding = false;
    emitChange();
  };

  const cancel = () => {
    editingId = null;
    adding = false;
    emitChange();
  };

  return el('div', { class: 'account-form' }, [
    el('div', { class: 'account-form-hint dim', text: isEdit ? 'Edit account' : 'New account' }),
    nameInput,
    el('label', { class: 'mini-label dim', text: 'Account type' }),
    typeSelect,
    el('label', { class: 'mini-label dim', text: 'Current balance (the balance before any transactions you log here)' }),
    openingInput,
    el('label', { class: 'mini-label dim', text: 'Overdraft limit (0 if none)' }),
    overdraftInput,
    el('div', { class: 'account-form-actions' }, [
      el('button', { class: 'btn-small', type: 'button', text: isEdit ? 'Save' : 'Add', onClick: save }),
      el('button', { class: 'btn-ghost', type: 'button', text: 'Cancel', onClick: cancel }),
    ]),
  ]);
}

function onDelete(a) {
  const accounts = getAccounts();
  if (accounts.length <= 1) {
    alert('You need at least one account. Add another before deleting this one.');
    return;
  }
  if (!confirm(`Delete "${a.name}"? Its transactions will move to another account.`)) return;
  deleteAccount(a.id);
  editingId = null;
  emitChange();
}

// Parse a possibly-negative amount (accounts can be overdrawn).
function parseSigned(value) {
  if (value == null) return 0;
  const cleaned = String(value).replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}
