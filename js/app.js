// app.js -- entry point: routing between views, bottom nav, SW registration.

import {
  initTransactions,
  renderTransactionsView,
  resetAddForm,
  loadTransactionIntoForm,
  focusAmount,
} from './transactions.js';
import { initDashboard, renderDashboard } from './dashboard.js';
import { initSummary, renderSummary } from './summary.js';
import { renderWedding } from './wedding.js';
import { initScan, renderScan, resetScan } from './import-scan.js';
import { initInsights } from './insights.js';
import { migrateData, generateDueTransactions } from './storage.js';
import { $, $$, toast } from './utils.js';

let currentView = 'home';

const VIEWS = {
  home: { el: '#view-home', render: renderDashboard },
  add: { el: '#view-add', render: null },
  transactions: { el: '#view-transactions', render: renderTransactionsView },
  summary: { el: '#view-summary', render: renderSummary },
  wedding: { el: '#view-wedding', render: renderWedding },
  scan: { el: '#view-scan', render: renderScan },
};

// Switch to a view. opts.editId (for "add") loads a transaction to edit.
function navigate(view, opts = {}) {
  if (!VIEWS[view]) view = 'home';
  currentView = view;

  // Toggle sections.
  for (const [name, cfg] of Object.entries(VIEWS)) {
    const node = $(cfg.el);
    if (node) node.hidden = name !== view;
  }

  // Toggle nav highlight.
  for (const btn of $$('.nav-btn')) {
    btn.classList.toggle('is-active', btn.dataset.nav === view);
  }

  // Per-view setup.
  if (view === 'add') {
    if (opts.editId) loadTransactionIntoForm(opts.editId);
    else resetAddForm();
    // Focus after the view is visible so iOS opens the keyboard.
    requestAnimationFrame(focusAmount);
  } else if (view === 'scan') {
    if (!opts.keepState) resetScan();
    renderScan();
  } else if (VIEWS[view].render) {
    VIEWS[view].render();
  }

  window.scrollTo(0, 0);
}

function wireNav() {
  for (const btn of $$('.nav-btn')) {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  }
}

// Re-render the active view whenever data changes (live updates).
function wireLiveUpdates() {
  document.addEventListener('budget:changed', () => {
    const cfg = VIEWS[currentView];
    if (cfg && cfg.render) cfg.render();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

function init() {
  migrateData(); // ensure a default account + attach legacy transactions
  const generated = generateDueTransactions(); // catch up recurring payments
  initDashboard({ navigate });
  initSummary({ navigate });
  initTransactions({ navigate });
  initScan({ navigate });
  initInsights({ navigate });
  const scanBtn = $('#scan-btn');
  if (scanBtn) scanBtn.addEventListener('click', () => navigate('scan'));
  wireNav();
  wireLiveUpdates();
  registerServiceWorker();
  navigate('home');
  if (generated > 0) {
    toast(`Added ${generated} recurring ${generated === 1 ? 'payment' : 'payments'}`);
  }
}

init();
