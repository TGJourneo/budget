// transactions.js -- add/edit form, and the filterable transactions list.

import {
  getTransactions,
  getTransaction,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  addCategory,
  getSettings,
  getAccounts,
} from './storage.js';
import {
  populateCategorySelect,
  populateFilterCategory,
  categoryColor,
} from './categories.js';
import { populateAccountSelect } from './accounts.js';
import { recurringIds, anomalyIds } from './patterns.js';
import {
  $,
  el,
  clear,
  uuid,
  todayISO,
  formatDate,
  formatSigned,
  formatCurrency,
  parseAmount,
  monthKey,
  monthLabel,
  monthKeysFromTransactions,
  emitChange,
  toast,
  downloadFile,
  csvCell,
} from './utils.js';

let navigate = () => {};
let currentType = 'expense';
let lastAccountId = null; // remember the last-used account for fast re-entry

// List filter state (persists while the app is open).
const filterState = {
  month: monthKey(),
  type: 'all',
  category: 'all',
};

// ---------------------------------------------------------------- init

export function initTransactions(deps = {}) {
  if (deps.navigate) navigate = deps.navigate;

  // Currency symbol on the amount field.
  const sym = getSettings().currencySymbol || '£';
  $('#amount-symbol').textContent = sym;

  wireTypeToggle();
  wireCategoryAdd();
  wireForm();
  wireListFilters();
  wireListDelegation();
  $('#export-csv').addEventListener('click', exportCSV);

  resetAddForm();
}

// Export all transactions as a CSV file (newest data is fine to sort ascending
// for spreadsheets). Uses the native share sheet on iOS, download elsewhere.
async function exportCSV() {
  const txns = getTransactions()
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  if (txns.length === 0) {
    toast('No transactions to export');
    return;
  }
  const accountsById = new Map(getAccounts().map((a) => [a.id, a.name]));
  const header = ['Date', 'Description', 'Category', 'Type', 'Account', 'Amount'];
  const lines = [header.map(csvCell).join(',')];
  for (const t of txns) {
    const signed = (t.type === 'expense' ? '-' : '') + Number(t.amount).toFixed(2);
    lines.push(
      [t.date, t.description || '', t.category || '', t.type, accountsById.get(t.accountId) || '', signed]
        .map(csvCell)
        .join(',')
    );
  }
  const csv = lines.join('\r\n');
  await downloadFile(`budget-${todayISO()}.csv`, csv, 'text/csv');
}

// ------------------------------------------------------------ add form

function wireTypeToggle() {
  for (const btn of document.querySelectorAll('.type-btn')) {
    btn.addEventListener('click', () => {
      setType(btn.dataset.type);
    });
  }
}

function setType(type) {
  currentType = type === 'income' ? 'income' : 'expense';
  for (const btn of document.querySelectorAll('.type-btn')) {
    btn.classList.toggle('is-active', btn.dataset.type === currentType);
  }
  // Repopulate categories for the chosen type, keeping selection if possible.
  const select = $('#category');
  const prev = select.value;
  populateCategorySelect(select, currentType, prev);
}

function wireCategoryAdd() {
  $('#toggle-add-cat').addEventListener('click', () => {
    const row = $('#new-cat-row');
    row.hidden = !row.hidden;
    if (!row.hidden) $('#new-cat-name').focus();
  });

  $('#save-cat').addEventListener('click', saveNewCategory);
  $('#new-cat-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveNewCategory();
    }
  });
}

function saveNewCategory() {
  const input = $('#new-cat-name');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }
  const ok = addCategory(currentType, name);
  if (!ok) {
    showError('That category already exists.');
    return;
  }
  populateCategorySelect($('#category'), currentType, name);
  input.value = '';
  $('#new-cat-row').hidden = true;
  clearError();
  emitChange();
  toast('Category added');
}

