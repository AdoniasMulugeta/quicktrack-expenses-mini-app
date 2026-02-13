// app.js — Core logic + Telegram SDK integration

let tg = null;
let currentGroupId = null;
let currentGroupData = null;

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

  // Handle deep link for group join
  handleDeepLink();
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
  const createGroupView = document.getElementById('create-group-view');
  const groupDetailView = document.getElementById('group-detail-view');
  const addGroupExpenseView = document.getElementById('add-group-expense-view');
  const joinGroupView = document.getElementById('join-group-view');

  if (!addGroupExpenseView.classList.contains('hidden')) {
    showView('group-detail');
  } else if (!groupDetailView.classList.contains('hidden')) {
    currentGroupId = null;
    currentGroupData = null;
    showView('groups');
  } else if (!createGroupView.classList.contains('hidden') || !joinGroupView.classList.contains('hidden')) {
    showView('groups');
  } else if (!addView.classList.contains('hidden') || !detailView.classList.contains('hidden')) {
    showView('list');
    resetForm();
  } else if (!summaryView.classList.contains('hidden') || !document.getElementById('groups-view').classList.contains('hidden')) {
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
      if (btn.dataset.view === 'groups') {
        loadGroups();
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

  // Category picker in personal expense form
  document.querySelectorAll('#add-view .category-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#add-view .category-option').forEach(o => o.classList.remove('selected'));
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
    document.querySelectorAll('#add-view .category-option').forEach(o => {
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

  // --- Group event listeners ---

  // Create group button
  document.getElementById('btn-create-group').addEventListener('click', () => {
    document.getElementById('input-group-name').value = '';
    showView('create-group');
  });

  // Save new group
  document.getElementById('btn-save-group').addEventListener('click', handleCreateGroup);

  // Share invite link
  document.getElementById('btn-share-invite').addEventListener('click', handleShareInvite);

  // Add group expense button
  document.getElementById('btn-add-group-expense').addEventListener('click', () => {
    resetGroupExpenseForm();
    showView('add-group-expense');
  });

  // Group expense category picker
  document.querySelectorAll('#group-category-grid .category-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#group-category-grid .category-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      document.getElementById('input-group-category').value = opt.dataset.cat;
    });
  });

  // Save group expense
  document.getElementById('btn-save-group-expense').addEventListener('click', handleSaveGroupExpense);

  // Delete group
  document.getElementById('btn-delete-group').addEventListener('click', handleDeleteGroup);

  // Join group
  document.getElementById('btn-confirm-join').addEventListener('click', handleConfirmJoin);
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

// --- Group API client ---

function getAuthHeader() {
  return tg?.initData || '';
}

async function apiCall(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuthHeader(),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'API error');
  }
  return data;
}

async function fetchGroups() {
  return apiCall('/api/groups');
}

