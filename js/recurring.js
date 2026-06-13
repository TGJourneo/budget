// recurring.js -- dashboard "Recurring" card: list of templates + inline
// add/edit/delete manager. Generation itself lives in storage.js.

import {
  getRecurring,
  addRecurring,
  updateRecurring,
  deleteRecurring,
  nextDueDate,
  getAccounts,
} from './storage.js';
import { populateCategorySelect } from './categories.js';
import { populateAccountSelect } from './accounts.js';
import {
  el,
  formatSigned,
  formatDate,
  parseAmount,
  todayISO,
  emitChange,
} from './utils.js';

let panelOpen = false;
let editingId = null;
let adding = false;

export function renderRecurringCard() {
  const templates = getRecurring();
  const accountsById = new Map(getAccounts().map((a) => [a.id, a.name]));
  const card = el('div', { class: 'accounts-card' });

  card.appendChild(
    el('div', { class: 'section-head' }, [
      el('h2', { text: 'Recurring' }),
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

  if (templates.length === 0 && !adding) {
    card.appendChild(
      el('div', { class: 'recurring-empty dim', text: 'No recurring payments yet. Add things like rent, car payments or subscriptions.' })
    );
  }

  for (const t of templates) {
    if (panelOpen && editingId === t.id) {
      card.appendChild(recurringForm(t));
    } else {
      card.appendChild(recurringRow(t, accountsById));
    }
  }

  if (panelOpen) {
    if (adding) {
      card.appendChild(recurringForm(null));
    } else {
      card.appendChild(
        el('button', {
          class: 'add-account-btn',
          type: 'button',
          text: '+ Add recurring payment',
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

function recurringRow(t, accountsById) {
  const freq = t.frequency === 'weekly' ? 'Weekly' : 'Monthly';
  const acct = accountsById.get(t.accountId);
  const metaParts = [freq, `next ${formatDate(nextDueDate(t))}`];
  if (acct) metaParts.push(acct);

  const left = [
    el('div', { class: 'account-name', text: t.description || t.category }),
    el('div', { class: 'account-meta dim', text: metaParts.join(' · ') }),
  ];

  const right = [
    el('div', {
      class: `account-balance num ${t.type === 'income' ? 'income' : 'expense'}`,
      text: formatSigned(t.amount, t.type),
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
            editingId = t.id;
            adding = false;
            emitChange();
          },
        }),
        el('button', {
          class: 'link-btn danger',
          type: 'button',
          text: 'Delete',
          onClick: () => {
            if (confirm(`Stop the recurring "${t.description || t.category}"? Transactions already added stay.`)) {
              deleteRecurring(t.id);
              editingId = null;
              emitChange();
            }
          },
        }),
      ])
    );
  }

  return el('div', { class: 'account-row' }, [
    el('div', { class: 'account-left' }, left),
    el('div', { class: 'account-right' }, right),
  ]);
}

function recurringForm(template) {
  const isEdit = !!template;
  const t = template || {
    description: '',
    amount: '',
    type: 'expense',
    category: '',
    accountId: getAccounts()[0] ? getAccounts()[0].id : null,
    frequency: 'monthly',
    startDate: todayISO(),
  };

  const descInput = el('input', { type: 'text', placeholder: 'e.g. Car payment', maxlength: '60', value: t.description });
  const amountInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Amount', value: t.amount === '' ? '' : String(t.amount) });

  const typeSelect = el('select', { class: 'select' }, [
    el('option', { value: 'expense', text: 'Expense' }),
    el('option', { value: 'income', text: 'Income' }),
  ]);
  typeSelect.value = t.type;

  const categorySelect = el('select', { class: 'select' });
  populateCategorySelect(categorySelect, t.type, t.category);
  typeSelect.addEventListener('change', () => {
    populateCategorySelect(categorySelect, typeSelect.value, categorySelect.value);
  });

  const accountSelect = el('select', { class: 'select' });
  populateAccountSelect(accountSelect, t.accountId);

  const freqSelect = el('select', { class: 'select' }, [
    el('option', { value: 'monthly', text: 'Monthly' }),
    el('option', { value: 'weekly', text: 'Weekly' }),
  ]);
  freqSelect.value = t.frequency;

  const dateInput = el('input', { type: 'date', value: t.startDate });

  const save = () => {
    const description = descInput.value.trim();
    const amount = parseAmount(amountInput.value);
    if (amount == null) {
      amountInput.focus();
      return;
    }
    const data = {
      description: description || categorySelect.value,
      amount,
      type: typeSelect.value,
      category: categorySelect.value,
      accountId: accountSelect.value,
      frequency: freqSelect.value,
      startDate: dateInput.value || todayISO(),
    };
    if (isEdit) updateRecurring(template.id, data);
    else addRecurring(data);
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
    el('div', { class: 'account-form-hint dim', text: isEdit ? 'Edit recurring payment' : 'New recurring payment' }),
    descInput,
    amountInput,
    el('label', { class: 'mini-label dim', text: 'Type & category' }),
    typeSelect,
    categorySelect,
    el('label', { class: 'mini-label dim', text: 'Account' }),
    accountSelect,
    el('label', { class: 'mini-label dim', text: 'How often' }),
    freqSelect,
    el('label', { class: 'mini-label dim', text: 'Next payment date' }),
    dateInput,
    el('div', { class: 'account-form-actions' }, [
      el('button', { class: 'btn-small', type: 'button', text: isEdit ? 'Save' : 'Add', onClick: save }),
      el('button', { class: 'btn-ghost', type: 'button', text: 'Cancel', onClick: cancel }),
    ]),
  ]);
}
