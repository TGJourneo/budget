// goals.js -- savings goals on the dashboard. A goal tracks progress from
// either a savings account or the wedding pot, shows a projection, and its
// monthly set-aside feeds the margin finder (see patterns.js).

import {
  getGoals,
  addGoal,
  updateGoal,
  deleteGoal,
  getAccountsWithBalances,
} from './storage.js';
import { getWeddingSummary } from './wedding.js';
import {
  el,
  formatCurrency,
  formatDate,
  todayISO,
  addMonths,
  parseISO,
  emitChange,
} from './utils.js';

let panelOpen = false;
let editingId = null;
let adding = false;

// Resolve a goal's current "saved" amount and a human label for its source.
export function goalProgress(goal) {
  if (goal.source === 'wedding') {
    const w = getWeddingSummary();
    return { saved: w.pot, sourceLabel: 'Wedding pot' };
  }
  if (goal.source.startsWith('account:')) {
    const id = goal.source.slice('account:'.length);
    const acct = getAccountsWithBalances().find((a) => a.id === id);
    return { saved: acct ? acct.balance : 0, sourceLabel: acct ? acct.name : 'Account' };
  }
  return { saved: 0, sourceLabel: 'Goal' };
}

function projection(goal, saved) {
  if (goal.target <= 0) return '';
  if (saved >= goal.target) return 'Reached 🎉';
  const remaining = goal.target - saved;
  if (goal.monthly > 0) {
    const months = Math.ceil(remaining / goal.monthly);
    const eta = addMonths(todayISO(), months);
    let line = `At ${formatCurrency(goal.monthly)}/mo, on track for ${formatDate(eta)}`;
    if (goal.targetDate) {
      line += parseISO(eta) <= parseISO(goal.targetDate) ? ' — ahead of target ✅' : ' — behind target ⚠️';
    }
    return line;
  }
  return 'Set a monthly amount to project a date.';
}

export function renderGoalsCard() {
  const goals = getGoals();
  const card = el('div', { class: 'accounts-card' });

  card.appendChild(
    el('div', { class: 'section-head' }, [
      el('h2', { text: 'Savings goals' }),
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

  if (goals.length === 0 && !adding) {
    card.appendChild(
      el('div', { class: 'recurring-empty dim', text: 'No goals yet. Add one (e.g. a wedding fund) to track progress and see what you can set aside.' })
    );
  }

  for (const g of goals) {
    if (panelOpen && editingId === g.id) card.appendChild(goalForm(g));
    else card.appendChild(goalRow(g));
  }

  if (panelOpen) {
    if (adding) card.appendChild(goalForm(null));
    else
      card.appendChild(
        el('button', {
          class: 'add-account-btn',
          type: 'button',
          text: '+ Add goal',
          onClick: () => {
            adding = true;
            editingId = null;
            emitChange();
          },
        })
      );
  }

  return card;
}

function goalRow(g) {
  const { saved, sourceLabel } = goalProgress(g);
  const pct = g.target > 0 ? Math.min(100, Math.round((saved / g.target) * 100)) : 0;

  const left = [
    el('div', { class: 'account-name', text: g.name }),
    el('div', { class: 'account-meta dim', text: `${sourceLabel}${g.targetDate ? ' · by ' + formatDate(g.targetDate) : ''}` }),
  ];
  const right = [
    el('div', { class: 'account-balance num', text: `${formatCurrency(saved)} / ${formatCurrency(g.target)}` }),
  ];
  if (panelOpen) {
    right.push(
      el('div', { class: 'account-actions' }, [
        el('button', { class: 'link-btn', type: 'button', text: 'Edit', onClick: () => { editingId = g.id; adding = false; emitChange(); } }),
        el('button', {
          class: 'link-btn danger',
          type: 'button',
          text: 'Delete',
          onClick: () => {
            if (confirm(`Delete the "${g.name}" goal?`)) {
              deleteGoal(g.id);
              editingId = null;
              emitChange();
            }
          },
        }),
      ])
    );
  }

  return el('div', { class: 'goal-row' }, [
    el('div', { class: 'account-row', style: 'border:none;background:none;padding:0;margin:0;min-height:0' }, [
      el('div', { class: 'account-left' }, left),
      el('div', { class: 'account-right' }, right),
    ]),
    el('div', { class: 'progress', style: 'height:8px;margin-top:8px' }, [
      el('div', { class: `progress-bar${pct >= 100 ? '' : ''}`, style: `width:${pct}%` }),
    ]),
    el('div', { class: 'dim', style: 'font-size:0.8rem;margin-top:6px', text: projection(g, saved) }),
  ]);
}

function goalForm(goal) {
  const isEdit = !!goal;
  const g = goal || { name: '', source: 'wedding', target: '', targetDate: '', monthly: '' };

  const name = el('input', { type: 'text', placeholder: 'Goal name (e.g. Wedding fund)', maxlength: '40', value: g.name });

  const source = el('select', { class: 'select' });
  source.appendChild(el('option', { value: 'wedding', text: 'Wedding pot' }));
  for (const a of getAccountsWithBalances()) {
    const label = a.type === 'savings' ? `${a.name} (savings)` : a.name;
    source.appendChild(el('option', { value: `account:${a.id}`, text: label }));
  }
  source.value = g.source;

  const target = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Target amount', value: g.target === '' ? '' : String(g.target) });
  const date = el('input', { type: 'date', value: g.targetDate || '' });
  const monthly = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Set aside per month', value: g.monthly === '' ? '' : String(g.monthly) });

  const save = () => {
    const data = {
      name: name.value.trim() || 'Goal',
      source: source.value,
      target: Number(String(target.value).replace(/[^0-9.]/g, '')) || 0,
      targetDate: date.value || '',
      monthly: Number(String(monthly.value).replace(/[^0-9.]/g, '')) || 0,
    };
    if (isEdit) updateGoal(goal.id, data);
    else addGoal(data);
    editingId = null;
    adding = false;
    emitChange();
  };
  const cancel = () => { editingId = null; adding = false; emitChange(); };

  return el('div', { class: 'account-form' }, [
    el('div', { class: 'account-form-hint dim', text: isEdit ? 'Edit goal' : 'New goal' }),
    name,
    el('label', { class: 'mini-label dim', text: 'Track progress from' }),
    source,
    el('label', { class: 'mini-label dim', text: 'Target amount' }),
    target,
    el('label', { class: 'mini-label dim', text: 'Target date (optional)' }),
    date,
    el('label', { class: 'mini-label dim', text: 'Set aside per month (used by the margin finder)' }),
    monthly,
    el('div', { class: 'account-form-actions' }, [
      el('button', { class: 'btn-small', type: 'button', text: isEdit ? 'Save' : 'Add', onClick: save }),
      el('button', { class: 'btn-ghost', type: 'button', text: 'Cancel', onClick: cancel }),
    ]),
  ]);
}
