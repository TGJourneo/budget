// categories.js -- populate category selects and assign stable colours.

import { getCategories } from './storage.js';
import { clear, el } from './utils.js';

// Fixed palette; categories map to a colour deterministically by name so the
// same category is always the same colour across dashboard / list / summary.
const PALETTE = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#ff7b72',
  '#39c5cf', '#db61a2', '#a5d6ff', '#7ee787', '#ffa657', '#d2a8ff',
];

export function categoryColor(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Fill a <select> with the categories for a given type, optionally
// pre-selecting one.
export function populateCategorySelect(select, type, selected) {
  const cats = getCategories();
  const list = type === 'income' ? cats.income : cats.expense;
  clear(select);
  for (const name of list) {
    const opt = el('option', { value: name, text: name });
    if (name === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

// Fill the transactions filter with every category (both types) plus "All".
export function populateFilterCategory(select, selected) {
  const cats = getCategories();
  const all = Array.from(new Set([...cats.expense, ...cats.income]));
  clear(select);
  select.appendChild(el('option', { value: 'all', text: 'All categories' }));
  for (const name of all) {
    select.appendChild(el('option', { value: name, text: name }));
  }
  if (selected && all.includes(selected)) select.value = selected;
  else select.value = 'all';
}
