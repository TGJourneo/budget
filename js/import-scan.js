// import-scan.js -- import transactions from a bank-app screenshot using
// Claude vision. Calls the Anthropic API directly from the browser with the
// user's own API key (stored on-device). Always shows an editable review list
// before anything is saved.

import {
  getAccounts,
  getCategories,
  addTransaction,
} from './storage.js';
import { populateCategorySelect } from './categories.js';
import { populateAccountSelect } from './accounts.js';
import {
  $,
  el,
  clear,
  uuid,
  todayISO,
  parseAmount,
  formatSigned,
  emitChange,
  toast,
} from './utils.js';

const KEY_STORE = 'budget_claude_key';
const MODEL_STORE = 'budget_scan_model';

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Most accurate (Opus) — a few pence each' },
  { id: 'claude-sonnet-4-6', label: 'Balanced (Sonnet) — cheaper' },
  { id: 'claude-haiku-4-5', label: 'Cheapest (Haiku) — least accurate' },
];

let navigate = () => {};

// view state
let phase = 'idle'; // 'idle' | 'loading' | 'review' | 'error'
let extracted = []; // [{include, date, description, amount, type, category}]
let errorMsg = '';
let accountId = null;

export function initScan(deps = {}) {
  if (deps.navigate) navigate = deps.navigate;
}

function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORE) || '';
  } catch (e) {
    return '';
  }
}
function setApiKey(v) {
  try {
    if (v) localStorage.setItem(KEY_STORE, v);
    else localStorage.removeItem(KEY_STORE);
  } catch (e) {
    /* ignore */
  }
}
function getModel() {
  return localStorage.getItem(MODEL_STORE) || MODELS[0].id;
}
function setModel(v) {
  localStorage.setItem(MODEL_STORE, v);
}

// Reset to a clean state (called when entering the view fresh).
export function resetScan() {
  phase = 'idle';
  extracted = [];
  errorMsg = '';
  accountId = getAccounts()[0] ? getAccounts()[0].id : null;
}

export function renderScan() {
  const root = $('#view-scan');
  clear(root);

  root.appendChild(
    el('header', { class: 'view-header view-header-row' }, [
      el('h1', { text: 'Scan screenshot' }),
      el('button', { type: 'button', class: 'header-btn', text: 'Done', onClick: () => navigate('add') }),
    ])
  );

  if (phase === 'loading') {
    root.appendChild(
      el('div', { class: 'empty' }, [
        el('span', { class: 'emoji', text: '🔎' }),
        el('div', { text: 'Reading your screenshot…' }),
        el('div', { class: 'dim', style: 'margin-top:6px;font-size:0.85rem', text: 'Sending the image to Claude. This needs a connection.' }),
      ])
    );
    return;
  }

  if (phase === 'review') {
    renderReview(root);
    return;
  }

  // idle (and error) -> setup + picker
  if (!getApiKey()) {
    root.appendChild(apiKeyCard());
    return;
  }

  root.appendChild(pickerCard());
  if (errorMsg) {
    root.appendChild(el('p', { class: 'form-error', text: errorMsg }));
  }
  root.appendChild(apiKeyFooter());
}

// ---- API key setup ----------------------------------------------------

function apiKeyCard() {
  const input = el('input', { type: 'password', placeholder: 'sk-ant-...', autocomplete: 'off' });
  const save = () => {
    const v = input.value.trim();
    if (!v) {
      input.focus();
      return;
    }
    setApiKey(v);
    errorMsg = '';
    emitChange();
  };
  return el('div', { class: 'account-form' }, [
    el('div', { class: 'account-form-hint dim', text: 'Connect Claude (one-time)' }),
    el('p', { class: 'dim', style: 'font-size:0.85rem;line-height:1.45;margin:0', text: 'Reading a screenshot uses Claude vision. Paste your own Anthropic API key — it is stored only on this device and used to call Claude directly. Each scan costs a few pence on your account, and the image is sent to Anthropic.' }),
    el('label', { class: 'mini-label dim', text: 'Anthropic API key' }),
    input,
    modelSelectRow(),
    el('div', { class: 'account-form-actions' }, [
      el('button', { class: 'btn-small', type: 'button', text: 'Save key', onClick: save }),
    ]),
    el('p', { class: 'dim', style: 'font-size:0.8rem;margin-top:4px', text: 'Get a key at console.anthropic.com → API keys.' }),
  ]);
}