async function createGroup(name) {
  return apiCall('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

async function fetchGroupDetail(groupId) {
  return apiCall(`/api/groups/${encodeURIComponent(groupId)}`);
}

async function deleteGroupApi(groupId) {
  return apiCall(`/api/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
}

async function addGroupExpense(groupId, expense) {
  return apiCall(`/api/groups/${encodeURIComponent(groupId)}/expenses`, {
    method: 'POST',
    body: JSON.stringify(expense)
  });
}

async function joinGroupApi(groupId, inviteCode) {
  return apiCall(`/api/groups/${encodeURIComponent(groupId)}/join?invite=${encodeURIComponent(inviteCode)}`, {
    method: 'POST'
  });
}

// --- Group handlers ---

async function loadGroups() {
  showGroupLoading('group-list');
  document.getElementById('groups-empty').classList.add('hidden');
  try {
    const data = await fetchGroups();
    renderGroupList(data.groups || []);
  } catch (e) {
    console.error('Failed to load groups:', e);
    document.getElementById('group-list').innerHTML =
      '<div class="loading">Failed to load groups</div>';
  }
}

async function openGroupDetail(groupId) {
  currentGroupId = groupId;
  showView('group-detail');
  showGroupLoading('group-expense-list');
  document.getElementById('group-expenses-empty').classList.add('hidden');
  document.getElementById('group-detail-name').textContent = 'Loading...';
  document.getElementById('group-members').innerHTML = '';

  try {
    const data = await fetchGroupDetail(groupId);
    currentGroupData = data.group;
    renderGroupDetail(data.group, data.members, data.expenses);
  } catch (e) {
    console.error('Failed to load group:', e);
    document.getElementById('group-detail-name').textContent = 'Error';
    document.getElementById('group-expense-list').innerHTML =
      '<div class="loading">Failed to load group</div>';
  }
}

async function handleCreateGroup() {
  const nameInput = document.getElementById('input-group-name');
  const name = nameInput.value.trim();

  if (!name) {
    nameInput.style.borderColor = 'var(--destructive)';
    nameInput.focus();
    haptic('error');
    setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
    return;
  }

  try {
    await createGroup(name);
    haptic('success');
    showView('groups');
    loadGroups();
  } catch (e) {
    console.error('Create group failed:', e);
    haptic('error');
  }
}

function handleShareInvite() {
  if (!currentGroupData) return;

  const botUsername = tg?.initDataUnsafe?.bot?.username;
  const inviteCode = currentGroupData.inviteCode;
  const groupId = currentGroupData.id;

  // Build the invite deep link
  const link = botUsername
    ? `https://t.me/${botUsername}?startapp=join_${groupId}_${inviteCode}`
    : `${window.location.origin}?join=${groupId}_${inviteCode}`;

  // Try native share, fall back to clipboard
  if (navigator.share) {
    navigator.share({
      title: `Join "${currentGroupData.name}" on QuickTrack`,
      text: `Join my expense group "${currentGroupData.name}"`,
      url: link
    }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(() => {
      haptic('success');
      const btn = document.getElementById('btn-share-invite');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => {});
  }
}

async function handleSaveGroupExpense() {
  if (!currentGroupId) return;

  const amountEl = document.getElementById('input-group-amount');
  const amount = parseFloat(amountEl.value);

  if (!amount || amount <= 0) {
    amountEl.style.borderColor = 'var(--destructive)';
    amountEl.focus();
    haptic('error');
    setTimeout(() => { amountEl.style.borderColor = ''; }, 1500);
    return;
  }

  const category = document.getElementById('input-group-category').value;
  const note = document.getElementById('input-group-note').value.trim();

  try {
    await addGroupExpense(currentGroupId, { amount, category, note });
    haptic('success');
    resetGroupExpenseForm();
    // Refresh group detail
    openGroupDetail(currentGroupId);
  } catch (e) {
    console.error('Add group expense failed:', e);
    haptic('error');
  }
}

function resetGroupExpenseForm() {
  document.getElementById('input-group-amount').value = '';
  document.getElementById('input-group-category').value = 'food';
  document.getElementById('input-group-note').value = '';
  document.getElementById('group-form-currency').textContent = currentCurrency;
  document.getElementById('group-expense-form-title').textContent = 'Add Group Expense';
  document.querySelectorAll('#group-category-grid .category-option').forEach(o => {
    o.classList.toggle('selected', o.dataset.cat === 'food');
  });
}

async function handleDeleteGroup() {
  if (!currentGroupId) return;
  try {
    await deleteGroupApi(currentGroupId);
    haptic('success');
    currentGroupId = null;
    currentGroupData = null;
    showView('groups');
    loadGroups();
  } catch (e) {
    console.error('Delete group failed:', e);
    haptic('error');
  }
}

// --- Deep link handling ---

let pendingJoin = null;

function handleDeepLink() {
  // Telegram deep link: startapp=join_{groupId}_{inviteCode}
  const startParam = tg?.initDataUnsafe?.start_param;
  if (startParam && startParam.startsWith('join_')) {
    const parts = startParam.slice(5).split('_');
    if (parts.length >= 2) {
      const groupId = parts[0];
      const inviteCode = parts.slice(1).join('_');
      pendingJoin = { groupId, inviteCode };
      showView('join-group');
      document.getElementById('join-group-title').textContent = 'Join Group';
      document.getElementById('join-group-desc').textContent = 'You\'ve been invited to join a group';
      return;
    }
  }

  // URL param fallback: ?join={groupId}_{inviteCode}
  const urlParams = new URLSearchParams(window.location.search);
  const joinParam = urlParams.get('join');
  if (joinParam) {
    const parts = joinParam.split('_');
    if (parts.length >= 2) {
      const groupId = parts[0];
      const inviteCode = parts.slice(1).join('_');
      pendingJoin = { groupId, inviteCode };
      showView('join-group');
      return;
    }
  }
}

async function handleConfirmJoin() {
  if (!pendingJoin) return;

  const btn = document.getElementById('btn-confirm-join');
  btn.textContent = 'Joining...';
  btn.disabled = true;

  try {
    const data = await joinGroupApi(pendingJoin.groupId, pendingJoin.inviteCode);
    haptic('success');
    pendingJoin = null;
    // Clear URL params
    if (window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    // Navigate to the group
    currentGroupId = data.group.id;
    showView('groups');
    loadGroups();
    // Then open the group detail
    setTimeout(() => openGroupDetail(data.group.id), 500);
  } catch (e) {
    console.error('Join failed:', e);
    haptic('error');
    document.getElementById('join-group-desc').textContent = 'Failed to join group. The invite may be invalid.';
  } finally {
    btn.textContent = 'Join Group';
    btn.disabled = false;
  }
}

// Init on load
document.addEventListener('DOMContentLoaded', init);