function wireForm() {
  $('#add-form').addEventListener('submit', onSubmit);
  $('#delete-btn').addEventListener('click', onDelete);
  $('#cancel-edit').addEventListener('click', () => {
    resetAddForm();
    navigate('transactions');
  });
}

function onSubmit(e) {
  e.preventDefault();
  clearError();

  const amount = parseAmount($('#amount').value);
  if (amount == null) {
    showError('Enter an amount greater than zero.');
    $('#amount').focus();
    return;
  }

  const category = $('#category').value || 'Other';
  let description = $('#description').value.trim();
  if (!description) description = category; // sensible default for speed

  const date = $('#date').value || todayISO();
  const accountId = $('#account').value || (getAccounts()[0] && getAccounts()[0].id) || null;
  lastAccountId = accountId;
  const editId = $('#edit-id').value;

  if (editId) {
    updateTransaction(editId, {
      amount,
      description,
      category,
      date,
      type: currentType,
      accountId,
    });
    emitChange();
    resetAddForm();
    toast('Saved');
    navigate('transactions');
  } else {
    addTransaction({
      id: uuid(),
      date,
      description,
      amount,
      type: currentType,
      category,
      accountId,
      createdAt: Date.now(),
    });
    emitChange();
    resetAddForm();
    toast('Added');
    // Stay on the Add screen, ready for the next entry.
    $('#amount').focus();
  }
}

function onDelete() {
  const editId = $('#edit-id').value;
  if (!editId) return;
  if (!confirm('Delete this transaction?')) return;
  deleteTransaction(editId);
  emitChange();
  resetAddForm();
  toast('Deleted');
  navigate('transactions');
}

// Reset the form to a clean "add expense" state.
export function resetAddForm() {
  $('#edit-id').value = '';
  $('#amount').value = '';
  $('#description').value = '';
  $('#date').value = todayISO();
  $('#new-cat-name').value = '';
  $('#new-cat-row').hidden = true;
  clearError();
  setType('expense');
  populateAccountSelect($('#account'), lastAccountId || (getAccounts()[0] && getAccounts()[0].id));
  $('#add-title').textContent = 'Add';
  $('#submit-btn').textContent = 'Add transaction';
  $('#delete-btn').hidden = true;
  $('#cancel-edit').hidden = true;
}

// Load a transaction into the form for editing.
export function loadTransactionIntoForm(id) {
  const tx = getTransaction(id);
  if (!tx) {
    resetAddForm();
    return;
  }
  setType(tx.type);
  $('#edit-id').value = tx.id;
  $('#amount').value = String(tx.amount);
  $('#description').value = tx.description || '';
  $('#date').value = tx.date;
  populateCategorySelect($('#category'), tx.type, tx.category);
  populateAccountSelect($('#account'), tx.accountId);
  clearError();
  $('#add-title').textContent = 'Edit';
  $('#submit-btn').textContent = 'Save changes';
  $('#delete-btn').hidden = false;
  $('#cancel-edit').hidden = false;
}

export function focusAmount() {
  const input = $('#amount');
  if (input) input.focus();
}

function showError(msg) {
  const node = $('#add-error');
  node.textContent = msg;
  node.hidden = false;
}
function clearError() {
  const node = $('#add-error');
  node.textContent = '';
  node.hidden = true;
}

// --------------------------------------------------------- list view

function wireListFilters() {
  $('#filter-month').addEventListener('change', (e) => {
    filterState.month = e.target.value;
    renderTransactionsView();
  });
  $('#filter-type').addEventListener('change', (e) => {
    filterState.type = e.target.value;
    renderTransactionsView();
  });
  $('#filter-category').addEventListener('change', (e) => {
    filterState.category = e.target.value;
    renderTransactionsView();
  });
}

function wireListDelegation() {
  // One delegated listener for the whole list (not one per row).
  $('#tx-list').addEventListener('click', (e) => {
    const item = e.target.closest('.tx-item');
    if (!item || !item.dataset.id) return;
    navigate('add', { editId: item.dataset.id });
  });
}

