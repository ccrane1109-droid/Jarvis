/* ==========================================================================
   JARVIS — Business command center
   localStorage key: jarvisBusiness -> {
     profile, products, suppliers, sales, expenses, marketing, content,
     goals, checklists, tasks, ideas, learning, migratedV2
   }

   The OLD shape ({goals:[{text,status,targetDate}], ledger:[{type,amount,
   description,date}]}) is migrated in place, once, the first time this
   loads (see migrateOldData) — nothing already tracked is lost. Old income
   ledger entries become synthetic Sales rows; old expense entries become
   Expense Manager rows; old goals become the new richer Goal shape.

   All reads/writes go through the Storage object below — nothing else in
   this file touches localStorage directly, so swapping to a real backend
   later means rewriting Storage.load/Storage.save (likely to return
   Promises), not the rendering/logic code that calls them.

   Module layout, top to bottom: Storage, date/format helpers, migration,
   Profile, Products, Suppliers, Sales, Expenses, Overview, Marketing,
   Content, Goals, Checklists, Tasks, Ideas, Learning, Analytics, boot.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisBusiness";
  const MARKETING_CHANNELS = ["tiktok", "instagram", "metaAds", "google", "email", "organic"];
  const MARKETING_CHANNEL_LABELS = { tiktok: "TikTok", instagram: "Instagram", metaAds: "Meta Ads", google: "Google", email: "Email Marketing", organic: "Organic Content" };
  const DEFAULT_CHECKLIST_ITEMS = [
    "Finish design", "Choose blank/product", "Order sample", "Inspect sample", "Create mockups",
    "Write product description", "Set price", "Create product page", "Create launch content",
    "Prepare email/SMS", "Publish product", "Launch ads", "Review results"
  ];

  function defaultMarketingChannel() { return { adSpend: 0, revenue: 0, visitors: 0, addToCarts: 0, checkoutStarts: 0, purchases: 0, subscribers: 0 }; }
  function defaultData() {
    const marketing = {};
    MARKETING_CHANNELS.forEach(function (c) { marketing[c] = defaultMarketingChannel(); });
    return {
      profile: { name: "", type: "", niche: "", mission: "", url: "", launchDate: "", monthlyGoal: 0, yearlyGoal: 0, notes: "" },
      products: [], suppliers: [], sales: [], expenses: [],
      marketing: marketing, content: [], goals: [], checklists: [], tasks: [], ideas: [], learning: [],
      migratedV2: false
    };
  }

  const Storage = {
    load: function () {
      const loaded = window.JarvisCore.loadJSON(LS_KEY, null);
      return (loaded && typeof loaded === "object") ? loaded : defaultData();
    },
    save: function (d) { window.JarvisCore.saveJSON(LS_KEY, d); }
  };

  let data = defaultData();

  // Transient UI state.
  let overviewRange = "month";
  let productFormEditId = null;
  let supplierFormEditId = null;
  let saleFormEditId = null;
  let expenseFormEditId = null;
  let goalFormEditId = null;
  let taskFormEditId = null;
  let ideaFormEditId = null;
  let learningFormEditId = null;
  let contentFormEditId = null;
  let activeMarketingChannel = null;
  let activeChecklistId = null;
  let productSearch = "";
  let productStatusFilter = "";
  let productSort = "name";
  let supplierSearch = "";

  function $(id) { return document.getElementById(id); }

  /* ---------------- date helpers (local-time safe, see Habits for why) ---------------- */

  function parseISODateLocal(iso) {
    const parts = iso.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function toISODateLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDaysISO(iso, n) { const d = parseISODateLocal(iso); d.setDate(d.getDate() + n); return toISODateLocal(d); }
  function getMondayISO(iso) { const d = parseISODateLocal(iso); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return toISODateLocal(d); }

  function getRangeBounds(range, todayIso) {
    if (range === "week") { const mon = getMondayISO(todayIso); return { start: mon, end: addDaysISO(mon, 6) }; }
    if (range === "month") { const d = parseISODateLocal(todayIso); return { start: toISODateLocal(new Date(d.getFullYear(), d.getMonth(), 1)), end: toISODateLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }; }
    if (range === "year") { const d = parseISODateLocal(todayIso); return { start: d.getFullYear() + "-01-01", end: d.getFullYear() + "-12-31" }; }
    return { start: "0000-01-01", end: "9999-12-31" };
  }
  function filterByRange(items, range, todayIso) {
    const b = getRangeBounds(range, todayIso);
    return items.filter(function (i) { return i.date >= b.start && i.date <= b.end; });
  }

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function isNonNegativeNumber(v) { const n = Number(v); return isFinite(n) && n >= 0; }
  function numOrZero(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  /* ---------------- persistence / migration ---------------- */

  // One-time upgrade of the old {goals, ledger} shape into the new richer
  // model. Idempotent via data.migratedV2 — never runs twice, never
  // duplicates data on a later load.
  function migrateOldData(loaded) {
    const core = window.JarvisCore;
    const next = defaultData();
    Object.keys(next).forEach(function (k) {
      if (loaded[k] !== undefined && k !== "goals") next[k] = loaded[k];
    });
    MARKETING_CHANNELS.forEach(function (c) {
      next.marketing[c] = Object.assign(defaultMarketingChannel(), (loaded.marketing && loaded.marketing[c]) || {});
    });

    if (Array.isArray(loaded.ledger)) {
      loaded.ledger.forEach(function (l) {
        if (!l || !isNonNegativeNumber(l.amount)) return;
        const date = l.date || core.todayISODate();
        if (l.type === "income") {
          next.sales.push({ id: l.id || core.uid("sale"), date: date, productId: null, productName: l.description ? "Legacy income — " + l.description : "Legacy income", quantity: 1, revenue: l.amount, cost: 0, shipping: 0, fees: 0, adCost: 0, createdAt: l.createdAt || Date.now() });
        } else {
          next.expenses.push({ id: l.id || core.uid("expense"), date: date, category: "Other", amount: l.amount, description: l.description || "", createdAt: l.createdAt || Date.now() });
        }
      });
    }

    if (Array.isArray(loaded.goals)) {
      const statusMap = { "Not Started": "Not Started", "In Progress": "In Progress", "Done": "Complete" };
      loaded.goals.forEach(function (g) {
        if (!g || !g.text) return;
        next.goals.push({
          id: g.id || core.uid("goal"), title: g.text, category: "Operations",
          targetDate: g.targetDate || "", priority: "Medium",
          status: statusMap[g.status] || "Not Started",
          hasNumericTarget: false, currentValue: 0, targetValue: 0, unit: "",
          manualProgressPct: g.status === "Done" ? 100 : (g.status === "In Progress" ? 50 : 0),
          notes: "", createdAt: g.createdAt || Date.now()
        });
      });
    }

    next.migratedV2 = true;
    return next;
  }

  function load() {
    const loaded = Storage.load();
    data = loaded.migratedV2 ? Object.assign(defaultData(), loaded) : migrateOldData(loaded);
    if (!loaded.migratedV2) save();
  }

  function save() { Storage.save(data); }

  /* ==================== PROFILE ==================== */

  function renderProfileForm() {
    const p = data.profile;
    $("bizProfileName").value = p.name || "";
    $("bizProfileType").value = p.type || "";
    $("bizProfileNiche").value = p.niche || "";
    $("bizProfileMission").value = p.mission || "";
    $("bizProfileUrl").value = p.url || "";
    $("bizProfileLaunchDate").value = p.launchDate || "";
    $("bizProfileMonthlyGoal").value = p.monthlyGoal || "";
    $("bizProfileYearlyGoal").value = p.yearlyGoal || "";
    $("bizProfileNotes").value = p.notes || "";
  }

  function handleProfileFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    data.profile = {
      name: $("bizProfileName").value.trim(), type: $("bizProfileType").value.trim(),
      niche: $("bizProfileNiche").value.trim(), mission: $("bizProfileMission").value.trim(),
      url: $("bizProfileUrl").value.trim(), launchDate: $("bizProfileLaunchDate").value,
      monthlyGoal: numOrZero($("bizProfileMonthlyGoal").value), yearlyGoal: numOrZero($("bizProfileYearlyGoal").value),
      notes: $("bizProfileNotes").value.trim()
    };
    save();
    renderOverview();
    core.showToast("Business profile saved.");
  }

  /* ==================== SUPPLIERS ==================== */

  function resetSupplierForm() {
    supplierFormEditId = null;
    ["bizSupplierName", "bizSupplierWebsite", "bizSupplierServices", "bizSupplierCostNotes", "bizSupplierShippingCost", "bizSupplierShippingTime", "bizSupplierContact", "bizSupplierNotes"].forEach(function (id) { $(id).value = ""; });
    $("bizSupplierQuality").value = "3";
    $("bizSupplierSampleStatus").value = "Not Ordered";
    $("bizSupplierModalTitle").textContent = "Add Supplier";
    $("bizSupplierFormSubmitBtn").textContent = "Add Supplier";
    $("bizSupplierFormCancelBtn").classList.add("hidden");
  }

  function openSupplierModal(supplier) {
    resetSupplierForm();
    if (supplier) {
      supplierFormEditId = supplier.id;
      $("bizSupplierName").value = supplier.name;
      $("bizSupplierWebsite").value = supplier.website || "";
      $("bizSupplierServices").value = supplier.servicesNotes || "";
      $("bizSupplierCostNotes").value = supplier.productCostNotes || "";
      $("bizSupplierShippingCost").value = supplier.shippingCost || "";
      $("bizSupplierShippingTime").value = supplier.shippingTime || "";
      $("bizSupplierQuality").value = supplier.qualityRating || 3;
      $("bizSupplierSampleStatus").value = supplier.sampleStatus || "Not Ordered";
      $("bizSupplierContact").value = supplier.contact || "";
      $("bizSupplierNotes").value = supplier.notes || "";
      $("bizSupplierModalTitle").textContent = "Edit Supplier";
      $("bizSupplierFormSubmitBtn").textContent = "Save Changes";
      $("bizSupplierFormCancelBtn").classList.remove("hidden");
    }
    window.JarvisCore.openModal("bizSupplierModal");
  }

  function handleSupplierFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("bizSupplierName").value.trim();
    if (!name) { core.showToast("Give the supplier a name."); return; }
    const raw = {
      name: name, website: $("bizSupplierWebsite").value.trim(), servicesNotes: $("bizSupplierServices").value.trim(),
      productCostNotes: $("bizSupplierCostNotes").value.trim(), shippingCost: numOrZero($("bizSupplierShippingCost").value),
      shippingTime: $("bizSupplierShippingTime").value.trim(), qualityRating: clampInt($("bizSupplierQuality").value, 1, 5, 3),
      sampleStatus: $("bizSupplierSampleStatus").value, contact: $("bizSupplierContact").value.trim(), notes: $("bizSupplierNotes").value.trim()
    };
    if (supplierFormEditId) {
      const s = data.suppliers.find(function (ss) { return ss.id === supplierFormEditId; });
      if (s) Object.assign(s, raw);
    } else {
      data.suppliers.push(Object.assign({}, raw, { id: core.uid("supplier"), createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizSupplierModal");
    renderSuppliers();
    renderProductSupplierOptions();
    core.showToast(supplierFormEditId ? "Supplier updated." : "Supplier added.");
  }

  function supplierRowHtml(s) {
    const core = window.JarvisCore;
    const stars = "★".repeat(s.qualityRating || 0) + "☆".repeat(5 - (s.qualityRating || 0));
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(s.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(s.name) + '</span>' +
            '<span class="list-item-meta">' + core.escapeHtml(s.servicesNotes || "") + '</span>' +
            '<span class="list-item-meta">' + stars + ' &middot; ' + core.escapeHtml(s.shippingTime || "?") + ' shipping &middot; Sample: ' + core.escapeHtml(s.sampleStatus) + '</span>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon supplier-edit-btn" data-id="' + core.escapeHtml(s.id) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger supplier-delete-btn" data-id="' + core.escapeHtml(s.id) + '">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderSuppliers() {
    const container = $("bizSuppliersList");
    const q = supplierSearch.trim().toLowerCase();
    const list = data.suppliers.filter(function (s) { return !q || s.name.toLowerCase().indexOf(q) !== -1; });
    if (list.length === 0) { container.innerHTML = '<div class="empty-state">' + (data.suppliers.length === 0 ? "No suppliers yet. Add one above." : "No suppliers match your search.") + '</div>'; return; }
    container.innerHTML = list.map(supplierRowHtml).join("");
  }

  function handleSuppliersListClick(e) {
    const editBtn = e.target.closest(".supplier-edit-btn");
    if (editBtn) { const s = data.suppliers.find(function (ss) { return ss.id === editBtn.getAttribute("data-id"); }); if (s) openSupplierModal(s); return; }
    const delBtn = e.target.closest(".supplier-delete-btn");
    if (delBtn) {
      const s = data.suppliers.find(function (ss) { return ss.id === delBtn.getAttribute("data-id"); });
      if (!s) return;
      if (!window.confirm('Delete supplier "' + s.name + '"? This can\'t be undone.')) return;
      data.suppliers = data.suppliers.filter(function (ss) { return ss.id !== s.id; });
      data.products.forEach(function (p) { if (p.supplierId === s.id) p.supplierId = null; });
      save();
      renderSuppliers(); renderProducts(); renderProductSupplierOptions();
      window.JarvisCore.showToast("Supplier deleted.");
    }
  }

  /* ==================== PRODUCTS ==================== */

  function productTotalCost(p) { return numOrZero(p.cost) + numOrZero(p.shippingCost) + numOrZero(p.fees); }
  function productProfit(p) { return numOrZero(p.price) - productTotalCost(p); }
  function productMarginPct(p) { return p.price > 0 ? (productProfit(p) / p.price) * 100 : 0; }

  function renderProductSupplierOptions() {
    const core = window.JarvisCore;
    const sel = $("bizProductSupplier");
    const current = sel.value;
    sel.innerHTML = '<option value="">None</option>' + data.suppliers.map(function (s) { return '<option value="' + core.escapeHtml(s.id) + '">' + core.escapeHtml(s.name) + '</option>'; }).join("");
    if (data.suppliers.some(function (s) { return s.id === current; })) sel.value = current;
  }

  function updateProductComputedPreview() {
    const p = { cost: $("bizProductCost").value, shippingCost: $("bizProductShipping").value, fees: $("bizProductFees").value, price: $("bizProductPrice").value };
    const totalCost = productTotalCost(p), profit = productProfit(p), margin = productMarginPct(p);
    $("bizProductComputedPreview").textContent = "Total cost: " + window.JarvisCore.formatCurrency(totalCost) + " · Profit/unit: " + window.JarvisCore.formatCurrency(profit) + " · Margin: " + Math.round(margin) + "%";
  }

  function resetProductForm() {
    productFormEditId = null;
    ["bizProductName", "bizProductCategory", "bizProductCost", "bizProductShipping", "bizProductPrice", "bizProductFees", "bizProductLaunchDate", "bizProductUrl", "bizProductNotes"].forEach(function (id) { $(id).value = ""; });
    $("bizProductStatus").value = "Idea";
    renderProductSupplierOptions();
    $("bizProductSupplier").value = "";
    $("bizProductModalTitle").textContent = "Add Product";
    $("bizProductFormSubmitBtn").textContent = "Add Product";
    $("bizProductFormCancelBtn").classList.add("hidden");
    updateProductComputedPreview();
  }

  function openProductModal(product) {
    resetProductForm();
    if (product) {
      productFormEditId = product.id;
      $("bizProductName").value = product.name;
      $("bizProductCategory").value = product.category || "";
      $("bizProductSupplier").value = product.supplierId || "";
      $("bizProductCost").value = product.cost || "";
      $("bizProductShipping").value = product.shippingCost || "";
      $("bizProductPrice").value = product.price || "";
      $("bizProductFees").value = product.fees || "";
      $("bizProductStatus").value = product.status || "Idea";
      $("bizProductLaunchDate").value = product.launchDate || "";
      $("bizProductUrl").value = product.url || "";
      $("bizProductNotes").value = product.notes || "";
      $("bizProductModalTitle").textContent = "Edit Product";
      $("bizProductFormSubmitBtn").textContent = "Save Changes";
      $("bizProductFormCancelBtn").classList.remove("hidden");
      updateProductComputedPreview();
    }
    window.JarvisCore.openModal("bizProductModal");
  }

  function handleProductFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("bizProductName").value.trim();
    if (!name) { core.showToast("Give the product a name."); return; }
    const raw = {
      name: name, category: $("bizProductCategory").value.trim(), supplierId: $("bizProductSupplier").value || null,
      cost: numOrZero($("bizProductCost").value), shippingCost: numOrZero($("bizProductShipping").value),
      price: numOrZero($("bizProductPrice").value), fees: numOrZero($("bizProductFees").value),
      status: $("bizProductStatus").value, launchDate: $("bizProductLaunchDate").value,
      url: $("bizProductUrl").value.trim(), notes: $("bizProductNotes").value.trim()
    };
    if (productFormEditId) {
      const p = data.products.find(function (pp) { return pp.id === productFormEditId; });
      if (p) Object.assign(p, raw);
    } else {
      data.products.push(Object.assign({}, raw, { id: core.uid("product"), createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizProductModal");
    renderProducts();
    renderSaleProductOptions();
    renderChecklistProductOptions();
    core.showToast(productFormEditId ? "Product updated." : "Product added.");
  }

  const PRODUCT_STATUS_BADGE = { Idea: "badge-neutral", Designing: "badge-neutral", "Sample Ordered": "badge-yellow", Ready: "badge-yellow", Live: "badge-green", Paused: "badge-yellow", Discontinued: "badge-red" };

  function productRowHtml(p) {
    const core = window.JarvisCore;
    const supplier = data.suppliers.find(function (s) { return s.id === p.supplierId; });
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(p.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(p.name) + ' <span class="badge ' + (PRODUCT_STATUS_BADGE[p.status] || "badge-neutral") + '">' + core.escapeHtml(p.status) + '</span></span>' +
            '<span class="list-item-meta">' + core.escapeHtml(p.category || "Uncategorized") + (supplier ? " &middot; " + core.escapeHtml(supplier.name) : "") + '</span>' +
            '<span class="list-item-meta">Price ' + core.formatCurrency(p.price) + ' &middot; Cost ' + core.formatCurrency(productTotalCost(p)) + ' &middot; Profit/unit ' + core.formatCurrency(productProfit(p)) + ' &middot; Margin ' + Math.round(productMarginPct(p)) + '%</span>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon product-checklist-btn" data-id="' + core.escapeHtml(p.id) + '">Checklist</button>' +
            '<button type="button" class="btn-icon product-edit-btn" data-id="' + core.escapeHtml(p.id) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger product-delete-btn" data-id="' + core.escapeHtml(p.id) + '">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderProducts() {
    const container = $("bizProductsList");
    let list = data.products.slice();
    const q = productSearch.trim().toLowerCase();
    if (q) list = list.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1 || (p.category || "").toLowerCase().indexOf(q) !== -1; });
    if (productStatusFilter) list = list.filter(function (p) { return p.status === productStatusFilter; });
    if (productSort === "margin") list.sort(function (a, b) { return productMarginPct(b) - productMarginPct(a); });
    else if (productSort === "profit") list.sort(function (a, b) { return productProfit(b) - productProfit(a); });
    else if (productSort === "recent") list.sort(function (a, b) { return b.createdAt - a.createdAt; });
    else list.sort(function (a, b) { return a.name.localeCompare(b.name); });

    if (list.length === 0) { container.innerHTML = '<div class="empty-state">' + (data.products.length === 0 ? "No products yet. Add one above." : "No products match your filters.") + '</div>'; return; }
    container.innerHTML = list.map(productRowHtml).join("");
  }

  function handleProductsListClick(e) {
    const checklistBtn = e.target.closest(".product-checklist-btn");
    if (checklistBtn) {
      const p = data.products.find(function (pp) { return pp.id === checklistBtn.getAttribute("data-id"); });
      if (!p) return;
      let checklist = data.checklists.find(function (c) { return c.productId === p.id; });
      if (!checklist) {
        checklist = { id: window.JarvisCore.uid("checklist"), name: p.name + " Launch Checklist", productId: p.id, items: DEFAULT_CHECKLIST_ITEMS.map(function (t) { return { id: window.JarvisCore.uid("item"), text: t, done: false }; }), createdAt: Date.now() };
        data.checklists.push(checklist);
        save();
      }
      openChecklistModal(checklist.id);
      return;
    }
    const editBtn = e.target.closest(".product-edit-btn");
    if (editBtn) { const p = data.products.find(function (pp) { return pp.id === editBtn.getAttribute("data-id"); }); if (p) openProductModal(p); return; }
    const delBtn = e.target.closest(".product-delete-btn");
    if (delBtn) {
      const p = data.products.find(function (pp) { return pp.id === delBtn.getAttribute("data-id"); });
      if (!p) return;
      if (!window.confirm('Delete product "' + p.name + '"? Its sales history stays, but it can no longer be selected for new sales. This can\'t be undone.')) return;
      data.products = data.products.filter(function (pp) { return pp.id !== p.id; });
      data.checklists = data.checklists.filter(function (c) { return c.productId !== p.id; });
      save();
      renderProducts(); renderSaleProductOptions(); renderChecklistsList(); renderChecklistProductOptions();
      window.JarvisCore.showToast("Product deleted.");
    }
  }

  /* ==================== SALES ==================== */

  function saleProfit(s) { return numOrZero(s.revenue) - numOrZero(s.cost) * (numOrZero(s.quantity) || 1) - numOrZero(s.shipping) - numOrZero(s.fees) - numOrZero(s.adCost); }

  function renderSaleProductOptions() {
    const core = window.JarvisCore;
    const sel = $("bizSaleProduct");
    const current = sel.value;
    sel.innerHTML = '<option value="">Select a product</option>' + data.products.map(function (p) { return '<option value="' + core.escapeHtml(p.id) + '">' + core.escapeHtml(p.name) + '</option>'; }).join("");
    if (data.products.some(function (p) { return p.id === current; })) sel.value = current;
  }

  function resetSaleForm() {
    saleFormEditId = null;
    $("bizSaleDate").value = window.JarvisCore.todayISODate();
    renderSaleProductOptions();
    $("bizSaleProduct").value = "";
    $("bizSaleQuantity").value = "1";
    ["bizSaleRevenue", "bizSaleCost", "bizSaleShipping", "bizSaleFees", "bizSaleAdCost"].forEach(function (id) { $(id).value = ""; });
    $("bizSaleModalTitle").textContent = "Add Sale";
    $("bizSaleFormSubmitBtn").textContent = "Add Sale";
    $("bizSaleFormCancelBtn").classList.add("hidden");
    updateSaleProfitPreview();
  }

  function updateSaleProfitPreview() {
    const s = { revenue: $("bizSaleRevenue").value, cost: $("bizSaleCost").value, quantity: $("bizSaleQuantity").value, shipping: $("bizSaleShipping").value, fees: $("bizSaleFees").value, adCost: $("bizSaleAdCost").value };
    $("bizSaleProfitPreview").textContent = "Profit: " + window.JarvisCore.formatCurrency(saleProfit(s));
  }

  function openSaleModal(sale) {
    resetSaleForm();
    if (sale) {
      saleFormEditId = sale.id;
      $("bizSaleDate").value = sale.date;
      $("bizSaleProduct").value = sale.productId || "";
      $("bizSaleQuantity").value = sale.quantity;
      $("bizSaleRevenue").value = sale.revenue;
      $("bizSaleCost").value = sale.cost;
      $("bizSaleShipping").value = sale.shipping;
      $("bizSaleFees").value = sale.fees;
      $("bizSaleAdCost").value = sale.adCost;
      $("bizSaleModalTitle").textContent = "Edit Sale";
      $("bizSaleFormSubmitBtn").textContent = "Save Changes";
      $("bizSaleFormCancelBtn").classList.remove("hidden");
      updateSaleProfitPreview();
    }
    window.JarvisCore.openModal("bizSaleModal");
  }

  function handleSaleFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    if (!isNonNegativeNumber($("bizSaleRevenue").value)) { core.showToast("Enter a valid revenue amount."); return; }
    const productId = $("bizSaleProduct").value || null;
    const product = data.products.find(function (p) { return p.id === productId; });
    const raw = {
      date: $("bizSaleDate").value || core.todayISODate(), productId: productId, productName: product ? product.name : "(deleted product)",
      quantity: clampInt($("bizSaleQuantity").value, 1, 100000, 1), revenue: numOrZero($("bizSaleRevenue").value),
      cost: numOrZero($("bizSaleCost").value), shipping: numOrZero($("bizSaleShipping").value),
      fees: numOrZero($("bizSaleFees").value), adCost: numOrZero($("bizSaleAdCost").value)
    };
    if (saleFormEditId) {
      const s = data.sales.find(function (ss) { return ss.id === saleFormEditId; });
      if (s) Object.assign(s, raw);
    } else {
      data.sales.push(Object.assign({}, raw, { id: core.uid("sale"), createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizSaleModal");
    renderSales(); renderOverview(); renderAnalytics();
    core.showToast(saleFormEditId ? "Sale updated." : "Sale added.");
  }

  function saleRowHtml(s) {
    const core = window.JarvisCore;
    const profit = saleProfit(s);
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(s.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(s.productName || "(unknown product)") + ' &times; ' + s.quantity + '</span>' +
            '<span class="list-item-meta">' + core.formatDate(s.date) + ' &middot; Revenue ' + core.formatCurrency(s.revenue) + ' &middot; Profit <span class="' + (profit >= 0 ? "text-positive" : "text-negative") + '">' + core.formatCurrency(profit) + '</span></span>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon sale-edit-btn" data-id="' + core.escapeHtml(s.id) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger sale-delete-btn" data-id="' + core.escapeHtml(s.id) + '">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderSales() {
    const container = $("bizSalesList");
    if (data.sales.length === 0) { container.innerHTML = '<div class="empty-state">No sales logged yet.</div>'; return; }
    const sorted = data.sales.slice().sort(function (a, b) { return (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) || b.createdAt - a.createdAt; });
    container.innerHTML = sorted.map(saleRowHtml).join("");
    renderSalesCharts();
  }

  function handleSalesListClick(e) {
    const editBtn = e.target.closest(".sale-edit-btn");
    if (editBtn) { const s = data.sales.find(function (ss) { return ss.id === editBtn.getAttribute("data-id"); }); if (s) openSaleModal(s); return; }
    const delBtn = e.target.closest(".sale-delete-btn");
    if (delBtn) {
      const s = data.sales.find(function (ss) { return ss.id === delBtn.getAttribute("data-id"); });
      if (!s) return;
      if (!window.confirm("Delete this sale? This can't be undone.")) return;
      data.sales = data.sales.filter(function (ss) { return ss.id !== s.id; });
      save();
      renderSales(); renderOverview(); renderAnalytics();
      window.JarvisCore.showToast("Sale deleted.");
    }
  }

  /* ---------------- shared: last-6-months bucketing (Sales charts + Analytics) ---------------- */

  function lastNMonthKeys(n) {
    const core = window.JarvisCore;
    const today = parseISODateLocal(core.todayISODate());
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      out.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: d.toLocaleDateString("en-US", { month: "short" }) });
    }
    return out;
  }
  function monthKeyOf(dateIso) { return dateIso.slice(0, 7); }

  function buildMonthlyFinancials(n) {
    const months = lastNMonthKeys(n);
    return months.map(function (m) {
      const salesThisMonth = data.sales.filter(function (s) { return monthKeyOf(s.date) === m.key; });
      const expensesThisMonth = data.expenses.filter(function (x) { return monthKeyOf(x.date) === m.key; });
      const revenue = salesThisMonth.reduce(function (sum, s) { return sum + numOrZero(s.revenue); }, 0);
      const grossProfit = salesThisMonth.reduce(function (sum, s) { return sum + saleProfit(s); }, 0);
      const expenseTotal = expensesThisMonth.reduce(function (sum, x) { return sum + numOrZero(x.amount); }, 0);
      return { label: m.label, key: m.key, revenue: revenue, expenses: expenseTotal, profit: grossProfit - expenseTotal };
    });
  }

  function renderBarChart(containerId, months, seriesA, seriesB, colorA, colorB, labelA, labelB) {
    const core = window.JarvisCore;
    const container = $(containerId);
    const hasData = months.some(function (m) { return m[seriesA] !== 0 || (seriesB && m[seriesB] !== 0); });
    if (!hasData) { container.innerHTML = '<div class="empty-state">Log some sales and expenses to see this chart.</div>'; return; }
    const width = 640, height = 220;
    const padding = { top: 16, right: 16, bottom: 28, left: 16 };
    const plotW = width - padding.left - padding.right, plotH = height - padding.top - padding.bottom;
    const maxVal = Math.max.apply(null, months.map(function (m) { return Math.max(m[seriesA], seriesB ? m[seriesB] : 0); })) * 1.15 || 1;
    const groupW = plotW / months.length;
    const barW = Math.min(26, groupW / (seriesB ? 3.2 : 2));
    function yTop(v) { return padding.top + plotH - (v / maxVal) * plotH; }
    let svg = "";
    months.forEach(function (m, i) {
      const groupX = padding.left + i * groupW + groupW / 2;
      const aX = seriesB ? groupX - barW - 2 : groupX - barW / 2;
      svg += '<rect x="' + aX.toFixed(1) + '" y="' + yTop(m[seriesA]).toFixed(1) + '" width="' + barW + '" height="' + (plotH - (yTop(m[seriesA]) - padding.top)).toFixed(1) + '" fill="' + colorA + '"><title>' + core.escapeHtml(m.label) + " " + labelA + ": " + core.formatCurrency(m[seriesA]) + '</title></rect>';
      if (seriesB) {
        const bX = groupX + 2;
        svg += '<rect x="' + bX.toFixed(1) + '" y="' + yTop(m[seriesB]).toFixed(1) + '" width="' + barW + '" height="' + (plotH - (yTop(m[seriesB]) - padding.top)).toFixed(1) + '" fill="' + colorB + '"><title>' + core.escapeHtml(m.label) + " " + labelB + ": " + core.formatCurrency(m[seriesB]) + '</title></rect>';
      }
      svg += '<text x="' + groupX.toFixed(1) + '" y="' + (height - 8) + '" font-size="10" fill="var(--text-faint)" text-anchor="middle">' + core.escapeHtml(m.label) + '</text>';
    });
    container.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" class="progress-chart-svg" role="img" aria-label="' + (seriesB ? (labelA + " vs " + labelB) : labelA) + '">' + svg + '</svg>';
  }

  function renderLineChart(containerId, points, opts) {
    const core = window.JarvisCore;
    const container = $(containerId);
    if (!points || points.every(function (p) { return p.v === 0; })) { container.innerHTML = '<div class="empty-state">' + (opts.emptyMessage || "Not enough data yet.") + '</div>'; return; }
    const width = 640, height = 200;
    const padding = { top: 16, right: 16, bottom: 24, left: 44 };
    const plotW = width - padding.left - padding.right, plotH = height - padding.top - padding.bottom;
    const xs = points.map(function (p, i) { return i; });
    const ys = points.map(function (p) { return p.v; });
    const minY = Math.min(0, Math.min.apply(null, ys));
    const maxY = Math.max.apply(null, ys) * 1.15 || 1;
    function xPos(i) { return padding.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW); }
    function yPos(v) { return padding.top + plotH - ((v - minY) / (maxY - minY || 1)) * plotH; }
    const pathD = points.map(function (p, i) { return (i === 0 ? "M" : "L") + xPos(i).toFixed(1) + "," + yPos(p.v).toFixed(1); }).join(" ");
    const circles = points.map(function (p, i) { return '<circle cx="' + xPos(i).toFixed(1) + '" cy="' + yPos(p.v).toFixed(1) + '" r="4" fill="' + (opts.color || "var(--accent)") + '"><title>' + core.escapeHtml(p.label) + ": " + core.formatCurrency(p.v) + '</title></circle>'; }).join("");
    const zeroY = yPos(0);
    container.innerHTML =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" class="progress-chart-svg" role="img" aria-label="' + core.escapeHtml(opts.ariaLabel || "trend") + '">' +
        '<line x1="' + padding.left + '" y1="' + zeroY.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--card-border)" stroke-width="1"/>' +
        '<path d="' + pathD + '" fill="none" stroke="' + (opts.color || "var(--accent)") + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        circles +
      '</svg>';
  }

  function renderSalesCharts() {
    const months = buildMonthlyFinancials(6);
    renderBarChart("bizRevenueChart", months, "revenue", "expenses", "var(--accent)", "var(--red)", "Revenue", "Expenses");
    renderLineChart("bizProfitChart", months.map(function (m) { return { v: m.profit, label: m.label }; }), { ariaLabel: "Profit over time", color: "var(--green)", emptyMessage: "Log sales and expenses to see profit over time." });
  }

  /* ==================== EXPENSES ==================== */

  const EXPENSE_CATEGORIES = ["Product/Samples", "Advertising", "Shopify/Website", "Apps/Software", "Supplier", "Shipping", "Packaging", "Design", "Marketing", "Other"];

  function resetExpenseForm() {
    expenseFormEditId = null;
    $("bizExpenseDate").value = window.JarvisCore.todayISODate();
    $("bizExpenseAmount").value = "";
    $("bizExpenseCategory").value = "Other";
    $("bizExpenseDescription").value = "";
    $("bizExpenseModalTitle").textContent = "Add Expense";
    $("bizExpenseFormSubmitBtn").textContent = "Add Expense";
    $("bizExpenseFormCancelBtn").classList.add("hidden");
  }

  function openExpenseModal(expense) {
    resetExpenseForm();
    if (expense) {
      expenseFormEditId = expense.id;
      $("bizExpenseDate").value = expense.date;
      $("bizExpenseAmount").value = expense.amount;
      $("bizExpenseCategory").value = expense.category;
      $("bizExpenseDescription").value = expense.description || "";
      $("bizExpenseModalTitle").textContent = "Edit Expense";
      $("bizExpenseFormSubmitBtn").textContent = "Save Changes";
      $("bizExpenseFormCancelBtn").classList.remove("hidden");
    }
    window.JarvisCore.openModal("bizExpenseModal");
  }

  function handleExpenseFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    if (!isNonNegativeNumber($("bizExpenseAmount").value) || Number($("bizExpenseAmount").value) <= 0) { core.showToast("Enter a valid amount."); return; }
    const raw = { date: $("bizExpenseDate").value || core.todayISODate(), category: $("bizExpenseCategory").value, amount: Number($("bizExpenseAmount").value), description: $("bizExpenseDescription").value.trim() };
    if (expenseFormEditId) {
      const x = data.expenses.find(function (xx) { return xx.id === expenseFormEditId; });
      if (x) Object.assign(x, raw);
    } else {
      data.expenses.push(Object.assign({}, raw, { id: core.uid("expense"), createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizExpenseModal");
    renderOverview(); renderAnalytics();
    core.showToast(expenseFormEditId ? "Expense updated." : "Expense added.");
  }

  function expenseRowHtml(x) {
    const core = window.JarvisCore;
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(x.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(x.description || x.category) + ' <span class="badge badge-red">' + core.formatCurrency(x.amount) + '</span></span>' +
            '<span class="list-item-meta">' + core.formatDate(x.date) + ' &middot; ' + core.escapeHtml(x.category) + '</span>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon expense-edit-btn" data-id="' + core.escapeHtml(x.id) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger expense-delete-btn" data-id="' + core.escapeHtml(x.id) + '">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderExpenses() {
    const core = window.JarvisCore;
    const container = $("bizExpensesList");
    if (data.expenses.length === 0) {
      container.innerHTML = '<div class="empty-state">No expenses logged yet.</div>';
      $("bizExpenseCategoryBreakdown").innerHTML = "";
      return;
    }
    const sorted = data.expenses.slice().sort(function (a, b) { return (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) || b.createdAt - a.createdAt; });
    container.innerHTML = sorted.map(expenseRowHtml).join("");

    const byCategory = {};
    data.expenses.forEach(function (x) { byCategory[x.category] = (byCategory[x.category] || 0) + numOrZero(x.amount); });
    $("bizExpenseCategoryBreakdown").innerHTML = Object.keys(byCategory).sort(function (a, b) { return byCategory[b] - byCategory[a]; }).map(function (cat) {
      return '<div class="stat-box"><span class="stat-value">' + core.formatCurrency(byCategory[cat]) + '</span><span class="stat-label">' + core.escapeHtml(cat) + '</span></div>';
    }).join("");
  }

  function handleExpensesListClick(e) {
    const editBtn = e.target.closest(".expense-edit-btn");
    if (editBtn) { const x = data.expenses.find(function (xx) { return xx.id === editBtn.getAttribute("data-id"); }); if (x) openExpenseModal(x); return; }
    const delBtn = e.target.closest(".expense-delete-btn");
    if (delBtn) {
      const x = data.expenses.find(function (xx) { return xx.id === delBtn.getAttribute("data-id"); });
      if (!x) return;
      if (!window.confirm("Delete this expense? This can't be undone.")) return;
      data.expenses = data.expenses.filter(function (xx) { return xx.id !== x.id; });
      save();
      renderExpenses(); renderOverview(); renderAnalytics();
      window.JarvisCore.showToast("Expense deleted.");
    }
  }

  /* ==================== OVERVIEW ==================== */

  function computeOverviewStats(range) {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const rangeSales = filterByRange(data.sales, range, today);
    const rangeExpenses = filterByRange(data.expenses, range, today);
    const revenue = rangeSales.reduce(function (s, x) { return s + numOrZero(x.revenue); }, 0);
    const grossProfit = rangeSales.reduce(function (s, x) { return s + saleProfit(x); }, 0);
    const expenseTotal = rangeExpenses.reduce(function (s, x) { return s + numOrZero(x.amount); }, 0);
    const netProfit = grossProfit - expenseTotal;
    const orders = rangeSales.length;
    const productsSold = rangeSales.reduce(function (s, x) { return s + numOrZero(x.quantity); }, 0);
    return {
      revenue: revenue, expenses: expenseTotal, netProfit: netProfit,
      marginPct: revenue > 0 ? (netProfit / revenue) * 100 : 0,
      orders: orders, aov: orders > 0 ? revenue / orders : 0, productsSold: productsSold
    };
  }

  function statBoxHtml(value, label, cls) {
    return '<div class="stat-box"><span class="stat-value' + (cls ? " " + cls : "") + '">' + value + '</span><span class="stat-label">' + label + '</span></div>';
  }

  function renderOverview() {
    const core = window.JarvisCore;
    const s = computeOverviewStats(overviewRange);
    $("bizOverviewStats").innerHTML =
      statBoxHtml(core.formatCurrency(s.revenue), "Revenue") +
      statBoxHtml(core.formatCurrency(s.expenses), "Expenses") +
      statBoxHtml(core.formatCurrency(s.netProfit), "Net Profit", s.netProfit >= 0 ? "positive" : "negative") +
      statBoxHtml(Math.round(s.marginPct) + "%", "Profit Margin") +
      statBoxHtml(String(s.orders), "Orders") +
      statBoxHtml(core.formatCurrency(s.aov), "Avg Order Value") +
      statBoxHtml(String(s.productsSold), "Products Sold");

    const monthStats = computeOverviewStats("month");
    const goal = numOrZero(data.profile.monthlyGoal);
    $("bizOverviewGoalProgress").innerHTML = goal > 0
      ? barHtml("This month vs. monthly goal", monthStats.revenue, goal, "")
      : '<p class="field-hint">Set a monthly revenue goal in Business Profile to track progress here.</p>';

    renderProfileForm();
    renderExpenses();
  }

  function barHtml(label, consumed, target, unit) {
    const core = window.JarvisCore;
    const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
    return (
      '<div class="nutri-bar-row">' +
        '<div class="nutri-bar-label"><span>' + core.escapeHtml(label) + '</span><span class="nutri-bar-value">' + core.formatCurrency(consumed) + ' / ' + core.formatCurrency(target) + unit + '</span></div>' +
        '<div class="nutri-bar-track"><div class="nutri-bar-fill' + (consumed > target ? " over" : "") + '" style="width:' + pct + '%"></div></div>' +
      '</div>'
    );
  }

  function handleRangeToggleClick(e) {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    overviewRange = btn.getAttribute("data-range");
    $("bizRangeToggle").querySelectorAll(".segmented-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
    renderOverview();
  }

  /* ==================== MARKETING ==================== */

  function channelROAS(ch) { return numOrZero(ch.adSpend) > 0 ? numOrZero(ch.revenue) / numOrZero(ch.adSpend) : 0; }
  function channelCPP(ch) { return numOrZero(ch.purchases) > 0 ? numOrZero(ch.adSpend) / numOrZero(ch.purchases) : 0; }
  function channelConversionRate(ch) { return numOrZero(ch.visitors) > 0 ? (numOrZero(ch.purchases) / numOrZero(ch.visitors)) * 100 : 0; }

  function channelCardHtml(key) {
    const core = window.JarvisCore;
    const ch = data.marketing[key];
    return (
      '<div class="channel-card" data-channel="' + key + '">' +
        '<span class="channel-card-name">' + MARKETING_CHANNEL_LABELS[key] + '</span>' +
        '<span class="channel-card-stat">Ad spend: <strong>' + core.formatCurrency(ch.adSpend) + '</strong></span>' +
        '<span class="channel-card-stat">Revenue: <strong>' + core.formatCurrency(ch.revenue) + '</strong></span>' +
        '<span class="channel-card-stat">ROAS: <strong>' + channelROAS(ch).toFixed(2) + 'x</strong></span>' +
        '<span class="channel-card-stat">Conversion: <strong>' + channelConversionRate(ch).toFixed(1) + '%</strong></span>' +
      '</div>'
    );
  }

  function renderMarketing() {
    const core = window.JarvisCore;
    $("bizMarketingChannelsGrid").innerHTML = MARKETING_CHANNELS.map(channelCardHtml).join("");

    const totals = { adSpend: 0, revenue: 0, visitors: 0, addToCarts: 0, checkoutStarts: 0, purchases: 0 };
    MARKETING_CHANNELS.forEach(function (k) {
      const ch = data.marketing[k];
      totals.adSpend += numOrZero(ch.adSpend); totals.revenue += numOrZero(ch.revenue);
      totals.visitors += numOrZero(ch.visitors); totals.addToCarts += numOrZero(ch.addToCarts);
      totals.checkoutStarts += numOrZero(ch.checkoutStarts); totals.purchases += numOrZero(ch.purchases);
    });
    const blendedROAS = totals.adSpend > 0 ? totals.revenue / totals.adSpend : 0;
    const cpp = totals.purchases > 0 ? totals.adSpend / totals.purchases : 0;
    const conversionRate = totals.visitors > 0 ? (totals.purchases / totals.visitors) * 100 : 0;
    const emailSubs = numOrZero(data.marketing.email.subscribers);
    const socialFollowers = numOrZero(data.marketing.tiktok.subscribers) + numOrZero(data.marketing.instagram.subscribers);

    $("bizMarketingSummaryStats").innerHTML =
      statBoxHtml(core.formatCurrency(totals.adSpend), "Total ad spend") +
      statBoxHtml(core.formatCurrency(totals.revenue), "Revenue from ads") +
      statBoxHtml(blendedROAS.toFixed(2) + "x", "ROAS") +
      statBoxHtml(core.formatCurrency(cpp), "Cost per purchase") +
      statBoxHtml(conversionRate.toFixed(1) + "%", "Conversion rate") +
      statBoxHtml(String(totals.visitors), "Website visitors") +
      statBoxHtml(String(totals.addToCarts), "Add-to-carts") +
      statBoxHtml(String(totals.checkoutStarts), "Checkout starts") +
      statBoxHtml(String(totals.purchases), "Purchases") +
      statBoxHtml(String(emailSubs), "Email subscribers") +
      statBoxHtml(String(socialFollowers), "Social followers");

    renderContentList();
  }

  function openMarketingChannelModal(key) {
    activeMarketingChannel = key;
    const ch = data.marketing[key];
    $("bizMarketingChannelModalTitle").textContent = "Update " + MARKETING_CHANNEL_LABELS[key];
    $("bizMarketingAdSpend").value = ch.adSpend || "";
    $("bizMarketingRevenue").value = ch.revenue || "";
    $("bizMarketingVisitors").value = ch.visitors || "";
    $("bizMarketingAddToCarts").value = ch.addToCarts || "";
    $("bizMarketingCheckoutStarts").value = ch.checkoutStarts || "";
    $("bizMarketingPurchases").value = ch.purchases || "";
    $("bizMarketingSubscribers").value = ch.subscribers || "";
    $("bizMarketingSubscribersLabel").textContent = (key === "email") ? "Email subscribers" : (key === "tiktok" || key === "instagram") ? "Social followers" : "Subscribers / followers";
    window.JarvisCore.openModal("bizMarketingChannelModal");
  }

  function handleMarketingChannelFormSubmit(e) {
    e.preventDefault();
    if (!activeMarketingChannel) return;
    data.marketing[activeMarketingChannel] = {
      adSpend: numOrZero($("bizMarketingAdSpend").value), revenue: numOrZero($("bizMarketingRevenue").value),
      visitors: numOrZero($("bizMarketingVisitors").value), addToCarts: numOrZero($("bizMarketingAddToCarts").value),
      checkoutStarts: numOrZero($("bizMarketingCheckoutStarts").value), purchases: numOrZero($("bizMarketingPurchases").value),
      subscribers: numOrZero($("bizMarketingSubscribers").value)
    };
    save();
    window.JarvisCore.closeModal("bizMarketingChannelModal");
    renderMarketing();
    window.JarvisCore.showToast(MARKETING_CHANNEL_LABELS[activeMarketingChannel] + " updated.");
    activeMarketingChannel = null;
  }

  function handleMarketingChannelsGridClick(e) {
    const card = e.target.closest(".channel-card");
    if (card) openMarketingChannelModal(card.getAttribute("data-channel"));
  }

  /* ==================== CONTENT PLANNER ==================== */

  const CONTENT_STATUS_BADGE = { Idea: "badge-neutral", Creating: "badge-yellow", Ready: "badge-yellow", Scheduled: "badge-yellow", Posted: "badge-green", Repurpose: "badge-neutral" };

  function resetContentForm() {
    contentFormEditId = null;
    $("bizContentPlatform").value = "TikTok";
    ["bizContentTitle", "bizContentType", "bizContentScheduledDate", "bizContentCta", "bizContentNotes", "bizContentPerformance"].forEach(function (id) { $(id).value = ""; });
    $("bizContentStatus").value = "Idea";
    $("bizContentModalTitle").textContent = "Add Content Idea";
    $("bizContentFormSubmitBtn").textContent = "Add Content Idea";
    $("bizContentFormCancelBtn").classList.add("hidden");
  }

  function openContentModal(item) {
    resetContentForm();
    if (item) {
      contentFormEditId = item.id;
      $("bizContentPlatform").value = item.platform;
      $("bizContentType").value = item.contentType || "";
      $("bizContentTitle").value = item.title;
      $("bizContentScheduledDate").value = item.scheduledDate || "";
      $("bizContentStatus").value = item.status;
      $("bizContentCta").value = item.cta || "";
      $("bizContentNotes").value = item.notes || "";
      $("bizContentPerformance").value = item.performanceNotes || "";
      $("bizContentModalTitle").textContent = "Edit Content Idea";
      $("bizContentFormSubmitBtn").textContent = "Save Changes";
      $("bizContentFormCancelBtn").classList.remove("hidden");
    }
    window.JarvisCore.openModal("bizContentModal");
  }

  function handleContentFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const title = $("bizContentTitle").value.trim();
    if (!title) { core.showToast("Give the content a title."); return; }
    const raw = {
      platform: $("bizContentPlatform").value, title: title, contentType: $("bizContentType").value.trim(),
      scheduledDate: $("bizContentScheduledDate").value, status: $("bizContentStatus").value,
      cta: $("bizContentCta").value.trim(), notes: $("bizContentNotes").value.trim(), performanceNotes: $("bizContentPerformance").value.trim()
    };
    if (contentFormEditId) {
      const c = data.content.find(function (cc) { return cc.id === contentFormEditId; });
      if (c) Object.assign(c, raw);
    } else {
      data.content.push(Object.assign({}, raw, { id: core.uid("content"), createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizContentModal");
    renderContentList();
    core.showToast(contentFormEditId ? "Content updated." : "Content idea added.");
  }

  function contentRowHtml(c) {
    const core = window.JarvisCore;
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(c.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(c.title) + ' <span class="badge ' + (CONTENT_STATUS_BADGE[c.status] || "badge-neutral") + '">' + core.escapeHtml(c.status) + '</span></span>' +
            '<span class="list-item-meta">' + core.escapeHtml(c.platform) + (c.contentType ? " &middot; " + core.escapeHtml(c.contentType) : "") + (c.scheduledDate ? " &middot; " + core.formatDate(c.scheduledDate) : "") + '</span>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon content-edit-btn" data-id="' + core.escapeHtml(c.id) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger content-delete-btn" data-id="' + core.escapeHtml(c.id) + '">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderContentList() {
    const container = $("bizContentList");
    if (data.content.length === 0) { container.innerHTML = '<div class="empty-state">No content planned yet.</div>'; return; }
    const sorted = data.content.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    container.innerHTML = sorted.map(contentRowHtml).join("");
  }

  function handleContentListClick(e) {
    const editBtn = e.target.closest(".content-edit-btn");
    if (editBtn) { const c = data.content.find(function (cc) { return cc.id === editBtn.getAttribute("data-id"); }); if (c) openContentModal(c); return; }
    const delBtn = e.target.closest(".content-delete-btn");
    if (delBtn) {
      const c = data.content.find(function (cc) { return cc.id === delBtn.getAttribute("data-id"); });
      if (!c) return;
      if (!window.confirm('Delete "' + c.title + '"? This can\'t be undone.')) return;
      data.content = data.content.filter(function (cc) { return cc.id !== c.id; });
      save();
      renderContentList();
      window.JarvisCore.showToast("Content idea deleted.");
    }
  }

  /* ==================== GOALS ==================== */

  function goalProgressPct(g) {
    if (g.status === "Complete") return 100;
    if (g.hasNumericTarget && isFinite(g.targetValue) && g.targetValue !== 0) return Math.min(100, Math.max(0, Math.round((g.currentValue / g.targetValue) * 100)));
    return Math.min(100, Math.max(0, Math.round(g.manualProgressPct || 0)));
  }

  function updateGoalFormNumericVisibility() {
    const hasNumeric = $("bizGoalHasNumeric").checked;
    $("bizGoalNumericRow").classList.toggle("hidden", !hasNumeric);
    $("bizGoalUnitRow").classList.toggle("hidden", !hasNumeric);
    $("bizGoalManualProgressRow").classList.toggle("hidden", hasNumeric);
  }

  function resetGoalForm() {
    goalFormEditId = null;
    $("bizGoalTitle").value = "";
    $("bizGoalCategory").value = "Revenue";
    $("bizGoalPriority").value = "Medium";
    $("bizGoalTargetDate").value = "";
    $("bizGoalStatus").value = "Not Started";
    $("bizGoalHasNumeric").checked = false;
    ["bizGoalCurrentValue", "bizGoalTargetValue", "bizGoalUnit"].forEach(function (id) { $(id).value = ""; });
    $("bizGoalManualProgress").value = "0";
    $("bizGoalNotes").value = "";
    $("bizGoalModalTitle").textContent = "Add Goal";
    $("bizGoalFormSubmitBtn").textContent = "Save Goal";
    $("bizGoalFormCancelBtn").classList.add("hidden");
    updateGoalFormNumericVisibility();
  }

  function openGoalModal(goal) {
    resetGoalForm();
    if (goal) {
      goalFormEditId = goal.id;
      $("bizGoalTitle").value = goal.title;
      $("bizGoalCategory").value = goal.category;
      $("bizGoalPriority").value = goal.priority;
      $("bizGoalTargetDate").value = goal.targetDate || "";
      $("bizGoalStatus").value = goal.status;
      $("bizGoalHasNumeric").checked = !!goal.hasNumericTarget;
      $("bizGoalCurrentValue").value = goal.hasNumericTarget ? goal.currentValue : "";
      $("bizGoalTargetValue").value = goal.hasNumericTarget ? goal.targetValue : "";
      $("bizGoalUnit").value = goal.unit || "";
      $("bizGoalManualProgress").value = goal.hasNumericTarget ? "0" : (goal.manualProgressPct || 0);
      $("bizGoalNotes").value = goal.notes || "";
      $("bizGoalModalTitle").textContent = "Edit Goal";
      $("bizGoalFormSubmitBtn").textContent = "Save Changes";
      $("bizGoalFormCancelBtn").classList.remove("hidden");
      updateGoalFormNumericVisibility();
    }
    window.JarvisCore.openModal("bizGoalModal");
  }

  function handleGoalFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const title = $("bizGoalTitle").value.trim();
    if (!title) { core.showToast("Give the goal a title."); return; }
    const hasNumeric = $("bizGoalHasNumeric").checked;
    const raw = {
      title: title, category: $("bizGoalCategory").value, priority: $("bizGoalPriority").value,
      targetDate: $("bizGoalTargetDate").value, status: $("bizGoalStatus").value,
      hasNumericTarget: hasNumeric, currentValue: hasNumeric ? numOrZero($("bizGoalCurrentValue").value) : 0,
      targetValue: hasNumeric ? numOrZero($("bizGoalTargetValue").value) : 0, unit: hasNumeric ? $("bizGoalUnit").value.trim() : "",
      manualProgressPct: hasNumeric ? 0 : clampInt($("bizGoalManualProgress").value, 0, 100, 0),
      notes: $("bizGoalNotes").value.trim()
    };
    if (goalFormEditId) {
      const g = data.goals.find(function (gg) { return gg.id === goalFormEditId; });
      if (g) Object.assign(g, raw);
    } else {
      data.goals.push(Object.assign({}, raw, { id: core.uid("bizgoal"), createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizGoalModal");
    renderGoals(); renderAnalytics();
    core.showToast(goalFormEditId ? "Goal updated." : "Goal created.");
  }

  function goalRowHtml(g) {
    const core = window.JarvisCore;
    const pct = goalProgressPct(g);
    const unitSuffix = g.unit ? (" " + core.escapeHtml(g.unit)) : "";
    const valueLine = g.hasNumericTarget ? (g.currentValue + unitSuffix + " / " + g.targetValue + unitSuffix) : (pct + "%");
    const priorityBadge = g.priority === "High" ? "badge-red" : g.priority === "Low" ? "badge-green" : "badge-yellow";
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(g.id) + '">' +
        '<div class="list-item-main">' +
          '<span class="list-item-title">' + core.escapeHtml(g.title) + ' <span class="badge ' + priorityBadge + '">' + core.escapeHtml(g.priority) + '</span>' + (g.status === "Complete" ? ' <span class="badge badge-green">Complete</span>' : "") + '</span>' +
          '<span class="list-item-meta">' + core.escapeHtml(g.category) + (g.targetDate ? " &middot; Target: " + core.formatDate(g.targetDate) : "") + " &middot; " + core.escapeHtml(g.status) + '</span>' +
          (g.notes ? '<span class="list-item-meta">' + core.escapeHtml(g.notes) + '</span>' : "") +
          '<div class="nutri-bar-row" style="margin-top:8px;">' +
            '<div class="nutri-bar-label"><span>Progress</span><span class="nutri-bar-value">' + valueLine + '</span></div>' +
            '<div class="nutri-bar-track"><div class="nutri-bar-fill" style="width:' + pct + '%"></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="list-item-actions" style="margin-top:10px;">' +
          '<button type="button" class="btn-icon goal-edit-btn" data-id="' + core.escapeHtml(g.id) + '">Edit</button>' +
          '<button type="button" class="btn-icon danger goal-delete-btn" data-id="' + core.escapeHtml(g.id) + '">Delete</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderGoals() {
    const container = $("bizGoalsList");
    if (data.goals.length === 0) { container.innerHTML = '<div class="empty-state">No goals yet. Add one above.</div>'; return; }
    const sorted = data.goals.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    container.innerHTML = sorted.map(goalRowHtml).join("");
  }

  function handleGoalsListClick(e) {
    const editBtn = e.target.closest(".goal-edit-btn");
    if (editBtn) { const g = data.goals.find(function (gg) { return gg.id === editBtn.getAttribute("data-id"); }); if (g) openGoalModal(g); return; }
    const delBtn = e.target.closest(".goal-delete-btn");
    if (delBtn) {
      const g = data.goals.find(function (gg) { return gg.id === delBtn.getAttribute("data-id"); });
      if (!g) return;
      if (!window.confirm('Delete goal "' + g.title + '"? This can\'t be undone.')) return;
      data.goals = data.goals.filter(function (gg) { return gg.id !== g.id; });
      save();
      renderGoals(); renderAnalytics();
      window.JarvisCore.showToast("Goal deleted.");
    }
  }

  /* ==================== LAUNCH CHECKLISTS ==================== */

  function renderChecklistProductOptions() {
    const core = window.JarvisCore;
    const sel = $("bizChecklistProductSelect");
    const current = sel.value;
    sel.innerHTML = '<option value="">None</option>' + data.products.map(function (p) { return '<option value="' + core.escapeHtml(p.id) + '">' + core.escapeHtml(p.name) + '</option>'; }).join("");
    if (data.products.some(function (p) { return p.id === current; })) sel.value = current;
  }

  function checklistCompletionPct(c) {
    if (!c.items || c.items.length === 0) return 0;
    return Math.round((c.items.filter(function (i) { return i.done; }).length / c.items.length) * 100);
  }

  function checklistRowHtml(c) {
    const core = window.JarvisCore;
    const pct = checklistCompletionPct(c);
    const product = data.products.find(function (p) { return p.id === c.productId; });
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(c.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(c.name) + '</span>' +
            '<span class="list-item-meta">' + (product ? core.escapeHtml(product.name) + " &middot; " : "") + pct + '% complete</span>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon checklist-open-btn" data-id="' + core.escapeHtml(c.id) + '">Open</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderChecklistsList() {
    const container = $("bizChecklistsList");
    if (data.checklists.length === 0) { container.innerHTML = '<div class="empty-state">No checklists yet.</div>'; return; }
    container.innerHTML = data.checklists.map(checklistRowHtml).join("");
  }

  function handleChecklistsListClick(e) {
    const openBtn = e.target.closest(".checklist-open-btn");
    if (openBtn) openChecklistModal(openBtn.getAttribute("data-id"));
  }

  function handleAddChecklistClick() {
    const core = window.JarvisCore;
    const checklist = { id: core.uid("checklist"), name: "New Launch Checklist", productId: null, items: DEFAULT_CHECKLIST_ITEMS.map(function (t) { return { id: core.uid("item"), text: t, done: false }; }), createdAt: Date.now() };
    data.checklists.push(checklist);
    save();
    renderChecklistsList();
    openChecklistModal(checklist.id);
  }

  function renderChecklistItemsList() {
    const core = window.JarvisCore;
    const checklist = data.checklists.find(function (c) { return c.id === activeChecklistId; });
    if (!checklist) return;
    $("bizChecklistItemsList").innerHTML = checklist.items.map(function (item) {
      return (
        '<div class="checklist-item">' +
          '<input type="checkbox" class="checklist-item-toggle" data-item-id="' + core.escapeHtml(item.id) + '"' + (item.done ? " checked" : "") + '>' +
          '<label>' + core.escapeHtml(item.text) + '</label>' +
          '<button type="button" class="btn-icon danger checklist-item-delete-btn" data-item-id="' + core.escapeHtml(item.id) + '" style="margin-left:auto;" aria-label="Remove item">&times;</button>' +
        '</div>'
      );
    }).join("");
  }

  function openChecklistModal(id) {
    activeChecklistId = id;
    const checklist = data.checklists.find(function (c) { return c.id === id; });
    if (!checklist) return;
    $("bizChecklistNameInput").value = checklist.name;
    renderChecklistProductOptions();
    $("bizChecklistProductSelect").value = checklist.productId || "";
    renderChecklistItemsList();
    window.JarvisCore.openModal("bizChecklistModal");
  }

  function handleChecklistItemsListChange(e) {
    const toggle = e.target.closest(".checklist-item-toggle");
    if (!toggle) return;
    const checklist = data.checklists.find(function (c) { return c.id === activeChecklistId; });
    if (!checklist) return;
    const item = checklist.items.find(function (i) { return i.id === toggle.getAttribute("data-item-id"); });
    if (item) { item.done = toggle.checked; save(); renderChecklistsList(); }
  }

  function handleChecklistItemsListClick(e) {
    const delBtn = e.target.closest(".checklist-item-delete-btn");
    if (!delBtn) return;
    const checklist = data.checklists.find(function (c) { return c.id === activeChecklistId; });
    if (!checklist) return;
    checklist.items = checklist.items.filter(function (i) { return i.id !== delBtn.getAttribute("data-item-id"); });
    save();
    renderChecklistItemsList(); renderChecklistsList();
  }

  function handleChecklistAddItem() {
    const text = $("bizChecklistNewItemInput").value.trim();
    if (!text) return;
    const checklist = data.checklists.find(function (c) { return c.id === activeChecklistId; });
    if (!checklist) return;
    checklist.items.push({ id: window.JarvisCore.uid("item"), text: text, done: false });
    $("bizChecklistNewItemInput").value = "";
    save();
    renderChecklistItemsList(); renderChecklistsList();
  }

  function handleChecklistSave() {
    const checklist = data.checklists.find(function (c) { return c.id === activeChecklistId; });
    if (!checklist) return;
    checklist.name = $("bizChecklistNameInput").value.trim() || checklist.name;
    checklist.productId = $("bizChecklistProductSelect").value || null;
    save();
    window.JarvisCore.closeModal("bizChecklistModal");
    renderChecklistsList();
    window.JarvisCore.showToast("Checklist saved.");
  }

  function handleChecklistDelete() {
    const checklist = data.checklists.find(function (c) { return c.id === activeChecklistId; });
    if (!checklist) return;
    if (!window.confirm('Delete checklist "' + checklist.name + '"? This can\'t be undone.')) return;
    data.checklists = data.checklists.filter(function (c) { return c.id !== checklist.id; });
    save();
    window.JarvisCore.closeModal("bizChecklistModal");
    renderChecklistsList();
    window.JarvisCore.showToast("Checklist deleted.");
  }

  /* ==================== TASKS (CEO Dashboard) ==================== */

  function resetTaskForm() {
    taskFormEditId = null;
    $("bizTaskText").value = ""; $("bizTaskPriority").value = "medium"; $("bizTaskDeadline").value = "";
    $("bizTaskCategory").value = ""; $("bizTaskNotes").value = "";
    $("bizTaskModalTitle").textContent = "Add Task";
    $("bizTaskFormSubmitBtn").textContent = "Add Task";
    $("bizTaskFormCancelBtn").classList.add("hidden");
  }

  function openTaskModal(task) {
    resetTaskForm();
    if (task) {
      taskFormEditId = task.id;
      $("bizTaskText").value = task.text; $("bizTaskPriority").value = task.priority;
      $("bizTaskDeadline").value = task.deadline || ""; $("bizTaskCategory").value = task.category || "";
      $("bizTaskNotes").value = task.notes || "";
      $("bizTaskModalTitle").textContent = "Edit Task";
      $("bizTaskFormSubmitBtn").textContent = "Save Changes";
      $("bizTaskFormCancelBtn").classList.remove("hidden");
    }
    window.JarvisCore.openModal("bizTaskModal");
  }

  function handleTaskFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const text = $("bizTaskText").value.trim();
    if (!text) { core.showToast("Enter a task."); return; }
    const raw = { text: text, priority: $("bizTaskPriority").value, deadline: $("bizTaskDeadline").value, category: $("bizTaskCategory").value.trim(), notes: $("bizTaskNotes").value.trim() };
    if (taskFormEditId) {
      const t = data.tasks.find(function (tt) { return tt.id === taskFormEditId; });
      if (t) Object.assign(t, raw);
    } else {
      data.tasks.push(Object.assign({}, raw, { id: core.uid("biztask"), completed: false, createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizTaskModal");
    renderTasks();
    core.showToast(taskFormEditId ? "Task updated." : "Task added.");
  }

  const TASK_PRIORITY_BADGE = { high: "badge-red", medium: "badge-yellow", low: "badge-green" };

  function taskRowHtml(t) {
    const core = window.JarvisCore;
    return (
      '<div class="food-item-card task-row' + (t.completed ? " task-row-done" : "") + '" data-id="' + core.escapeHtml(t.id) + '">' +
        '<button type="button" class="habit-check-btn task-check-btn' + (t.completed ? " done" : "") + '" data-id="' + core.escapeHtml(t.id) + '" aria-pressed="' + !!t.completed + '">' + (t.completed ? "&#10003;" : "") + '</button>' +
        '<div class="food-item-main">' +
          '<div class="food-item-title-row">' +
            '<span class="food-item-title task-text">' + core.escapeHtml(t.text) + '</span>' +
            '<span class="badge ' + (TASK_PRIORITY_BADGE[t.priority] || "badge-yellow") + '">' + t.priority + '</span>' +
          '</div>' +
          '<div class="food-item-meta">' + (t.deadline ? core.formatDate(t.deadline) : "No deadline") + (t.category ? " &middot; " + core.escapeHtml(t.category) : "") + '</div>' +
        '</div>' +
        '<div class="food-item-menu-wrap">' +
          '<button type="button" class="btn-icon task-edit-btn" data-id="' + core.escapeHtml(t.id) + '">Edit</button>' +
          '<button type="button" class="btn-icon danger task-delete-btn" data-id="' + core.escapeHtml(t.id) + '">Delete</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderTasks() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const weekEnd = addDaysISO(getMondayISO(today), 6);
    const buckets = { today: [], week: [], overdue: [], completed: [] };
    data.tasks.forEach(function (t) {
      if (t.completed) { buckets.completed.push(t); return; }
      if (!t.deadline) { buckets.week.push(t); return; }
      if (t.deadline < today) { buckets.overdue.push(t); return; }
      if (t.deadline === today) { buckets.today.push(t); return; }
      buckets.week.push(t);
    });
    function renderBucket(id, list, emptyMsg) {
      $(id).innerHTML = list.length ? list.map(taskRowHtml).join("") : '<div class="empty-state">' + emptyMsg + '</div>';
    }
    renderBucket("bizTasksToday", buckets.today, "Nothing due today.");
    renderBucket("bizTasksWeek", buckets.week, "Nothing due this week.");
    renderBucket("bizTasksOverdue", buckets.overdue, "Nothing overdue.");
    renderBucket("bizTasksCompleted", buckets.completed.slice().reverse(), "Nothing completed yet.");

    const dueToday = data.tasks.filter(function (t) { return t.deadline === today; });
    const doneToday = dueToday.filter(function (t) { return t.completed; }).length;
    $("bizTaskProgressRow").innerHTML = dueToday.length > 0
      ? barHtmlPlain("Today's business work", doneToday, dueToday.length)
      : '<p class="field-hint">No tasks due today.</p>';
  }

  function barHtmlPlain(label, done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      '<div class="nutri-bar-label"><span>' + label + '</span><span class="nutri-bar-value">' + done + ' / ' + total + '</span></div>' +
      '<div class="nutri-bar-track"><div class="nutri-bar-fill" style="width:' + pct + '%"></div></div>'
    );
  }

  function handleTasksClick(e) {
    const checkBtn = e.target.closest(".task-check-btn");
    if (checkBtn) {
      const t = data.tasks.find(function (tt) { return tt.id === checkBtn.getAttribute("data-id"); });
      if (t) { t.completed = !t.completed; save(); renderTasks(); }
      return;
    }
    const editBtn = e.target.closest(".task-edit-btn");
    if (editBtn) { const t = data.tasks.find(function (tt) { return tt.id === editBtn.getAttribute("data-id"); }); if (t) openTaskModal(t); return; }
    const delBtn = e.target.closest(".task-delete-btn");
    if (delBtn) {
      const t = data.tasks.find(function (tt) { return tt.id === delBtn.getAttribute("data-id"); });
      if (!t) return;
      if (!window.confirm('Delete "' + t.text + '"? This can\'t be undone.')) return;
      data.tasks = data.tasks.filter(function (tt) { return tt.id !== t.id; });
      save(); renderTasks();
      window.JarvisCore.showToast("Task deleted.");
    }
  }

  /* ==================== IDEAS VAULT ==================== */

  function resetIdeaForm() {
    ideaFormEditId = null;
    $("bizIdeaText").value = ""; $("bizIdeaCategory").value = "Product"; $("bizIdeaPriority").value = "Medium";
    $("bizIdeaStatus").value = "New"; $("bizIdeaNotes").value = "";
    $("bizIdeaModalTitle").textContent = "Add Idea";
    $("bizIdeaFormSubmitBtn").textContent = "Add Idea";
    $("bizIdeaFormCancelBtn").classList.add("hidden");
  }

  function openIdeaModal(idea) {
    resetIdeaForm();
    if (idea) {
      ideaFormEditId = idea.id;
      $("bizIdeaText").value = idea.text; $("bizIdeaCategory").value = idea.category; $("bizIdeaPriority").value = idea.priority;
      $("bizIdeaStatus").value = idea.status; $("bizIdeaNotes").value = idea.notes || "";
      $("bizIdeaModalTitle").textContent = "Edit Idea";
      $("bizIdeaFormSubmitBtn").textContent = "Save Changes";
      $("bizIdeaFormCancelBtn").classList.remove("hidden");
    }
    window.JarvisCore.openModal("bizIdeaModal");
  }

  function handleIdeaFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const text = $("bizIdeaText").value.trim();
    if (!text) { core.showToast("Enter an idea."); return; }
    const raw = { text: text, category: $("bizIdeaCategory").value, priority: $("bizIdeaPriority").value, status: $("bizIdeaStatus").value, notes: $("bizIdeaNotes").value.trim() };
    if (ideaFormEditId) {
      const i = data.ideas.find(function (ii) { return ii.id === ideaFormEditId; });
      if (i) Object.assign(i, raw);
    } else {
      data.ideas.push(Object.assign({}, raw, { id: core.uid("idea"), createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizIdeaModal");
    renderIdeas();
    core.showToast(ideaFormEditId ? "Idea updated." : "Idea saved.");
  }

  function ideaRowHtml(i) {
    const core = window.JarvisCore;
    const priorityBadge = i.priority === "High" ? "badge-red" : i.priority === "Low" ? "badge-green" : "badge-yellow";
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(i.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(i.text) + ' <span class="badge ' + priorityBadge + '">' + core.escapeHtml(i.priority) + '</span></span>' +
            '<span class="list-item-meta">' + core.escapeHtml(i.category) + " &middot; " + core.escapeHtml(i.status) + " &middot; " + core.formatDate(i.createdAt) + '</span>' +
            (i.notes ? '<span class="list-item-meta">' + core.escapeHtml(i.notes) + '</span>' : "") +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon idea-edit-btn" data-id="' + core.escapeHtml(i.id) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger idea-delete-btn" data-id="' + core.escapeHtml(i.id) + '">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderIdeas() {
    const container = $("bizIdeasList");
    if (data.ideas.length === 0) { container.innerHTML = '<div class="empty-state">No ideas saved yet.</div>'; return; }
    const sorted = data.ideas.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    container.innerHTML = sorted.map(ideaRowHtml).join("");
  }

  function handleIdeasListClick(e) {
    const editBtn = e.target.closest(".idea-edit-btn");
    if (editBtn) { const i = data.ideas.find(function (ii) { return ii.id === editBtn.getAttribute("data-id"); }); if (i) openIdeaModal(i); return; }
    const delBtn = e.target.closest(".idea-delete-btn");
    if (delBtn) {
      const i = data.ideas.find(function (ii) { return ii.id === delBtn.getAttribute("data-id"); });
      if (!i) return;
      if (!window.confirm("Delete this idea? This can't be undone.")) return;
      data.ideas = data.ideas.filter(function (ii) { return ii.id !== i.id; });
      save(); renderIdeas();
      window.JarvisCore.showToast("Idea deleted.");
    }
  }

  /* ==================== LEARNING TRACKER ==================== */

  function resetLearningForm() {
    learningFormEditId = null;
    ["bizLearningTopic", "bizLearningResource", "bizLearningKeyLesson", "bizLearningApplication", "bizLearningNotes"].forEach(function (id) { $(id).value = ""; });
    $("bizLearningCompleted").checked = false;
    $("bizLearningModalTitle").textContent = "Add Learning";
    $("bizLearningFormSubmitBtn").textContent = "Add Learning";
    $("bizLearningFormCancelBtn").classList.add("hidden");
  }

  function openLearningModal(entry) {
    resetLearningForm();
    if (entry) {
      learningFormEditId = entry.id;
      $("bizLearningTopic").value = entry.topic; $("bizLearningResource").value = entry.resource || "";
      $("bizLearningKeyLesson").value = entry.keyLesson || ""; $("bizLearningApplication").value = entry.application || "";
      $("bizLearningNotes").value = entry.notes || ""; $("bizLearningCompleted").checked = !!entry.completed;
      $("bizLearningModalTitle").textContent = "Edit Learning";
      $("bizLearningFormSubmitBtn").textContent = "Save Changes";
      $("bizLearningFormCancelBtn").classList.remove("hidden");
    }
    window.JarvisCore.openModal("bizLearningModal");
  }

  function handleLearningFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const topic = $("bizLearningTopic").value.trim();
    if (!topic) { core.showToast("Enter a topic."); return; }
    const raw = {
      topic: topic, resource: $("bizLearningResource").value.trim(), keyLesson: $("bizLearningKeyLesson").value.trim(),
      application: $("bizLearningApplication").value.trim(), notes: $("bizLearningNotes").value.trim(), completed: $("bizLearningCompleted").checked
    };
    if (learningFormEditId) {
      const l = data.learning.find(function (ll) { return ll.id === learningFormEditId; });
      if (l) Object.assign(l, raw);
    } else {
      data.learning.push(Object.assign({}, raw, { id: core.uid("learning"), createdAt: Date.now() }));
    }
    save();
    window.JarvisCore.closeModal("bizLearningModal");
    renderLearning();
    core.showToast(learningFormEditId ? "Learning entry updated." : "Learning entry added.");
  }

  function learningRowHtml(l) {
    const core = window.JarvisCore;
    return (
      '<div class="list-item" data-id="' + core.escapeHtml(l.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(l.topic) + (l.completed ? ' <span class="badge badge-green">Done</span>' : "") + '</span>' +
            (l.resource ? '<span class="list-item-meta">' + core.escapeHtml(l.resource) + '</span>' : "") +
            (l.keyLesson ? '<span class="list-item-meta">Lesson: ' + core.escapeHtml(l.keyLesson) + '</span>' : "") +
            (l.application ? '<span class="list-item-meta">Applying: ' + core.escapeHtml(l.application) + '</span>' : "") +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon learning-edit-btn" data-id="' + core.escapeHtml(l.id) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger learning-delete-btn" data-id="' + core.escapeHtml(l.id) + '">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderLearning() {
    const container = $("bizLearningList");
    if (data.learning.length === 0) { container.innerHTML = '<div class="empty-state">Nothing logged yet.</div>'; return; }
    const sorted = data.learning.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    container.innerHTML = sorted.map(learningRowHtml).join("");
  }

  function handleLearningListClick(e) {
    const editBtn = e.target.closest(".learning-edit-btn");
    if (editBtn) { const l = data.learning.find(function (ll) { return ll.id === editBtn.getAttribute("data-id"); }); if (l) openLearningModal(l); return; }
    const delBtn = e.target.closest(".learning-delete-btn");
    if (delBtn) {
      const l = data.learning.find(function (ll) { return ll.id === delBtn.getAttribute("data-id"); });
      if (!l) return;
      if (!window.confirm("Delete this learning entry? This can't be undone.")) return;
      data.learning = data.learning.filter(function (ll) { return ll.id !== l.id; });
      save(); renderLearning();
      window.JarvisCore.showToast("Learning entry deleted.");
    }
  }

  /* ==================== ANALYTICS ==================== */

  function renderAnalytics() {
    const core = window.JarvisCore;
    const months = buildMonthlyFinancials(6);
    renderLineChart("bizAnalyticsRevenueTrend", months.map(function (m) { return { v: m.revenue, label: m.label }; }), { ariaLabel: "Revenue trend", emptyMessage: "Log some sales to see your revenue trend." });
    renderLineChart("bizAnalyticsProfitTrend", months.map(function (m) { return { v: m.profit, label: m.label }; }), { ariaLabel: "Profit trend", color: "var(--green)", emptyMessage: "Log some sales and expenses to see your profit trend." });

    const salesByProduct = {};
    data.sales.forEach(function (s) {
      if (!s.productId) return;
      salesByProduct[s.productId] = (salesByProduct[s.productId] || 0) + numOrZero(s.quantity);
    });
    const topProducts = Object.keys(salesByProduct).map(function (id) { return { product: data.products.find(function (p) { return p.id === id; }), qty: salesByProduct[id] }; })
      .filter(function (x) { return x.product; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    $("bizAnalyticsTopProducts").innerHTML = topProducts.length
      ? topProducts.map(function (x) { return '<div class="list-item"><div class="list-item-main"><span class="list-item-title">' + core.escapeHtml(x.product.name) + '</span><span class="list-item-meta">' + x.qty + ' sold</span></div></div>'; }).join("")
      : '<div class="empty-state">Log some sales to see your top-selling products.</div>';

    const marginRanked = data.products.filter(function (p) { return p.price > 0; }).slice().sort(function (a, b) { return productMarginPct(b) - productMarginPct(a); }).slice(0, 5);
    $("bizAnalyticsMarginProducts").innerHTML = marginRanked.length
      ? marginRanked.map(function (p) { return '<div class="list-item"><div class="list-item-main"><span class="list-item-title">' + core.escapeHtml(p.name) + '</span><span class="list-item-meta">' + Math.round(productMarginPct(p)) + '% margin</span></div></div>'; }).join("")
      : '<div class="empty-state">Add products with a price to see margin rankings.</div>';

    const byCategory = {};
    data.expenses.forEach(function (x) { byCategory[x.category] = (byCategory[x.category] || 0) + numOrZero(x.amount); });
    const categoryKeys = Object.keys(byCategory).sort(function (a, b) { return byCategory[b] - byCategory[a]; });
    $("bizAnalyticsExpensesByCategory").innerHTML = categoryKeys.length
      ? categoryKeys.map(function (cat) { return statBoxHtml(core.formatCurrency(byCategory[cat]), cat); }).join("")
      : '<div class="empty-state">Log some expenses to see your spending by category.</div>';

    const mTotals = { adSpend: 0, revenue: 0, purchases: 0, visitors: 0 };
    MARKETING_CHANNELS.forEach(function (k) {
      const ch = data.marketing[k];
      mTotals.adSpend += numOrZero(ch.adSpend); mTotals.revenue += numOrZero(ch.revenue);
      mTotals.purchases += numOrZero(ch.purchases); mTotals.visitors += numOrZero(ch.visitors);
    });
    if (mTotals.adSpend === 0 && mTotals.revenue === 0 && mTotals.visitors === 0) {
      $("bizAnalyticsMarketingPerformance").innerHTML = '<div class="empty-state">Log marketing numbers to see performance here.</div>';
    } else {
      const mROAS = mTotals.adSpend > 0 ? mTotals.revenue / mTotals.adSpend : 0;
      const mCPP = mTotals.purchases > 0 ? mTotals.adSpend / mTotals.purchases : 0;
      const mConversion = mTotals.visitors > 0 ? (mTotals.purchases / mTotals.visitors) * 100 : 0;
      $("bizAnalyticsMarketingPerformance").innerHTML =
        statBoxHtml(core.formatCurrency(mTotals.adSpend), "Ad spend") +
        statBoxHtml(core.formatCurrency(mTotals.revenue), "Revenue from ads") +
        statBoxHtml(mROAS.toFixed(2) + "x", "ROAS") +
        statBoxHtml(core.formatCurrency(mCPP), "Cost per purchase") +
        statBoxHtml(mConversion.toFixed(1) + "%", "Conversion rate");
    }

    if (months[5].revenue === 0 && months[4].revenue === 0) {
      $("bizAnalyticsMoM").innerHTML = '<div class="empty-state">Log at least two months of sales to see growth.</div>';
    } else {
      const prev = months[4].revenue, curr = months[5].revenue;
      const growthPct = prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0);
      $("bizAnalyticsMoM").innerHTML =
        statBoxHtml(core.formatCurrency(curr), "This month") +
        statBoxHtml(core.formatCurrency(prev), "Last month") +
        statBoxHtml((growthPct >= 0 ? "+" : "") + Math.round(growthPct) + "%", "Growth", growthPct >= 0 ? "positive" : "negative");
    }

    if (data.goals.length === 0) {
      $("bizAnalyticsGoalCompletion").innerHTML = '<div class="empty-state">Add some goals to track completion here.</div>';
    } else {
      const completedCount = data.goals.filter(function (g) { return g.status === "Complete"; }).length;
      $("bizAnalyticsGoalCompletion").innerHTML = barHtmlPlainPct("Goals completed", completedCount, data.goals.length);
    }
  }

  function barHtmlPlainPct(label, done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      '<div class="nutri-bar-row"><div class="nutri-bar-label"><span>' + label + '</span><span class="nutri-bar-value">' + done + ' / ' + total + ' (' + pct + '%)</span></div>' +
      '<div class="nutri-bar-track"><div class="nutri-bar-fill" style="width:' + pct + '%"></div></div></div>'
    );
  }

  /* ==================== boot ==================== */

  function renderAll() {
    renderOverview();
    renderProducts();
    renderSuppliers();
    renderSales();
    renderMarketing();
    renderGoals();
    renderTasks();
    renderIdeas();
    renderLearning();
    renderChecklistsList();
    renderAnalytics();
    renderProductSupplierOptions();
    renderSaleProductOptions();
    renderChecklistProductOptions();
  }

  function getSummary() {
    const s = computeOverviewStats("month");
    const activeGoals = data.goals.filter(function (g) { return g.status !== "Complete"; }).length;
    return { income: s.revenue, expense: s.expenses, net: s.netProfit, activeGoals: activeGoals, totalGoals: data.goals.length };
  }

  function onSubTabChange(targetId) {
    if (targetId === "biz-overview") renderOverview();
    if (targetId === "biz-products") { renderProducts(); renderChecklistsList(); }
    if (targetId === "biz-sales") renderSales();
    if (targetId === "biz-marketing") renderMarketing();
    if (targetId === "biz-goals") renderGoals();
    if (targetId === "biz-tasks") renderTasks();
    if (targetId === "biz-suppliers") renderSuppliers();
    if (targetId === "biz-ideas") { renderIdeas(); renderLearning(); }
    if (targetId === "biz-analytics") renderAnalytics();
  }

  function init() {
    load();

    $("bizRangeToggle").addEventListener("click", handleRangeToggleClick);
    $("bizProfileForm").addEventListener("submit", handleProfileFormSubmit);

    $("bizAddExpenseBtn").addEventListener("click", function () { openExpenseModal(null); });
    $("bizExpenseModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizExpenseModal"); });
    $("bizExpenseForm").addEventListener("submit", handleExpenseFormSubmit);
    $("bizExpenseFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizExpenseModal"); });
    $("bizExpensesList").addEventListener("click", handleExpensesListClick);

    $("bizAddProductBtn").addEventListener("click", function () { openProductModal(null); });
    $("bizProductModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizProductModal"); });
    $("bizProductForm").addEventListener("submit", handleProductFormSubmit);
    $("bizProductFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizProductModal"); });
    ["bizProductCost", "bizProductShipping", "bizProductPrice", "bizProductFees"].forEach(function (id) { $(id).addEventListener("input", updateProductComputedPreview); });
    $("bizProductsList").addEventListener("click", handleProductsListClick);
    $("bizProductSearchInput").addEventListener("input", function (e) { productSearch = e.target.value; renderProducts(); });
    $("bizProductStatusFilter").addEventListener("change", function (e) { productStatusFilter = e.target.value; renderProducts(); });
    $("bizProductSortSelect").addEventListener("change", function (e) { productSort = e.target.value; renderProducts(); });

    $("bizAddSupplierBtn").addEventListener("click", function () { openSupplierModal(null); });
    $("bizSupplierModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizSupplierModal"); });
    $("bizSupplierForm").addEventListener("submit", handleSupplierFormSubmit);
    $("bizSupplierFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizSupplierModal"); });
    $("bizSuppliersList").addEventListener("click", handleSuppliersListClick);
    $("bizSupplierSearchInput").addEventListener("input", function (e) { supplierSearch = e.target.value; renderSuppliers(); });

    $("bizAddSaleBtn").addEventListener("click", function () { openSaleModal(null); });
    $("bizSaleModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizSaleModal"); });
    $("bizSaleForm").addEventListener("submit", handleSaleFormSubmit);
    $("bizSaleFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizSaleModal"); });
    ["bizSaleRevenue", "bizSaleCost", "bizSaleQuantity", "bizSaleShipping", "bizSaleFees", "bizSaleAdCost"].forEach(function (id) { $(id).addEventListener("input", updateSaleProfitPreview); });
    $("bizSalesList").addEventListener("click", handleSalesListClick);

    $("bizMarketingChannelsGrid").addEventListener("click", handleMarketingChannelsGridClick);
    $("bizMarketingChannelModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizMarketingChannelModal"); });
    $("bizMarketingChannelForm").addEventListener("submit", handleMarketingChannelFormSubmit);

    $("bizAddContentBtn").addEventListener("click", function () { openContentModal(null); });
    $("bizContentModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizContentModal"); });
    $("bizContentForm").addEventListener("submit", handleContentFormSubmit);
    $("bizContentFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizContentModal"); });
    $("bizContentList").addEventListener("click", handleContentListClick);

    $("bizAddGoalBtn").addEventListener("click", function () { openGoalModal(null); });
    $("bizGoalModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizGoalModal"); });
    $("bizGoalHasNumeric").addEventListener("change", updateGoalFormNumericVisibility);
    $("bizGoalForm").addEventListener("submit", handleGoalFormSubmit);
    $("bizGoalFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizGoalModal"); });
    $("bizGoalsList").addEventListener("click", handleGoalsListClick);

    $("bizAddTaskBtn").addEventListener("click", function () { openTaskModal(null); });
    $("bizTaskModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizTaskModal"); });
    $("bizTaskForm").addEventListener("submit", handleTaskFormSubmit);
    $("bizTaskFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizTaskModal"); });
    ["bizTasksToday", "bizTasksWeek", "bizTasksOverdue", "bizTasksCompleted"].forEach(function (id) { $(id).addEventListener("click", handleTasksClick); });

    $("bizAddIdeaBtn").addEventListener("click", function () { openIdeaModal(null); });
    $("bizIdeaModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizIdeaModal"); });
    $("bizIdeaForm").addEventListener("submit", handleIdeaFormSubmit);
    $("bizIdeaFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizIdeaModal"); });
    $("bizIdeasList").addEventListener("click", handleIdeasListClick);

    $("bizAddLearningBtn").addEventListener("click", function () { openLearningModal(null); });
    $("bizLearningModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizLearningModal"); });
    $("bizLearningForm").addEventListener("submit", handleLearningFormSubmit);
    $("bizLearningFormCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizLearningModal"); });
    $("bizLearningList").addEventListener("click", handleLearningListClick);

    $("bizAddChecklistBtn").addEventListener("click", handleAddChecklistClick);
    $("bizChecklistsList").addEventListener("click", handleChecklistsListClick);
    $("bizChecklistModalCloseBtn").addEventListener("click", function () { window.JarvisCore.closeModal("bizChecklistModal"); });
    $("bizChecklistItemsList").addEventListener("change", handleChecklistItemsListChange);
    $("bizChecklistItemsList").addEventListener("click", handleChecklistItemsListClick);
    $("bizChecklistAddItemBtn").addEventListener("click", handleChecklistAddItem);
    $("bizChecklistSaveBtn").addEventListener("click", handleChecklistSave);
    $("bizChecklistDeleteBtn").addEventListener("click", handleChecklistDelete);

    renderAll();
  }

  window.JarvisBusiness = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange };
})();