function modelSelectRow() {
  const select = el('select', { class: 'select' });
  for (const m of MODELS) {
    const opt = el('option', { value: m.id, text: m.label });
    if (m.id === getModel()) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => setModel(select.value));
  return el('div', {}, [el('label', { class: 'mini-label dim', text: 'Accuracy / cost' }), select]);
}

function apiKeyFooter() {
  return el('div', { class: 'budget-foot', style: 'margin-top:18px' }, [
    el('span', { class: 'dim', text: 'Claude connected' }),
    el('button', {
      class: 'budget-set',
      type: 'button',
      text: 'Change key',
      onClick: () => {
        setApiKey('');
        emitChange();
      },
    }),
  ]);
}

// ---- image picker -----------------------------------------------------

function pickerCard() {
  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'display:none',
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) onImageChosen(file);
  });

  const card = el('div', { class: 'account-form' }, [
    el('div', { class: 'account-form-hint dim', text: 'Import from a screenshot' }),
    el('p', { class: 'dim', style: 'font-size:0.85rem;line-height:1.45;margin:0', text: 'Take or choose a screenshot of your transactions from your banking app. Claude reads it, then you review everything before it is saved.' }),
    modelSelectRow(),
    fileInput,
    el('div', { class: 'account-form-actions' }, [
      el('button', { class: 'btn-primary', type: 'button', text: '📷 Choose screenshot', onClick: () => fileInput.click() }),
    ]),
  ]);
  return card;
}

async function onImageChosen(file) {
  errorMsg = '';
  phase = 'loading';
  emitChange();
  try {
    const { base64, mediaType } = await fileToBase64(file);
    const txns = await callClaude(base64, mediaType);
    if (!txns.length) {
      throw new Error('No transactions were found in that image. Try a clearer screenshot.');
    }
    extracted = txns.map((t) => ({
      include: true,
      date: validDate(t.date),
      description: typeof t.description === 'string' ? t.description : '',
      amount: parseAmount(t.amount) || 0,
      type: t.type === 'income' ? 'income' : 'expense',
      category: typeof t.category === 'string' ? t.category : 'Other',
    }));
    accountId = getAccounts()[0] ? getAccounts()[0].id : null;
    phase = 'review';
  } catch (e) {
    errorMsg = e && e.message ? e.message : 'Something went wrong reading the image.';
    phase = 'error';
  }
  emitChange();
}

// Downscale to a long edge of 1568px and re-encode as JPEG to control size/cost.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxEdge = 1568;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}