export function renderTransactionsView() {
  const all = getTransactions();

  // Month filter options (always include current month).
  const months = monthKeysFromTransactions(all);
  if (!months.includes(filterState.month)) filterState.month = months[0];
  const monthSelect = $('#filter-month');
  clear(monthSelect);
  for (const key of months) {
    const opt = el('option', { value: key, text: monthLabel(key) });
    if (key === filterState.month) opt.selected = true;
    monthSelect.appendChild(opt);
  }

  // Category filter options.
  populateFilterCategory($('#filter-category'), filterState.category);
  $('#filter-type').value = filterState.type;

  // Apply filters.
  let rows = all.filter((t) => t.date.slice(0, 7) === filterState.month);
  if (filterState.type !== 'all') rows = rows.filter((t) => t.type === filterState.type);
  if (filterState.category !== 'all')
    rows = rows.filter((t) => t.category === filterState.category);

  rows.sort(sortByDateDesc);

  // Summary line for the current filter.
  const income = sum(rows.filter((t) => t.type === 'income'));
  const expense = sum(rows.filter((t) => t.type === 'expense'));
  const summaryLine = $('#tx-summary-line');
  clear(summaryLine);
  summaryLine.append(
    el('span', {}, [el('span', { class: 'dim' }, 'In '), el('strong', { class: 'income', text: formatCurrency(income) })]),
    el('span', {}, [el('span', { class: 'dim' }, 'Out '), el('strong', { class: 'expense', text: formatCurrency(expense) })]),
    el('span', {}, [el('span', { class: 'dim' }, `${rows.length} item${rows.length === 1 ? '' : 's'}`)])
  );

  // List.
  const list = $('#tx-list');
  clear(list);
  if (rows.length === 0) {
    list.appendChild(emptyState('No transactions for this filter.'));
    return;
  }
  const labelOf = accountLabeller();
  const recurring = recurringIds(all);
  const anomalies = anomalyIds(all);
  for (const tx of rows) {
    list.appendChild(txItem(tx, labelOf(tx), { recurring: recurring.has(tx.id), anomaly: anomalies.has(tx.id) }));
  }
}

// Shared row renderer (also used by the dashboard's recent list).
// accountName is shown only when the user has more than one account.
// flags: { recurring, anomaly } add small badges.
export function txItem(tx, accountName, flags = {}) {
  let meta = `${formatDate(tx.date)} · ${tx.category}`;
  if (accountName) meta += ` · ${accountName}`;
  const descChildren = [el('span', { text: tx.description || tx.category })];
  if (flags.recurring) descChildren.push(el('span', { class: 'tx-badge recurring', title: 'Looks recurring', text: '↻' }));
  if (flags.anomaly) descChildren.push(el('span', { class: 'tx-badge anomaly', title: 'Unusually large for this category', text: '!' }));
  return el('li', { class: 'tx-item', dataset: { id: tx.id } }, [
    el('span', { class: 'tx-cat-dot', style: `background:${categoryColor(tx.category)}` }),
    el('div', { class: 'tx-main' }, [
      el('div', { class: 'tx-desc' }, descChildren),
      el('div', { class: 'tx-meta', text: meta }),
    ]),
    el('div', {
      class: `tx-amount num ${tx.type === 'income' ? 'income' : 'expense'}`,
      text: formatSigned(tx.amount, tx.type),
    }),
  ]);
}

// Build an id -> name map and a flag for whether to show account in rows.
export function accountLabeller() {
  const accounts = getAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a.name]));
  const show = accounts.length > 1;
  return (tx) => (show ? byId.get(tx.accountId) || '' : '');
}

function emptyState(message) {
  return el('li', { class: 'empty' }, [
    el('span', { class: 'emoji', text: '🗒️' }),
    el('div', { text: message }),
  ]);
}

function sortByDateDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

function sum(list) {
  return list.reduce((acc, t) => acc + Number(t.amount || 0), 0);
}
