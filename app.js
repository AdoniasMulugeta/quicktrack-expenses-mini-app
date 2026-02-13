// app.js — Core logic + Telegram SDK integration

let tg = null;

async function init() {
  // Telegram SDK
  tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();

    // Theme
    document.documentElement.style.setProperty('--bg-color', tg.themeParams.bg_color || '#ffffff');
    document.documentElement.style.setProperty('--text-color', tg.themeParams.text_color || '#000000');

    // User ID for storage prefix
    const user = tg.initDataUnsafe?.user;
    if (user) setUserId(String(user.id));

    // MainButton
    tg.MainButton.setText('Add Expense');
    tg.MainButton.show();
    tg.MainButton.onClick(() => {
      resetForm();
      showView('add');
    });

    // BackButton
    tg.BackButton.onClick(() => {
      navigateBack();
    });
  }

  // Init storage
  try {
    await initStorage();
  } catch (e) {
    console.error('Storage init failed:', e);
  }

  // Load config
  const config = await getConfig();
  currentCurrency = config.currency || 'ETB';
  document.getElementById('currency-btn').textContent = currentCurrency;

  // Load & render
  await refreshList();

  // Setup event listeners
  setupEventListeners();

  // Online/offline
  window.addEventListener('online', () => showOfflineBanner(false));
  window.addEventListener('offline', () => showOfflineBanner(true));
  if (!navigator.onLine) showOfflineBanner(true);
}

async function refreshList() {
  allExpenses = await getAllExpenses();
  renderExpenseList(allExpenses);
  renderSummary(allExpenses);
}

function navigateBack() {
  const addView = document.getElementById('add-view');
  const detailView = document.getElementById('detail-view');
  const summaryView = document.getElementById('summary-view');

  if (!addView.classList.contains('hidden') || !detailView.classList.contains('hidden')) {
    showView('list');
    resetForm();
  } else if (!summaryView.classList.contains('hidden')) {
    showView('list');
  } else {
    tg?.close();
  }
}

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showView(btn.dataset.view);
      if (btn.dataset.view === 'summary') {
        renderSummary(allExpenses);
      }
    });
  });

  // Search
  const searchInput = document.getElementById('search-input');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentFilter.search = searchInput.value.trim();
      renderExpenseList(allExpenses);
    }, 200);
  });

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      if (currentFilter.category === cat) {
        currentFilter.category = '';
        chip.classList.remove('active');
      } else {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        currentFilter.category = cat;
        chip.classList.add('active');
      }
      renderExpenseList(allExpenses);
    });
  });

  // Category picker in form
  document.querySelectorAll('.category-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.category-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      document.getElementById('input-category').value = opt.dataset.cat;
    });
  });

  // Save form
  document.getElementById('btn-save').addEventListener('click', handleSave);

  // Delete from form
  document.getElementById('btn-delete-form').addEventListener('click', handleDeleteFromForm);

  // Detail actions
  document.getElementById('btn-edit').addEventListener('click', async () => {
    if (!editingId) return;
    const expense = await getExpense(editingId);
    if (!expense) return;
    resetForm();
    populateEditForm(expense);
    // Select category in grid
    document.querySelectorAll('.category-option').forEach(o => {
      o.classList.toggle('selected', o.dataset.cat === expense.category);
    });
    showView('add');
  });

  document.getElementById('btn-delete').addEventListener('click', handleDelete);

  // Currency toggle
  document.getElementById('currency-btn').addEventListener('click', async () => {
    const currencies = ['ETB', 'USD', 'EUR', 'GBP'];
    const idx = currencies.indexOf(currentCurrency);
    currentCurrency = currencies[(idx + 1) % currencies.length];
    document.getElementById('currency-btn').textContent = currentCurrency;
    await setConfig({ currency: currentCurrency });
    renderExpenseList(allExpenses);
    renderSummary(allExpenses);
  });

  // Add button (non-Telegram fallback)
  const addBtn = document.getElementById('add-fab');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      resetForm();
      showView('add');
    });
  }
}

async function handleSave() {
  const amountEl = document.getElementById('input-amount');
  const amount = parseFloat(amountEl.value);

  if (!amount || amount <= 0) {
    amountEl.style.borderColor = 'var(--destructive)';
    amountEl.focus();
    haptic('error');
    setTimeout(() => { amountEl.style.borderColor = ''; }, 1500);
    return;
  }

  const category = document.getElementById('input-category').value;
  const note = document.getElementById('input-note').value.trim();

  try {
    if (editingId) {
      await updateExpense({ id: editingId, amount, category, note });
    } else {
      await addExpense({ amount, category, note });
    }
    haptic('success');
    resetForm();
    await refreshList();
    showView('list');
  } catch (e) {
    console.error('Save failed:', e);
    haptic('error');
  }
}

async function handleDelete() {
  if (!editingId) return;
  try {
    await deleteExpense(editingId);
    haptic('success');
    editingId = null;
    await refreshList();
    showView('list');
  } catch (e) {
    console.error('Delete failed:', e);
    haptic('error');
  }
}

async function handleDeleteFromForm() {
  if (!editingId) return;
  await handleDelete();
  resetForm();
}

function haptic(type) {
  const hf = tg?.HapticFeedback;
  if (!hf) return;
  if (type === 'success') {
    hf.notificationOccurred('success');
  } else if (type === 'error') {
    hf.notificationOccurred('error');
  } else {
    hf.impactOccurred('light');
  }
}

// Init on load
document.addEventListener('DOMContentLoaded', init);