async function callClaude(base64, mediaType) {
  const key = getApiKey();
  const cats = getCategories();
  const allCats = Array.from(new Set([...cats.expense, ...cats.income, 'Other']));
  const today = todayISO();

  const tool = {
    name: 'record_transactions',
    description: 'Record every transaction read from the screenshot.',
    input_schema: {
      type: 'object',
      properties: {
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
              description: { type: 'string' },
              amount: { type: 'number', description: 'positive number, no currency symbol' },
              type: { type: 'string', enum: ['income', 'expense'] },
              category: { type: 'string' },
            },
            required: ['description', 'amount', 'type'],
          },
        },
      },
      required: ['transactions'],
    },
  };

  const prompt =
    `This image is a screenshot of bank or card transactions. Extract EVERY transaction.\n\n` +
    `For each: date as ISO YYYY-MM-DD (assume year ${today.slice(0, 4)} if not shown; use ${today} if no date at all); ` +
    `description (the merchant/text); amount as a POSITIVE number with no currency symbol; ` +
    `type "expense" for money out or "income" for money in; ` +
    `category as the best fit from: ${allCats.join(', ')} (use "Other" if unsure). ` +
    `Ignore balances, totals and headers. Call record_transactions with the full list.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 4096,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'record_transactions' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    let msg = `Claude API error (${res.status}).`;
    if (res.status === 401) msg = 'That API key was rejected. Check it and try again.';
    else if (res.status === 429) msg = 'Rate limited by the API — wait a moment and retry.';
    else {
      try {
        const e = await res.json();
        if (e && e.error && e.error.message) msg = e.error.message;
      } catch (err) {
        /* keep default */
      }
    }
    throw new Error(msg);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
  if (!toolUse || !toolUse.input || !Array.isArray(toolUse.input.transactions)) {
    throw new Error('Claude did not return any transactions.');
  }
  return toolUse.input.transactions;
}

// ---- review list ------------------------------------------------------

function renderReview(root) {
  const includedCount = extracted.filter((t) => t.include).length;

  root.appendChild(
    el('p', { class: 'dim', style: 'margin:0 2px 12px', text: `Found ${extracted.length} transaction${extracted.length === 1 ? '' : 's'}. Untick any you don't want, edit anything that's off, then save.` })
  );

  // Account picker for the whole batch.
  const acctSelect = el('select', { class: 'select' });
  populateAccountSelect(acctSelect, accountId);
  acctSelect.addEventListener('change', () => {
    accountId = acctSelect.value;
  });
  root.appendChild(el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Add all to account' }), acctSelect]));

  for (let i = 0; i < extracted.length; i++) {
    root.appendChild(reviewRow(extracted[i], i));
  }

  const actions = el('div', { class: 'add-actions' }, [
    el('button', {
      class: 'btn-primary',
      type: 'button',
      text: `Add ${includedCount} transaction${includedCount === 1 ? '' : 's'}`,
      onClick: confirmImport,
    }),
    el('button', { class: 'btn-ghost', type: 'button', text: 'Cancel', onClick: () => { resetScan(); navigate('add'); } }),
  ]);
  root.appendChild(actions);
}

function reviewRow(item, idx) {
  const check = el('input', { type: 'checkbox' });
  check.checked = item.include;
  check.addEventListener('change', () => {
    item.include = check.checked;
    emitChange();
  });

  const desc = el('input', { type: 'text', value: item.description });
  desc.addEventListener('change', () => { item.description = desc.value; });

  const amount = el('input', { type: 'text', inputmode: 'decimal', value: String(item.amount) });
  amount.addEventListener('change', () => { item.amount = parseAmount(amount.value) || 0; });

  const typeSel = el('select', { class: 'select' }, [
    el('option', { value: 'expense', text: 'Expense' }),
    el('option', { value: 'income', text: 'Income' }),
  ]);
  typeSel.value = item.type;

  const catSel = el('select', { class: 'select' });
  populateCategorySelect(catSel, item.type, item.category);
  typeSel.addEventListener('change', () => {
    item.type = typeSel.value;
    populateCategorySelect(catSel, item.type, catSel.value);
    item.category = catSel.value;
  });
  catSel.addEventListener('change', () => { item.category = catSel.value; });

  const date = el('input', { type: 'date', value: item.date });
  date.addEventListener('change', () => { item.date = date.value || todayISO(); });

  return el('div', { class: `scan-item${item.include ? '' : ' excluded'}` }, [
    el('div', { class: 'scan-item-head' }, [
      el('label', { class: 'scan-check' }, [check, el('span', {})]),
      desc,
      amount,
    ]),
    el('div', { class: 'scan-item-grid' }, [typeSel, catSel, date]),
  ]);
}

function confirmImport() {
  const chosen = extracted.filter((t) => t.include && t.amount > 0);
  if (chosen.length === 0) {
    toast('Nothing to add');
    return;
  }
  const acct = accountId || (getAccounts()[0] && getAccounts()[0].id) || null;
  for (const t of chosen) {
    addTransaction({
      id: uuid(),
      date: validDate(t.date),
      description: t.description.trim() || t.category,
      amount: t.amount,
      type: t.type,
      category: t.category || 'Other',
      accountId: acct,
      createdAt: Date.now(),
    });
  }
  resetScan();
  emitChange();
  toast(`Added ${chosen.length}`);
  navigate('transactions');
}

function validDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayISO();
}
