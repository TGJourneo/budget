// utils.js -- formatting, date helpers, UUID generation, small DOM helpers

import { getSettings } from './storage.js';

// --- IDs ---------------------------------------------------------------

export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for very old engines (should not be needed on iOS 16+).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- Currency ----------------------------------------------------------

let _currencyFormatter = null;
let _currencyKey = '';

function currencyFormatter() {
  const settings = getSettings();
  const key = settings.currency || 'GBP';
  if (!_currencyFormatter || _currencyKey !== key) {
    try {
      _currencyFormatter = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: key,
      });
    } catch (e) {
      _currencyFormatter = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
      });
    }
    _currencyKey = key;
  }
  return _currencyFormatter;
}

// Call this if currency settings change so the cached formatter rebuilds.
export function resetCurrencyFormatter() {
  _currencyFormatter = null;
  _currencyKey = '';
}

// Format a positive number as currency, e.g. 1234.5 -> "£1,234.50".
export function formatCurrency(amount) {
  const n = Number(amount);
  if (!isFinite(n)) return currencyFormatter().format(0);
  return currencyFormatter().format(n);
}

// Format a signed amount with a +/- prefix based on transaction type.
export function formatSigned(amount, type) {
  const sign = type === 'income' ? '+' : '-';
  return sign + formatCurrency(Math.abs(Number(amount) || 0));
}

// --- Dates -------------------------------------------------------------

// Parse a 'YYYY-MM-DD' string into a *local* Date (avoids UTC day-shift).
export function parseISO(iso) {
  if (!iso || typeof iso !== 'string') return new Date(NaN);
  const parts = iso.split('-');
  if (parts.length !== 3) return new Date(NaN);
  const [y, m, d] = parts.map(Number);
  return new Date(y, m - 1, d);
}

// Today's date as 'YYYY-MM-DD' in local time.
export function todayISO() {
  return toISO(new Date());
}

// Convert a Date to a local 'YYYY-MM-DD' string.
export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Add n months to an ISO date, clamping the day to the target month's length
// (e.g. 31 Jan + 1 month -> 28/29 Feb). Computed from the original date to
// avoid drift when stepping repeatedly.
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(d, lastDay));
  return toISO(date);
}

// Add n days to an ISO date.
export function addDays(iso, n) {
  const date = parseISO(iso);
  date.setDate(date.getDate() + n);
  return toISO(date);
}

// Display an ISO date as "13 Jun 2026".
export function formatDate(iso) {
  const date = parseISO(iso);
  if (isNaN(date.getTime())) return iso || '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// The month key 'YYYY-MM' for a given ISO date (or today if omitted).
export function monthKey(iso) {
  const src = iso || todayISO();
  return src.slice(0, 7);
}

// Human label for a month key, e.g. "2026-06" -> "June 2026".
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// The month key immediately before the given one.
export function previousMonthKey(key) {
  let [y, m] = key.split('-').map(Number);
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Does a transaction's date fall within the given month key?
export function isInMonth(iso, key) {
  return typeof iso === 'string' && iso.slice(0, 7) === key;
}

// Build a sorted (desc) list of month keys that have transactions,
// always including the current month.
export function monthKeysFromTransactions(transactions) {
  const set = new Set([monthKey()]);
  for (const t of transactions) {
    if (t && typeof t.date === 'string') set.add(t.date.slice(0, 7));
  }
  return Array.from(set).sort().reverse();
}

// --- DOM helpers -------------------------------------------------------

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

// Create an element with attributes and children. Text children are added
// via textContent-safe nodes, so no unsanitised HTML is ever injected.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'text') {
      node.textContent = v;
    } else {
      node.setAttribute(k, v);
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    node.appendChild(
      typeof child === 'string' ? document.createTextNode(child) : child
    );
  }
  return node;
}

// Clear all children of a node.
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Broadcast that data changed so the active view can re-render.
export function emitChange() {
  document.dispatchEvent(new CustomEvent('budget:changed'));
}

// Brief bottom-of-screen confirmation toast.
let _toastTimer = null;
export function toast(message) {
  let node = document.getElementById('toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    node.className = 'toast';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => node.classList.remove('show'), 1600);
}

// Offer a text file to the user. Prefers the native share sheet (best on
// iOS, including installed PWAs) and falls back to a normal download link.
// Must be called from within a user gesture (e.g. a click handler).
export async function downloadFile(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  try {
    if (navigator.canShare) {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user cancelled the share sheet
    // otherwise fall through to the download link
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Escape one value for CSV (RFC 4180): quote if it contains a comma, quote or
// newline, and double any embedded quotes.
export function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Parse a user-entered amount string into a positive number, or null.
export function parseAmount(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}
