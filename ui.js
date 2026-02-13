// ui.js — DOM manipulation + Canvas pie chart

const CATEGORIES = {
  food: { label: 'Food', color: '#34C759', icon: '🍔' },
  transport: { label: 'Transport', color: '#007AFF', icon: '🚌' },
  bills: { label: 'Bills', color: '#FF9500', icon: '📄' },
  other: { label: 'Other', color: '#AF52DE', icon: '📦' }
};

let currentFilter = { category: '', search: '' };
let allExpenses = [];
let editingId = null;
let currentCurrency = 'ETB';

function formatAmount(amount) {
  return new Intl.NumberFormat('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return 'Today ' + d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 172800000) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.getDate() === yesterday.getDate()) {
      return 'Yesterday ' + d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    }
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
}

function renderExpenseList(expenses) {
  const list = document.getElementById('expense-list');
  const empty = document.getElementById('empty-state');

  let filtered = expenses;
  if (currentFilter.category) {
    filtered = filtered.filter(e => e.category === currentFilter.category);
  }
  if (currentFilter.search) {
    const q = currentFilter.search.toLowerCase();
    filtered = filtered.filter(e =>
      (e.note || '').toLowerCase().includes(q) ||
      CATEGORIES[e.category].label.toLowerCase().includes(q)
    );
  }

  // Show only recent 30
  const shown = filtered.slice(0, 30);

  if (shown.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = shown.map(e => {
    const cat = CATEGORIES[e.category] || CATEGORIES.other;
    return `
      <div class="expense-card" data-id="${e.id}">
        <div class="expense-left">
          <span class="expense-icon">${cat.icon}</span>
          <div class="expense-info">
            <div class="expense-cat-row">
              <span class="cat-badge" style="background:${cat.color}20;color:${cat.color}">${cat.label}</span>
              ${e.note ? `<span class="expense-note">${escapeHtml(e.note)}</span>` : ''}
            </div>
            <span class="expense-date">${formatDate(e.timestamp)}</span>
          </div>
        </div>
        <div class="expense-right">
          <span class="expense-amount">-${formatAmount(e.amount)}</span>
          <span class="expense-currency">${currentCurrency}</span>
        </div>
      </div>
    `;
  }).join('');

  // Attach click handlers for edit
  list.querySelectorAll('.expense-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      showExpenseDetail(id);
    });
  });
}

function showExpenseDetail(id) {
  const expense = allExpenses.find(e => e.id === id);
  if (!expense) return;

  editingId = id;
  const cat = CATEGORIES[expense.category];

  const detail = document.getElementById('detail-view');
  document.getElementById('detail-icon').textContent = cat.icon;
  document.getElementById('detail-amount').textContent = `${formatAmount(expense.amount)} ${currentCurrency}`;
  document.getElementById('detail-category').textContent = cat.label;
  document.getElementById('detail-category').style.color = cat.color;
  document.getElementById('detail-note').textContent = expense.note || 'No note';
  document.getElementById('detail-date').textContent = new Date(expense.timestamp).toLocaleString('en', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  showView('detail');
}

function renderSummary(expenses) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthExpenses = expenses.filter(e => new Date(e.timestamp) >= monthStart);

  const total = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const avgDaily = daysPassed > 0 ? total / daysPassed : 0;

  document.getElementById('summary-total').textContent = `${formatAmount(total)} ${currentCurrency}`;
  document.getElementById('summary-avg').textContent = `${formatAmount(avgDaily)} ${currentCurrency}/day`;
  document.getElementById('summary-count').textContent = `${monthExpenses.length} expenses`;

  // Category breakdown
  const byCategory = {};
  monthExpenses.forEach(e => {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  });

  renderPieChart(byCategory, total);
  renderCategoryBreakdown(byCategory, total);

  // Footer summary
  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  const footer = document.getElementById('summary-footer');
  if (topCat && total > 0) {
    const pct = Math.round((topCat[1] / total) * 100);
    footer.textContent = `This month: ${formatAmount(total)} ${currentCurrency} | ${CATEGORIES[topCat[0]].label} ${pct}%`;
  } else {
    footer.textContent = 'No expenses this month';
  }
}

function renderPieChart(byCategory, total) {
  const canvas = document.getElementById('pie-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;

  ctx.clearRect(0, 0, size, size);

  if (total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e0e0e0';
    ctx.fill();
    ctx.fillStyle = '#999';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', cx, cy + 5);
    return;
  }

  let startAngle = -Math.PI / 2;
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  entries.forEach(([cat, amount]) => {
    const slice = (amount / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle = CATEGORIES[cat]?.color || '#999';
    ctx.fill();
    startAngle += slice;
  });

  // Center hole for donut
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim() || '#fff';
  ctx.fill();

  // Center text
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#000';
  ctx.font = 'bold 16px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(formatAmount(total), cx, cy - 2);
  ctx.font = '11px -apple-system, sans-serif';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--hint-color').trim() || '#999';
  ctx.fillText(currentCurrency, cx, cy + 14);
}

function renderCategoryBreakdown(byCategory, total) {
  const container = document.getElementById('category-breakdown');
  if (!container) return;

  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  container.innerHTML = entries.map(([cat, amount]) => {
    const c = CATEGORIES[cat] || CATEGORIES.other;
    const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
    return `
      <div class="breakdown-row">
        <span class="breakdown-icon">${c.icon}</span>
        <span class="breakdown-label">${c.label}</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar" style="width:${pct}%;background:${c.color}"></div>
        </div>
        <span class="breakdown-pct">${pct}%</span>
        <span class="breakdown-amount">${formatAmount(amount)}</span>
      </div>
    `;
  }).join('');
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const view = document.getElementById(`${name}-view`);
  if (view) view.classList.remove('hidden');

  // Tab active state
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  // Telegram BackButton
  const tg = window.Telegram?.WebApp;
  if (name === 'list') {
    tg?.BackButton?.hide();
    tg?.MainButton?.show();
  } else if (name === 'add' || name === 'detail' || name === 'summary') {
    tg?.BackButton?.show();
    if (name !== 'add') tg?.MainButton?.hide();
  }
}

function populateEditForm(expense) {
  document.getElementById('input-amount').value = expense.amount;
  document.getElementById('input-category').value = expense.category;
  document.getElementById('input-note').value = expense.note || '';
  document.getElementById('form-title').textContent = 'Edit Expense';
  document.getElementById('btn-save').textContent = 'Update';
  document.getElementById('btn-delete-form').classList.remove('hidden');
  editingId = expense.id;
}

function resetForm() {
  document.getElementById('input-amount').value = '';
  document.getElementById('input-category').value = 'food';
  document.getElementById('input-note').value = '';
  document.getElementById('form-title').textContent = 'Add Expense';
  document.getElementById('btn-save').textContent = 'Save';
  document.getElementById('btn-delete-form').classList.add('hidden');
  editingId = null;
}

function showOfflineBanner(show) {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.classList.toggle('hidden', !show);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
