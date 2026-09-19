/* ==========================================================================
   JARVIS — Business tracker (goals + ledger)
   localStorage key: jarvisBusiness -> { goals: [...], ledger: [...] }
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisBusiness";
  let data = { goals: [], ledger: [] };

  function load() {
    const loaded = window.JarvisCore.loadJSON(LS_KEY, { goals: [], ledger: [] });
    data = {
      goals: Array.isArray(loaded.goals) ? loaded.goals : [],
      ledger: Array.isArray(loaded.ledger) ? loaded.ledger : []
    };
  }

  function save() {
    window.JarvisCore.saveJSON(LS_KEY, data);
  }

  function renderGoals() {
    const core = window.JarvisCore;
    const container = document.getElementById("goalList");
    if (data.goals.length === 0) {
      container.innerHTML = '<div class="empty-state">No goals yet. Add one to get started.</div>';
      return;
    }
    const sorted = data.goals.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    container.innerHTML = sorted.map(function (g) {
      const badgeClass = g.status === "Done" ? "badge-green" : g.status === "In Progress" ? "badge-yellow" : "badge-neutral";
      const dateText = g.targetDate ? " · Due " + core.formatDate(g.targetDate) : "";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(g.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(g.text) + '</span>' +
              '<span class="list-item-meta"><span class="badge ' + badgeClass + '">' + core.escapeHtml(g.status) + '</span>' + dateText + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon goal-advance-btn" data-id="' + core.escapeHtml(g.id) + '" aria-label="Advance status">Advance</button>' +
              '<button type="button" class="btn-icon danger goal-delete-btn" data-id="' + core.escapeHtml(g.id) + '" aria-label="Delete goal">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderLedger() {
    const core = window.JarvisCore;
    const container = document.getElementById("ledgerList");
    let income = 0, expense = 0;
    data.ledger.forEach(function (l) {
      if (l.type === "income") income += l.amount; else expense += l.amount;
    });
    document.getElementById("bizStatIncome").textContent = core.formatCurrency(income);
    document.getElementById("bizStatExpense").textContent = core.formatCurrency(expense);
    const net = income - expense;
    const netEl = document.getElementById("bizStatNet");
    netEl.textContent = core.formatCurrency(net);
    netEl.className = "stat-value " + (net >= 0 ? "positive" : "negative");

    if (data.ledger.length === 0) {
      container.innerHTML = '<div class="empty-state">No ledger entries yet.</div>';
      return;
    }
    const sorted = data.ledger.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt; });
    container.innerHTML = sorted.map(function (l) {
      const sign = l.type === "income" ? "+" : "-";
      const cls = l.type === "income" ? "badge-green" : "badge-red";
      const desc = l.description ? core.escapeHtml(l.description) : "(no description)";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(l.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + desc + ' <span class="badge ' + cls + '">' + sign + core.formatCurrency(l.amount) + '</span></span>' +
              '<span class="list-item-meta">' + core.formatDate(l.date) + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger ledger-delete-btn" data-id="' + core.escapeHtml(l.id) + '" aria-label="Delete ledger entry">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function render() {
    renderGoals();
    renderLedger();
  }

  function handleGoalSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const text = document.getElementById("goalText").value.trim();
    const targetDate = document.getElementById("goalTargetDate").value;
    const status = document.getElementById("goalStatus").value;
    if (!text) {
      core.showToast("Please enter a goal.");
      return;
    }
    data.goals.push({
      id: core.uid("goal"),
      text: text,
      targetDate: targetDate || null,
      status: status,
      createdAt: Date.now()
    });
    save();
    render();
    e.target.reset();
    core.showToast("Goal added.");
  }

  function handleGoalListClick(e) {
    const core = window.JarvisCore;
    const advanceBtn = e.target.closest(".goal-advance-btn");
    if (advanceBtn) {
      const id = advanceBtn.getAttribute("data-id");
      const goal = data.goals.find(function (g) { return g.id === id; });
      if (!goal) return;
      const order = ["Not Started", "In Progress", "Done"];
      const idx = order.indexOf(goal.status);
      goal.status = order[Math.min(idx + 1, order.length - 1)];
      save();
      render();
      return;
    }
    const delBtn = e.target.closest(".goal-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      data.goals = data.goals.filter(function (g) { return g.id !== id; });
      save();
      render();
    }
  }

  function handleLedgerSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const type = document.getElementById("ledgerType").value;
    const amountRaw = document.getElementById("ledgerAmount").value;
    const description = document.getElementById("ledgerDesc").value.trim();
    const dateInput = document.getElementById("ledgerDate").value;

    const amount = Number(amountRaw);
    if (!core.isPositiveNumber(amount)) {
      core.showToast("Amount must be a positive number.");
      return;
    }

    data.ledger.push({
      id: core.uid("ledger"),
      type: type,
      amount: amount,
      description: description,
      date: dateInput || core.todayISODate(),
      createdAt: Date.now()
    });
    save();
    render();
    e.target.reset();
    document.getElementById("ledgerDate").value = "";
    core.showToast("Ledger entry added.");
  }

  function handleLedgerListClick(e) {
    const delBtn = e.target.closest(".ledger-delete-btn");
    if (!delBtn) return;
    const id = delBtn.getAttribute("data-id");
    data.ledger = data.ledger.filter(function (l) { return l.id !== id; });
    save();
    render();
  }

  function getSummary() {
    let income = 0, expense = 0;
    data.ledger.forEach(function (l) {
      if (l.type === "income") income += l.amount; else expense += l.amount;
    });
    const activeGoals = data.goals.filter(function (g) { return g.status !== "Done"; }).length;
    return {
      income: income,
      expense: expense,
      net: income - expense,
      activeGoals: activeGoals,
      totalGoals: data.goals.length
    };
  }

  function init() {
    load();
    render();
    document.getElementById("goalForm").addEventListener("submit", handleGoalSubmit);
    document.getElementById("goalList").addEventListener("click", handleGoalListClick);
    document.getElementById("ledgerForm").addEventListener("submit", handleLedgerSubmit);
    document.getElementById("ledgerList").addEventListener("click", handleLedgerListClick);
  }

  window.JarvisBusiness = { init: init, getSummary: getSummary };
})();
