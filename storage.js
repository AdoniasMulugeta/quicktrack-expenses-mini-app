// storage.js — IndexedDB wrapper + Telegram CloudStorage sync

const DB_NAME = 'quicktrack';
const DB_VERSION = 1;
const STORE_NAME = 'expenses';
const CLOUD_KEY = 'expenses_v1';
const CONFIG_KEY = 'config_v1';
const MAX_ENTRIES = 500;
const MAX_AGE_DAYS = 90;

let db = null;
let syncQueue = [];
let userId = '';

function setUserId(id) {
  userId = id || 'default';
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        const store = d.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('category', 'category', { unique: false });
      }
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode) {
  const t = db.transaction(STORE_NAME, mode);
  return t.objectStore(STORE_NAME);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function addExpense(expense) {
  return new Promise((resolve, reject) => {
    const e = {
      id: generateId(),
      amount: parseFloat(expense.amount),
      category: expense.category || 'other',
      note: (expense.note || '').slice(0, 100),
      timestamp: expense.timestamp || new Date().toISOString(),
      version: 1
    };
    const req = tx('readwrite').put(e);
    req.onsuccess = () => {
      queueSync();
      resolve(e);
    };
    req.onerror = () => reject(req.error);
  });
}

function updateExpense(expense) {
  return new Promise((resolve, reject) => {
    const store = tx('readwrite');
    const getReq = store.get(expense.id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) return reject(new Error('Not found'));
      const updated = {
        ...existing,
        amount: parseFloat(expense.amount),
        category: expense.category,
        note: (expense.note || '').slice(0, 100),
        timestamp: expense.timestamp || existing.timestamp,
        version: (existing.version || 0) + 1
      };
      // Need new transaction since we can't reuse across async boundaries
      const req2 = tx('readwrite').put(updated);
      req2.onsuccess = () => {
        queueSync();
        resolve(updated);
      };
      req2.onerror = () => reject(req2.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

function deleteExpense(id) {
  return new Promise((resolve, reject) => {
    const req = tx('readwrite').delete(id);
    req.onsuccess = () => {
      queueSync();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

function getExpense(id) {
  return new Promise((resolve, reject) => {
    const req = tx('readonly').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllExpenses() {
  return new Promise((resolve, reject) => {
    const req = tx('readonly').index('timestamp').openCursor(null, 'prev');
    const results = [];
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function pruneOldExpenses(expenses) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  return expenses.filter(e => new Date(e.timestamp).getTime() > cutoff).slice(0, MAX_ENTRIES);
}

// --- Telegram CloudStorage sync ---

function getCloudStorage() {
  return window.Telegram?.WebApp?.CloudStorage || null;
}

function cloudGet(key) {
  return new Promise((resolve) => {
    const cs = getCloudStorage();
    if (!cs) return resolve(null);
    cs.getItem(key, (err, val) => {
      if (err || !val) return resolve(null);
      try { resolve(JSON.parse(val)); } catch { resolve(null); }
    });
  });
}

function cloudSet(key, data) {
  return new Promise((resolve) => {
    const cs = getCloudStorage();
    if (!cs) return resolve(false);
    const str = JSON.stringify(data);
    // CloudStorage value limit is ~4096 bytes per key
    // Split if needed, but for MVP keep it simple
    if (str.length > 4000) {
      // Store only the most recent entries that fit
      const trimmed = data.slice(0, Math.floor(data.length * 0.7));
      cs.setItem(key, JSON.stringify(trimmed), (err) => resolve(!err));
    } else {
      cs.setItem(key, str, (err) => resolve(!err));
    }
  });
}

function queueSync() {
  if (syncQueue.length === 0) {
    syncQueue.push(Date.now());
    setTimeout(flushSync, 2000);
  }
}

async function flushSync() {
  syncQueue = [];
  if (!navigator.onLine) return;
  try {
    const expenses = await getAllExpenses();
    const pruned = pruneOldExpenses(expenses);
    await cloudSet(CLOUD_KEY, pruned);
  } catch (e) {
    console.warn('Sync failed:', e);
  }
}

async function loadFromCloud() {
  const cloudData = await cloudGet(CLOUD_KEY);
  if (!cloudData || !Array.isArray(cloudData) || cloudData.length === 0) return false;

  const localExpenses = await getAllExpenses();
  if (localExpenses.length > 0) return false; // Local has data, skip

  // Populate IndexedDB from cloud
  return new Promise((resolve, reject) => {
    const store = tx('readwrite');
    let count = 0;
    cloudData.forEach(e => {
      const req = store.put(e);
      req.onsuccess = () => {
        count++;
        if (count === cloudData.length) resolve(true);
      };
      req.onerror = () => {
        count++;
        if (count === cloudData.length) resolve(true);
      };
    });
  });
}

// Config (currency preference)
async function getConfig() {
  const cloud = await cloudGet(CONFIG_KEY);
  if (cloud) return cloud;
  const local = localStorage.getItem(CONFIG_KEY);
  return local ? JSON.parse(local) : { currency: 'ETB' };
}

async function setConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  await cloudSet(CONFIG_KEY, config);
}

async function initStorage() {
  await openDB();
  await loadFromCloud();
}

// Listen for online to flush
window.addEventListener('online', flushSync);
