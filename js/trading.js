/* ==========================================================================
   JARVIS — Trading Lab
   Education, paper trading, journal, and discipline tools.
   Strictly for learning and practice: no broker connection, no real trades,
   no buy/sell signals, no live market data. All prices are manually entered.

   localStorage keys:
     jarvisTradingWatchlist
     jarvisPaperTrades
     jarvisTradingJournal
     jarvisTradingSettings
   ========================================================================== */

(function () {
  "use strict";

  const LS_WATCHLIST = "jarvisTradingWatchlist";
  const LS_TRADES = "jarvisPaperTrades";
  const LS_JOURNAL = "jarvisTradingJournal";
  const LS_SETTINGS = "jarvisTradingSettings";

  let watchlist = [];
  let trades = [];
  let journal = [];
  let settings = { startingBalance: 10000, dailyTradeLimit: 3 };

  /* ---------------- persistence ---------------- */

  function defaultWatchlist() {
    const core = window.JarvisCore;
    return [
      { id: core.uid("wl"), symbol: "SPY", price: 445.2, changePct: 0.32, notes: "S&P 500 ETF (demo data)" },
      { id: core.uid("wl"), symbol: "QQQ", price: 378.55, changePct: 0.51, notes: "Nasdaq-100 ETF (demo data)" },
      { id: core.uid("wl"), symbol: "AAPL", price: 189.4, changePct: -0.18, notes: "Demo data" },
      { id: core.uid("wl"), symbol: "NVDA", price: 118.11, changePct: 1.25, notes: "Demo data" },
      { id: core.uid("wl"), symbol: "TSLA", price: 248.5, changePct: -0.75, notes: "Demo data" }
    ];
  }

  function load() {
    const core = window.JarvisCore;

    let wl = core.loadJSON(LS_WATCHLIST, null);
    if (!Array.isArray(wl)) {
      wl = defaultWatchlist();
      core.saveJSON(LS_WATCHLIST, wl);
    }
    watchlist = wl;

    trades = core.loadJSON(LS_TRADES, []);
    if (!Array.isArray(trades)) trades = [];

    journal = core.loadJSON(LS_JOURNAL, []);
    if (!Array.isArray(journal)) journal = [];

    let st = core.loadJSON(LS_SETTINGS, null);
    if (!st || typeof st !== "object") {
      st = { startingBalance: 10000, dailyTradeLimit: 3 };
      core.saveJSON(LS_SETTINGS, st);
    }
    if (!core.isPositiveNumber(st.startingBalance)) st.startingBalance = 10000;
    if (!st.dailyTradeLimit || st.dailyTradeLimit < 1) st.dailyTradeLimit = 3;
    settings = st;
  }

  function saveWatchlist() { window.JarvisCore.saveJSON(LS_WATCHLIST, watchlist); }
  function saveTrades() { window.JarvisCore.saveJSON(LS_TRADES, trades); }
  function saveJournal() { window.JarvisCore.saveJSON(LS_JOURNAL, journal); }
  function saveSettings() { window.JarvisCore.saveJSON(LS_SETTINGS, settings); }

  /* ---------------- market clock ---------------- */

  function getEasternTimeInfo() {
    const now = new Date();
    const dateFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
    const timeFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    });
    const partsFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short"
    });
    const parts = {};
    partsFmt.formatToParts(now).forEach(function (p) { parts[p.type] = p.value; });
    return {
      dateLabel: dateFmt.format(now),
      timeLabel: timeFmt.format(now),
      hour: parseInt(parts.hour, 10),
      minute: parseInt(parts.minute, 10),
      weekday: parts.weekday
    };
  }

  function classifyMarketStatus(hour, minute, weekday) {
    if (weekday === "Sat" || weekday === "Sun") return "closed";
    const mins = hour * 60 + minute;
    if (mins >= 240 && mins < 570) return "pre";
    if (mins >= 570 && mins < 960) return "open";
    if (mins >= 960 && mins < 1200) return "after";
    return "closed";
  }

  const STATUS_LABELS = { pre: "Pre-Market", open: "Market Open", after: "After Hours", closed: "Market Closed" };

  function tickClock() {
    const info = getEasternTimeInfo();
    document.getElementById("marketDate").textContent = info.dateLabel;
    document.getElementById("marketClock").textContent = info.timeLabel;
    const status = classifyMarketStatus(info.hour, info.minute, info.weekday);
    document.getElementById("marketStatusText").textContent = STATUS_LABELS[status];
    document.getElementById("marketStatusDot").className = "status-dot " + status;
  }

  /* ---------------- watchlist ---------------- */

  function renderWatchlist() {
    const core = window.JarvisCore;
    const container = document.getElementById("watchlistTable");
    if (watchlist.length === 0) {
      container.innerHTML = '<div class="empty-state">No symbols on your watchlist.</div>';
      return;
    }
    container.innerHTML = watchlist.map(function (w) {
      const dirClass = w.changePct > 0 ? "up" : (w.changePct < 0 ? "down" : "flat");
      const arrow = w.changePct > 0 ? "▲" : (w.changePct < 0 ? "▼" : "—");
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(w.id) + '">' +
          '<div class="watchlist-row-inputs">' +
            '<strong>' + core.escapeHtml(w.symbol) + '</strong>' +
            '<input type="number" class="wl-price-input" data-id="' + core.escapeHtml(w.id) + '" min="0.01" step="0.01" value="' + core.escapeHtml(w.price) + '" aria-label="Price for ' + core.escapeHtml(w.symbol) + '">' +
            '<input type="number" class="wl-change-input" data-id="' + core.escapeHtml(w.id) + '" step="0.01" value="' + core.escapeHtml(w.changePct) + '" aria-label="Daily change percent for ' + core.escapeHtml(w.symbol) + '">' +
            '<input type="text" class="wl-notes-input" data-id="' + core.escapeHtml(w.id) + '" value="' + core.escapeHtml(w.notes || "") + '" maxlength="80" aria-label="Notes for ' + core.escapeHtml(w.symbol) + '">' +
            '<span class="direction-arrow ' + dirClass + '">' + arrow + " " + core.formatPercent(w.changePct) + '</span>' +
          '</div>' +
          '<div class="list-item-actions" style="margin-top:8px;">' +
            '<button type="button" class="btn-icon danger wl-remove-btn" data-id="' + core.escapeHtml(w.id) + '" aria-label="Remove ' + core.escapeHtml(w.symbol) + ' from watchlist">Remove</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function updateWatchlistArrowUI(rowEl, changePct) {
    const span = rowEl.querySelector(".direction-arrow");
    if (!span) return;
    const dirClass = changePct > 0 ? "up" : (changePct < 0 ? "down" : "flat");
    const arrow = changePct > 0 ? "▲" : (changePct < 0 ? "▼" : "—");
    span.className = "direction-arrow " + dirClass;
    span.textContent = arrow + " " + window.JarvisCore.formatPercent(changePct);
  }

  function handleWatchlistFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const symbol = document.getElementById("wlSymbol").value.trim().toUpperCase();
    const priceRaw = document.getElementById("wlPrice").value;
    const changeRaw = document.getElementById("wlChange").value;
    const notes = document.getElementById("wlNotes").value.trim();

    if (!symbol) { core.showToast("Please enter a symbol."); return; }
    const price = Number(priceRaw);
    if (!core.isPositiveNumber(price)) { core.showToast("Price must be a positive number."); return; }
    const changePct = changeRaw === "" ? 0 : Number(changeRaw);
    if (!isFinite(changePct)) { core.showToast("Daily change must be a number."); return; }
    if (watchlist.some(function (w) { return w.symbol === symbol; })) {
      core.showToast(symbol + " is already on your watchlist.");
      return;
    }

    watchlist.push({ id: core.uid("wl"), symbol: symbol, price: price, changePct: changePct, notes: notes });
    saveWatchlist();
    renderWatchlist();
    e.target.reset();
    core.showToast(symbol + " added to watchlist.");
  }

  function handleWatchlistTableClick(e) {
    const removeBtn = e.target.closest(".wl-remove-btn");
    if (!removeBtn) return;
    const id = removeBtn.getAttribute("data-id");
    watchlist = watchlist.filter(function (w) { return w.id !== id; });
    saveWatchlist();
    renderWatchlist();
  }

  function handleWatchlistTableChange(e) {
    const target = e.target;
    const id = target.getAttribute("data-id");
    if (!id) return;
    const core = window.JarvisCore;
    const w = watchlist.find(function (x) { return x.id === id; });
    if (!w) return;

    if (target.classList.contains("wl-price-input")) {
      const val = Number(target.value);
      if (!core.isPositiveNumber(val)) {
        target.value = w.price;
        core.showToast("Price must be a positive number.");
        return;
      }
      w.price = val;
      saveWatchlist();
    } else if (target.classList.contains("wl-change-input")) {
      const val = target.value === "" ? 0 : Number(target.value);
      if (!isFinite(val)) {
        target.value = w.changePct;
        core.showToast("Daily change must be a number.");
        return;
      }
      w.changePct = val;
      saveWatchlist();
      const row = target.closest(".watchlist-row-inputs");
      if (row) updateWatchlistArrowUI(row, val);
    } else if (target.classList.contains("wl-notes-input")) {
      w.notes = target.value;
      saveWatchlist();
    }
  }

  /* ---------------- pre-trade checklist ---------------- */

  const CHECKLIST_IDS = ["chk1", "chk2", "chk3", "chk4", "chk5", "chk6", "chk7"];

  function checklistCheckedCount() {
    return CHECKLIST_IDS.filter(function (id) {
      const el = document.getElementById(id);
      return el && el.checked;
    }).length;
  }

  function resetChecklist() {
    CHECKLIST_IDS.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    updateChecklistProgress();
  }

  function updateChecklistProgress() {
    const count = checklistCheckedCount();
    const pct = Math.round((count / CHECKLIST_IDS.length) * 100);
    document.getElementById("checklistProgressFill").style.width = pct + "%";
    document.getElementById("checklistProgressLabel").textContent = pct + "% complete";
    updateLogTradeButtonState();
  }

  function tradesLoggedToday() {
    const today = window.JarvisCore.todayISODate();
    return trades.filter(function (t) { return (t.dateTime || "").slice(0, 10) === today; }).length;
  }

  function isDailyLimitReached() {
    return tradesLoggedToday() >= settings.dailyTradeLimit;
  }

  function updateLogTradeButtonState() {
    const allChecked = checklistCheckedCount() === CHECKLIST_IDS.length;
    document.getElementById("logTradeBtn").disabled = !allChecked || isDailyLimitReached();
  }

  function setDefaultTradeDateTime() {
    document.getElementById("tradeDateTime").value = window.JarvisCore.nowLocalDateTimeInputValue();
  }

  /* ---------------- paper trading ---------------- */

  function computeUnrealizedPnl(t) {
    const cp = (t.currentPrice !== undefined && t.currentPrice !== null) ? t.currentPrice : t.entryPrice;
    if (t.direction === "buy") return (cp - t.entryPrice) * t.quantity;
    return (t.entryPrice - cp) * t.quantity;
  }

  function computeRealizedPnl(t) {
    if (t.status !== "closed" || t.exitPrice === undefined || t.exitPrice === null) return 0;
    if (t.direction === "buy") return (t.exitPrice - t.entryPrice) * t.quantity;
    return (t.entryPrice - t.exitPrice) * t.quantity;
  }

  function handleTradeFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;

    if (isDailyLimitReached()) {
      core.showToast("Daily paper trade limit reached.");
      return;
    }
    if (checklistCheckedCount() !== CHECKLIST_IDS.length) {
      core.showToast("Complete the pre-trade checklist first.");
      return;
    }

    const symbol = document.getElementById("tradeSymbol").value.trim().toUpperCase();
    const direction = document.getElementById("tradeDirection").value;
    const entryPrice = Number(document.getElementById("tradeEntryPrice").value);
    const quantity = Number(document.getElementById("tradeQuantity").value);
    const stopLoss = Number(document.getElementById("tradeStopLoss").value);
    const target = Number(document.getElementById("tradeTarget").value);
    const dateTime = document.getElementById("tradeDateTime").value;
    const reason = document.getElementById("tradeReason").value.trim();

    if (!symbol) { core.showToast("Please enter a symbol."); return; }
    if (!core.isPositiveNumber(entryPrice)) { core.showToast("Entry price must be a positive number."); return; }
    if (!core.isPositiveNumber(quantity)) { core.showToast("Quantity must be a positive number."); return; }
    if (!core.isPositiveNumber(stopLoss)) { core.showToast("Stop loss must be a positive number."); return; }
    if (!core.isPositiveNumber(target)) { core.showToast("Target must be a positive number."); return; }
    if (!dateTime) { core.showToast("Please choose a date and time."); return; }
    if (!reason) { core.showToast("Please enter a reason for entry."); return; }

    trades.push({
      id: core.uid("trade"),
      symbol: symbol,
      direction: direction,
      entryPrice: entryPrice,
      quantity: Math.round(quantity),
      stopLoss: stopLoss,
      target: target,
      dateTime: dateTime,
      reason: reason,
      status: "open",
      currentPrice: entryPrice,
      exitPrice: null,
      exitNotes: "",
      closeDateTime: null,
      createdAt: Date.now()
    });
    saveTrades();
    renderPaperTrading();
    e.target.reset();
    resetChecklist();
    setDefaultTradeDateTime();
    core.showToast("Paper trade logged.");
  }

  function renderOpenPositions() {
    const core = window.JarvisCore;
    const container = document.getElementById("openPositionsList");
    const openTrades = trades.filter(function (t) { return t.status === "open"; });
    if (openTrades.length === 0) {
      container.innerHTML = '<div class="empty-state">No open positions.</div>';
      return;
    }
    const sorted = openTrades.slice().sort(function (a, b) { return new Date(b.dateTime) - new Date(a.dateTime); });
    container.innerHTML = sorted.map(function (t) {
      const pnl = computeUnrealizedPnl(t);
      const pnlClass = pnl >= 0 ? "positive" : "negative";
      const dirLabel = t.direction === "buy" ? "Buy/Long" : "Sell/Short";
      const dirBadge = t.direction === "buy" ? "badge-green" : "badge-red";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(t.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(t.symbol) + ' <span class="badge ' + dirBadge + '">' + dirLabel + '</span></span>' +
              '<span class="list-item-meta">Entry ' + core.formatCurrency(t.entryPrice) + ' &times; ' + t.quantity + ' &middot; Stop ' + core.formatCurrency(t.stopLoss) + ' &middot; Target ' + core.formatCurrency(t.target) + ' &middot; ' + core.formatDateTime(t.dateTime) + '</span>' +
              '<span class="list-item-meta">Reason: ' + core.escapeHtml(t.reason) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="form-row two-col" style="margin-top:10px;">' +
            '<div>' +
              '<label for="cp-' + core.escapeHtml(t.id) + '">Current price</label>' +
              '<input type="number" id="cp-' + core.escapeHtml(t.id) + '" class="trade-current-price-input" data-id="' + core.escapeHtml(t.id) + '" min="0.01" step="0.01" value="' + core.escapeHtml(t.currentPrice) + '">' +
            '</div>' +
            '<div>' +
              '<span class="stat-label">Unrealized P&amp;L</span>' +
              '<div class="stat-value ' + pnlClass + '">' + core.formatCurrency(pnl) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="list-item-actions" style="margin-top:10px;">' +
            '<button type="button" class="btn btn-secondary trade-close-btn" data-id="' + core.escapeHtml(t.id) + '">Close Trade</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderClosedPositions() {
    const core = window.JarvisCore;
    const container = document.getElementById("closedPositionsList");
    const closedTrades = trades.filter(function (t) { return t.status === "closed"; });
    if (closedTrades.length === 0) {
      container.innerHTML = '<div class="empty-state">No closed positions yet.</div>';
      return;
    }
    const sorted = closedTrades.slice().sort(function (a, b) { return new Date(b.closeDateTime) - new Date(a.closeDateTime); });
    container.innerHTML = sorted.map(function (t) {
      const pnl = computeRealizedPnl(t);
      const dirLabel = t.direction === "buy" ? "Buy/Long" : "Sell/Short";
      const dirBadge = t.direction === "buy" ? "badge-green" : "badge-red";
      const notes = t.exitNotes ? '<span class="list-item-meta">Notes: ' + core.escapeHtml(t.exitNotes) + '</span>' : "";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(t.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(t.symbol) + ' <span class="badge ' + dirBadge + '">' + dirLabel + '</span> <span class="badge ' + (pnl >= 0 ? "badge-green" : "badge-red") + '">' + core.formatCurrency(pnl) + '</span></span>' +
              '<span class="list-item-meta">Entry ' + core.formatCurrency(t.entryPrice) + ' &rarr; Exit ' + core.formatCurrency(t.exitPrice) + ' &times; ' + t.quantity + ' &middot; Closed ' + core.formatDateTime(t.closeDateTime) + '</span>' +
              notes +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleOpenPositionsClick(e) {
    const btn = e.target.closest(".trade-close-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    document.getElementById("closeTradeId").value = id;
    document.getElementById("closeExitPrice").value = "";
    document.getElementById("closeTradeNotes").value = "";
    window.JarvisCore.openModal("closeTradeModal");
  }

  function handleOpenPositionsChange(e) {
    const target = e.target;
    if (!target.classList.contains("trade-current-price-input")) return;
    const id = target.getAttribute("data-id");
    const t = trades.find(function (x) { return x.id === id; });
    if (!t) return;
    const core = window.JarvisCore;
    const val = Number(target.value);
    if (!core.isPositiveNumber(val)) {
      target.value = t.currentPrice;
      core.showToast("Current price must be a positive number.");
      return;
    }
    t.currentPrice = val;
    saveTrades();

    /* Update only the affected P&L figure in place rather than replacing the
       whole list (and the input mid-event), which can throw a DOM error in
       some browsers when a node is removed while it still holds focus. */
    const listItem = target.closest(".list-item");
    if (listItem) {
      const pnl = computeUnrealizedPnl(t);
      const pnlEl = listItem.querySelector(".stat-value");
      if (pnlEl) {
        pnlEl.textContent = core.formatCurrency(pnl);
        pnlEl.className = "stat-value " + (pnl >= 0 ? "positive" : "negative");
      }
    }
    renderStats();
  }

  function handleCloseTradeSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const id = document.getElementById("closeTradeId").value;
    const exitPrice = Number(document.getElementById("closeExitPrice").value);
    const notes = document.getElementById("closeTradeNotes").value.trim();
    if (!core.isPositiveNumber(exitPrice)) { core.showToast("Exit price must be a positive number."); return; }
    const t = trades.find(function (x) { return x.id === id; });
    if (!t) return;
    t.status = "closed";
    t.exitPrice = exitPrice;
    t.exitNotes = notes;
    t.closeDateTime = core.nowLocalDateTimeInputValue();
    saveTrades();
    core.closeModal("closeTradeModal");
    renderPaperTrading();
    core.showToast("Trade closed.");
  }

  function handleResetAccountConfirm() {
    const core = window.JarvisCore;
    trades = [];
    saveTrades();
    renderPaperTrading();
    core.closeModal("resetAccountModal");
    core.showToast("Paper account reset.");
  }

  function handleSettingsSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const balance = Number(document.getElementById("settingsStartingBalance").value);
    const limit = Number(document.getElementById("settingsDailyLimit").value);
    if (!core.isPositiveNumber(balance)) { core.showToast("Starting balance must be a positive number."); return; }
    if (!isFinite(limit) || limit < 1) { core.showToast("Daily limit must be at least 1."); return; }
    settings.startingBalance = balance;
    settings.dailyTradeLimit = Math.round(limit);
    saveSettings();
    core.closeModal("settingsModal");
    renderPaperTrading();
    core.showToast("Settings saved.");
  }

  function handleNoTradeDaySubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const note = document.getElementById("noTradeDayNote").value.trim();
    journal.push({
      id: core.uid("journal"),
      date: core.todayISODate(),
      symbol: "",
      setup: "No Trade Day",
      outcome: "n/a",
      marketConditions: "",
      entryReason: note || "Chose discipline over forcing a trade.",
      emotionsBefore: "",
      exitReason: "",
      lessonLearned: note,
      disciplineRating: 5,
      noTradeDay: true,
      createdAt: Date.now()
    });
    saveJournal();
    document.getElementById("noTradeDayForm").reset();
    core.closeModal("noTradeDayModal");
    renderJournal();
    core.showToast("No-trade day logged. That's discipline paying off.");
  }

  /* ---------------- stats ---------------- */

  function computeStats() {
    const closed = trades.filter(function (t) { return t.status === "closed"; });
    const realized = closed.reduce(function (sum, t) { return sum + computeRealizedPnl(t); }, 0);
    const unrealized = trades.filter(function (t) { return t.status === "open"; })
      .reduce(function (sum, t) { return sum + computeUnrealizedPnl(t); }, 0);
    const wins = closed.filter(function (t) { return computeRealizedPnl(t) > 0; });
    const losses = closed.filter(function (t) { return computeRealizedPnl(t) < 0; });
    const winRate = closed.length ? (wins.length / closed.length * 100) : 0;
    const avgWin = wins.length ? wins.reduce(function (s, t) { return s + computeRealizedPnl(t); }, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce(function (s, t) { return s + computeRealizedPnl(t); }, 0) / losses.length : 0;
    const largestLoss = losses.length ? Math.min.apply(null, losses.map(function (t) { return computeRealizedPnl(t); })) : 0;
    const balance = settings.startingBalance + realized;
    return { realized: realized, unrealized: unrealized, winRate: winRate, totalTrades: trades.length, avgWin: avgWin, avgLoss: avgLoss, largestLoss: largestLoss, balance: balance };
  }

  function renderStats() {
    const core = window.JarvisCore;
    const s = computeStats();
    document.getElementById("statBalance").textContent = core.formatCurrency(s.balance);

    const realizedEl = document.getElementById("statRealized");
    realizedEl.textContent = core.formatCurrency(s.realized);
    realizedEl.className = "stat-value " + (s.realized >= 0 ? "positive" : "negative");

    const unrealizedEl = document.getElementById("statUnrealized");
    unrealizedEl.textContent = core.formatCurrency(s.unrealized);
    unrealizedEl.className = "stat-value " + (s.unrealized >= 0 ? "positive" : "negative");

    document.getElementById("statWinRate").textContent = core.formatPercent(s.winRate, 0);
    document.getElementById("statTotalTrades").textContent = s.totalTrades;
    document.getElementById("statAvgWin").textContent = core.formatCurrency(s.avgWin);
    document.getElementById("statAvgLoss").textContent = core.formatCurrency(s.avgLoss);
    document.getElementById("statLargestLoss").textContent = core.formatCurrency(s.largestLoss);
  }

  function renderDailyLimit() {
    const count = tradesLoggedToday();
    document.getElementById("dailyTradeCount").textContent = count;
    document.getElementById("dailyTradeLimitLabel").textContent = settings.dailyTradeLimit;
    const reached = isDailyLimitReached();
    document.getElementById("dailyLimitMessage").classList.toggle("hidden", !reached);
    document.getElementById("tradeLimitReachedMessage").classList.toggle("hidden", !reached);
    updateLogTradeButtonState();
  }

  function renderWeeklySummary() {
    const core = window.JarvisCore;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const weekClosed = trades.filter(function (t) {
      return t.status === "closed" && t.closeDateTime && new Date(t.closeDateTime) >= weekAgo;
    });
    const weekOpenedCount = trades.filter(function (t) {
      return t.dateTime && new Date(t.dateTime) >= weekAgo;
    }).length;
    const pnl = weekClosed.reduce(function (s, t) { return s + computeRealizedPnl(t); }, 0);
    const wins = weekClosed.filter(function (t) { return computeRealizedPnl(t) > 0; }).length;
    const winRate = weekClosed.length ? (wins / weekClosed.length * 100) : 0;

    document.getElementById("weekTrades").textContent = weekOpenedCount;
    const pnlEl = document.getElementById("weekPnl");
    pnlEl.textContent = core.formatCurrency(pnl);
    pnlEl.className = "stat-value " + (pnl >= 0 ? "positive" : "negative");
    document.getElementById("weekWinRate").textContent = core.formatPercent(winRate, 0);

    const weekJournal = journal.filter(function (j) {
      return j.date && new Date(j.date) >= weekAgo && j.lessonLearned && j.lessonLearned.trim() !== "";
    });
    const lessonCounts = {};
    weekJournal.forEach(function (j) {
      const key = j.lessonLearned.trim();
      lessonCounts[key] = (lessonCounts[key] || 0) + 1;
    });
    let topLesson = "—";
    let max = 0;
    Object.keys(lessonCounts).forEach(function (k) {
      if (lessonCounts[k] > max) { max = lessonCounts[k]; topLesson = k; }
    });
    document.getElementById("weekLesson").textContent = "Most common lesson: " + topLesson;
  }

  function renderPaperTrading() {
    renderDailyLimit();
    renderWeeklySummary();
    renderStats();
    renderOpenPositions();
    renderClosedPositions();
  }

  /* ---------------- journal ---------------- */

  function getFilteredJournal() {
    const search = (document.getElementById("journalSearch").value || "").toLowerCase().trim();
    const fSymbol = document.getElementById("journalFilterSymbol").value;
    const fOutcome = document.getElementById("journalFilterOutcome").value;
    const fSetup = document.getElementById("journalFilterSetup").value;
    return journal.filter(function (j) {
      if (fSymbol && j.symbol !== fSymbol) return false;
      if (fOutcome && j.outcome !== fOutcome) return false;
      if (fSetup && j.setup !== fSetup) return false;
      if (search) {
        const hay = [j.symbol, j.setup, j.marketConditions, j.entryReason, j.emotionsBefore, j.exitReason, j.lessonLearned]
          .filter(Boolean).join(" ").toLowerCase();
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    });
  }

  function populateJournalFilters() {
    const core = window.JarvisCore;
    const symbolSel = document.getElementById("journalFilterSymbol");
    const setupSel = document.getElementById("journalFilterSetup");
    const currentSymbol = symbolSel.value;
    const currentSetup = setupSel.value;
    const symbols = Array.from(new Set(journal.map(function (j) { return j.symbol; }).filter(Boolean))).sort();
    const setups = Array.from(new Set(journal.map(function (j) { return j.setup; }).filter(Boolean))).sort();

    symbolSel.innerHTML = '<option value="">All symbols</option>' +
      symbols.map(function (s) { return '<option value="' + core.escapeHtml(s) + '">' + core.escapeHtml(s) + '</option>'; }).join("");
    setupSel.innerHTML = '<option value="">All setups</option>' +
      setups.map(function (s) { return '<option value="' + core.escapeHtml(s) + '">' + core.escapeHtml(s) + '</option>'; }).join("");

    if (symbols.indexOf(currentSymbol) !== -1) symbolSel.value = currentSymbol;
    if (setups.indexOf(currentSetup) !== -1) setupSel.value = currentSetup;
  }

  function renderJournalList() {
    const core = window.JarvisCore;
    const container = document.getElementById("journalList");
    if (journal.length === 0) {
      container.innerHTML = '<div class="empty-state">No journal entries yet.</div>';
      return;
    }
    const filtered = getFilteredJournal();
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">No journal entries match your filters.</div>';
      return;
    }
    const sorted = filtered.slice().sort(function (a, b) {
      return new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt;
    });
    container.innerHTML = sorted.map(function (j) {
      const outcomeBadge = j.outcome === "win" ? "badge-green" : j.outcome === "loss" ? "badge-red" : j.outcome === "breakeven" ? "badge-yellow" : "badge-neutral";
      const symbolLabel = j.symbol ? core.escapeHtml(j.symbol) : (j.noTradeDay ? "No Trade Day" : "—");
      const setupLabel = j.setup ? core.escapeHtml(j.setup) : "";
      const rows = [];
      rows.push('<span class="list-item-meta">' + core.formatDate(j.date) + ' &middot; Discipline ' + core.escapeHtml(j.disciplineRating) + '/5</span>');
      if (j.marketConditions) rows.push('<span class="list-item-meta">Conditions: ' + core.escapeHtml(j.marketConditions) + '</span>');
      if (j.entryReason) rows.push('<span class="list-item-meta">Entry: ' + core.escapeHtml(j.entryReason) + '</span>');
      if (j.emotionsBefore) rows.push('<span class="list-item-meta">Emotions: ' + core.escapeHtml(j.emotionsBefore) + '</span>');
      if (j.exitReason) rows.push('<span class="list-item-meta">Exit: ' + core.escapeHtml(j.exitReason) + '</span>');
      if (j.lessonLearned) rows.push('<span class="list-item-meta">Lesson: ' + core.escapeHtml(j.lessonLearned) + '</span>');
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(j.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + symbolLabel + (setupLabel ? " &middot; " + setupLabel : "") + ' <span class="badge ' + outcomeBadge + '">' + core.escapeHtml(j.outcome) + '</span></span>' +
              rows.join("") +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon journal-edit-btn" data-id="' + core.escapeHtml(j.id) + '">Edit</button>' +
              '<button type="button" class="btn-icon danger journal-delete-btn" data-id="' + core.escapeHtml(j.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderJournal() {
    populateJournalFilters();
    renderJournalList();
  }

  function exitEditMode() {
    document.getElementById("journalEditId").value = "";
    document.getElementById("journalFormTitle").textContent = "New Journal Entry";
    document.getElementById("journalSubmitBtn").textContent = "Save Journal Entry";
    document.getElementById("journalCancelEditBtn").classList.add("hidden");
  }

  function enterEditMode(entry) {
    document.getElementById("journalEditId").value = entry.id;
    document.getElementById("journalDate").value = entry.date || "";
    document.getElementById("journalSymbol").value = entry.symbol || "";
    document.getElementById("journalSetup").value = entry.setup || "";
    document.getElementById("journalOutcome").value = entry.outcome || "n/a";
    document.getElementById("journalMarketConditions").value = entry.marketConditions || "";
    document.getElementById("journalEntryReason").value = entry.entryReason || "";
    document.getElementById("journalEmotions").value = entry.emotionsBefore || "";
    document.getElementById("journalExitReason").value = entry.exitReason || "";
    document.getElementById("journalLesson").value = entry.lessonLearned || "";
    document.getElementById("journalDiscipline").value = String(entry.disciplineRating || 3);
    document.getElementById("journalFormTitle").textContent = "Edit Journal Entry";
    document.getElementById("journalSubmitBtn").textContent = "Update Journal Entry";
    document.getElementById("journalCancelEditBtn").classList.remove("hidden");
    document.getElementById("journalForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetJournalFormFields() {
    document.getElementById("journalForm").reset();
    document.getElementById("journalDiscipline").value = "3";
    document.getElementById("journalOutcome").value = "n/a";
    document.getElementById("journalDate").value = window.JarvisCore.todayISODate();
  }

  function handleJournalSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const editId = document.getElementById("journalEditId").value;
    const date = document.getElementById("journalDate").value || core.todayISODate();
    const symbol = document.getElementById("journalSymbol").value.trim().toUpperCase();
    const setup = document.getElementById("journalSetup").value.trim();
    const outcome = document.getElementById("journalOutcome").value;
    const marketConditions = document.getElementById("journalMarketConditions").value.trim();
    const entryReason = document.getElementById("journalEntryReason").value.trim();
    const emotionsBefore = document.getElementById("journalEmotions").value.trim();
    const exitReason = document.getElementById("journalExitReason").value.trim();
    const lessonLearned = document.getElementById("journalLesson").value.trim();
    const disciplineRating = Number(document.getElementById("journalDiscipline").value);

    if (editId) {
      const entry = journal.find(function (j) { return j.id === editId; });
      if (entry) {
        entry.date = date; entry.symbol = symbol; entry.setup = setup; entry.outcome = outcome;
        entry.marketConditions = marketConditions; entry.entryReason = entryReason; entry.emotionsBefore = emotionsBefore;
        entry.exitReason = exitReason; entry.lessonLearned = lessonLearned; entry.disciplineRating = disciplineRating;
      }
      core.showToast("Journal entry updated.");
    } else {
      journal.push({
        id: core.uid("journal"), date: date, symbol: symbol, setup: setup, outcome: outcome,
        marketConditions: marketConditions, entryReason: entryReason, emotionsBefore: emotionsBefore,
        exitReason: exitReason, lessonLearned: lessonLearned, disciplineRating: disciplineRating,
        noTradeDay: false, createdAt: Date.now()
      });
      core.showToast("Journal entry saved.");
    }
    saveJournal();
    exitEditMode();
    resetJournalFormFields();
    renderJournal();
  }

  function handleJournalListClick(e) {
    const editBtn = e.target.closest(".journal-edit-btn");
    if (editBtn) {
      const entry = journal.find(function (j) { return j.id === editBtn.getAttribute("data-id"); });
      if (entry) enterEditMode(entry);
      return;
    }
    const delBtn = e.target.closest(".journal-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      journal = journal.filter(function (j) { return j.id !== id; });
      saveJournal();
      renderJournal();
    }
  }

  /* ---------------- AI-style review ---------------- */

  function generateAIReview() {
    const core = window.JarvisCore;
    const container = document.getElementById("aiReviewOutput");
    const MIN = 3;

    if (journal.length < MIN) {
      container.innerHTML = '<div class="empty-state">Log more trades to unlock this insight.</div>';
      return;
    }

    const relevant = journal.filter(function (j) { return !j.noTradeDay; });
    const items = [];

    const setupCounts = {};
    relevant.forEach(function (j) { if (j.setup) setupCounts[j.setup] = (setupCounts[j.setup] || 0) + 1; });
    const setupKeys = Object.keys(setupCounts);
    if (setupKeys.length > 0) {
      let top = setupKeys[0];
      setupKeys.forEach(function (k) { if (setupCounts[k] > setupCounts[top]) top = k; });
      items.push("<strong>Most common setup:</strong> " + core.escapeHtml(top) + " (" + setupCounts[top] + " entries)");
    } else {
      items.push("<strong>Most common setup:</strong> Log more trades to unlock this insight.");
    }

    const withOutcome = relevant.filter(function (j) { return j.outcome === "win" || j.outcome === "loss"; });
    if (withOutcome.length >= MIN) {
      const bySetup = {};
      withOutcome.forEach(function (j) {
        const key = j.setup || "(no setup)";
        if (!bySetup[key]) bySetup[key] = { win: 0, total: 0 };
        bySetup[key].total++;
        if (j.outcome === "win") bySetup[key].win++;
      });
      const lines = Object.keys(bySetup).map(function (key) {
        const s = bySetup[key];
        const rate = Math.round((s.win / s.total) * 100);
        return core.escapeHtml(key) + ": " + rate + "% (" + s.win + "/" + s.total + ")";
      });
      items.push("<strong>Win rate by setup:</strong> " + lines.join(" &middot; "));
    } else {
      items.push("<strong>Win rate by setup:</strong> Log more trades to unlock this insight.");
    }

    const symbolCounts = {};
    relevant.forEach(function (j) { if (j.symbol) symbolCounts[j.symbol] = (symbolCounts[j.symbol] || 0) + 1; });
    const symbolKeys = Object.keys(symbolCounts);
    if (symbolKeys.length > 0) {
      let top = symbolKeys[0];
      symbolKeys.forEach(function (k) { if (symbolCounts[k] > symbolCounts[top]) top = k; });
      items.push("<strong>Most-used symbol:</strong> " + core.escapeHtml(top) + " (" + symbolCounts[top] + " entries)");
    } else {
      items.push("<strong>Most-used symbol:</strong> Log more trades to unlock this insight.");
    }

    const ratings = relevant.map(function (j) { return Number(j.disciplineRating); }).filter(function (n) { return isFinite(n) && n > 0; });
    if (ratings.length > 0) {
      const avg = (ratings.reduce(function (s, n) { return s + n; }, 0) / ratings.length).toFixed(1);
      items.push("<strong>Average discipline rating:</strong> " + avg + " / 5");
    } else {
      items.push("<strong>Average discipline rating:</strong> Log more trades to unlock this insight.");
    }

    const emotionText = relevant.map(function (j) { return (j.emotionsBefore || "").toLowerCase(); }).join(" ");
    const lowDisciplineCount = relevant.filter(function (j) { return Number(j.disciplineRating) <= 2; }).length;
    let habitTip = null;
    if (/revenge/.test(emotionText)) {
      habitTip = "Revenge trading shows up in your notes. Consider a mandatory cooldown after a loss before your next trade.";
    } else if (/bored/.test(emotionText)) {
      habitTip = "Boredom trading appears in your notes. Try requiring a written setup match before entering.";
    } else if (/fomo/.test(emotionText)) {
      habitTip = "FOMO shows up in your notes. Consider a rule to only enter setups you planned before the session.";
    } else if (relevant.length > 0 && lowDisciplineCount >= Math.ceil(relevant.length * 0.3)) {
      habitTip = "A meaningful share of your entries have low discipline ratings. Review your checklist before your next trade.";
    } else {
      habitTip = "Keep journaling consistently — patterns become clearer with more entries.";
    }
    items.push("<strong>One habit to improve:</strong> " + habitTip);

    container.innerHTML = items.map(function (html) { return '<div class="ai-review-item">' + html + "</div>"; }).join("");
  }

  /* ---------------- render all ---------------- */

  function renderAll() {
    renderWatchlist();
    renderPaperTrading();
    renderJournal();
  }

  function onSubTabChange() {
    /* state is kept fully in sync on every mutation, so no special action needed */
  }

  /* ---------------- init ---------------- */

  function init() {
    load();
    setDefaultTradeDateTime();
    document.getElementById("journalDate").value = window.JarvisCore.todayISODate();

    renderAll();
    tickClock();
    window.setInterval(tickClock, 1000);

    document.getElementById("watchlistForm").addEventListener("submit", handleWatchlistFormSubmit);
    document.getElementById("watchlistTable").addEventListener("click", handleWatchlistTableClick);
    document.getElementById("watchlistTable").addEventListener("change", handleWatchlistTableChange);

    CHECKLIST_IDS.forEach(function (id) {
      document.getElementById(id).addEventListener("change", updateChecklistProgress);
    });
    document.getElementById("tradeForm").addEventListener("submit", handleTradeFormSubmit);

    document.getElementById("openPositionsList").addEventListener("click", handleOpenPositionsClick);
    document.getElementById("openPositionsList").addEventListener("change", handleOpenPositionsChange);

    document.getElementById("closeTradeForm").addEventListener("submit", handleCloseTradeSubmit);
    document.getElementById("closeTradeCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("closeTradeModal"); });

    document.getElementById("resetAccountBtn").addEventListener("click", function () { window.JarvisCore.openModal("resetAccountModal"); });
    document.getElementById("resetAccountConfirmBtn").addEventListener("click", handleResetAccountConfirm);
    document.getElementById("resetAccountCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("resetAccountModal"); });

    document.getElementById("openSettingsBtn").addEventListener("click", function () {
      document.getElementById("settingsStartingBalance").value = settings.startingBalance;
      document.getElementById("settingsDailyLimit").value = settings.dailyTradeLimit;
      window.JarvisCore.openModal("settingsModal");
    });
    document.getElementById("settingsForm").addEventListener("submit", handleSettingsSubmit);
    document.getElementById("settingsCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("settingsModal"); });

    document.getElementById("noTradeDayBtn").addEventListener("click", function () { window.JarvisCore.openModal("noTradeDayModal"); });
    document.getElementById("noTradeDayForm").addEventListener("submit", handleNoTradeDaySubmit);
    document.getElementById("noTradeDayCancelBtn").addEventListener("click", function () { window.JarvisCore.closeModal("noTradeDayModal"); });

    document.getElementById("journalForm").addEventListener("submit", handleJournalSubmit);
    document.getElementById("journalCancelEditBtn").addEventListener("click", function () {
      exitEditMode();
      resetJournalFormFields();
    });
    document.getElementById("journalList").addEventListener("click", handleJournalListClick);
    document.getElementById("journalSearch").addEventListener("input", renderJournalList);
    document.getElementById("journalFilterSymbol").addEventListener("change", renderJournalList);
    document.getElementById("journalFilterOutcome").addEventListener("change", renderJournalList);
    document.getElementById("journalFilterSetup").addEventListener("change", renderJournalList);
    document.getElementById("aiReviewBtn").addEventListener("click", generateAIReview);

    updateChecklistProgress();
  }

  window.JarvisTrading = { init: init, onSubTabChange: onSubTabChange };
})();
