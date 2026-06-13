// summary.js -- per-month breakdown: donut + ranked bars + MoM comparison.

import { getTransactions } from './storage.js';
import { categoryColor } from './categories.js';
import {
  $,
  el,
  clear,
  formatCurrency,
  monthKey,
  monthLabel,
  previousMonthKey,
  isInMonth,
  monthKeysFromTransactions,
} from './utils.js';

let selectedMonth = monthKey();

export function initSummary() {
  // nothing persistent to wire; month select is rebuilt each render
}

export function renderSummary() {
  const root = $('#view-summary');
  clear(root);

  const all = getTransactions();
  const months = monthKeysFromTransactions(all);
  if (!months.includes(selectedMonth)) selectedMonth = months[0];

  // Header with month selector.
  const select = el('select', { class: 'select' });
  for (const key of months) {
    const opt = el('option', { value: key, text: monthLabel(key) });
    if (key === selectedMonth) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', (e) => {
    selectedMonth = e.target.value;
    renderSummary();
  });
  const header = el('header', { class: 'view-header' }, [el('h1', { text: 'Summary' })]);
  root.appendChild(header);
  root.appendChild(el('div', { class: 'field' }, [select]));

  // Month data.
  const txns = all.filter((t) => isInMonth(t.date, selectedMonth));
  const income = sum(txns.filter((t) => t.type === 'income'));
  const expense = sum(txns.filter((t) => t.type === 'expense'));

  // Totals.
  root.appendChild(
    el('div', { class: 'summary-totals' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: 'Income' }),
        el('div', { class: 'stat-value num income', text: formatCurrency(income) }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: 'Expenses' }),
        el('div', { class: 'stat-value num expense', text: formatCurrency(expense) }),
      ]),
    ])
  );

  // Category breakdown of expenses.
  const byCat = groupExpenses(txns);
  if (byCat.length === 0) {
    root.appendChild(
      el('div', { class: 'empty' }, [
        el('span', { class: 'emoji', text: '📊' }),
        el('div', { text: 'No spending recorded this month.' }),
      ])
    );
  } else {
    root.appendChild(donut(byCat, expense));
    root.appendChild(catBars(byCat, expense));
  }

  // Month-on-month comparison.
  root.appendChild(momCard(all));
}

// --- donut (SVG built from numbers/palette only; no user text inside) ---

function donut(byCat, total) {
  const r = 80;
  const c = 2 * Math.PI * r;
  let offset = 0;
  let slices = '';
  for (const { category, amount } of byCat) {
    const frac = total > 0 ? amount / total : 0;
    const len = frac * c;
    const color = categoryColor(category);
    slices += `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${color}" stroke-width="28" stroke-dasharray="${len.toFixed(3)} ${(c - len).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}"></circle>`;
    offset += len;
  }

  const wrap = el('div', { class: 'donut-wrap' });
  const donutEl = el('div', { class: 'donut' });
  // Safe: only numeric + palette-hex values interpolated, no user input.
  donutEl.innerHTML = `<svg viewBox="0 0 200 200" width="200" height="200">
    <circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="28"></circle>
    ${slices}
  </svg>`;
  donutEl.appendChild(
    el('div', { class: 'donut-center' }, [
      el('span', { class: 'label', text: 'Spent' }),
      el('span', { class: 'value num', text: formatCurrency(total) }),
    ])
  );
  wrap.appendChild(donutEl);
  return wrap;
}

// --- ranked horizontal bars ---

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

// --- month-on-month ---

function momCard(all) {
  const prevKey = previousMonthKey(selectedMonth);
  const cur = all.filter((t) => isInMonth(t.date, selectedMonth));
  const prev = all.filter((t) => isInMonth(t.date, prevKey));

  const curExp = sum(cur.filter((t) => t.type === 'expense'));
  const prevExp = sum(prev.filter((t) => t.type === 'expense'));
  const curInc = sum(cur.filter((t) => t.type === 'income'));
  const prevInc = sum(prev.filter((t) => t.type === 'income'));

  const card = el('div', { class: 'mom-card' });
  card.appendChild(
    el('div', { class: 'section-head' }, [
      el('h2', { text: `vs ${monthLabel(prevKey)}` }),
    ])
  );
  card.appendChild(momRow('Spending', curExp, prevExp, true));
  card.appendChild(momRow('Income', curInc, prevInc, false));
  return card;
}

function momRow(label, cur, prev, lessIsGood) {
  const diff = cur - prev;
  let deltaText;
  let cls = 'dim';
  if (prev === 0 && cur === 0) {
    deltaText = 'no change';
  } else if (prev === 0) {
    deltaText = 'new';
  } else {
    const pct = Math.round((diff / prev) * 100);
    const up = diff > 0;
    deltaText = `${up ? '▲' : diff < 0 ? '▼' : ''} ${Math.abs(pct)}%`;
    if (diff !== 0) {
      const good = lessIsGood ? diff < 0 : diff > 0;
      cls = good ? 'income' : 'expense';
    }
  }
  return el('div', { class: 'mom-row' }, [
    el('span', {}, [
      el('div', { text: label }),
      el('div', { class: 'dim', style: 'font-size:0.8rem', text: formatCurrency(cur) }),
    ]),
    el('span', { class: `mom-delta ${cls}`, text: deltaText }),
  ]);
}

// --- helpers ---

function groupExpenses(txns) {
  const map = new Map();
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    map.set(t.category, (map.get(t.category) || 0) + Number(t.amount || 0));
  }
  return Array.from(map, ([category, amount]) => ({ category, amount })).sort(
    (a, b) => b.amount - a.amount
  );
}

function sum(list) {
  return list.reduce((acc, t) => acc + Number(t.amount || 0), 0);
}
