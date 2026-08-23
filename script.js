/* ============================================================
   AKASH FOOD POINT OS — script.js
   Phase 1: Dashboard · New Order · Menu Management · Close Day
   Storage: raw IndexedDB, offline-first, no dependencies.
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- CONSTANTS ---------------- */
  const DB_NAME = 'afp_os_db';
  const DB_VERSION = 5;
  const STORES = ['categories', 'items', 'orders', 'footfall', 'closings', 'inventory', 'purchases', 'expenses', 'udharPayments', 'settings', 'seasonalPurchases', 'seasonalSales', 'supplierPayments'];

  const todayKey = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  let currencySymbol = '₹'; // overridden from saved Settings after DB loads
  let shopName = 'Akash Food Point';
  // currencySymbol is user-editable (Settings), and rupee()'s output lands in
  // innerHTML in dozens of places — escape it here once rather than at every call site.
  const rupee = (n) => `${escapeHtml(currencySymbol)}${Math.round(n || 0).toLocaleString('en-IN')}`;
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const APP_VERSION = 'v28'; // bump alongside sw.js CACHE_NAME every round — shown in Settings so updates can be verified, not guessed

  // Every render function below builds HTML with template strings for speed and
  // readability. Any value that came from a free-text field the user typed
  // (names, notes, suppliers, custom units/categories) MUST be passed through
  // this before going into innerHTML — otherwise typing something like
  // <img src=x onerror=...> into e.g. a customer name would execute as code
  // the next time that record is displayed.
  const escapeHtml = (val) => String(val ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

  /* ---------------- DB LAYER ---------------- */
  let db;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains('categories')) {
          _db.createObjectStore('categories', { keyPath: 'id' });
        }
        if (!_db.objectStoreNames.contains('items')) {
          const s = _db.createObjectStore('items', { keyPath: 'id' });
          s.createIndex('categoryId', 'categoryId');
        }
        if (!_db.objectStoreNames.contains('orders')) {
          const s = _db.createObjectStore('orders', { keyPath: 'id' });
          s.createIndex('dateKey', 'dateKey');
        }
        if (!_db.objectStoreNames.contains('footfall')) {
          _db.createObjectStore('footfall', { keyPath: 'dateKey' });
        }
        if (!_db.objectStoreNames.contains('closings')) {
          _db.createObjectStore('closings', { keyPath: 'dateKey' });
        }
        if (!_db.objectStoreNames.contains('inventory')) {
          _db.createObjectStore('inventory', { keyPath: 'id' });
        }
        if (!_db.objectStoreNames.contains('purchases')) {
          const s = _db.createObjectStore('purchases', { keyPath: 'id' });
          s.createIndex('dateKey', 'dateKey');
        }
        if (!_db.objectStoreNames.contains('expenses')) {
          const s = _db.createObjectStore('expenses', { keyPath: 'id' });
          s.createIndex('dateKey', 'dateKey');
        }
        if (!_db.objectStoreNames.contains('udharPayments')) {
          const s = _db.createObjectStore('udharPayments', { keyPath: 'id' });
          s.createIndex('customerKey', 'customerKey');
        }
        if (!_db.objectStoreNames.contains('settings')) {
          _db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!_db.objectStoreNames.contains('seasonalPurchases')) {
          const s = _db.createObjectStore('seasonalPurchases', { keyPath: 'id' });
          s.createIndex('dateKey', 'dateKey');
        }
        if (!_db.objectStoreNames.contains('seasonalSales')) {
          const s = _db.createObjectStore('seasonalSales', { keyPath: 'id' });
          s.createIndex('dateKey', 'dateKey');
        }
        if (!_db.objectStoreNames.contains('supplierPayments')) {
          const s = _db.createObjectStore('supplierPayments', { keyPath: 'id' });
          s.createIndex('supplierKey', 'supplierKey');
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return db.transaction(store, mode).objectStore(store);
  }

  function dbGetAll(store, indexName, query) {
    return new Promise((resolve, reject) => {
      const source = indexName ? tx(store).index(indexName) : tx(store);
      const req = query !== undefined ? source.getAll(query) : source.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function dbGet(store, key) {
    return new Promise((resolve, reject) => {
      const req = tx(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function dbPut(store, value) {
    return new Promise((resolve, reject) => {
      const req = tx(store, 'readwrite').put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function dbDelete(store, key) {
    return new Promise((resolve, reject) => {
      const req = tx(store, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function dbClear(store) {
    return new Promise((resolve, reject) => {
      const req = tx(store, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /* ---------------- SEED DATA (placeholder — edit/delete freely in Menu tab) ---------------- */
  async function seedIfEmpty() {
    const existing = await dbGetAll('categories');
    if (!existing.length) {
      const categories = ['Burger', 'Noodles', 'Momos', 'Manchurian', 'Drinks', 'Sides'];
      const catRecords = categories.map((name) => ({ id: uid(), name }));
      for (const c of catRecords) await dbPut('categories', c);

      const byName = Object.fromEntries(catRecords.map((c) => [c.name, c.id]));
      const sampleItems = [
        { name: 'Veg Burger', cat: 'Burger', offlinePrice: 60, onlinePrice: 79, foodCost: 22, packagingCost: 4 },
        { name: 'Paneer Burger', cat: 'Burger', offlinePrice: 80, onlinePrice: 99, foodCost: 32, packagingCost: 4 },
        {
          name: 'Veg Noodles', cat: 'Noodles', offlinePrice: 70, onlinePrice: 89, foodCost: 26, packagingCost: 5,
          hasHalf: true, halfOfflinePrice: 45, halfOnlinePrice: 59, halfFoodCost: 15, halfPackagingCost: 3,
        },
        {
          name: 'Veg Momos (8 pcs)', cat: 'Momos', offlinePrice: 60, onlinePrice: 79, foodCost: 20, packagingCost: 5,
          hasHalf: true, halfOfflinePrice: 35, halfOnlinePrice: 45, halfFoodCost: 11, halfPackagingCost: 3,
        },
        { name: 'Veg Manchurian', cat: 'Manchurian', offlinePrice: 90, onlinePrice: 109, foodCost: 30, packagingCost: 6 },
        { name: 'Cold Drink (250ml)', cat: 'Drinks', offlinePrice: 20, onlinePrice: 25, foodCost: 14, packagingCost: 0 },
        { name: 'French Fries', cat: 'Sides', offlinePrice: 50, onlinePrice: 65, foodCost: 18, packagingCost: 4 },
      ];
      for (const it of sampleItems) {
        await dbPut('items', {
          id: uid(),
          name: it.name,
          categoryId: byName[it.cat],
          hasHalf: !!it.hasHalf,
          offlinePrice: it.offlinePrice,
          onlinePrice: it.onlinePrice,
          foodCost: it.foodCost,
          packagingCost: it.packagingCost,
          halfOfflinePrice: it.halfOfflinePrice || 0,
          halfOnlinePrice: it.halfOnlinePrice || 0,
          halfFoodCost: it.halfFoodCost || 0,
          halfPackagingCost: it.halfPackagingCost || 0,
          available: true,
        });
      }
    }

    // Seed common raw-material inventory items so Purchase Entry isn't empty on first use.
    // Checked independently of categories above — otherwise this silently never runs
    // for anyone who already had categories before this feature was added.
    const existingInv = await dbGetAll('inventory');
    if (!existingInv.length) {
      const sampleInventory = [
        { name: 'Burger Buns', unit: 'dozen', currentStock: 0, minStock: 2, purchaseCost: 60 },
        { name: 'Noodles Pack', unit: 'pkt', currentStock: 0, minStock: 3, purchaseCost: 55 },
        { name: 'Mixed Vegetables', unit: 'kg', currentStock: 0, minStock: 3, purchaseCost: 35 },
        { name: 'Cooking Oil', unit: 'l', currentStock: 0, minStock: 2, purchaseCost: 150 },
        { name: 'Paneer', unit: 'kg', currentStock: 0, minStock: 1, purchaseCost: 320 },
        { name: 'Cheese Slices', unit: 'pkt', currentStock: 0, minStock: 2, purchaseCost: 90 },
        { name: 'Packaging Boxes', unit: 'pcs', currentStock: 0, minStock: 20, purchaseCost: 3 },
      ];
      for (const inv of sampleInventory) {
        await dbPut('inventory', { id: uid(), supplier: '', ...inv });
      }
    }
  }

  /* ---------------- STATE ---------------- */
  const state = {
    view: 'dashboard',
    categories: [],
    items: [],
    activeMenuCategory: 'all',
    activeMgmtCategory: 'all',
    cart: {}, // itemId -> qty
    source: 'Offline',
    payment: 'Cash',
    editingItemId: null,
    todayFootfall: { count: 0, buying: 0 },
    todayOrders: [],
    inventory: [],
    activeMoreSub: 'inventory',
    activePurchasePeriod: 'today',
    seasonalMode: 'purchase',
    lastCartGrand: null,
    discountMode: 'discount',
    editingOrderId: null,
    editingOrderSnapshot: null,
    editingExpenseId: null,
    editingPurchaseId: null,
    editingSeasonalPurchaseId: null,
    editingSeasonalSaleId: null,
    editingClosingDate: null,
    printMode: 'offline',
    editingInventoryId: null,
    recipeDraft: [], // [{inventoryId, qty}] while editing an item
    portionsDraft: [], // [{id, label, offlinePrice, onlinePrice, foodCost, recipeFactor}] extra portions while editing an item
    activeCustomerKey: null,
    allOrders: [],
    allExpenses: [],
    allPurchases: [],
  };

  const customerKeyOf = (o) => (o.mobile && o.mobile.trim()) || (o.customerName && o.customerName.trim().toLowerCase()) || null;

  /* ---------------- TOAST ---------------- */
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // Quick "it just changed" cue on a number — footfall count, cart total, etc.
  // Restarts cleanly even if called again before the previous pulse finished.
  function pulse(el) {
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth; // force reflow so the animation restarts instead of no-op'ing
    el.classList.add('pulse');
  }

  /* ---------------- NAVIGATION ---------------- */
  function setView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach((v) => {
      v.hidden = v.dataset.view !== view;
    });
    document.querySelectorAll('.tabbar__btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    if (view === 'dashboard') renderDashboard();
    if (view === 'order') renderOrderView();
    if (view === 'menu') renderMenuManagement();
    if (view === 'more') renderMoreView();
    if (view === 'close') renderCloseDay();
  }

  /* ---------------- DATA REFRESH ---------------- */
  async function refreshCategoriesAndItems() {
    state.categories = await dbGetAll('categories');
    state.items = await dbGetAll('items');
  }

  async function loadTodayFootfall() {
    const rec = await dbGet('footfall', todayKey());
    state.todayFootfall = rec || { dateKey: todayKey(), count: 0, buying: 0 };
  }

  async function loadTodayOrders() {
    state.todayOrders = await dbGetAll('orders', 'dateKey', todayKey());
    state.todayOrders.sort((a, b) => b.timestamp - a.timestamp);
  }

  async function refreshInventory() {
    state.inventory = await dbGetAll('inventory');
  }

  async function loadTodayExpensesAndPurchases() {
    const [exp, pur] = await Promise.all([
      dbGetAll('expenses', 'dateKey', todayKey()),
      dbGetAll('purchases', 'dateKey', todayKey()),
    ]);
    return { exp, pur };
  }

  async function loadAllOrdersAndPayments() {
    state.allOrders = await dbGetAll('orders');
    state.allPayments = await dbGetAll('udharPayments');
  }

  // Loads everything the Udhar report needs — both businesses, both directions.
  async function loadAllCreditData() {
    await loadAllOrdersAndPayments();
    const [seasonalSales, purchases, seasonalPurchases, supplierPayments] = await Promise.all([
      dbGetAll('seasonalSales'),
      dbGetAll('purchases'),
      dbGetAll('seasonalPurchases'),
      dbGetAll('supplierPayments'),
    ]);
    state.allSeasonalSales = seasonalSales;
    state.allPurchases = purchases;
    state.allSeasonalPurchases = seasonalPurchases;
    state.allSupplierPayments = supplierPayments;
  }

  function lowStockItems() {
    return state.inventory.filter((i) => (i.currentStock || 0) <= (i.minStock || 0));
  }

  /* ---------------- DASHBOARD ---------------- */
  async function renderDashboard() {
    await loadTodayFootfall();
    await loadTodayOrders();
    await refreshCategoriesAndItems();
    await refreshInventory();
    const { exp, pur } = await loadTodayExpensesAndPurchases();
    await loadAllOrdersAndPayments();

    document.getElementById('footfallCount').textContent = state.todayFootfall.count;
    document.getElementById('footfallBuying').textContent = state.todayFootfall.buying;
    const conv = state.todayFootfall.count
      ? Math.round((state.todayFootfall.buying / state.todayFootfall.count) * 100)
      : 0;
    document.getElementById('footfallConv').textContent = `${conv}%`;

    const sales = state.todayOrders.reduce((s, o) => s + o.grandTotal, 0);
    const rawProfit = state.todayOrders.reduce((s, o) => s + o.profit, 0);
    const cash = state.todayOrders.filter((o) => o.payment === 'Cash').reduce((s, o) => s + o.grandTotal, 0);
    const upi = state.todayOrders.filter((o) => o.payment === 'UPI').reduce((s, o) => s + o.grandTotal, 0);
    const aov = state.todayOrders.length ? sales / state.todayOrders.length : 0;
    const expensesTotal = exp.reduce((s, e) => s + e.amount, 0);
    const purchasesTotal = pur.reduce((s, p) => s + p.amount, 0);
    const profit = rawProfit - expensesTotal;
    const lowStock = lowStockItems();

    // Udhar Outstanding = total ever given on credit minus total ever repaid (across all customers, not just today)
    const totalUdharGiven = state.allOrders.filter((o) => o.payment === 'Udhar').reduce((s, o) => s + o.grandTotal, 0);
    const totalUdharPaid = (state.allPayments || []).reduce((s, p) => s + p.amount, 0);
    const udharOutstanding = Math.max(0, totalUdharGiven - totalUdharPaid);

    document.getElementById('statSales').textContent = rupee(sales);
    document.getElementById('statOrders').textContent = state.todayOrders.length;
    document.getElementById('statAOV').textContent = rupee(aov);
    document.getElementById('statProfit').textContent = rupee(profit);
    document.getElementById('statCash').textContent = rupee(cash);
    document.getElementById('statUPI').textContent = rupee(upi);
    document.getElementById('statUdhar').textContent = rupee(udharOutstanding);
    document.getElementById('statExpenses').textContent = rupee(expensesTotal);
    document.getElementById('statPurchases').textContent = rupee(purchasesTotal);
    const lowStockEl = document.getElementById('statLowStock');
    lowStockEl.textContent = lowStock.length ? lowStock.map((i) => i.name).join(', ') : 'None';
    lowStockEl.closest('.stat-card').classList.toggle('stat-card--alert', lowStock.length > 0);

    document.getElementById('ticketTime').textContent = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });

    const list = document.getElementById('recentOrdersList');
    if (!state.todayOrders.length) {
      list.innerHTML = '<div class="order-log__empty">No orders yet today. Tap New Order to start billing.</div>';
    } else {
      list.innerHTML = state.todayOrders.slice(0, 12).map(orderRowHTML).join('');
      list.querySelectorAll('[data-order-id]').forEach((btn) => {
        btn.addEventListener('click', () => openOrderForEdit(btn.dataset.orderId));
      });
      list.querySelectorAll('[data-detail-id]').forEach((btn) => {
        btn.addEventListener('click', () => openOrderDetail(btn.dataset.detailId));
      });
    }
  }

  function orderRowHTML(o) {
    const tagClass = o.payment.toLowerCase();
    const time = new Date(o.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const itemCount = o.items.reduce((s, i) => s + i.qty, 0);
    return `
      <div class="order-row">
        <div class="order-row__left">
          <span class="order-row__name">${o.customerName ? escapeHtml(o.customerName) : 'Walk-in'} · ${itemCount} item${itemCount > 1 ? 's' : ''}</span>
          <span class="order-row__meta">
            <span class="tag tag--${tagClass}">${o.payment}</span>
            <span class="tag">${o.source}</span>
            ${time}
          </span>
        </div>
        <div class="order-row__amount">${rupee(o.grandTotal)}</div>
        <button class="order-row__edit-order" data-detail-id="${o.id}">Details</button>
        <button class="order-row__edit-order" data-order-id="${o.id}">Edit</button>
      </div>`;
  }

  async function bumpFootfall(delta) {
    await loadTodayFootfall();
    const next = Math.max(0, state.todayFootfall.count + delta);
    state.todayFootfall = { ...state.todayFootfall, dateKey: todayKey(), count: next };
    await dbPut('footfall', state.todayFootfall);
    const el = document.getElementById('footfallCount');
    el.textContent = next;
    pulse(el);
  }

  document.getElementById('footfallPlus').addEventListener('click', () => bumpFootfall(1));
  document.getElementById('footfallMinus').addEventListener('click', () => bumpFootfall(-1));

  /* ---------------- NEW ORDER ---------------- */
  const cartKey = (itemId, portionId) => `${itemId}::${portionId}`;
  const parseCartKey = (key) => {
    const idx = key.lastIndexOf('::');
    return { itemId: key.slice(0, idx), size: key.slice(idx + 2) };
  };

  // Custom named portions (Quarter/Half/Full/Piece/anything, each own price) — falls
  // back to the old hasHalf/half* fields for items saved before this existed, so
  // nothing on an existing menu breaks. New items use item.portions directly.
  function getItemPortions(item) {
    if (item.portions && item.portions.length) return item.portions;
    const full = {
      id: 'full', label: 'Full',
      offlinePrice: item.offlinePrice || 0, onlinePrice: item.onlinePrice || 0,
      foodCost: item.foodCost || 0, recipeFactor: 1,
    };
    if (item.hasHalf) {
      const half = {
        id: 'half', label: 'Half',
        offlinePrice: item.halfOfflinePrice || 0, onlinePrice: item.halfOnlinePrice || 0,
        foodCost: item.halfFoodCost || 0, recipeFactor: 0.5,
      };
      return [half, full];
    }
    return [full];
  }
  function findPortion(item, portionId) {
    const portions = getItemPortions(item);
    return portions.find((p) => p.id === portionId) || portions[portions.length - 1];
  }

  function itemPrice(item, portionId = 'full') {
    const p = findPortion(item, portionId);
    return state.source === 'Offline' ? (p.offlinePrice || 0) : (p.onlinePrice || 0);
  }
  function itemUnitCost(item, portionId = 'full') {
    // Per-item toggle now, not hardcoded: chargePackagingOffline/Online default
    // match old behavior (off/on) for items saved before this existed.
    const chargePackaging = state.source === 'Offline'
      ? item.chargePackagingOffline === true
      : item.chargePackagingOnline !== false;
    const p = findPortion(item, portionId);
    return (p.foodCost || 0) + (chargePackaging ? (item.packagingCost || 0) : 0);
  }

  // Deduct recipe ingredients from inventory when an order is completed (Used tracking).
  // Half-size orders deduct half the recipe quantity.
  async function deductInventoryForOrder(orderItems) {
    let touched = false;
    await refreshInventory();
    for (const line of orderItems) {
      const item = state.items.find((i) => i.id === line.itemId);
      if (!item || !item.recipe || !item.recipe.length) continue;
      const factor = findPortion(item, line.size).recipeFactor || 1;
      for (const ing of item.recipe) {
        const invItem = state.inventory.find((i) => i.id === ing.inventoryId);
        if (!invItem) continue;
        // Recipe quantities are entered in the item's Recipe Unit (e.g. piece),
        // but Stock Left is tracked in the Purchase Unit (e.g. dozen) — convert.
        const perPurchase = invItem.unitsPerPurchase || 1;
        const consumedInPurchaseUnits = (ing.qty * line.qty * factor) / perPurchase;
        invItem.currentStock = Math.max(0, (invItem.currentStock || 0) - consumedInPurchaseUnits);
        await dbPut('inventory', invItem);
        touched = true;
      }
    }
    if (touched) await refreshInventory();
  }

  // Puts recipe ingredients back into inventory — used when editing an order,
  // to undo its original deduction before applying the (possibly different) new one.
  async function reverseInventoryForOrder(orderItems) {
    let touched = false;
    await refreshInventory();
    for (const line of orderItems) {
      const item = state.items.find((i) => i.id === line.itemId);
      if (!item || !item.recipe || !item.recipe.length) continue;
      const factor = findPortion(item, line.size).recipeFactor || 1;
      for (const ing of item.recipe) {
        const invItem = state.inventory.find((i) => i.id === ing.inventoryId);
        if (!invItem) continue;
        const perPurchase = invItem.unitsPerPurchase || 1;
        const restoredInPurchaseUnits = (ing.qty * line.qty * factor) / perPurchase;
        invItem.currentStock = (invItem.currentStock || 0) + restoredInPurchaseUnits;
        await dbPut('inventory', invItem);
        touched = true;
      }
    }
    if (touched) await refreshInventory();
  }

  function inventoryRecipeUnit(inv) {
    return inv.hasConversion && inv.recipeUnit ? inv.recipeUnit : inv.unit;
  }
  function inventoryCostPerRecipeUnit(inv) {
    return (inv.purchaseCost || 0) / (inv.unitsPerPurchase || 1);
  }

  function renderCategoryChips() {
    const wrap = document.getElementById('categoryChips');
    const chips = [{ id: 'all', name: 'All' }, ...state.categories];
    wrap.innerHTML = chips.map((c) => `
      <button class="chip ${state.activeMenuCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)}</button>
    `).join('');
    wrap.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeMenuCategory = btn.dataset.cat;
        renderCategoryChips();
        renderMenuGrid();
      });
    });
  }

  function sizeRowHTML(item, portion) {
    const key = cartKey(item.id, portion.id);
    const qty = state.cart[key] || 0;
    const price = itemPrice(item, portion.id);
    const showTag = getItemPortions(item).length > 1;
    return `
      <div class="size-row" data-key="${key}">
        <div class="size-row__info">
          ${showTag ? `<span class="size-row__tag">${escapeHtml(portion.label)}</span>` : ''}
          <span class="size-row__price">${rupee(price)}</span>
        </div>
        <div class="stepper">
          <button type="button" class="stepper__btn stepper__btn--minus" data-key="${key}" data-act="dec" aria-label="Remove one">&minus;</button>
          <span class="stepper__qty">${qty}</span>
          <button type="button" class="stepper__btn stepper__btn--plus" data-key="${key}" data-act="inc" aria-label="Add one">+</button>
        </div>
      </div>`;
  }

  function renderMenuGrid() {
    const grid = document.getElementById('menuGrid');
    let items = state.items;
    if (state.activeMenuCategory !== 'all') {
      items = items.filter((i) => i.categoryId === state.activeMenuCategory);
    }
    if (!items.length) {
      grid.innerHTML = '<div class="empty-hint">No items in this category yet. Add some from the Menu tab.</div>';
      return;
    }
    grid.innerHTML = items.map((item) => {
      const portions = getItemPortions(item);
      const inCart = portions.some((p) => state.cart[cartKey(item.id, p.id)]);
      return `
        <div class="menu-item-card ${inCart ? 'in-cart' : ''} ${item.available ? '' : 'menu-item-card--unavailable'}">
          <div class="menu-item-card__head">
            <span class="menu-item-card__name">${escapeHtml(item.name)}</span>
            <button type="button" class="sold-out-toggle ${item.available ? '' : 'sold-out-toggle--off'}" data-toggle-avail="${item.id}">
              ${item.available ? 'Sold Out' : 'Back In Stock'}
            </button>
          </div>
          ${portions.map((p) => sizeRowHTML(item, p)).join('')}
        </div>`;
    }).join('');

    grid.querySelectorAll('[data-toggle-avail]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.toggleAvail;
        const item = state.items.find((i) => i.id === id);
        if (!item) return;
        item.available = !item.available;
        await dbPut('items', item);
        await refreshCategoriesAndItems();
        renderMenuGrid();
      });
    });

    grid.querySelectorAll('.stepper__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const delta = btn.dataset.act === 'inc' ? 1 : -1;
        const next = (state.cart[key] || 0) + delta;
        if (next <= 0) delete state.cart[key];
        else state.cart[key] = next;
        renderMenuGrid();
        renderCartAndTotals();
      });
    });

    // Long-press anywhere on a size row (not the buttons) to type an exact quantity
    grid.querySelectorAll('.size-row').forEach((row) => {
      let pressTimer;
      const start = () => { pressTimer = setTimeout(() => promptQty(row.dataset.key), 550); };
      const cancel = () => clearTimeout(pressTimer);
      row.addEventListener('touchstart', start);
      row.addEventListener('touchend', cancel);
      row.addEventListener('touchmove', cancel);
      row.addEventListener('mousedown', start);
      row.addEventListener('mouseup', cancel);
      row.addEventListener('mouseleave', cancel);
    });
  }

  function promptQty(key) {
    const { itemId, size } = parseCartKey(key);
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    const current = state.cart[key] || 0;
    const portion = findPortion(item, size); const label = portion.label === 'Full' ? item.name : `${item.name} (${portion.label})`;
    const val = window.prompt(`Set quantity for ${label}`, current);
    if (val === null) return;
    const n = Math.max(0, parseInt(val, 10) || 0);
    if (n === 0) delete state.cart[key];
    else state.cart[key] = n;
    renderMenuGrid();
    renderCartAndTotals();
  }

  // Single source of truth for discount vs received-amount math, used by both the
  // live totals preview and the actual order-save — so they can never disagree.
  function computeDiscountAndGrand(subtotal) {
    if (state.discountMode === 'received') {
      const received = document.getElementById('receivedInput').value;
      if (received === '') return { discount: 0, grand: subtotal };
      const grand = Math.max(0, parseFloat(received) || 0);
      const discount = Math.max(0, subtotal - grand);
      return { discount, grand };
    }
    const discount = Math.max(0, parseInt(document.getElementById('discountInput').value, 10) || 0);
    return { discount, grand: Math.max(0, subtotal - discount) };
  }

  function renderCartAndTotals() {
    const cartList = document.getElementById('cartList');
    const ids = Object.keys(state.cart);
    if (!ids.length) {
      cartList.innerHTML = '<div class="cart-empty">No items added yet. Tap menu items to add.</div>';
    } else {
      cartList.innerHTML = ids.map((key) => {
        const { itemId, size } = parseCartKey(key);
        const item = state.items.find((i) => i.id === itemId);
        if (!item) return '';
        const qty = state.cart[key];
        const portion = findPortion(item, size); const label = portion.label === 'Full' ? item.name : `${item.name} (${portion.label})`;
        return `
          <div class="cart-row" data-key="${key}">
            <span class="cart-row__name">${escapeHtml(label)}</span>
            <span class="cart-row__ctrl">
              <button data-act="dec">−</button>
              <span>${qty}</span>
              <button data-act="inc">+</button>
            </span>
          </div>`;
      }).join('');
      cartList.querySelectorAll('.cart-row').forEach((row) => {
        const key = row.dataset.key;
        row.querySelector('[data-act="inc"]').addEventListener('click', () => {
          state.cart[key] = (state.cart[key] || 0) + 1;
          renderCartAndTotals();
          renderMenuGrid();
        });
        row.querySelector('[data-act="dec"]').addEventListener('click', () => {
          const next = (state.cart[key] || 0) - 1;
          if (next <= 0) delete state.cart[key];
          else state.cart[key] = next;
          renderCartAndTotals();
          renderMenuGrid();
        });
      });
    }

    let subtotal = 0, foodCostTotal = 0, itemCount = 0;
    ids.forEach((key) => {
      const { itemId, size } = parseCartKey(key);
      const item = state.items.find((i) => i.id === itemId);
      if (!item) return;
      const qty = state.cart[key];
      subtotal += itemPrice(item, size) * qty;
      foodCostTotal += itemUnitCost(item, size) * qty;
      itemCount += qty;
    });
    const { discount, grand } = computeDiscountAndGrand(subtotal);
    const profit = grand - foodCostTotal;

    document.getElementById('totalSubtotal').textContent = rupee(subtotal);
    document.getElementById('totalDiscount').textContent = rupee(discount);
    document.getElementById('totalFoodCost').textContent = rupee(foodCostTotal);
    document.getElementById('totalProfit').textContent = rupee(profit);
    document.getElementById('totalGrand').textContent = rupee(grand);
    document.getElementById('ticketSummaryLine').textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''} · ${rupee(grand)}`;
    if (grand !== state.lastCartGrand) {
      pulse(document.getElementById('totalGrand'));
      pulse(document.getElementById('ticketSummaryLine'));
      state.lastCartGrand = grand;
    }
  }

  document.getElementById('discountModeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.discountMode = btn.dataset.mode;
    document.querySelectorAll('#discountModeSeg button').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('discountFieldWrap').hidden = state.discountMode !== 'discount';
    document.getElementById('receivedFieldWrap').hidden = state.discountMode !== 'received';
    renderCartAndTotals();
  });
  document.getElementById('receivedInput').addEventListener('input', renderCartAndTotals);

  function resetOrderForm() {
    state.cart = {};
    state.source = 'Offline';
    state.payment = 'Cash';
    state.discountMode = 'discount';
    state.editingOrderId = null;
    state.editingOrderSnapshot = null;
    document.getElementById('custName').value = '';
    document.getElementById('custMobile').value = '';
    document.getElementById('discountInput').value = '';
    document.getElementById('receivedInput').value = '';
    document.getElementById('discountFieldWrap').hidden = false;
    document.getElementById('receivedFieldWrap').hidden = true;
    document.getElementById('discountEntryWrap').hidden = true;
    document.querySelectorAll('#discountModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'discount'));
    document.querySelectorAll('#sourceSeg button').forEach((b) => b.classList.toggle('active', b.dataset.value === 'Offline'));
    document.querySelectorAll('#paymentSeg button').forEach((b) => b.classList.toggle('active', b.dataset.value === 'Cash'));
    document.getElementById('orderTicketPanel').classList.remove('expanded');
    document.getElementById('editOrderBanner').hidden = true;
    document.getElementById('completeOrderBtn').textContent = 'Complete Order';
  }

  async function openOrderDetail(orderId) {
    const o = await dbGet('orders', orderId);
    if (!o) { toast('Order not found'); return; }
    document.getElementById('orderDetailTitle').textContent =
      `${o.customerName || 'Walk-in'} · ${new Date(o.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    const lines = o.items.map((i) => `
      <div class="close-row"><span>${escapeHtml(i.name)} x${i.qty}</span><span>${rupee(i.price * i.qty)}</span></div>
    `).join('');
    document.getElementById('orderDetailRows').innerHTML = `
      ${lines}
      <div class="close-row"><span>Subtotal</span><span>${rupee(o.subtotal)}</span></div>
      <div class="close-row"><span>Discount</span><span>${rupee(o.discount)}</span></div>
      <div class="close-row"><span>Source</span><span>${escapeHtml(o.source)}</span></div>
      <div class="close-row"><span>Payment</span><span>${escapeHtml(o.payment)}</span></div>
      ${o.mobile ? `<div class="close-row"><span>Mobile</span><span>${escapeHtml(o.mobile)}</span></div>` : ''}
      <div class="close-row close-row--total"><span>Grand Total</span><span>${rupee(o.grandTotal)}</span></div>
    `;
    document.getElementById('orderDetailBackdrop').hidden = false;
  }
  document.getElementById('orderDetailClose').addEventListener('click', () => {
    document.getElementById('orderDetailBackdrop').hidden = true;
  });
  document.getElementById('orderDetailBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'orderDetailBackdrop') document.getElementById('orderDetailBackdrop').hidden = true;
  });

  async function openOrderForEdit(orderId) {
    const order = await dbGet('orders', orderId);
    if (!order) { toast('Order not found'); return; }

    resetOrderForm();
    state.editingOrderId = orderId;
    state.editingOrderSnapshot = order;

    let skippedItems = 0;
    order.items.forEach((line) => {
      const stillExists = state.items.some((i) => i.id === line.itemId);
      if (!stillExists) { skippedItems += 1; return; }
      state.cart[cartKey(line.itemId, line.size || 'full')] = line.qty;
    });

    state.source = order.source;
    state.payment = order.payment;
    document.getElementById('custName').value = order.customerName || '';
    document.getElementById('custMobile').value = order.mobile || '';
    document.getElementById('discountInput').value = order.discount || '';
    document.getElementById('discountEntryWrap').hidden = !(order.source === 'Zomato' || order.source === 'Swiggy');
    document.querySelectorAll('#sourceSeg button').forEach((b) => b.classList.toggle('active', b.dataset.value === order.source));
    document.querySelectorAll('#paymentSeg button').forEach((b) => b.classList.toggle('active', b.dataset.value === order.payment));

    document.getElementById('editOrderBannerText').textContent =
      `Editing ${order.customerName || 'walk-in'}'s order from ${new Date(order.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    document.getElementById('editOrderBanner').hidden = false;
    document.getElementById('completeOrderBtn').textContent = 'Update Order';

    setView('order');
    renderMenuGrid();
    renderCartAndTotals();

    if (skippedItems) {
      toast(`${skippedItems} item${skippedItems > 1 ? 's' : ''} no longer in menu — couldn't load ${skippedItems > 1 ? 'them' : 'it'}`);
    }
  }

  document.getElementById('cancelEditOrderBtn').addEventListener('click', () => {
    resetOrderForm();
    renderMenuGrid();
    renderCartAndTotals();
    setView('dashboard');
  });

  function renderOrderView() {
    renderCategoryChips();
    renderMenuGrid();
    renderCartAndTotals();
  }

  document.getElementById('sourceSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.source = btn.dataset.value;
    document.querySelectorAll('#sourceSeg button').forEach((b) => b.classList.toggle('active', b === btn));

    const isOnline = state.source === 'Zomato' || state.source === 'Swiggy';
    document.getElementById('discountEntryWrap').hidden = !isOnline;
    if (!isOnline) {
      // Offline doesn't use the online-discount workflow — clear it so a stale
      // hidden value can't silently apply to the total.
      state.discountMode = 'discount';
      document.getElementById('discountInput').value = '';
      document.getElementById('receivedInput').value = '';
      document.getElementById('discountFieldWrap').hidden = false;
      document.getElementById('receivedFieldWrap').hidden = true;
      document.querySelectorAll('#discountModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'discount'));
    }

    renderMenuGrid();
    renderCartAndTotals();
  });

  document.getElementById('paymentSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.payment = btn.dataset.value;
    document.querySelectorAll('#paymentSeg button').forEach((b) => b.classList.toggle('active', b === btn));
  });

  document.getElementById('discountInput').addEventListener('input', renderCartAndTotals);

  document.getElementById('ticketHandle').addEventListener('click', () => {
    document.getElementById('orderTicketPanel').classList.toggle('expanded');
  });

  document.getElementById('completeOrderBtn').addEventListener('click', async () => {
    const ids = Object.keys(state.cart);
    if (!ids.length) { toast('Add at least one item'); return; }

    let subtotal = 0, foodCostTotal = 0;
    const orderItems = ids.map((key) => {
      const { itemId, size } = parseCartKey(key);
      const item = state.items.find((i) => i.id === itemId);
      const qty = state.cart[key];
      const price = itemPrice(item, size);
      const unitFoodCost = itemUnitCost(item, size);
      subtotal += price * qty;
      foodCostTotal += unitFoodCost * qty;
      const portion = findPortion(item, size); const label = portion.label === 'Full' ? item.name : `${item.name} (${portion.label})`;
      return { itemId, size, name: label, qty, price, unitFoodCost };
    });
    const { discount, grand: grandTotal } = computeDiscountAndGrand(subtotal);
    const profit = grandTotal - foodCostTotal;

    const isEdit = !!state.editingOrderId;

    if (isEdit) {
      // Undo the original order's inventory deduction before applying the new one,
      // so editing quantities up or down keeps Stock Left correct either way.
      await reverseInventoryForOrder(state.editingOrderSnapshot.items);

      const updatedOrder = {
        ...state.editingOrderSnapshot, // keeps id, original dateKey/timestamp, udharCleared state, etc.
        customerName: document.getElementById('custName').value.trim(),
        mobile: document.getElementById('custMobile').value.trim(),
        source: state.source,
        payment: state.payment,
        items: orderItems,
        subtotal, discount, grandTotal, foodCostTotal, profit,
      };
      await dbPut('orders', updatedOrder);
      await deductInventoryForOrder(orderItems);
      // Footfall was already counted when this order was first placed — don't recount it.

      toast(`Order updated · ${rupee(grandTotal)}`);
      resetOrderForm();
      renderMenuGrid();
      renderCartAndTotals();
      setView('dashboard');
      return;
    }

    const order = {
      id: uid(),
      dateKey: todayKey(),
      timestamp: Date.now(),
      customerName: document.getElementById('custName').value.trim(),
      mobile: document.getElementById('custMobile').value.trim(),
      source: state.source,
      payment: state.payment,
      items: orderItems,
      subtotal, discount, grandTotal, foodCostTotal, profit,
    };

    await dbPut('orders', order);
    await deductInventoryForOrder(orderItems);

    // buying customer -> footfall.buying +1
    await loadTodayFootfall();
    state.todayFootfall.buying = (state.todayFootfall.buying || 0) + 1;
    if (state.todayFootfall.count < state.todayFootfall.buying) {
      state.todayFootfall.count = state.todayFootfall.buying;
    }
    await dbPut('footfall', state.todayFootfall);

    toast(`Order complete · ${rupee(grandTotal)}`);
    resetOrderForm();
    renderMenuGrid();
    renderCartAndTotals();
  });

  /* ---------------- MENU MANAGEMENT ---------------- */
  function renderMenuMgmtChips() {
    const wrap = document.getElementById('menuMgmtCategoryChips');
    const chips = [{ id: 'all', name: 'All' }, ...state.categories];
    wrap.innerHTML = chips.map((c) => `
      <button class="chip ${state.activeMgmtCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)}</button>
    `).join('');
    wrap.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeMgmtCategory = btn.dataset.cat;
        renderMenuMgmtChips();
        renderMenuMgmtList();
      });
    });
  }

  function renderMenuMgmtList() {
    const list = document.getElementById('menuMgmtList');
    let items = state.items;
    if (state.activeMgmtCategory !== 'all') {
      items = items.filter((i) => i.categoryId === state.activeMgmtCategory);
    }
    if (!items.length) {
      list.innerHTML = '<div class="empty-hint">No items yet. Tap "+ Item" to add one.</div>';
      return;
    }
    list.innerHTML = items.map((item) => {
      const portions = getItemPortions(item);
      const extra = portions.filter((p) => p.id !== 'full');
      const sub = portions.map((p) => {
        const cost = state.source === 'Offline' ? p.foodCost : p.foodCost + item.packagingCost;
        return `${escapeHtml(p.label)}: Offline ${rupee(p.offlinePrice)} · Online ${rupee(p.onlinePrice)} (cost ${rupee(p.foodCost)})`;
      }).join('<br/>');
      return `
      <div class="item-row ${item.available ? '' : 'item-row__unavailable'}">
        <div>
          <div class="item-row__name">${escapeHtml(item.name)}${extra.length ? ` <span class="tag">${extra.length + 1} portions</span>` : ''}</div>
          <div class="item-row__sub">${sub}</div>
        </div>
        <button class="item-row__edit" data-id="${item.id}">Edit</button>
      </div>
    `;
    }).join('');
    list.querySelectorAll('.item-row__edit').forEach((btn) => {
      btn.addEventListener('click', () => { openItemModal(btn.dataset.id); });
    });
  }

  function populateCategorySelect() {
    const sel = document.getElementById('fItemCategory');
    sel.innerHTML = state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  function renderPortionsList() {
    const wrap = document.getElementById('portionsList');
    wrap.innerHTML = state.portionsDraft.map((p, idx) => `
      <div class="size-block" data-idx="${idx}">
        <div class="field-row">
          <div>
            <label>Portion Name</label>
            <input type="text" data-field="label" value="${escapeHtml(p.label || '')}" placeholder="e.g. Half, Quarter, Piece" />
          </div>
        </div>
        <div class="field-row">
          <div>
            <label>Offline Price ₹</label>
            <input type="number" min="0" data-field="offlinePrice" value="${p.offlinePrice || ''}" />
          </div>
          <div>
            <label>Online Price ₹</label>
            <input type="number" min="0" data-field="onlinePrice" value="${p.onlinePrice || ''}" />
          </div>
        </div>
        <div class="field-row">
          <div>
            <label>Food Cost ₹</label>
            <input type="number" min="0" data-field="foodCost" value="${p.foodCost || ''}" />
          </div>
          <div>
            <label>Recipe Factor <span class="field-hint">(1 = full recipe, 0.5 = half, etc.)</span></label>
            <input type="number" min="0" step="0.1" data-field="recipeFactor" value="${p.recipeFactor != null ? p.recipeFactor : 1}" />
          </div>
        </div>
        <button type="button" class="btn btn--ghost btn--small portion-remove" data-idx="${idx}">Remove Portion</button>
      </div>
    `).join('');

    wrap.querySelectorAll('input[data-field]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.closest('.size-block').dataset.idx, 10);
        const field = e.target.dataset.field;
        state.portionsDraft[idx][field] = field === 'label' ? e.target.value : (parseFloat(e.target.value) || 0);
      });
    });
    wrap.querySelectorAll('.portion-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.portionsDraft.splice(parseInt(btn.dataset.idx, 10), 1);
        renderPortionsList();
      });
    });
  }

  document.getElementById('addPortionBtn').addEventListener('click', () => {
    state.portionsDraft.push({ label: '', offlinePrice: 0, onlinePrice: 0, foodCost: 0, recipeFactor: 1 });
    renderPortionsList();
  });

  async function openItemModal(itemId) {
    state.editingItemId = itemId || null;
    populateCategorySelect();
    await refreshInventory();
    const backdrop = document.getElementById('itemModalBackdrop');
    const title = document.getElementById('itemModalTitle');
    const deleteBtn = document.getElementById('fDeleteBtn');

    if (itemId) {
      const item = state.items.find((i) => i.id === itemId);
      title.textContent = 'Edit Item';
      document.getElementById('fItemName').value = item.name;
      document.getElementById('fItemCategory').value = item.categoryId;
      document.getElementById('fOfflinePrice').value = item.offlinePrice;
      document.getElementById('fOnlinePrice').value = item.onlinePrice;
      document.getElementById('fFoodCost').value = item.foodCost;
      document.getElementById('fPackagingCost').value = item.packagingCost;
      document.getElementById('fPackOffline').checked = item.chargePackagingOffline === true;
      document.getElementById('fPackOnline').checked = item.chargePackagingOnline !== false;
      document.getElementById('fAvailable').checked = item.available;
      deleteBtn.hidden = false;
      state.recipeDraft = (item.recipe || []).map((r) => ({ ...r }));
      const portions = getItemPortions(item);
      state.portionsDraft = portions.filter((p) => p.id !== 'full').map((p) => ({ ...p }));
    } else {
      title.textContent = 'New Item';
      document.getElementById('fItemName').value = '';
      if (state.categories.length) document.getElementById('fItemCategory').value = state.categories[0].id;
      document.getElementById('fOfflinePrice').value = '';
      document.getElementById('fOnlinePrice').value = '';
      document.getElementById('fFoodCost').value = '';
      document.getElementById('fPackagingCost').value = '';
      document.getElementById('fPackOffline').checked = false;
      document.getElementById('fPackOnline').checked = true;
      document.getElementById('fAvailable').checked = true;
      deleteBtn.hidden = true;
      state.recipeDraft = [];
      state.portionsDraft = [];
    }
    renderPortionsList();
    renderRecipeRows();
    backdrop.hidden = false;
  }

  function closeItemModal() {
    document.getElementById('itemModalBackdrop').hidden = true;
    state.editingItemId = null;
    state.recipeDraft = [];
    state.portionsDraft = [];
  }

  function computeRecipeCost() {
    return state.recipeDraft.reduce((sum, row) => {
      const inv = state.inventory.find((i) => i.id === row.inventoryId);
      if (!inv) return sum;
      return sum + inventoryCostPerRecipeUnit(inv) * (row.qty || 0);
    }, 0);
  }

  function renderRecipeRows() {
    const wrap = document.getElementById('recipeRows');
    const hint = document.getElementById('recipeNoInventoryHint');
    hint.hidden = state.inventory.length > 0;

    wrap.innerHTML = state.recipeDraft.map((row, idx) => {
      const selectedInv = state.inventory.find((i) => i.id === row.inventoryId);
      const unitLabel = selectedInv ? inventoryRecipeUnit(selectedInv) : '';
      return `
      <div class="recipe-row" data-idx="${idx}">
        <select data-field="inventoryId">
          ${state.inventory.map((inv) => `<option value="${inv.id}" ${inv.id === row.inventoryId ? 'selected' : ''}>${escapeHtml(inv.name)} (per ${escapeHtml(inventoryRecipeUnit(inv))})</option>`).join('')}
        </select>
        <input type="number" min="0" step="any" data-field="qty" value="${row.qty || ''}" placeholder="Qty (${escapeHtml(unitLabel)})" />
        <button type="button" class="recipe-row__remove" data-idx="${idx}">&times;</button>
      </div>`;
    }).join('');

    wrap.querySelectorAll('select[data-field="inventoryId"]').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const idx = e.target.closest('.recipe-row').dataset.idx;
        state.recipeDraft[idx].inventoryId = e.target.value;
        renderRecipeRows();
      });
    });
    wrap.querySelectorAll('input[data-field="qty"]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = e.target.closest('.recipe-row').dataset.idx;
        state.recipeDraft[idx].qty = parseFloat(e.target.value) || 0;
        document.getElementById('recipeCostValue').textContent = rupee(computeRecipeCost());
      });
    });
    wrap.querySelectorAll('.recipe-row__remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.recipeDraft.splice(parseInt(btn.dataset.idx, 10), 1);
        renderRecipeRows();
        document.getElementById('recipeCostValue').textContent = rupee(computeRecipeCost());
      });
    });

    document.getElementById('recipeCostValue').textContent = rupee(computeRecipeCost());
  }

  document.getElementById('addRecipeRowBtn').addEventListener('click', () => {
    if (!state.inventory.length) { toast('Add inventory items first'); return; }
    state.recipeDraft.push({ inventoryId: state.inventory[0].id, qty: 0 });
    renderRecipeRows();
  });

  document.getElementById('useRecipeCostBtn').addEventListener('click', () => {
    document.getElementById('fFoodCost').value = Math.round(computeRecipeCost());
    toast('Food cost updated from recipe');
  });

  document.getElementById('addItemBtn').addEventListener('click', async () => {
    if (!state.categories.length) { toast('Add a category first'); return; }
    await openItemModal(null);
  });
  document.getElementById('itemModalClose').addEventListener('click', closeItemModal);
  document.getElementById('itemModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'itemModalBackdrop') closeItemModal();
  });

  document.getElementById('fSaveBtn').addEventListener('click', async () => {
    const name = document.getElementById('fItemName').value.trim();
    if (!name) { toast('Item name is required'); return; }
    const fullPortion = {
      id: 'full', label: 'Full',
      offlinePrice: parseFloat(document.getElementById('fOfflinePrice').value) || 0,
      onlinePrice: parseFloat(document.getElementById('fOnlinePrice').value) || 0,
      foodCost: parseFloat(document.getElementById('fFoodCost').value) || 0,
      recipeFactor: 1,
    };
    const extraPortions = state.portionsDraft
      .filter((p) => p.label && p.label.trim())
      .map((p) => ({
        id: p.id || uid(),
        label: p.label.trim(),
        offlinePrice: p.offlinePrice || 0,
        onlinePrice: p.onlinePrice || 0,
        foodCost: p.foodCost || 0,
        recipeFactor: p.recipeFactor != null ? p.recipeFactor : 1,
      }));
    const record = {
      id: state.editingItemId || uid(),
      name,
      categoryId: document.getElementById('fItemCategory').value,
      offlinePrice: fullPortion.offlinePrice,
      onlinePrice: fullPortion.onlinePrice,
      foodCost: fullPortion.foodCost,
      packagingCost: parseFloat(document.getElementById('fPackagingCost').value) || 0,
      chargePackagingOffline: document.getElementById('fPackOffline').checked,
      chargePackagingOnline: document.getElementById('fPackOnline').checked,
      portions: [fullPortion, ...extraPortions],
      available: document.getElementById('fAvailable').checked,
      recipe: state.recipeDraft.filter((r) => r.inventoryId && r.qty > 0),
    };
    await dbPut('items', record);
    await refreshCategoriesAndItems();
    closeItemModal();
    renderMenuMgmtList();
    toast('Item saved');
  });

  document.getElementById('fDeleteBtn').addEventListener('click', async () => {
    if (!state.editingItemId) return;
    if (!window.confirm('Delete this item?')) return;
    await dbDelete('items', state.editingItemId);
    await refreshCategoriesAndItems();
    closeItemModal();
    renderMenuMgmtList();
    toast('Item deleted');
  });

  document.getElementById('addCategoryBtn').addEventListener('click', () => {
    document.getElementById('fCategoryName').value = '';
    document.getElementById('catModalBackdrop').hidden = false;
  });
  document.getElementById('catModalClose').addEventListener('click', () => {
    document.getElementById('catModalBackdrop').hidden = true;
  });
  document.getElementById('catModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'catModalBackdrop') document.getElementById('catModalBackdrop').hidden = true;
  });
  document.getElementById('catSaveBtn').addEventListener('click', async () => {
    const name = document.getElementById('fCategoryName').value.trim();
    if (!name) { toast('Category name is required'); return; }
    await dbPut('categories', { id: uid(), name });
    await refreshCategoriesAndItems();
    document.getElementById('catModalBackdrop').hidden = true;
    renderMenuMgmtChips();
    renderMenuMgmtList();
    toast('Category added');
  });

  async function renderMenuManagement() {
    await refreshCategoriesAndItems();
    renderMenuMgmtChips();
    renderMenuMgmtList();
  }

  /* ----- Printable Menu ----- */
  function priceLine(offline, online, mode) {
    if (mode === 'offline') return `₹${Math.round(offline || 0)}`;
    if (mode === 'online') return `₹${Math.round(online || 0)}`;
    return `Off ₹${Math.round(offline || 0)} / On ₹${Math.round(online || 0)}`;
  }

  function printItemRow(item, mode) {
    const portions = getItemPortions(item);
    const priceText = portions.length > 1
      ? portions.map((p) => `${escapeHtml(p.label)} ${priceLine(p.offlinePrice, p.onlinePrice, mode)}`).join(' · ')
      : priceLine(portions[0].offlinePrice, portions[0].onlinePrice, mode);
    return `
      <div class="print-menu__item ${mode === 'both' ? 'print-menu__item--both' : ''}">
        <span class="print-menu__item-name">${escapeHtml(item.name)}</span>
        <span class="print-menu__leader"></span>
        <span class="print-menu__item-price">${priceText}</span>
      </div>`;
  }

  function buildPrintMenu(mode) {
    const wrap = document.getElementById('printMenuCategories');
    const blocks = state.categories.map((cat) => {
      const items = state.items.filter((i) => i.categoryId === cat.id && i.available);
      if (!items.length) return '';
      return `
        <div class="print-menu__cat">
          <div class="print-menu__cat-name">${escapeHtml(cat.name)}</div>
          ${items.map((item) => printItemRow(item, mode)).join('')}
        </div>`;
    }).join('');
    wrap.innerHTML = blocks || '<div class="print-menu__cat">No available items yet — add some in Menu Management.</div>';

    const taglines = { offline: 'IN-SHOP MENU', online: 'ONLINE MENU (ZOMATO / SWIGGY)', both: 'MENU · IN-SHOP & ONLINE PRICES' };
    document.getElementById('printMenuTagline').textContent = taglines[mode] || 'MENU';
    document.getElementById('printMenuArea').classList.toggle('print-menu--both', mode === 'both');
  }

  document.getElementById('printModeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.printMode = btn.dataset.mode;
    document.querySelectorAll('#printModeSeg button').forEach((b) => b.classList.toggle('active', b === btn));
  });

  document.getElementById('printMenuBtn').addEventListener('click', () => {
    if (!state.items.some((i) => i.available)) {
      toast('Mark at least one item Available first');
      return;
    }
    buildPrintMenu(state.printMode || 'offline');
    window.print();
  });

  /* ----- Download Menu as PDF (jsPDF) — more reliable across phones than
     relying on the browser's print dialog rendering @media print correctly ----- */
  function priceLinePdf(offline, online, mode) {
    if (mode === 'offline') return `Rs ${Math.round(offline || 0)}`;
    if (mode === 'online') return `Rs ${Math.round(online || 0)}`;
    return `Rs ${Math.round(offline || 0)} (offline) / Rs ${Math.round(online || 0)} (online)`;
  }

  document.getElementById('downloadMenuPdfBtn').addEventListener('click', () => {
    const mode = state.printMode || 'offline';
    if (!state.items.some((i) => i.available)) {
      toast('Mark at least one item Available first');
      return;
    }
    if (!window.jspdf) {
      toast('PDF library failed to load — check your internet connection and try again');
      return;
    }

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const marginX = 18;
      const contentW = pageW - marginX * 2;
      let y = 22;

      const titles = { offline: 'IN-SHOP MENU', online: 'ONLINE MENU (ZOMATO / SWIGGY)', both: 'MENU — IN-SHOP & ONLINE PRICES' };

      function drawHeader() {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        doc.setTextColor(26, 22, 20);
        doc.text(shopName.toUpperCase(), pageW / 2, y, { align: 'center' });
        y += 7;
        doc.setDrawColor(196, 58, 36);
        doc.setLineWidth(1);
        doc.line(pageW / 2 - 12, y, pageW / 2 + 12, y);
        y += 8;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(110, 100, 90);
        doc.text(titles[mode] || 'MENU', pageW / 2, y, { align: 'center' });
        y += 12;
      }

      function ensureSpace(needed) {
        if (y + needed > pageH - 18) {
          doc.addPage();
          y = 20;
        }
      }

      drawHeader();

      const availableCats = state.categories.filter((cat) =>
        state.items.some((i) => i.categoryId === cat.id && i.available));

      if (!availableCats.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(100, 90, 85);
        doc.text('No available items yet — add some in Menu Management.', pageW / 2, y + 10, { align: 'center' });
      }

      availableCats.forEach((cat) => {
        const items = state.items.filter((i) => i.categoryId === cat.id && i.available);

        ensureSpace(14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(196, 58, 36);
        doc.text(String(cat.name || '').toUpperCase(), marginX, y);
        doc.setDrawColor(26, 22, 20);
        doc.setLineWidth(0.3);
        doc.line(marginX, y + 1.5, marginX + contentW, y + 1.5);
        y += 8;

        items.forEach((item) => {
          const portions = getItemPortions(item);
          const lines = portions.length > 1
            ? portions.map((p) => `${item.name} (${p.label})`)
            : [item.name];
          const prices = portions.map((p) => priceLinePdf(p.offlinePrice, p.onlinePrice, mode));

          lines.forEach((lineName, idx) => {
            ensureSpace(7);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10.5);
            doc.setTextColor(26, 22, 20);
            doc.text(lineName, marginX, y);
            doc.setFont('helvetica', 'bold');
            doc.text(prices[idx], marginX + contentW, y, { align: 'right' });
            // Leader line between name and price — a plain thin rule rather than a
            // dashed one, since dash-pattern support isn't consistent across jsPDF builds.
            const nameW = doc.getTextWidth(lineName);
            const priceW = doc.getTextWidth(prices[idx]);
            const leaderStart = marginX + nameW + 3;
            const leaderEnd = marginX + contentW - priceW - 3;
            if (leaderEnd > leaderStart) {
              doc.setDrawColor(200, 194, 186);
              doc.setLineWidth(0.15);
              doc.line(leaderStart, y - 1, leaderEnd, y - 1);
            }
            y += 6.5;
          });
        });
        y += 4;
      });

      ensureSpace(10);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(140, 130, 120);
      doc.text('Prices for dine-in / takeaway. Menu subject to change without notice.', pageW / 2, pageH - 12, { align: 'center' });

      doc.save(`akash-food-point-menu-${mode}.pdf`);
      toast('Menu PDF downloaded');
    } catch (err) {
      console.error('Menu PDF generation failed:', err);
      toast('Couldn\'t generate the PDF — try "Print Directly" instead');
    }
  });

  /* ---------------- MORE: INVENTORY / PURCHASES / EXPENSES / CUSTOMERS ---------------- */

  function switchMoreSub(sub) {
    state.activeMoreSub = sub;
    document.querySelectorAll('#moreSubNav button').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
    ['inventory', 'purchases', 'expenses', 'customers', 'reports', 'seasonal', 'udhar'].forEach((s) => {
      document.getElementById(`sub-${s}`).hidden = s !== sub;
    });
    if (sub === 'inventory') renderInventoryList();
    if (sub === 'purchases') { populatePurchaseItemSelect(); renderPurchaseList(); }
    if (sub === 'expenses') renderExpenseList();
    if (sub === 'customers') renderCustomerList();
    if (sub === 'reports') renderReports();
    if (sub === 'seasonal') renderSeasonal();
    if (sub === 'udhar') renderUdharTab();
  }

  document.getElementById('moreSubNav').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    switchMoreSub(btn.dataset.sub);
  });

  function formatDateReadable(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }
  function wireDateReadout(inputId, readoutId) {
    const input = document.getElementById(inputId);
    const readout = document.getElementById(readoutId);
    readout.textContent = formatDateReadable(input.value);
    input.addEventListener('input', () => { readout.textContent = formatDateReadable(input.value); });
  }
  wireDateReadout('pDate', 'pDateReadout');
  wireDateReadout('eDate', 'eDateReadout');

  async function renderMoreView() {
    await refreshInventory();
    await loadAllOrdersAndPayments();
    document.getElementById('pDate').value = todayKey();
    document.getElementById('eDate').value = todayKey();
    document.getElementById('pDateReadout').textContent = formatDateReadable(todayKey());
    document.getElementById('eDateReadout').textContent = formatDateReadable(todayKey());
    switchMoreSub(state.activeMoreSub);
  }

  /* ----- Inventory ----- */
  function renderInventoryList() {
    const list = document.getElementById('inventoryList');
    if (!state.inventory.length) {
      list.innerHTML = '<div class="empty-hint">No inventory items yet. Tap "+ Item" to add raw materials.</div>';
      return;
    }
    list.innerHTML = state.inventory.map((inv) => {
      const low = (inv.currentStock || 0) <= (inv.minStock || 0);
      const conversionNote = inv.hasConversion && inv.recipeUnit && inv.unitsPerPurchase
        ? ` (= ${Math.round((inv.currentStock || 0) * inv.unitsPerPurchase)} ${escapeHtml(inv.recipeUnit)})`
        : '';
      return `
      <div class="item-row">
        <div>
          <div class="item-row__name">${escapeHtml(inv.name)}</div>
          <div class="item-row__sub">
            <span class="item-row__stock-badge ${low ? 'item-row__stock-badge--low' : ''}">Stock left: ${inv.currentStock || 0} ${escapeHtml(inv.unit)}${conversionNote}</span>
            &nbsp;Min ${inv.minStock || 0} ${escapeHtml(inv.unit)} · ₹${inv.purchaseCost || 0}/${escapeHtml(inv.unit)}${inv.supplier ? ' · ' + escapeHtml(inv.supplier) : ''}
          </div>
        </div>
        <button class="item-row__edit" data-id="${inv.id}">Edit</button>
        <button class="item-row__delete" data-id="${inv.id}" aria-label="Delete inventory item">&times;</button>
      </div>`;
    }).join('');
    list.querySelectorAll('.item-row__edit').forEach((btn) => {
      btn.addEventListener('click', () => openInventoryModal(btn.dataset.id));
    });
    list.querySelectorAll('.item-row__delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this inventory item? Any recipes using it will keep working but stop deducting stock for it.')) return;
        try {
          await dbDelete('inventory', btn.dataset.id);
          await refreshInventory();
          renderInventoryList();
          toast('Inventory item deleted');
        } catch (err) {
          console.error('Delete inventory item failed:', err);
          toast('Delete failed — try again');
        }
      });
    });
  }

  const PRESET_UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'pkt'];

  function setUnitField(unitValue) {
    const sel = document.getElementById('iUnit');
    const other = document.getElementById('iUnitOther');
    if (unitValue && !PRESET_UNITS.includes(unitValue)) {
      sel.value = '__other';
      other.hidden = false;
      other.value = unitValue;
    } else {
      sel.value = unitValue || 'g';
      other.hidden = true;
      other.value = '';
    }
  }
  document.getElementById('iUnit').addEventListener('change', (e) => {
    document.getElementById('iUnitOther').hidden = e.target.value !== '__other';
    updateConversionUnitLabel();
  });
  document.getElementById('iUnitOther').addEventListener('input', updateConversionUnitLabel);
  function currentPurchaseUnitLabel() {
    const sel = document.getElementById('iUnit').value;
    return sel === '__other' ? (document.getElementById('iUnitOther').value.trim() || 'unit') : sel;
  }
  function updateConversionUnitLabel() {
    document.getElementById('iConversionUnitLabel').textContent = currentPurchaseUnitLabel();
  }
  document.getElementById('iHasConversion').addEventListener('change', (e) => {
    document.getElementById('iConversionBlock').hidden = !e.target.checked;
    updateConversionUnitLabel();
  });

  function openInventoryModal(id) {
    state.editingInventoryId = id || null;
    const title = document.getElementById('invModalTitle');
    const deleteBtn = document.getElementById('iDeleteBtn');
    const stockLeftWrap = document.getElementById('iStockLeftWrap');
    const stockInputLabel = document.getElementById('iStockInputLabel');
    if (id) {
      const inv = state.inventory.find((i) => i.id === id);
      title.textContent = 'Edit Inventory Item';
      document.getElementById('iName').value = inv.name;
      setUnitField(inv.unit);
      document.getElementById('iMinStock').value = inv.minStock;
      document.getElementById('iPurchaseCost').value = inv.purchaseCost;
      document.getElementById('iSupplier').value = inv.supplier || '';
      stockLeftWrap.hidden = false;
      document.getElementById('iStockLeftDisplay').value = `${inv.currentStock || 0} ${inv.unit}`;
      stockInputLabel.textContent = 'Add New Stock';
      document.getElementById('iStockInput').value = '';
      document.getElementById('iStockInput').placeholder = 'e.g. 5 (adds to stock left)';
      document.getElementById('iHasConversion').checked = !!inv.hasConversion;
      document.getElementById('iConversionBlock').hidden = !inv.hasConversion;
      document.getElementById('iRecipeUnit').value = inv.recipeUnit || '';
      document.getElementById('iUnitsPerPurchase').value = inv.unitsPerPurchase || '';
      deleteBtn.hidden = false;
    } else {
      title.textContent = 'New Inventory Item';
      document.getElementById('iName').value = '';
      setUnitField('g');
      document.getElementById('iMinStock').value = '';
      document.getElementById('iPurchaseCost').value = '';
      document.getElementById('iSupplier').value = '';
      stockLeftWrap.hidden = true;
      stockInputLabel.textContent = 'Opening Stock';
      document.getElementById('iStockInput').value = '';
      document.getElementById('iStockInput').placeholder = '0';
      document.getElementById('iHasConversion').checked = false;
      document.getElementById('iConversionBlock').hidden = true;
      document.getElementById('iRecipeUnit').value = '';
      document.getElementById('iUnitsPerPurchase').value = '';
      deleteBtn.hidden = true;
    }
    updateConversionUnitLabel();
    document.getElementById('invModalBackdrop').hidden = false;
  }

  function closeInventoryModal() {
    document.getElementById('invModalBackdrop').hidden = true;
    state.editingInventoryId = null;
  }

  document.getElementById('addInventoryBtn').addEventListener('click', () => openInventoryModal(null));
  document.getElementById('invModalClose').addEventListener('click', closeInventoryModal);
  document.getElementById('invModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'invModalBackdrop') closeInventoryModal();
  });

  document.getElementById('iSaveBtn').addEventListener('click', async () => {
    const name = document.getElementById('iName').value.trim();
    if (!name) { toast('Item name is required'); return; }
    const unitSel = document.getElementById('iUnit').value;
    const unit = unitSel === '__other'
      ? (document.getElementById('iUnitOther').value.trim() || 'unit')
      : unitSel;
    const stockInputVal = parseFloat(document.getElementById('iStockInput').value) || 0;
    const isEdit = !!state.editingInventoryId;
    const existing = isEdit ? state.inventory.find((i) => i.id === state.editingInventoryId) : null;
    // New item: the number entered is the Opening Stock.
    // Existing item: the number entered is New Stock received, added on top of Stock Left.
    const newStockLeft = isEdit ? (existing.currentStock || 0) + stockInputVal : stockInputVal;

    const record = {
      id: state.editingInventoryId || uid(),
      name,
      unit,
      currentStock: newStockLeft,
      minStock: parseFloat(document.getElementById('iMinStock').value) || 0,
      purchaseCost: parseFloat(document.getElementById('iPurchaseCost').value) || 0,
      supplier: document.getElementById('iSupplier').value.trim(),
      hasConversion: document.getElementById('iHasConversion').checked,
      recipeUnit: document.getElementById('iRecipeUnit').value.trim(),
      unitsPerPurchase: parseFloat(document.getElementById('iUnitsPerPurchase').value) || 1,
    };
    await dbPut('inventory', record);
    await refreshInventory();
    closeInventoryModal();
    renderInventoryList();
    // Keep the Purchases item field's datalist (and the typed value, in case the
    // name changed) in sync if this item was edited from there.
    if (!document.getElementById('sub-purchases').hidden) {
      populatePurchaseItemSelect(record.name);
    }
    toast('Inventory item saved');
  });

  document.getElementById('iDeleteBtn').addEventListener('click', async () => {
    if (!state.editingInventoryId) return;
    if (!window.confirm('Delete this inventory item?')) return;
    await dbDelete('inventory', state.editingInventoryId);
    await refreshInventory();
    closeInventoryModal();
    renderInventoryList();
    toast('Inventory item deleted');
  });

  /* ----- Purchases ----- */
  function findInventoryByName(name) {
    const target = name.trim().toLowerCase();
    if (!target) return null;
    return state.inventory.find((i) => i.name.trim().toLowerCase() === target) || null;
  }

  function populatePurchaseItemSelect(nameToFill) {
    const datalist = document.getElementById('pItemDatalist');
    datalist.innerHTML = state.inventory.map((i) => `<option value="${escapeHtml(i.name)}"></option>`).join('');
    if (nameToFill !== undefined) document.getElementById('pItemInput').value = nameToFill;
    updatePurchaseItemMatch();
  }

  function updatePurchaseItemMatch() {
    const typed = document.getElementById('pItemInput').value;
    const match = findInventoryByName(typed);
    const hint = document.getElementById('pItemMatchHint');
    const editBtn = document.getElementById('pEditItemBtn');
    const unitInput = document.getElementById('pItemUnit');
    if (match) {
      hint.textContent = `Existing item · Stock left: ${match.currentStock || 0} ${match.unit}`;
      editBtn.hidden = false;
      unitInput.value = match.unit;
    } else if (typed.trim()) {
      hint.textContent = 'New item — will be added to Inventory when you save.';
      editBtn.hidden = true;
    } else {
      hint.textContent = '';
      editBtn.hidden = true;
    }
    return match;
  }
  document.getElementById('pItemInput').addEventListener('input', updatePurchaseItemMatch);
  document.getElementById('pEditItemBtn').addEventListener('click', () => {
    const match = findInventoryByName(document.getElementById('pItemInput').value);
    if (match) openInventoryModal(match.id);
  });

  function recalcPurchaseAmount() {
    const qty = parseFloat(document.getElementById('pQty').value) || 0;
    const rate = parseFloat(document.getElementById('pRate').value) || 0;
    document.getElementById('pAmount').value = qty && rate ? Math.round(qty * rate) : '';
  }
  document.getElementById('pQty').addEventListener('input', recalcPurchaseAmount);
  document.getElementById('pRate').addEventListener('input', recalcPurchaseAmount);

  function startOfWeek(d = new Date()) {
    const day = d.getDay(); // 0 = Sunday
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7)); // back up to Monday
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  async function renderPurchaseSummary() {
    const all = await dbGetAll('purchases');
    const now = new Date();
    const monthPrefix = todayKey().slice(0, 7);
    const weekStart = startOfWeek(now).getTime();

    const period = state.activePurchasePeriod || 'today';
    let filtered;
    let label;
    if (period === 'today') {
      filtered = all.filter((p) => p.dateKey === todayKey());
      label = 'Today';
    } else if (period === 'week') {
      filtered = all.filter((p) => new Date(p.dateKey + 'T00:00:00').getTime() >= weekStart);
      label = 'Mon – Today';
    } else {
      filtered = all.filter((p) => p.dateKey.startsWith(monthPrefix));
      label = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    }

    const total = filtered.reduce((s, p) => s + p.amount, 0);
    document.getElementById('purchaseSummaryLabel').textContent = label;
    document.getElementById('purchaseSummaryTotal').textContent = rupee(total);

    const byItem = {};
    filtered.forEach((p) => {
      if (!byItem[p.itemName]) byItem[p.itemName] = { qty: 0, unit: p.unit || '', amount: 0 };
      byItem[p.itemName].qty += p.qty;
      byItem[p.itemName].amount += p.amount;
    });
    const rows = Object.entries(byItem).sort((a, b) => b[1].amount - a[1].amount);
    const el = document.getElementById('purchaseSummaryByItem');
    el.innerHTML = rows.length
      ? rows.map(([name, d]) => `<div class="close-row"><span>${escapeHtml(name)} (${d.qty}${d.unit ? ' ' + escapeHtml(d.unit) : ''})</span><span>${rupee(d.amount)}</span></div>`).join('')
      : `<div class="close-row"><span>No purchases logged ${period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'} yet</span><span></span></div>`;
  }

  document.getElementById('purchasePeriodSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.activePurchasePeriod = btn.dataset.period;
    document.querySelectorAll('#purchasePeriodSeg button').forEach((b) => b.classList.toggle('active', b === btn));
    renderPurchaseSummary();
  });

  async function renderPurchaseList() {
    const all = await dbGetAll('purchases');
    all.sort((a, b) => b.timestamp - a.timestamp);
    const list = document.getElementById('purchaseList');
    if (!all.length) {
      list.innerHTML = '<div class="order-log__empty">No purchases logged yet.</div>';
    } else {
      list.innerHTML = all.slice(0, 20).map((p) => `
        <div class="order-row">
          <div class="order-row__left">
            <span class="order-row__name">${escapeHtml(p.itemName)} · ${p.qty} ${escapeHtml(p.unit || ('unit' + (p.qty !== 1 ? 's' : '')))}</span>
            <span class="order-row__meta">${p.supplier ? escapeHtml(p.supplier) : 'No supplier'} · ${p.dateKey} · ${p.payment}</span>
          </div>
          <div class="order-row__amount">${rupee(p.amount)}</div>
          <button class="order-row__edit-order" data-id="${p.id}">Edit</button>
          <button class="order-row__delete" data-id="${p.id}" aria-label="Delete purchase">&times;</button>
        </div>
      `).join('');
      list.querySelectorAll('.order-row__delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!window.confirm('Delete this purchase? This will also remove the stock it added to Inventory.')) return;
          try {
            const purchase = all.find((p) => p.id === btn.dataset.id);
            if (purchase) {
              const inv = state.inventory.find((i) => i.id === purchase.inventoryId)
                || (await dbGet('inventory', purchase.inventoryId));
              if (inv) {
                inv.currentStock = Math.max(0, (inv.currentStock || 0) - purchase.qty);
                await dbPut('inventory', inv);
                await refreshInventory();
              }
            }
            await dbDelete('purchases', btn.dataset.id);
            renderPurchaseList();
            toast('Purchase deleted — stock adjusted back');
          } catch (err) {
            console.error('Delete purchase failed:', err);
            toast('Delete failed — try again');
          }
        });
      });
      list.querySelectorAll('.order-row__edit-order').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = all.find((x) => x.id === btn.dataset.id);
          if (!p) return;
          state.editingPurchaseId = p.id;
          document.getElementById('pDate').value = p.dateKey;
          document.getElementById('pDateReadout').textContent = formatDateReadable(p.dateKey);
          document.getElementById('pSupplier').value = p.supplier || '';
          document.getElementById('pItemInput').value = p.itemName;
          document.getElementById('pItemUnit').value = p.unit || '';
          document.getElementById('pQty').value = p.qty;
          document.getElementById('pRate').value = p.rate;
          document.getElementById('pAmount').value = p.amount;
          document.getElementById('pPayment').value = p.payment;
          document.getElementById('pNotes').value = p.notes || '';
          updatePurchaseItemMatch();
          document.getElementById('savePurchaseBtn').textContent = 'Update Purchase';
          document.getElementById('cancelEditPurchaseBtn').hidden = false;
        });
      });
    }
    await renderPurchaseSummary();
  }

  function resetPurchaseForm() {
    state.editingPurchaseId = null;
    document.getElementById('pSupplier').value = '';
    document.getElementById('pQty').value = '';
    document.getElementById('pRate').value = '';
    document.getElementById('pAmount').value = '';
    document.getElementById('pNotes').value = '';
    document.getElementById('pItemInput').value = '';
    document.getElementById('pItemUnit').value = '';
    document.getElementById('pItemMatchHint').textContent = '';
    document.getElementById('pEditItemBtn').hidden = true;
    document.getElementById('pDate').value = todayKey();
    document.getElementById('pDateReadout').textContent = formatDateReadable(todayKey());
    document.getElementById('savePurchaseBtn').textContent = 'Save Purchase';
    document.getElementById('cancelEditPurchaseBtn').hidden = true;
    populatePurchaseItemSelect();
  }
  document.getElementById('cancelEditPurchaseBtn').addEventListener('click', resetPurchaseForm);

  document.getElementById('savePurchaseBtn').addEventListener('click', async () => {
    const typedName = document.getElementById('pItemInput').value.trim();
    const qty = parseFloat(document.getElementById('pQty').value) || 0;
    const rate = parseFloat(document.getElementById('pRate').value) || 0;
    const amount = parseFloat(document.getElementById('pAmount').value) || qty * rate;
    if (!typedName) { toast('Enter or pick an item'); return; }
    if (!qty) { toast('Enter a quantity'); return; }

    const isEdit = !!state.editingPurchaseId;
    let oldPurchase = null;
    if (isEdit) oldPurchase = await dbGet('purchases', state.editingPurchaseId);

    let inv = findInventoryByName(typedName);
    if (!inv) {
      const unit = document.getElementById('pItemUnit').value.trim() || 'unit';
      inv = {
        id: uid(),
        name: typedName,
        unit,
        currentStock: 0,
        minStock: 0,
        purchaseCost: rate,
        supplier: '',
      };
      await dbPut('inventory', inv);
    }

    // If editing and switching item, first undo the old stock effect on the old item.
    if (isEdit && oldPurchase && oldPurchase.inventoryId !== inv.id) {
      const oldInv = await dbGet('inventory', oldPurchase.inventoryId);
      if (oldInv) {
        oldInv.currentStock = Math.max(0, (oldInv.currentStock || 0) - oldPurchase.qty);
        await dbPut('inventory', oldInv);
      }
    }

    const purchase = {
      id: state.editingPurchaseId || uid(),
      dateKey: document.getElementById('pDate').value || todayKey(),
      timestamp: isEdit ? oldPurchase.timestamp : Date.now(),
      supplier: document.getElementById('pSupplier').value.trim(),
      inventoryId: inv.id,
      itemName: inv.name,
      unit: inv.unit,
      qty, rate, amount,
      payment: document.getElementById('pPayment').value,
      notes: document.getElementById('pNotes').value.trim(),
    };
    await dbPut('purchases', purchase);

    // Same item as before: replace the old quantity's stock effect with the new one.
    // Different item: the old item was already corrected above, so just add the new qty here.
    const qtyDelta = (isEdit && oldPurchase && oldPurchase.inventoryId === inv.id) ? (qty - oldPurchase.qty) : qty;
    inv.currentStock = Math.max(0, (inv.currentStock || 0) + qtyDelta);
    if (rate) inv.purchaseCost = rate;
    await dbPut('inventory', inv);
    await refreshInventory();

    resetPurchaseForm();
    renderPurchaseList();
    toast(isEdit ? 'Purchase updated · stock adjusted' : 'Purchase saved · inventory updated');
    renderPurchaseList();
    toast(`Saved · ${inv.name} stock left: ${inv.currentStock} ${inv.unit}`);
  });

  /* ----- Expenses ----- */
  async function renderExpenseList() {
    const all = await dbGetAll('expenses');
    all.sort((a, b) => b.timestamp - a.timestamp);

    const monthPrefix = todayKey().slice(0, 7); // YYYY-MM
    const thisMonth = all.filter((ex) => ex.dateKey.startsWith(monthPrefix));
    const monthTotal = thisMonth.reduce((s, ex) => s + ex.amount, 0);
    const byCategory = {};
    thisMonth.forEach((ex) => { byCategory[ex.category] = (byCategory[ex.category] || 0) + ex.amount; });

    document.getElementById('expenseMonthLabel').textContent = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    document.getElementById('expenseMonthTotal').textContent = rupee(monthTotal);
    const catEl = document.getElementById('expenseMonthByCategory');
    const cats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    catEl.innerHTML = cats.length
      ? cats.map(([cat, amt]) => `<div class="close-row"><span>${escapeHtml(cat)}</span><span>${rupee(amt)}</span></div>`).join('')
      : '<div class="close-row"><span>No expenses logged this month yet</span><span></span></div>';

    const list = document.getElementById('expenseList');
    if (!all.length) {
      list.innerHTML = '<div class="order-log__empty">No expenses logged yet.</div>';
      return;
    }
    list.innerHTML = all.slice(0, 20).map((ex) => `
      <div class="order-row">
        <div class="order-row__left">
          <span class="order-row__name">${escapeHtml(ex.category)}</span>
          <span class="order-row__meta">${ex.dateKey}${ex.notes ? ' · ' + escapeHtml(ex.notes) : ''}</span>
        </div>
        <div class="order-row__amount">${rupee(ex.amount)}</div>
        <button class="order-row__edit-order" data-id="${ex.id}">Edit</button>
        <button class="order-row__delete" data-id="${ex.id}" aria-label="Delete expense">&times;</button>
      </div>
    `).join('');
    list.querySelectorAll('.order-row__delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this expense?')) return;
        try {
          await dbDelete('expenses', btn.dataset.id);
          renderExpenseList();
          toast('Expense deleted');
        } catch (err) {
          console.error('Delete expense failed:', err);
          toast('Delete failed — try again');
        }
      });
    });
    list.querySelectorAll('.order-row__edit-order').forEach((btn) => {
      btn.addEventListener('click', () => loadExpenseIntoForm(all.find((e) => e.id === btn.dataset.id)));
    });
  }

  function loadExpenseIntoForm(ex) {
    if (!ex) return;
    state.editingExpenseId = ex.id;
    document.getElementById('eDate').value = ex.dateKey;
    document.getElementById('eDateReadout').textContent = formatDateReadable(ex.dateKey);
    const presetCats = ['Raw Material', 'Gas', 'Electricity', 'Packaging', 'Cleaning', 'Repairs', 'Advertising', 'Miscellaneous'];
    if (presetCats.includes(ex.category)) {
      document.getElementById('eCategory').value = ex.category;
      document.getElementById('eCategoryOther').hidden = true;
    } else {
      document.getElementById('eCategory').value = '__other';
      document.getElementById('eCategoryOther').hidden = false;
      document.getElementById('eCategoryOther').value = ex.category;
    }
    document.getElementById('eAmount').value = ex.amount;
    document.getElementById('eNotes').value = ex.notes || '';
    document.getElementById('saveExpenseBtn').textContent = 'Update Expense';
    document.getElementById('cancelEditExpenseBtn').hidden = false;
  }

  function resetExpenseForm() {
    state.editingExpenseId = null;
    document.getElementById('eAmount').value = '';
    document.getElementById('eNotes').value = '';
    document.getElementById('eCategoryOther').value = '';
    document.getElementById('eCategoryOther').hidden = true;
    document.getElementById('eCategory').value = 'Raw Material';
    document.getElementById('eDate').value = todayKey();
    document.getElementById('eDateReadout').textContent = formatDateReadable(todayKey());
    document.getElementById('saveExpenseBtn').textContent = 'Save Expense';
    document.getElementById('cancelEditExpenseBtn').hidden = true;
  }
  document.getElementById('cancelEditExpenseBtn').addEventListener('click', resetExpenseForm);

  document.getElementById('eCategory').addEventListener('change', (e) => {
    document.getElementById('eCategoryOther').hidden = e.target.value !== '__other';
  });

  document.getElementById('saveExpenseBtn').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('eAmount').value) || 0;
    if (!amount) { toast('Enter an amount'); return; }
    const catSel = document.getElementById('eCategory').value;
    const category = catSel === '__other'
      ? (document.getElementById('eCategoryOther').value.trim() || 'Other')
      : catSel;
    const expense = {
      id: state.editingExpenseId || uid(),
      dateKey: document.getElementById('eDate').value || todayKey(),
      timestamp: state.editingExpenseId ? (await dbGet('expenses', state.editingExpenseId)).timestamp : Date.now(),
      category,
      amount,
      notes: document.getElementById('eNotes').value.trim(),
    };
    const wasEditing = !!state.editingExpenseId;
    await dbPut('expenses', expense);
    resetExpenseForm();
    renderExpenseList();
    toast(wasEditing ? 'Expense updated' : 'Expense saved · added to this month\'s total');
  });

  /* ----- Customers + Udhar ----- */
  function buildCustomerDirectory() {
    const map = new Map();
    for (const o of state.allOrders) {
      const key = customerKeyOf(o);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: o.customerName || o.mobile || 'Customer',
          mobile: o.mobile || '',
          visits: 0, spend: 0, udharGiven: 0, lastVisit: 0,
        });
      }
      const c = map.get(key);
      c.visits += 1;
      c.spend += o.grandTotal;
      if (o.payment === 'Udhar') c.udharGiven += o.grandTotal;
      if (o.timestamp > c.lastVisit) c.lastVisit = o.timestamp;
      if (o.customerName) c.name = o.customerName;
      if (o.mobile) c.mobile = o.mobile;
    }
    for (const p of (state.allPayments || [])) {
      const c = map.get(p.customerKey);
      if (c) c.udharPaid = (c.udharPaid || 0) + p.amount;
    }
    return Array.from(map.values()).map((c) => ({
      ...c,
      avgBill: c.visits ? c.spend / c.visits : 0,
      udharBalance: Math.max(0, c.udharGiven - (c.udharPaid || 0)),
    })).sort((a, b) => b.lastVisit - a.lastVisit);
  }

  function renderCustomerList() {
    const customers = buildCustomerDirectory();
    const list = document.getElementById('customerList');
    if (!customers.length) {
      list.innerHTML = '<div class="empty-hint">No customers yet. Names/mobiles entered at New Order show up here.</div>';
      return;
    }
    list.innerHTML = customers.map((c) => `
      <div class="item-row" data-key="${escapeHtml(c.key)}">
        <div>
          <div class="item-row__name">${escapeHtml(c.name)}</div>
          <div class="item-row__sub customer-row__meta">${c.visits} visits · ${rupee(c.spend)} spent${c.udharBalance ? ` · <strong>${rupee(c.udharBalance)} udhar</strong>` : ''}</div>
        </div>
        <button class="item-row__edit" data-key="${escapeHtml(c.key)}">Ledger</button>
      </div>
    `).join('');
    list.querySelectorAll('.item-row__edit').forEach((btn) => {
      btn.addEventListener('click', () => openCustomerModal(btn.dataset.key));
    });
  }

  async function openCustomerModal(key) {
    state.activeCustomerKey = key;
    // Opened from either the Customers tab (food-order stats available) or the
    // Udhar tab (may be a Seasonal-Biz-only customer with no food order history) —
    // fall back gracefully so the modal never breaks for the latter.
    const foodStats = buildCustomerDirectory().find((x) => x.key === key);
    const receivable = buildReceivablesDirectory().find((x) => x.key === key);
    const c = foodStats || receivable;
    if (!c) return;
    const balance = receivable ? receivable.udharBalance : (c.udharBalance || 0);

    document.getElementById('custModalName').textContent = c.name;
    document.getElementById('custVisits').textContent = foodStats ? foodStats.visits : 0;
    document.getElementById('custSpend').textContent = rupee(foodStats ? foodStats.spend : 0);
    document.getElementById('custAvg').textContent = rupee(foodStats ? foodStats.avgBill : 0);
    document.getElementById('custBalance').textContent = rupee(balance);
    document.getElementById('custPaymentAmount').value = '';

    const pending = pendingReceivablesFor(key);
    const pendingEl = document.getElementById('custPendingList');
    pendingEl.innerHTML = pending.length
      ? pending.map(pendingEntryRowHTML).join('')
      : '<div class="order-log__empty">Nothing pending — fully cleared.</div>';
    pendingEl.querySelectorAll('.order-row__clear').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const dateInput = pendingEl.querySelector(`[data-clear-date-for="${btn.dataset.id}"]`);
        await markUdharCleared(btn.dataset.store, btn.dataset.id, dateInput ? dateInput.value : null);
        openCustomerModal(key);
        renderUdharTab();
      });
    });

    const payments = (state.allPayments || []).filter((p) => p.customerKey === key).sort((a, b) => b.timestamp - a.timestamp);
    const histEl = document.getElementById('custPaymentHistory');
    histEl.innerHTML = payments.length
      ? payments.map((p) => `
        <div class="order-row">
          <div class="order-row__left">
            <span class="order-row__name">Payment received</span>
            <span class="order-row__meta">${new Date(p.timestamp).toLocaleDateString('en-IN')}</span>
          </div>
          <div class="order-row__amount">${rupee(p.amount)}</div>
        </div>`).join('')
      : '<div class="order-log__empty">No payments recorded yet.</div>';

    document.getElementById('custModalBackdrop').hidden = false;
  }

  document.getElementById('custModalClose').addEventListener('click', () => {
    document.getElementById('custModalBackdrop').hidden = true;
  });
  document.getElementById('custModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'custModalBackdrop') document.getElementById('custModalBackdrop').hidden = true;
  });

  document.getElementById('custPaymentBtn').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('custPaymentAmount').value) || 0;
    if (!amount || !state.activeCustomerKey) { toast('Enter a payment amount'); return; }
    await dbPut('udharPayments', {
      id: uid(),
      customerKey: state.activeCustomerKey,
      amount,
      timestamp: Date.now(),
    });
    await loadAllOrdersAndPayments();
    toast('Payment recorded');
    openCustomerModal(state.activeCustomerKey);
    renderCustomerList();
  });

  /* ----- Reports (monthly, historical) ----- */
  function metricsFor(orders, expenses) {
    const sales = orders.reduce((s, o) => s + o.grandTotal, 0);
    const rawProfit = orders.reduce((s, o) => s + o.profit, 0);
    const expTotal = expenses.reduce((s, e) => s + e.amount, 0);
    return { sales, orders: orders.length, profit: rawProfit - expTotal };
  }

  function pctChangeLabel(cur, prev) {
    if (!prev) return cur ? { text: 'New', cls: 'compare-up' } : { text: '—', cls: 'compare-flat' };
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return { text: '0%', cls: 'compare-flat' };
    return { text: `${pct > 0 ? '+' : ''}${pct}%`, cls: pct > 0 ? 'compare-up' : 'compare-down' };
  }

  function renderCompareTable(elId, cur, prev, curLabel, prevLabel) {
    const rows = [
      ['Sales', rupee(cur.sales), rupee(prev.sales), pctChangeLabel(cur.sales, prev.sales)],
      ['Orders', cur.orders, prev.orders, pctChangeLabel(cur.orders, prev.orders)],
      ['Profit', rupee(cur.profit), rupee(prev.profit), pctChangeLabel(cur.profit, prev.profit)],
    ];
    document.getElementById(elId).innerHTML = `
      <div class="compare-row compare-row--head"><span></span><span>${curLabel}</span><span>${prevLabel}</span><span>Change</span></div>
      ${rows.map(([label, c, p, chg]) => `
        <div class="compare-row">
          <span class="compare-row__label">${label}</span><span>${c}</span><span>${p}</span><span class="${chg.cls}">${chg.text}</span>
        </div>`).join('')}
    `;
  }

  function dateKeyMinus(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return todayKey(d);
  }

  async function renderComparisons() {
    await loadAllOrdersAndPayments();
    const allExpenses = await dbGetAll('expenses');

    const today = todayKey();
    const yesterday = dateKeyMinus(1);
    const todayM = metricsFor(state.allOrders.filter((o) => o.dateKey === today), allExpenses.filter((e) => e.dateKey === today));
    const ydayM = metricsFor(state.allOrders.filter((o) => o.dateKey === yesterday), allExpenses.filter((e) => e.dateKey === yesterday));
    renderCompareTable('cmpDay', todayM, ydayM, 'Today', 'Yesterday');

    const thisMonthKey = today.slice(0, 7);
    const lastMonthDate = new Date();
    lastMonthDate.setDate(1); // avoid month-length rollover surprises
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const thisMonthM = metricsFor(
      state.allOrders.filter((o) => o.dateKey.startsWith(thisMonthKey)),
      allExpenses.filter((e) => e.dateKey.startsWith(thisMonthKey))
    );
    const lastMonthM = metricsFor(
      state.allOrders.filter((o) => o.dateKey.startsWith(lastMonthKey)),
      allExpenses.filter((e) => e.dateKey.startsWith(lastMonthKey))
    );
    renderCompareTable('cmpMonth', thisMonthM, lastMonthM, 'This Month', 'Last Month');
  }

  function renderSalesTrendChart() {
    try {
      const canvas = document.getElementById('salesTrendChart');
      if (!canvas || !canvas.getContext) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return; // some restricted WebViews return null even when getContext exists
      const days = [];
      for (let i = 13; i >= 0; i--) days.push(dateKeyMinus(i));
      const salesByDay = days.map((dk) => state.allOrders.filter((o) => o.dateKey === dk).reduce((s, o) => s + o.grandTotal, 0));
      const max = Math.max(...salesByDay, 1);

      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const barGap = 4;
      const barW = W / days.length;

      salesByDay.forEach((val, i) => {
        const h = (val / max) * (H - 26);
        const x = i * barW + barGap / 2;
        const y = H - h - 16;
        ctx.fillStyle = i === days.length - 1 ? '#E1432B' : '#8A5A4E';
        ctx.fillRect(x, y, barW - barGap, h);
      });

      ctx.fillStyle = '#A79E90';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      days.forEach((dk, i) => {
        ctx.fillText(dk.slice(8, 10), i * barW + barW / 2, H - 4);
      });
    } catch (err) {
      console.error('Sales trend chart failed to render:', err);
    }
  }

  async function renderReports() {
    state.reportPeriod = state.reportPeriod || 'month';
    document.getElementById('rPeriodMonth').value = document.getElementById('rPeriodMonth').value || todayKey().slice(0, 7);
    document.getElementById('rPeriodDay').value = document.getElementById('rPeriodDay').value || todayKey();
    document.getElementById('rPeriodYear').value = document.getElementById('rPeriodYear').value || todayKey().slice(0, 4);
    document.getElementById('rPeriodDayReadout').textContent = formatDateReadable(document.getElementById('rPeriodDay').value);
    await computePeriodReport();
    await renderComparisons();
    renderSalesTrendChart();
    await renderBusinessInsights();
  }

  function daysBetween(dateKeyA, dateKeyB) {
    return Math.round((new Date(dateKeyB) - new Date(dateKeyA)) / 86400000);
  }

  async function renderBusinessInsights() {
    await refreshCategoriesAndItems();
    await refreshInventory();
    await loadAllOrdersAndPayments();
    const allExpenses = await dbGetAll('expenses');
    const orders = state.allOrders || [];
    const today = todayKey();

    // ---- 1. Repeat customers gone quiet: >=2 past orders, none in the last 14 days ----
    const custMap = new Map();
    orders.forEach((o) => {
      const key = customerKeyOf(o);
      if (!key) return;
      if (!custMap.has(key)) custMap.set(key, { name: o.customerName || o.mobile, count: 0, lastDate: o.dateKey });
      const c = custMap.get(key);
      c.count += 1;
      if (o.dateKey > c.lastDate) c.lastDate = o.dateKey;
      if (o.customerName) c.name = o.customerName;
    });
    const quiet = Array.from(custMap.values())
      .filter((c) => c.count >= 2 && daysBetween(c.lastDate, today) >= 14)
      .map((c) => ({ ...c, daysAgo: daysBetween(c.lastDate, today) }))
      .sort((a, b) => b.daysAgo - a.daysAgo)
      .slice(0, 10);
    document.getElementById('insightRepeatCustomers').innerHTML = quiet.length
      ? quiet.map((c) => `<div class="close-row"><span>${escapeHtml(c.name)} (${c.count} past orders)</span><span>${c.daysAgo} days ago</span></div>`).join('')
      : '<div class="close-row"><span>No regulars have gone quiet — good sign.</span><span></span></div>';

    // ---- 2. Running low soon: estimate days of stock left from last 7 days' recipe usage ----
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoKey = weekAgo.toISOString().slice(0, 10);
    const usage = {}; // inventoryId -> qty used in last 7 days (purchase units)
    orders.filter((o) => o.dateKey >= weekAgoKey).forEach((o) => {
      o.items.forEach((line) => {
        const item = state.items.find((i) => i.id === line.itemId);
        if (!item || !item.recipe || !item.recipe.length) return;
        const factor = findPortion(item, line.size).recipeFactor || 1;
        item.recipe.forEach((ing) => {
          const inv = state.inventory.find((i) => i.id === ing.inventoryId);
          if (!inv) return;
          const perPurchase = inv.unitsPerPurchase || 1;
          const used = (ing.qty * line.qty * factor) / perPurchase;
          usage[ing.inventoryId] = (usage[ing.inventoryId] || 0) + used;
        });
      });
    });
    const lowSoon = state.inventory
      .map((inv) => {
        const weeklyUsed = usage[inv.id] || 0;
        const dailyUsed = weeklyUsed / 7;
        const daysLeft = dailyUsed > 0 ? (inv.currentStock || 0) / dailyUsed : null;
        return { name: inv.name, unit: inv.unit, stock: inv.currentStock || 0, daysLeft };
      })
      .filter((i) => i.daysLeft !== null && i.daysLeft <= 3)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 10);
    document.getElementById('insightLowStock').innerHTML = lowSoon.length
      ? lowSoon.map((i) => `<div class="close-row"><span>${escapeHtml(i.name)} — ${i.stock} ${escapeHtml(i.unit || '')} left</span><span>~${i.daysLeft.toFixed(1)} days left</span></div>`).join('')
      : '<div class="close-row"><span>Nothing projected to run out in the next 3 days.</span><span></span></div>';

    // ---- 3. Profit margin by item, last 30 days ----
    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
    const monthAgoKey = monthAgo.toISOString().slice(0, 10);
    const marginAgg = {};
    orders.filter((o) => o.dateKey >= monthAgoKey).forEach((o) => o.items.forEach((line) => {
      if (!marginAgg[line.name]) marginAgg[line.name] = { name: line.name, revenue: 0, cost: 0 };
      marginAgg[line.name].revenue += line.price * line.qty;
      marginAgg[line.name].cost += line.unitFoodCost * line.qty;
    }));
    const margins = Object.values(marginAgg)
      .filter((m) => m.revenue > 0)
      .map((m) => ({ ...m, marginPct: ((m.revenue - m.cost) / m.revenue) * 100 }))
      .sort((a, b) => b.marginPct - a.marginPct);
    document.getElementById('insightMargins').innerHTML = margins.length
      ? margins.map((m) => `<div class="close-row"><span>${escapeHtml(m.name)}</span><span>${m.marginPct.toFixed(0)}% margin · ${rupee(m.revenue - m.cost)} profit</span></div>`).join('')
      : '<div class="close-row"><span>No sales in the last 30 days yet.</span><span></span></div>';

    // ---- 4. Best/worst day of week, all orders on record ----
    const dayTotals = {}; // dateKey -> sales
    orders.forEach((o) => { dayTotals[o.dateKey] = (dayTotals[o.dateKey] || 0) + o.grandTotal; });
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayAgg = weekdayNames.map(() => ({ total: 0, days: 0 }));
    Object.entries(dayTotals).forEach(([dateKey, sales]) => {
      const wd = new Date(dateKey).getDay();
      weekdayAgg[wd].total += sales;
      weekdayAgg[wd].days += 1;
    });
    const weekdayRows = weekdayNames
      .map((name, i) => ({ name, avg: weekdayAgg[i].days ? weekdayAgg[i].total / weekdayAgg[i].days : 0, days: weekdayAgg[i].days }))
      .filter((w) => w.days > 0)
      .sort((a, b) => b.avg - a.avg);
    document.getElementById('insightWeekday').innerHTML = weekdayRows.length
      ? weekdayRows.map((w) => `<div class="close-row"><span>${w.name}</span><span>${rupee(w.avg)} avg (${w.days} day${w.days !== 1 ? 's' : ''} on record)</span></div>`).join('')
      : '<div class="close-row"><span>Not enough closed days yet to see a pattern.</span><span></span></div>';

    // ---- 5. Expense category alerts: this month vs last month, flag >20% jumps ----
    const thisMonthKey = today.slice(0, 7);
    const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);
    const thisMonthByCat = {}, lastMonthByCat = {};
    allExpenses.forEach((e) => {
      if (e.dateKey.startsWith(thisMonthKey)) thisMonthByCat[e.category] = (thisMonthByCat[e.category] || 0) + e.amount;
      if (e.dateKey.startsWith(lastMonthKey)) lastMonthByCat[e.category] = (lastMonthByCat[e.category] || 0) + e.amount;
    });
    const expenseAlerts = Object.entries(thisMonthByCat)
      .map(([cat, amt]) => {
        const prev = lastMonthByCat[cat] || 0;
        const pctChange = prev > 0 ? ((amt - prev) / prev) * 100 : (amt > 0 ? 100 : 0);
        return { cat, amt, prev, pctChange };
      })
      .filter((e) => e.pctChange >= 20 && e.amt >= 100)
      .sort((a, b) => b.pctChange - a.pctChange);
    document.getElementById('insightExpenses').innerHTML = expenseAlerts.length
      ? expenseAlerts.map((e) => `<div class="close-row"><span>${escapeHtml(e.cat)}</span><span>${rupee(e.amt)} this month, up ${e.pctChange.toFixed(0)}% from ${rupee(e.prev)}</span></div>`).join('')
      : '<div class="close-row"><span>No expense category has jumped noticeably this month.</span><span></span></div>';
  }

  document.getElementById('reportPeriodSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.reportPeriod = btn.dataset.period;
    document.querySelectorAll('#reportPeriodSeg button').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('rPeriodDayWrap').hidden = state.reportPeriod !== 'day';
    document.getElementById('rPeriodWeekWrap').hidden = state.reportPeriod !== 'week';
    document.getElementById('rPeriodMonthWrap').hidden = state.reportPeriod !== 'month';
    document.getElementById('rPeriodYearWrap').hidden = state.reportPeriod !== 'year';
    computePeriodReport();
  });
  document.getElementById('rPeriodDay').addEventListener('change', () => {
    document.getElementById('rPeriodDayReadout').textContent = formatDateReadable(document.getElementById('rPeriodDay').value);
    computePeriodReport();
  });
  document.getElementById('rPeriodWeek').addEventListener('change', computePeriodReport);
  document.getElementById('rPeriodMonth').addEventListener('change', computePeriodReport);
  document.getElementById('rPeriodYear').addEventListener('change', computePeriodReport);

  // ISO week input (e.g. "2026-W34") -> Monday..Sunday date-key range for that week.
  function isoWeekToRange(weekStr) {
    const [yearStr, wStr] = weekStr.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(wStr, 10);
    const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const dayOfWeek = simple.getUTCDay() || 7;
    const monday = new Date(simple);
    monday.setUTCDate(simple.getUTCDate() - dayOfWeek + 1);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const fmt = (d) => d.toISOString().slice(0, 10);
    return { startKey: fmt(monday), endKey: fmt(sunday) };
  }

  async function computePeriodReport() {
    await refreshCategoriesAndItems();
    await loadAllOrdersAndPayments();
    const allExpenses = await dbGetAll('expenses');

    const period = state.reportPeriod || 'month';
    let orderFilter, expenseFilter, label;

    if (period === 'day') {
      const dayKey = document.getElementById('rPeriodDay').value || todayKey();
      orderFilter = (o) => o.dateKey === dayKey;
      expenseFilter = (e) => e.dateKey === dayKey;
      label = formatDateReadable(dayKey);
    } else if (period === 'week') {
      const weekVal = document.getElementById('rPeriodWeek').value;
      if (!weekVal) { label = 'Pick a week'; orderFilter = () => false; expenseFilter = () => false; }
      else {
        const { startKey, endKey } = isoWeekToRange(weekVal);
        orderFilter = (o) => o.dateKey >= startKey && o.dateKey <= endKey;
        expenseFilter = (e) => e.dateKey >= startKey && e.dateKey <= endKey;
        label = `${formatDateReadable(startKey)} – ${formatDateReadable(endKey)}`;
      }
    } else if (period === 'year') {
      const yearVal = document.getElementById('rPeriodYear').value || todayKey().slice(0, 4);
      orderFilter = (o) => o.dateKey.startsWith(yearVal);
      expenseFilter = (e) => e.dateKey.startsWith(yearVal);
      label = yearVal;
    } else {
      const monthKey = document.getElementById('rPeriodMonth').value || todayKey().slice(0, 7);
      orderFilter = (o) => o.dateKey.startsWith(monthKey);
      expenseFilter = (e) => e.dateKey.startsWith(monthKey);
      const [y, m] = monthKey.split('-');
      label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    }

    const orders = state.allOrders.filter(orderFilter);
    const expenses = allExpenses.filter(expenseFilter);

    const sales = orders.reduce((s, o) => s + o.grandTotal, 0);
    const rawProfit = orders.reduce((s, o) => s + o.profit, 0);
    const expTotal = expenses.reduce((s, e) => s + e.amount, 0);
    const profit = rawProfit - expTotal;

    document.getElementById('rMonthLabel').textContent = label;
    document.getElementById('rSales').textContent = rupee(sales);
    document.getElementById('rOrders').textContent = orders.length;
    document.getElementById('rProfit').textContent = rupee(profit);
    document.getElementById('rExpenses').textContent = rupee(expTotal);

    const itemAgg = {};
    orders.forEach((o) => o.items.forEach((line) => {
      const key = line.itemId + '::' + line.size;
      if (!itemAgg[key]) itemAgg[key] = { name: line.name, qty: 0, revenue: 0, itemId: line.itemId };
      itemAgg[key].qty += line.qty;
      itemAgg[key].revenue += line.price * line.qty;
    }));
    const topItems = Object.values(itemAgg).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    document.getElementById('rTopItems').innerHTML = topItems.length
      ? topItems.map((i) => `<div class="close-row"><span>${escapeHtml(i.name)} (${i.qty} sold)</span><span>${rupee(i.revenue)}</span></div>`).join('')
      : '<div class="close-row"><span>No sales in this period</span><span></span></div>';

    const catAgg = {};
    orders.forEach((o) => o.items.forEach((line) => {
      const item = state.items.find((i) => i.id === line.itemId);
      const cat = item ? state.categories.find((c) => c.id === item.categoryId) : null;
      const catName = cat ? cat.name : 'Uncategorized / Deleted item';
      catAgg[catName] = (catAgg[catName] || 0) + line.price * line.qty;
    }));
    const catRows = Object.entries(catAgg).sort((a, b) => b[1] - a[1]);
    document.getElementById('rCategoryBreakdown').innerHTML = catRows.length
      ? catRows.map(([name, amt]) => `<div class="close-row"><span>${escapeHtml(name)}</span><span>${rupee(amt)}</span></div>`).join('')
      : '<div class="close-row"><span>No sales in this period</span><span></span></div>';

    const custMap = new Map();
    orders.forEach((o) => {
      const key = customerKeyOf(o);
      if (!key) return;
      if (!custMap.has(key)) custMap.set(key, { name: o.customerName || o.mobile || 'Customer', visits: 0, spend: 0 });
      const c = custMap.get(key);
      c.visits += 1;
      c.spend += o.grandTotal;
      if (o.customerName) c.name = o.customerName;
    });
    const custRows = Array.from(custMap.values()).sort((a, b) => b.spend - a.spend);
    document.getElementById('rCustomers').innerHTML = custRows.length
      ? custRows.map((c) => `<div class="close-row"><span>${escapeHtml(c.name)} (${c.visits} order${c.visits !== 1 ? 's' : ''})</span><span>${rupee(c.spend)}</span></div>`).join('')
      : '<div class="close-row"><span>No named customers in this period</span><span></span></div>';
  }

  /* ---------------- SEASONAL BUSINESS (separate ledger — not linked to the food menu/inventory) ---------------- */

  function switchSeasonalMode(mode) {
    state.seasonalMode = mode;
    document.querySelectorAll('#seasonalModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('seasonalPurchaseMode').hidden = mode !== 'purchase';
    document.getElementById('seasonalSaleMode').hidden = mode !== 'sale';
    document.getElementById('seasonalSummaryMode').hidden = mode !== 'summary';
    if (mode === 'purchase') renderSeasonalPurchaseList();
    if (mode === 'sale') renderSeasonalSaleList();
    if (mode === 'summary') renderSeasonalSummary();
  }
  document.getElementById('seasonalModeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    switchSeasonalMode(btn.dataset.mode);
  });

  async function populateSeasonalItemDatalist() {
    const [purchases, sales] = await Promise.all([dbGetAll('seasonalPurchases'), dbGetAll('seasonalSales')]);
    const names = new Set([...purchases.map((p) => p.itemName), ...sales.map((s) => s.itemName)]);
    document.getElementById('spItemDatalist').innerHTML = [...names].map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  async function renderSeasonal() {
    document.getElementById('spDate').value = todayKey();
    document.getElementById('ssDate').value = todayKey();
    document.getElementById('spDateReadout').textContent = formatDateReadable(todayKey());
    document.getElementById('ssDateReadout').textContent = formatDateReadable(todayKey());
    await populateSeasonalItemDatalist();
    switchSeasonalMode(state.seasonalMode || 'purchase');
  }

  function recalcSeasonalAmount(qtyId, rateId, amountId) {
    const qty = parseFloat(document.getElementById(qtyId).value) || 0;
    const rate = parseFloat(document.getElementById(rateId).value) || 0;
    document.getElementById(amountId).value = qty && rate ? Math.round(qty * rate) : '';
  }
  document.getElementById('spQty').addEventListener('input', () => recalcSeasonalAmount('spQty', 'spRate', 'spAmount'));
  document.getElementById('spRate').addEventListener('input', () => recalcSeasonalAmount('spQty', 'spRate', 'spAmount'));
  document.getElementById('ssQty').addEventListener('input', () => recalcSeasonalAmount('ssQty', 'ssRate', 'ssAmount'));
  document.getElementById('ssRate').addEventListener('input', () => recalcSeasonalAmount('ssQty', 'ssRate', 'ssAmount'));

  async function renderSeasonalPurchaseList() {
    const all = await dbGetAll('seasonalPurchases');
    all.sort((a, b) => b.timestamp - a.timestamp);
    const list = document.getElementById('seasonalPurchaseList');
    list.innerHTML = all.length ? all.slice(0, 25).map((p) => `
      <div class="order-row">
        <div class="order-row__left">
          <span class="order-row__name">${escapeHtml(p.itemName)} · ${p.qty} ${escapeHtml(p.unit || 'unit')}</span>
          <span class="order-row__meta">${p.supplier ? escapeHtml(p.supplier) + ' · ' : ''}${p.dateKey}</span>
        </div>
        <div class="order-row__amount">${rupee(p.amount)}</div>
        <button class="order-row__edit-order" data-id="${p.id}">Edit</button>
        <button class="order-row__delete" data-id="${p.id}" aria-label="Delete purchase">&times;</button>
      </div>`).join('') : '<div class="order-log__empty">No seasonal purchases logged yet.</div>';
    list.querySelectorAll('.order-row__delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this purchase entry?')) return;
        try {
          await dbDelete('seasonalPurchases', btn.dataset.id);
          renderSeasonalPurchaseList();
          toast('Deleted');
        } catch (err) {
          console.error('Delete seasonal purchase failed:', err);
          toast('Delete failed — try again');
        }
      });
    });
    list.querySelectorAll('.order-row__edit-order').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = all.find((x) => x.id === btn.dataset.id);
        if (!p) return;
        state.editingSeasonalPurchaseId = p.id;
        document.getElementById('spDate').value = p.dateKey;
        document.getElementById('spDateReadout').textContent = formatDateReadable(p.dateKey);
        document.getElementById('spItemInput').value = p.itemName;
        document.getElementById('spUnit').value = p.unit || '';
        document.getElementById('spQty').value = p.qty;
        document.getElementById('spRate').value = p.rate;
        document.getElementById('spAmount').value = p.amount;
        document.getElementById('spSupplier').value = p.supplier || '';
        document.getElementById('spNotes').value = p.notes || '';
        document.getElementById('spPayment').value = p.payment || 'Cash';
        document.getElementById('saveSeasonalPurchaseBtn').textContent = 'Update Purchase';
        document.getElementById('cancelEditSeasonalPurchaseBtn').hidden = false;
      });
    });
  }

  function resetSeasonalPurchaseForm() {
    state.editingSeasonalPurchaseId = null;
    document.getElementById('spItemInput').value = '';
    document.getElementById('spUnit').value = '';
    document.getElementById('spQty').value = '';
    document.getElementById('spRate').value = '';
    document.getElementById('spAmount').value = '';
    document.getElementById('spSupplier').value = '';
    document.getElementById('spNotes').value = '';
    document.getElementById('spPayment').value = 'Cash';
    document.getElementById('spDate').value = todayKey();
    document.getElementById('spDateReadout').textContent = formatDateReadable(todayKey());
    document.getElementById('saveSeasonalPurchaseBtn').textContent = 'Save Purchase';
    document.getElementById('cancelEditSeasonalPurchaseBtn').hidden = true;
  }
  document.getElementById('cancelEditSeasonalPurchaseBtn').addEventListener('click', resetSeasonalPurchaseForm);

  async function renderSeasonalSaleList() {
    const all = await dbGetAll('seasonalSales');
    all.sort((a, b) => b.timestamp - a.timestamp);
    const list = document.getElementById('seasonalSaleList');
    list.innerHTML = all.length ? all.slice(0, 25).map((s) => `
      <div class="order-row">
        <div class="order-row__left">
          <span class="order-row__name">${escapeHtml(s.itemName)} · ${s.qty} ${escapeHtml(s.unit || 'unit')}</span>
          <span class="order-row__meta">${s.customerName ? escapeHtml(s.customerName) + ' · ' : ''}${s.dateKey} · ${s.payment}</span>
        </div>
        <div class="order-row__amount">${rupee(s.amount)}</div>
        <button class="order-row__edit-order" data-id="${s.id}">Edit</button>
        <button class="order-row__delete" data-id="${s.id}" aria-label="Delete sale">&times;</button>
      </div>`).join('') : '<div class="order-log__empty">No seasonal sales logged yet.</div>';
    list.querySelectorAll('.order-row__delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this sale entry?')) return;
        try {
          await dbDelete('seasonalSales', btn.dataset.id);
          renderSeasonalSaleList();
          toast('Deleted');
        } catch (err) {
          console.error('Delete seasonal sale failed:', err);
          toast('Delete failed — try again');
        }
      });
    });
    list.querySelectorAll('.order-row__edit-order').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = all.find((x) => x.id === btn.dataset.id);
        if (!s) return;
        state.editingSeasonalSaleId = s.id;
        document.getElementById('ssDate').value = s.dateKey;
        document.getElementById('ssDateReadout').textContent = formatDateReadable(s.dateKey);
        document.getElementById('ssItemInput').value = s.itemName;
        document.getElementById('ssUnit').value = s.unit || '';
        document.getElementById('ssQty').value = s.qty;
        document.getElementById('ssRate').value = s.rate;
        document.getElementById('ssAmount').value = s.amount;
        document.getElementById('ssCustomer').value = s.customerName || '';
        document.getElementById('ssMobile').value = s.mobile || '';
        document.getElementById('ssPayment').value = s.payment || 'Cash';
        document.getElementById('saveSeasonalSaleBtn').textContent = 'Update Sale';
        document.getElementById('cancelEditSeasonalSaleBtn').hidden = false;
      });
    });
  }

  function resetSeasonalSaleForm() {
    state.editingSeasonalSaleId = null;
    document.getElementById('ssItemInput').value = '';
    document.getElementById('ssUnit').value = '';
    document.getElementById('ssQty').value = '';
    document.getElementById('ssRate').value = '';
    document.getElementById('ssAmount').value = '';
    document.getElementById('ssCustomer').value = '';
    document.getElementById('ssMobile').value = '';
    document.getElementById('ssPayment').value = 'Cash';
    document.getElementById('ssDate').value = todayKey();
    document.getElementById('ssDateReadout').textContent = formatDateReadable(todayKey());
    document.getElementById('saveSeasonalSaleBtn').textContent = 'Save Sale';
    document.getElementById('cancelEditSeasonalSaleBtn').hidden = true;
  }
  document.getElementById('cancelEditSeasonalSaleBtn').addEventListener('click', resetSeasonalSaleForm);

  document.getElementById('saveSeasonalPurchaseBtn').addEventListener('click', async () => {
    const itemName = document.getElementById('spItemInput').value.trim();
    const qty = parseFloat(document.getElementById('spQty').value) || 0;
    if (!itemName) { toast('Enter an item name'); return; }
    if (!qty) { toast('Enter a quantity'); return; }
    const rate = parseFloat(document.getElementById('spRate').value) || 0;
    const amount = parseFloat(document.getElementById('spAmount').value) || qty * rate;
    const isEdit = !!state.editingSeasonalPurchaseId;
    try {
      const record = {
        id: state.editingSeasonalPurchaseId || uid(),
        dateKey: document.getElementById('spDate').value || todayKey(),
        timestamp: isEdit ? (await dbGet('seasonalPurchases', state.editingSeasonalPurchaseId)).timestamp : Date.now(),
        itemName,
        unit: document.getElementById('spUnit').value.trim(),
        qty, rate, amount,
        supplier: document.getElementById('spSupplier').value.trim(),
        notes: document.getElementById('spNotes').value.trim(),
        payment: document.getElementById('spPayment').value,
      };
      if (isEdit) {
        const old = await dbGet('seasonalPurchases', state.editingSeasonalPurchaseId);
        record.udharCleared = old.udharCleared;
        record.udharClearedDate = old.udharClearedDate;
      }
      await dbPut('seasonalPurchases', record);
      resetSeasonalPurchaseForm();
      await populateSeasonalItemDatalist();
      renderSeasonalPurchaseList();
      toast(isEdit ? 'Purchase updated' : 'Purchase saved');
    } catch (err) {
      console.error('Save seasonal purchase failed:', err);
      toast('Save failed — try again');
    }
  });

  document.getElementById('saveSeasonalSaleBtn').addEventListener('click', async () => {
    const itemName = document.getElementById('ssItemInput').value.trim();
    const qty = parseFloat(document.getElementById('ssQty').value) || 0;
    if (!itemName) { toast('Enter an item name'); return; }
    if (!qty) { toast('Enter a quantity'); return; }
    const rate = parseFloat(document.getElementById('ssRate').value) || 0;
    const amount = parseFloat(document.getElementById('ssAmount').value) || qty * rate;
    const isEdit = !!state.editingSeasonalSaleId;
    try {
      const record = {
        id: state.editingSeasonalSaleId || uid(),
        dateKey: document.getElementById('ssDate').value || todayKey(),
        timestamp: isEdit ? (await dbGet('seasonalSales', state.editingSeasonalSaleId)).timestamp : Date.now(),
        itemName,
        unit: document.getElementById('ssUnit').value.trim(),
        qty, rate, amount,
        customerName: document.getElementById('ssCustomer').value.trim(),
        mobile: document.getElementById('ssMobile').value.trim(),
        payment: document.getElementById('ssPayment').value,
      };
      if (isEdit) {
        const old = await dbGet('seasonalSales', state.editingSeasonalSaleId);
        record.udharCleared = old.udharCleared;
        record.udharClearedDate = old.udharClearedDate;
      }
      await dbPut('seasonalSales', record);
      resetSeasonalSaleForm();
      await populateSeasonalItemDatalist();
      renderSeasonalSaleList();
      toast(isEdit ? 'Sale updated' : 'Sale saved');
    } catch (err) {
      console.error('Save seasonal sale failed:', err);
      toast('Save failed — try again');
    }
  });

  async function renderSeasonalSummary() {
    const [purchases, sales] = await Promise.all([dbGetAll('seasonalPurchases'), dbGetAll('seasonalSales')]);
    const monthPrefix = todayKey().slice(0, 7);
    const monthPurchases = purchases.filter((p) => p.dateKey.startsWith(monthPrefix));
    const monthSales = sales.filter((s) => s.dateKey.startsWith(monthPrefix));

    const mSalesTotal = monthSales.reduce((s, x) => s + x.amount, 0);
    const mPurchTotal = monthPurchases.reduce((s, x) => s + x.amount, 0);
    document.getElementById('seasonalMonthLabel').textContent = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    document.getElementById('seasonalMonthSales').textContent = rupee(mSalesTotal);
    document.getElementById('seasonalMonthPurchases').textContent = rupee(mPurchTotal);
    document.getElementById('seasonalMonthProfit').textContent = rupee(mSalesTotal - mPurchTotal);

    const aSalesTotal = sales.reduce((s, x) => s + x.amount, 0);
    const aPurchTotal = purchases.reduce((s, x) => s + x.amount, 0);
    document.getElementById('seasonalAllSales').textContent = rupee(aSalesTotal);
    document.getElementById('seasonalAllPurchases').textContent = rupee(aPurchTotal);
    document.getElementById('seasonalAllProfit').textContent = rupee(aSalesTotal - aPurchTotal);

    const byItem = {};
    monthSales.forEach((s) => {
      if (!byItem[s.itemName]) byItem[s.itemName] = { qty: 0, amount: 0, unit: s.unit || '' };
      byItem[s.itemName].qty += s.qty;
      byItem[s.itemName].amount += s.amount;
    });
    const rows = Object.entries(byItem).sort((a, b) => b[1].amount - a[1].amount);
    document.getElementById('seasonalByItem').innerHTML = rows.length
      ? rows.map(([name, d]) => `<div class="close-row"><span>${escapeHtml(name)} (${d.qty}${d.unit ? ' ' + escapeHtml(d.unit) : ''})</span><span>${rupee(d.amount)}</span></div>`).join('')
      : '<div class="close-row"><span>No sales logged this month yet</span><span></span></div>';
  }

  /* ---------------- UDHAR — consolidated receivables + payables, both businesses ---------------- */

  // People who owe US money — merges food-shop orders (customerKeyOf: mobile-first)
  // with Seasonal Biz sales (same key scheme now that Seasonal Sale also has a Mobile field).
  function buildReceivablesDirectory() {
    const map = new Map();
    for (const o of (state.allOrders || [])) {
      const key = customerKeyOf(o);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, name: o.customerName || o.mobile || 'Customer', udharGiven: 0, foodGiven: 0, seasonalGiven: 0, lastActivity: 0 });
      const c = map.get(key);
      if (o.payment === 'Udhar' && !o.udharCleared) { c.udharGiven += o.grandTotal; c.foodGiven += o.grandTotal; }
      if (o.timestamp > c.lastActivity) c.lastActivity = o.timestamp;
      if (o.customerName) c.name = o.customerName;
    }
    for (const s of (state.allSeasonalSales || [])) {
      const key = (s.mobile && s.mobile.trim()) || (s.customerName && s.customerName.trim().toLowerCase()) || null;
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, name: s.customerName || s.mobile || 'Customer', udharGiven: 0, foodGiven: 0, seasonalGiven: 0, lastActivity: 0 });
      const c = map.get(key);
      if (s.payment === 'Udhar' && !s.udharCleared) { c.udharGiven += s.amount; c.seasonalGiven += s.amount; }
      if (s.timestamp > c.lastActivity) c.lastActivity = s.timestamp;
      if (s.customerName) c.name = s.customerName;
    }
    for (const p of (state.allPayments || [])) {
      const c = map.get(p.customerKey);
      if (c) c.udharPaid = (c.udharPaid || 0) + p.amount;
    }
    return Array.from(map.values())
      .map((c) => ({ ...c, udharBalance: Math.max(0, c.udharGiven - (c.udharPaid || 0)) }))
      .filter((c) => c.udharBalance > 0)
      .sort((a, b) => b.udharBalance - a.udharBalance);
  }

  // Individual pending (not-yet-cleared) Udhar entries owed to us by a given customer key —
  // powers the "tap Cleared on this specific entry" list in the ledger modal.
  function pendingReceivablesFor(key) {
    const items = [];
    for (const o of (state.allOrders || [])) {
      if (o.payment !== 'Udhar' || o.udharCleared) continue;
      if (customerKeyOf(o) !== key) continue;
      const itemCount = o.items.reduce((s, i) => s + i.qty, 0);
      items.push({ store: 'orders', id: o.id, date: o.dateKey, amount: o.grandTotal, label: `Food order · ${itemCount} item${itemCount !== 1 ? 's' : ''}` });
    }
    for (const s of (state.allSeasonalSales || [])) {
      if (s.payment !== 'Udhar' || s.udharCleared) continue;
      const sKey = (s.mobile && s.mobile.trim()) || (s.customerName && s.customerName.trim().toLowerCase()) || null;
      if (sKey !== key) continue;
      items.push({ store: 'seasonalSales', id: s.id, date: s.dateKey, amount: s.amount, label: `Seasonal · ${s.itemName}` });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  // People WE owe money to — merges food-shop Purchases + Seasonal Biz Purchases,
  // grouped by supplier name (both forms use the same free-text Supplier field).
  function buildPayablesDirectory() {
    const map = new Map();
    for (const p of (state.allPurchases || [])) {
      const key = p.supplier ? p.supplier.trim().toLowerCase() : null;
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, name: p.supplier, udharGiven: 0, foodGiven: 0, seasonalGiven: 0, lastActivity: 0 });
      const s = map.get(key);
      if (p.payment === 'Udhar' && !p.udharCleared) { s.udharGiven += p.amount; s.foodGiven += p.amount; }
      if (p.timestamp > s.lastActivity) s.lastActivity = p.timestamp;
      if (p.supplier) s.name = p.supplier;
    }
    for (const p of (state.allSeasonalPurchases || [])) {
      const key = p.supplier ? p.supplier.trim().toLowerCase() : null;
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, name: p.supplier, udharGiven: 0, foodGiven: 0, seasonalGiven: 0, lastActivity: 0 });
      const s = map.get(key);
      if (p.payment === 'Udhar' && !p.udharCleared) { s.udharGiven += p.amount; s.seasonalGiven += p.amount; }
      if (p.timestamp > s.lastActivity) s.lastActivity = p.timestamp;
      if (p.supplier) s.name = p.supplier;
    }
    for (const pay of (state.allSupplierPayments || [])) {
      const s = map.get(pay.supplierKey);
      if (s) s.udharPaid = (s.udharPaid || 0) + pay.amount;
    }
    return Array.from(map.values())
      .map((s) => ({ ...s, udharBalance: Math.max(0, s.udharGiven - (s.udharPaid || 0)) }))
      .filter((s) => s.udharBalance > 0)
      .sort((a, b) => b.udharBalance - a.udharBalance);
  }

  // Individual pending (not-yet-cleared) Udhar purchases owed to a given supplier key.
  function pendingPayablesFor(key) {
    const items = [];
    for (const p of (state.allPurchases || [])) {
      if (p.payment !== 'Udhar' || p.udharCleared) continue;
      const pKey = p.supplier ? p.supplier.trim().toLowerCase() : null;
      if (pKey !== key) continue;
      items.push({ store: 'purchases', id: p.id, date: p.dateKey, amount: p.amount, label: `Food shop · ${p.itemName}` });
    }
    for (const p of (state.allSeasonalPurchases || [])) {
      if (p.payment !== 'Udhar' || p.udharCleared) continue;
      const pKey = p.supplier ? p.supplier.trim().toLowerCase() : null;
      if (pKey !== key) continue;
      items.push({ store: 'seasonalPurchases', id: p.id, date: p.dateKey, amount: p.amount, label: `Seasonal · ${p.itemName}` });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Marks one specific transaction as cleared (paid off), stamped with today's date,
  // rather than recording a generic lump payment against the running balance.
  async function markUdharCleared(store, id, clearedDate) {
    try {
      const rec = await dbGet(store, id);
      if (!rec) return;
      rec.udharCleared = true;
      rec.udharClearedDate = clearedDate || todayKey();
      await dbPut(store, rec);
      await loadAllCreditData();
      toast('Marked cleared');
    } catch (err) {
      console.error('Mark cleared failed:', err);
      toast('Save failed — try again');
    }
  }

  function pendingEntryRowHTML(item) {
    return `
      <div class="order-row">
        <div class="order-row__left">
          <span class="order-row__name">${escapeHtml(item.label)}</span>
          <span class="order-row__meta">${item.date}</span>
        </div>
        <div class="order-row__amount">${rupee(item.amount)}</div>
        <input type="date" class="clear-date-input" data-clear-date-for="${item.id}" value="${todayKey()}" />
        <button class="order-row__clear" data-store="${item.store}" data-id="${item.id}">Cleared</button>
      </div>`;
  }

  function businessSplitLine(foodAmt, seasonalAmt) {
    if (foodAmt > 0 && seasonalAmt > 0) return `Food ${rupee(foodAmt)} · Seasonal ${rupee(seasonalAmt)}`;
    if (seasonalAmt > 0) return 'Seasonal Biz only';
    return 'Food shop only';
  }

  async function renderUdharTab() {
    await loadAllCreditData();

    const receivables = buildReceivablesDirectory();
    const custList = document.getElementById('udharCustomerList');
    custList.innerHTML = receivables.length
      ? receivables.map((c) => `
        <div class="item-row">
          <div>
            <div class="item-row__name">${escapeHtml(c.name)}</div>
            <div class="item-row__sub"><strong>${rupee(c.udharBalance)}</strong> owed to you · ${businessSplitLine(c.foodGiven, c.seasonalGiven)}</div>
          </div>
          <button class="item-row__edit" data-key="${escapeHtml(c.key)}">Ledger</button>
        </div>`).join('')
      : '<div class="empty-hint">Nobody owes you money right now.</div>';
    custList.querySelectorAll('.item-row__edit').forEach((btn) => {
      btn.addEventListener('click', () => openCustomerModal(btn.dataset.key));
    });

    const payables = buildPayablesDirectory();
    const supList = document.getElementById('udharSupplierList');
    supList.innerHTML = payables.length
      ? payables.map((s) => `
        <div class="item-row">
          <div>
            <div class="item-row__name">${escapeHtml(s.name)}</div>
            <div class="item-row__sub"><strong>${rupee(s.udharBalance)}</strong> you owe · ${businessSplitLine(s.foodGiven, s.seasonalGiven)}</div>
          </div>
          <button class="item-row__edit" data-key="${escapeHtml(s.key)}">Ledger</button>
        </div>`).join('')
      : '<div class="empty-hint">You don\'t owe any suppliers right now.</div>';
    supList.querySelectorAll('.item-row__edit').forEach((btn) => {
      btn.addEventListener('click', () => openSupplierModal(btn.dataset.key));
    });
  }

  async function openSupplierModal(key) {
    state.activeSupplierKey = key;
    const suppliers = buildPayablesDirectory();
    const s = suppliers.find((x) => x.key === key);
    if (!s) return;

    document.getElementById('supModalName').textContent = s.name;
    document.getElementById('supTotal').textContent = rupee(s.udharGiven);
    document.getElementById('supBalance').textContent = rupee(s.udharBalance);
    document.getElementById('supPaymentAmount').value = '';

    const pending = pendingPayablesFor(key);
    const pendingEl = document.getElementById('supPendingList');
    pendingEl.innerHTML = pending.length
      ? pending.map(pendingEntryRowHTML).join('')
      : '<div class="order-log__empty">Nothing pending — fully cleared.</div>';
    pendingEl.querySelectorAll('.order-row__clear').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const dateInput = pendingEl.querySelector(`[data-clear-date-for="${btn.dataset.id}"]`);
        await markUdharCleared(btn.dataset.store, btn.dataset.id, dateInput ? dateInput.value : null);
        openSupplierModal(key);
        renderUdharTab();
      });
    });

    const payments = (state.allSupplierPayments || []).filter((p) => p.supplierKey === key).sort((a, b) => b.timestamp - a.timestamp);
    const histEl = document.getElementById('supPaymentHistory');
    histEl.innerHTML = payments.length
      ? payments.map((p) => `
        <div class="order-row">
          <div class="order-row__left">
            <span class="order-row__name">Payment made</span>
            <span class="order-row__meta">${new Date(p.timestamp).toLocaleDateString('en-IN')}</span>
          </div>
          <div class="order-row__amount">${rupee(p.amount)}</div>
        </div>`).join('')
      : '<div class="order-log__empty">No payments recorded yet.</div>';

    document.getElementById('supModalBackdrop').hidden = false;
  }

  document.getElementById('supModalClose').addEventListener('click', () => {
    document.getElementById('supModalBackdrop').hidden = true;
  });
  document.getElementById('supModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'supModalBackdrop') document.getElementById('supModalBackdrop').hidden = true;
  });

  document.getElementById('supPaymentBtn').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('supPaymentAmount').value) || 0;
    if (!amount || !state.activeSupplierKey) { toast('Enter a payment amount'); return; }
    try {
      await dbPut('supplierPayments', {
        id: uid(),
        supplierKey: state.activeSupplierKey,
        amount,
        timestamp: Date.now(),
      });
      await loadAllCreditData();
      toast('Payment recorded');
      openSupplierModal(state.activeSupplierKey);
      renderUdharTab();
    } catch (err) {
      console.error('Record supplier payment failed:', err);
      toast('Save failed — try again');
    }
  });

  /* ---------------- CLOSE DAY ---------------- */
  async function renderCloseDay() {
    await loadTodayOrders();
    await loadTodayFootfall();
    const { exp, pur } = await loadTodayExpensesAndPurchases();

    const sales = state.todayOrders.reduce((s, o) => s + o.grandTotal, 0);
    const rawProfit = state.todayOrders.reduce((s, o) => s + o.profit, 0);
    const cash = state.todayOrders.filter((o) => o.payment === 'Cash').reduce((s, o) => s + o.grandTotal, 0);
    const upi = state.todayOrders.filter((o) => o.payment === 'UPI').reduce((s, o) => s + o.grandTotal, 0);
    const udhar = state.todayOrders.filter((o) => o.payment === 'Udhar').reduce((s, o) => s + o.grandTotal, 0);
    const offline = state.todayOrders.filter((o) => o.source === 'Offline').reduce((s, o) => s + o.grandTotal, 0);
    const online = state.todayOrders.filter((o) => o.source !== 'Offline').reduce((s, o) => s + o.grandTotal, 0);
    const aov = state.todayOrders.length ? sales / state.todayOrders.length : 0;
    const expensesTotal = exp.reduce((s, e) => s + e.amount, 0);
    const purchasesTotal = pur.reduce((s, p) => s + p.amount, 0);
    const profit = rawProfit - expensesTotal;

    document.getElementById('closeDate').textContent = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });

    const rows = [
      ['Footfall', state.todayFootfall.count],
      ['Customers Attended', state.todayFootfall.buying || 0],
      ['Orders', state.todayOrders.length],
      ['Avg Order Value', rupee(aov)],
      ['Sales', rupee(sales)],
      ['Offline', rupee(offline)],
      ['Online (Zomato/Swiggy)', rupee(online)],
      ['Cash', rupee(cash)],
      ['UPI', rupee(upi)],
      ['Udhar (today)', rupee(udhar)],
      ['Expenses', rupee(expensesTotal)],
      ['Purchases', rupee(purchasesTotal)],
    ];
    document.getElementById('closeRows').innerHTML = rows.map(([label, val]) =>
      `<div class="close-row"><span>${label}</span><span>${val}</span></div>`
    ).join('') + `<div class="close-row close-row--total"><span>Profit</span><span>${rupee(profit)}</span></div>`;

    const existing = await dbGet('closings', todayKey());
    document.getElementById('closeDayBtn').textContent = existing ? 'Re-Close Day (Update)' : 'Close Day';

    await renderClosedHistory();
  }

  async function renderClosedHistory() {
    const all = await dbGetAll('closings');
    all.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    const list = document.getElementById('closedHistoryList');
    if (!all.length) {
      list.innerHTML = '<div class="order-log__empty">No days closed yet.</div>';
      return;
    }
    list.innerHTML = all.slice(0, 30).map((c) => `
      <div class="order-row">
        <div class="order-row__left">
          <span class="order-row__name">${c.dateKey}</span>
          <span class="order-row__meta">${c.orders} orders · AOV ${rupee(c.aov || (c.orders ? c.sales / c.orders : 0))} · Footfall ${c.footfall}</span>
        </div>
        <div class="order-row__amount">${rupee(c.sales)}</div>
        <button class="item-row__edit" data-view-date="${c.dateKey}" style="margin-left:6px;">View</button>
        <button class="order-row__edit-order" data-edit-date="${c.dateKey}">Edit</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-view-date]').forEach((btn) => {
      btn.addEventListener('click', () => openClosingDetail(btn.dataset.viewDate));
    });
    list.querySelectorAll('[data-edit-date]').forEach((btn) => {
      btn.addEventListener('click', () => openClosingEdit(btn.dataset.editDate));
    });
  }

  const CLOSING_FIELDS = [
    ['footfall', 'Footfall'], ['buyingCustomers', 'Customers Attended'], ['orders', 'Orders'],
    ['sales', 'Sales ₹'], ['offline', 'Offline ₹'], ['online', 'Online ₹'],
    ['cash', 'Cash ₹'], ['upi', 'UPI ₹'], ['udhar', 'Udhar ₹'],
    ['expenses', 'Expenses ₹'], ['purchases', 'Purchases ₹'], ['profit', 'Profit ₹'],
  ];

  async function openClosingDetail(dateKey) {
    const c = await dbGet('closings', dateKey);
    if (!c) return;
    state.editingClosingDate = null;
    const aov = c.aov !== undefined ? c.aov : (c.orders ? c.sales / c.orders : 0);
    document.getElementById('closingDetailTitle').textContent = c.dateKey;
    const rows = [
      ['Footfall', c.footfall || 0],
      ['Customers Attended', c.buyingCustomers !== undefined ? c.buyingCustomers : (c.orders || 0)],
      ['Orders', c.orders || 0],
      ['Avg Order Value', rupee(aov)],
      ['Sales', rupee(c.sales || 0)],
      ['Offline', rupee(c.offline !== undefined ? c.offline : (c.sales || 0))],
      ['Online (Zomato/Swiggy)', rupee(c.online || 0)],
      ['Cash', rupee(c.cash || 0)],
      ['UPI', rupee(c.upi || 0)],
      ['Udhar (that day)', rupee(c.udhar || 0)],
      ['Expenses', rupee(c.expenses || 0)],
      ['Purchases', rupee(c.purchases || 0)],
    ];
    document.getElementById('closingDetailRows').innerHTML = rows.map(([label, val]) =>
      `<div class="close-row"><span>${label}</span><span>${val}</span></div>`
    ).join('') + `<div class="close-row close-row--total"><span>Profit</span><span>${rupee(c.profit || 0)}</span></div>`;
    document.getElementById('closingDetailNote').hidden = c.offline !== undefined;
    document.getElementById('closingDetailSaveBtn').hidden = true;
    document.getElementById('closingDetailBackdrop').hidden = false;
  }

  async function openClosingEdit(dateKey) {
    const c = await dbGet('closings', dateKey);
    if (!c) return;
    state.editingClosingDate = dateKey;
    document.getElementById('closingDetailTitle').textContent = `Editing ${c.dateKey}`;
    document.getElementById('closingDetailNote').hidden = true;
    document.getElementById('closingDetailRows').innerHTML = CLOSING_FIELDS.map(([field, label]) => `
      <div class="close-row">
        <span>${label}</span>
        <input type="number" step="0.01" data-closing-field="${field}" value="${c[field] || 0}" style="width:110px; text-align:right;" />
      </div>
    `).join('');
    document.getElementById('closingDetailSaveBtn').hidden = false;
    document.getElementById('closingDetailBackdrop').hidden = false;
  }

  document.getElementById('closingDetailSaveBtn').addEventListener('click', async () => {
    if (!state.editingClosingDate) return;
    try {
      const c = await dbGet('closings', state.editingClosingDate);
      if (!c) return;
      document.querySelectorAll('#closingDetailRows [data-closing-field]').forEach((inp) => {
        c[inp.dataset.closingField] = parseFloat(inp.value) || 0;
      });
      // AOV is derived, keep it consistent with the corrected sales/orders.
      c.aov = c.orders ? c.sales / c.orders : 0;
      await dbPut('closings', c);
      toast('Closing updated');
      document.getElementById('closingDetailBackdrop').hidden = true;
      renderClosedHistory();
    } catch (err) {
      console.error('Save closing edit failed:', err);
      toast('Save failed — try again');
    }
  });

  document.getElementById('closingDetailClose').addEventListener('click', () => {
    document.getElementById('closingDetailBackdrop').hidden = true;
  });
  document.getElementById('closingDetailBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'closingDetailBackdrop') document.getElementById('closingDetailBackdrop').hidden = true;
  });

  document.getElementById('closeDayBtn').addEventListener('click', async () => {
    await loadTodayOrders();
    await loadTodayFootfall();
    const { exp, pur } = await loadTodayExpensesAndPurchases();
    const sales = state.todayOrders.reduce((s, o) => s + o.grandTotal, 0);
    const rawProfit = state.todayOrders.reduce((s, o) => s + o.profit, 0);
    const cash = state.todayOrders.filter((o) => o.payment === 'Cash').reduce((s, o) => s + o.grandTotal, 0);
    const upi = state.todayOrders.filter((o) => o.payment === 'UPI').reduce((s, o) => s + o.grandTotal, 0);
    const udhar = state.todayOrders.filter((o) => o.payment === 'Udhar').reduce((s, o) => s + o.grandTotal, 0);
    const offline = state.todayOrders.filter((o) => o.source === 'Offline').reduce((s, o) => s + o.grandTotal, 0);
    const online = state.todayOrders.filter((o) => o.source !== 'Offline').reduce((s, o) => s + o.grandTotal, 0);
    const aov = state.todayOrders.length ? sales / state.todayOrders.length : 0;
    const expensesTotal = exp.reduce((s, e) => s + e.amount, 0);
    const purchasesTotal = pur.reduce((s, p) => s + p.amount, 0);
    const profit = rawProfit - expensesTotal;

    const record = {
      dateKey: todayKey(),
      sales, profit, cash, upi, udhar, offline, online, aov,
      orders: state.todayOrders.length,
      footfall: state.todayFootfall.count || 0,
      buyingCustomers: state.todayFootfall.buying || 0,
      expenses: expensesTotal,
      purchases: purchasesTotal,
      closedAt: Date.now(),
    };
    await dbPut('closings', record);
    toast('Day closed');
    renderCloseDay();
  });

  /* ---------------- GLOBAL ERROR SAFETY NET ---------------- */
  // Save/delete handlers are async with no per-site try/catch. If a DB write
  // ever throws (quota, corrupted record, etc), it used to fail silently —
  // button visibly "does nothing." This catches it and surfaces a toast.
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled error:', e.reason);
    toast('Something went wrong — please try again');
    e.preventDefault();
  });
  window.addEventListener('error', (e) => {
    console.error('Script error:', e.error || e.message);
  });

  /* ---------------- TAB NAV ---------------- */
  document.querySelectorAll('.tabbar__btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  /* ---------------- HELP ---------------- */
  document.getElementById('helpBtn').addEventListener('click', () => {
    document.getElementById('helpModalBackdrop').hidden = false;
  });
  document.getElementById('helpModalClose').addEventListener('click', () => {
    document.getElementById('helpModalBackdrop').hidden = true;
  });
  document.getElementById('helpModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'helpModalBackdrop') document.getElementById('helpModalBackdrop').hidden = true;
  });

  /* ---------------- SETTINGS / RESET ---------------- */
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('appVersionLabel').textContent = APP_VERSION;
    document.getElementById('settingsModalBackdrop').hidden = false;
  });
  document.getElementById('settingsModalClose').addEventListener('click', () => {
    document.getElementById('settingsModalBackdrop').hidden = true;
  });
  document.getElementById('settingsModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModalBackdrop') document.getElementById('settingsModalBackdrop').hidden = true;
  });

  /* ----- Backup / Restore ----- */
  document.getElementById('exportBackupBtn').addEventListener('click', async () => {
    try {
      const backup = { app: 'akash-food-point-os', exportedAt: new Date().toISOString(), version: 1, data: {} };
      for (const store of STORES) {
        backup.data[store] = await dbGetAll(store);
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `akash-food-point-backup-${todayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Backup downloaded');
    } catch (err) {
      console.error('Backup export failed:', err);
      toast('Backup failed — try again');
    }
  });

  document.getElementById('restoreBackupBtn').addEventListener('click', () => {
    document.getElementById('restoreFileInput').click();
  });

  document.getElementById('restoreFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (err) {
      toast('That file isn\'t a valid backup');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.data) {
      toast('That file isn\'t a valid backup');
      return;
    }

    const sure = window.confirm(
      'This will REPLACE all current data on this device with the contents of this backup. This cannot be undone.\n\nContinue?'
    );
    if (!sure) return;

    try {
      for (const store of STORES) {
        await dbClear(store);
        const records = Array.isArray(parsed.data[store]) ? parsed.data[store] : [];
        for (const rec of records) await dbPut(store, rec);
      }
      toast('Backup restored — restarting...');
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      console.error('Restore failed:', err);
      toast('Restore failed partway — please try again');
    }
  });

  /* ----- Export to Excel (CSV) — for viewing/analysis, not restore ----- */
  function csvCell(val) {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCSV(headers, rows) {
    return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  }
  function downloadCSV(filename, csvText) {
    // Leading BOM so Excel opens UTF-8 (₹ symbol etc.) correctly instead of garbling it.
    const blob = new Blob(['\ufeff' + csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.getElementById('exportOrdersCsvBtn').addEventListener('click', async () => {
    try {
      const orders = await dbGetAll('orders');
      if (!orders.length) { toast('No orders to export yet'); return; }
      orders.sort((a, b) => a.timestamp - b.timestamp);
      const headers = ['Date', 'Time', 'Customer', 'Mobile', 'Source', 'Payment', 'Items', 'Subtotal', 'Discount', 'Grand Total', 'Food Cost', 'Profit'];
      const rows = orders.map((o) => [
        o.dateKey,
        new Date(o.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        o.customerName || '',
        o.mobile || '',
        o.source,
        o.payment,
        o.items.map((i) => `${i.name} x${i.qty}`).join('; '),
        o.subtotal,
        o.discount,
        o.grandTotal,
        o.foodCostTotal,
        o.profit,
      ]);
      downloadCSV(`akash-food-point-orders-${todayKey()}.csv`, toCSV(headers, rows));
      toast('Orders CSV downloaded');
    } catch (err) {
      console.error('Orders CSV export failed:', err);
      toast('Export failed — try again');
    }
  });

  document.getElementById('exportPurchasesCsvBtn').addEventListener('click', async () => {
    try {
      const purchases = await dbGetAll('purchases');
      if (!purchases.length) { toast('No purchases to export yet'); return; }
      purchases.sort((a, b) => a.timestamp - b.timestamp);
      const headers = ['Date', 'Item', 'Quantity', 'Unit', 'Rate', 'Amount', 'Supplier', 'Payment', 'Notes'];
      const rows = purchases.map((p) => [p.dateKey, p.itemName, p.qty, p.unit || '', p.rate, p.amount, p.supplier || '', p.payment, p.notes || '']);
      downloadCSV(`akash-food-point-purchases-${todayKey()}.csv`, toCSV(headers, rows));
      toast('Purchases CSV downloaded');
    } catch (err) {
      console.error('Purchases CSV export failed:', err);
      toast('Export failed — try again');
    }
  });

  document.getElementById('exportExpensesCsvBtn').addEventListener('click', async () => {
    try {
      const expenses = await dbGetAll('expenses');
      if (!expenses.length) { toast('No expenses to export yet'); return; }
      expenses.sort((a, b) => a.timestamp - b.timestamp);
      const headers = ['Date', 'Category', 'Amount', 'Notes'];
      const rows = expenses.map((e) => [e.dateKey, e.category, e.amount, e.notes || '']);
      downloadCSV(`akash-food-point-expenses-${todayKey()}.csv`, toCSV(headers, rows));
      toast('Expenses CSV downloaded');
    } catch (err) {
      console.error('Expenses CSV export failed:', err);
      toast('Export failed — try again');
    }
  });

  document.getElementById('exportSeasonalPurchasesCsvBtn').addEventListener('click', async () => {
    try {
      const purchases = await dbGetAll('seasonalPurchases');
      if (!purchases.length) { toast('No seasonal purchases to export yet'); return; }
      purchases.sort((a, b) => a.timestamp - b.timestamp);
      const headers = ['Date', 'Item', 'Unit', 'Qty', 'Rate', 'Amount', 'Supplier', 'Payment', 'Notes'];
      const rows = purchases.map((p) => [p.dateKey, p.itemName, p.unit || '', p.qty, p.rate, p.amount, p.supplier || '', p.payment || '', p.notes || '']);
      downloadCSV(`akash-food-point-seasonal-purchases-${todayKey()}.csv`, toCSV(headers, rows));
      toast('Seasonal Purchases CSV downloaded');
    } catch (err) {
      console.error('Seasonal purchases CSV export failed:', err);
      toast('Export failed — try again');
    }
  });

  document.getElementById('exportSeasonalSalesCsvBtn').addEventListener('click', async () => {
    try {
      const sales = await dbGetAll('seasonalSales');
      if (!sales.length) { toast('No seasonal sales to export yet'); return; }
      sales.sort((a, b) => a.timestamp - b.timestamp);
      const headers = ['Date', 'Item', 'Unit', 'Qty', 'Rate', 'Amount', 'Customer', 'Mobile', 'Payment'];
      const rows = sales.map((s) => [s.dateKey, s.itemName, s.unit || '', s.qty, s.rate, s.amount, s.customerName || '', s.mobile || '', s.payment || '']);
      downloadCSV(`akash-food-point-seasonal-sales-${todayKey()}.csv`, toCSV(headers, rows));
      toast('Seasonal Sales CSV downloaded');
    } catch (err) {
      console.error('Seasonal sales CSV export failed:', err);
      toast('Export failed — try again');
    }
  });

  document.getElementById('resetDataBtn').addEventListener('click', async () => {
    const step1 = window.confirm(
      'This permanently deletes EVERYTHING on this device — menu, orders, inventory, purchases, expenses, customers, closings. This cannot be undone.\n\nContinue?'
    );
    if (!step1) return;
    const step2 = window.confirm('Really sure? This is your last chance to cancel — all data will be erased and the app will restart fresh.');
    if (!step2) return;

    try {
      for (const store of STORES) {
        await dbClear(store);
      }
      toast('All data cleared — restarting...');
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      console.error('Reset failed:', err);
      toast('Reset failed — try again');
    }
  });

  /* ---------------- MODAL SCROLL LOCK ---------------- */
  // Keeps the page behind a modal from scrolling on mobile, without touching every open/close call site.
  function anyModalOpen() {
    return Array.from(document.querySelectorAll('.modal-backdrop')).some((m) => !m.hidden);
  }
  const modalObserver = new MutationObserver(() => {
    document.body.classList.toggle('modal-open', anyModalOpen());
  });
  document.querySelectorAll('.modal-backdrop').forEach((m) => {
    modalObserver.observe(m, { attributes: true, attributeFilter: ['hidden'] });
  });

  /* ---------------- SERVICE WORKER ---------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  /* ---------------- INIT ---------------- */
  function applyShopDetailsToDOM() {
    document.getElementById('topbarShopName').textContent = shopName;
    document.getElementById('printMenuBrand').textContent = shopName;
    document.title = `${shopName} OS`;
    document.getElementById('sShopName').value = shopName;
    document.getElementById('sCurrency').value = currencySymbol;
  }

  async function loadShopSettings() {
    const rec = await dbGet('settings', 'app');
    if (rec) {
      shopName = rec.shopName || shopName;
      currencySymbol = rec.currencySymbol || currencySymbol;
    }
    applyShopDetailsToDOM();
  }

  document.getElementById('saveShopDetailsBtn').addEventListener('click', async () => {
    const newName = document.getElementById('sShopName').value.trim() || 'Akash Food Point';
    const newCurrency = document.getElementById('sCurrency').value.trim() || '₹';
    try {
      await dbPut('settings', { key: 'app', shopName: newName, currencySymbol: newCurrency });
      shopName = newName;
      currencySymbol = newCurrency;
      applyShopDetailsToDOM();
      setView(state.view); // re-render current screen so every rupee()/name string updates immediately
      toast('Shop details saved');
    } catch (err) {
      console.error('Saving shop details failed:', err);
      toast('Save failed — try again');
    }
  });

  /* ---------------- THEME ---------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
  }
  document.getElementById('themeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const theme = btn.dataset.theme;
    try { localStorage.setItem('afp_theme', theme); } catch (err) { /* private mode may block this — theme just won't persist */ }
    applyTheme(theme);
  });

  /* ---------------- INIT ---------------- */
  async function init() {
    document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-IN', {
      weekday: 'short', day: '2-digit', month: 'short',
    });
    try {
      const savedTheme = (() => { try { return localStorage.getItem('afp_theme'); } catch { return null; } })();
      applyTheme(savedTheme === 'light' ? 'light' : 'dark');

      await openDB();
      await seedIfEmpty();
      await loadShopSettings();
      await refreshCategoriesAndItems();
      setView('dashboard');
    } catch (err) {
      // IndexedDB can fail to open in private/incognito browsing, when storage
      // is full, or when a corrupted DB exists — fail loudly with a plain
      // message rather than leaving a silently broken, blank screen.
      console.error('Akash Food Point OS failed to start:', err);
      document.getElementById('app').innerHTML = `
        <div class="empty-hint" style="padding:60px 20px; text-align:center; line-height:1.6;">
          <strong style="color:var(--chili); display:block; margin-bottom:8px; font-size:15px;">Couldn't load your data</strong>
          This can happen in private/incognito browsing, or if device storage is full.<br/>
          Try opening this page in a normal (non-private) browser tab, then reload.
        </div>`;
    }
  }

  init();
})();
