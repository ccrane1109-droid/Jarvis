/* ==========================================================================
   JARVIS — shared utilities and app boot
   Exposes window.JarvisCore for use by workout.js, habits.js, business.js,
   trading.js. Handles top-level tab switching and toast notifications.
   ========================================================================== */

(function () {
  "use strict";

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function formatCurrency(num) {
    const n = Number(num);
    if (!isFinite(n)) return "$0.00";
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPercent(num, digits) {
    const n = Number(num);
    if (!isFinite(n)) return "0%";
    return n.toFixed(digits === undefined ? 1 : digits) + "%";
  }

  function formatDate(dateLike) {
    if (!dateLike) return "";
    const d = new Date(dateLike);
    if (isNaN(d.getTime())) return String(dateLike);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateTime(dateLike) {
    if (!dateLike) return "";
    const d = new Date(dateLike);
    if (isNaN(d.getTime())) return String(dateLike);
    return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function todayISODate() {
    const d = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
  }

  function nowLocalDateTimeInputValue() {
    const d = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(function () {
      toast.classList.add("hidden");
    }, 2600);
  }

  function setupTabGroup(buttons, panels, onChange) {
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        const targetId = btn.getAttribute("data-target") || btn.getAttribute("data-subtarget");
        buttons.forEach(function (b) {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        panels.forEach(function (p) {
          if (p.id === targetId) {
            p.classList.add("active");
          } else {
            p.classList.remove("active");
          }
        });
        if (typeof onChange === "function") onChange(targetId);
      });
    });
  }

  function isPositiveNumber(value) {
    const n = Number(value);
    return isFinite(n) && n > 0;
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  }

  window.JarvisCore = {
    escapeHtml: escapeHtml,
    uid: uid,
    loadJSON: loadJSON,
    saveJSON: saveJSON,
    formatCurrency: formatCurrency,
    formatPercent: formatPercent,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    todayISODate: todayISODate,
    nowLocalDateTimeInputValue: nowLocalDateTimeInputValue,
    showToast: showToast,
    setupTabGroup: setupTabGroup,
    isPositiveNumber: isPositiveNumber,
    openModal: openModal,
    closeModal: closeModal
  };

  /* ---------------- Daily Briefing ---------------- */

  function greetingWord() {
    const hour = new Date().getHours();
    if (hour < 5) return "Up late";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function buildBriefingHTML() {
    const rows = [];

    if (window.JarvisBusiness && typeof window.JarvisBusiness.getSummary === "function") {
      const biz = window.JarvisBusiness.getSummary();
      const netClass = biz.net >= 0 ? "text-positive" : "text-negative";
      rows.push(
        '<div class="briefing-row"><strong>Business:</strong> Net <span class="' + netClass + '">' + formatCurrency(biz.net) + '</span>' +
        ' &middot; ' + biz.activeGoals + ' active goal' + (biz.activeGoals === 1 ? "" : "s") +
        (biz.totalGoals === 0 ? " (no goals logged yet)" : "") + '</div>'
      );
    }

    if (window.JarvisHabits && typeof window.JarvisHabits.getSummary === "function") {
      const h = window.JarvisHabits.getSummary();
      const habitsText = h.total === 0
        ? "no habits added yet"
        : h.doneToday + "/" + h.total + " done today &middot; best streak " + h.bestStreak + " day" + (h.bestStreak === 1 ? "" : "s");
      rows.push('<div class="briefing-row"><strong>Habits:</strong> ' + habitsText + '</div>');
    }

    if (window.JarvisWorkout && typeof window.JarvisWorkout.getSummary === "function") {
      const w = window.JarvisWorkout.getSummary();
      const lastText = w.lastWorkout ? ("last: " + escapeHtml(w.lastWorkout.name) + " on " + formatDate(w.lastWorkout.date)) : "no workouts logged yet";
      rows.push(
        '<div class="briefing-row"><strong>Workouts:</strong> ' + w.streak + ' day streak &middot; ' + w.thisWeek + ' this week &middot; ' + lastText + '</div>'
      );
    }

    if (window.JarvisCalories && typeof window.JarvisCalories.getSummary === "function") {
      const c = window.JarvisCalories.getSummary();
      const calClass = c.remaining >= 0 ? "text-positive" : "text-negative";
      rows.push(
        '<div class="briefing-row"><strong>Calories:</strong> ' + c.todayTotal + ' / ' + c.goal + ' today &middot; ' +
        '<span class="' + calClass + '">' + (c.remaining >= 0 ? c.remaining + ' remaining' : Math.abs(c.remaining) + ' over') + '</span></div>'
      );
    }

    if (window.JarvisVideo && typeof window.JarvisVideo.getSummary === "function") {
      const v = window.JarvisVideo.getSummary();
      const videoText = v.total === 0
        ? "no generations yet"
        : v.week + " this week &middot; " + v.completed + "/" + v.total + " completed";
      rows.push('<div class="briefing-row"><strong>AI Video:</strong> ' + videoText + '</div>');
    }

    if (rows.length === 0) {
      rows.push('<div class="empty-state">No data yet — start logging in each tab and this briefing will summarize your day.</div>');
    }

    return '<p class="briefing-greeting">' + greetingWord() + '. Here’s where things stand:</p>' + rows.join("");
  }

  function showBriefing() {
    const content = document.getElementById("briefingContent");
    if (content) content.innerHTML = buildBriefingHTML();
    openModal("briefingModal");
  }

  function maybeAutoShowBriefing() {
    const today = todayISODate();
    let lastShown = null;
    try { lastShown = localStorage.getItem("jarvisLastBriefingDate"); } catch (e) { lastShown = null; }
    if (lastShown !== today) {
      showBriefing();
      try { localStorage.setItem("jarvisLastBriefingDate", today); } catch (e) { /* ignore */ }
    }
  }

  /* ---------------- service worker ---------------- */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol === "file:") return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline support is a nice-to-have, ignore failures */ });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    const mainNavBtns = Array.prototype.slice.call(document.querySelectorAll(".main-nav-btn"));
    const mainPanels = Array.prototype.slice.call(document.querySelectorAll(".tab-panel"));
    setupTabGroup(mainNavBtns, mainPanels);

    const subNavBtns = Array.prototype.slice.call(document.querySelectorAll(".sub-nav-btn"));
    const subPanels = Array.prototype.slice.call(document.querySelectorAll(".sub-panel"));
    setupTabGroup(subNavBtns, subPanels, function (targetId) {
      if (window.JarvisTrading && typeof window.JarvisTrading.onSubTabChange === "function") {
        window.JarvisTrading.onSubTabChange(targetId);
      }
    });

    const workoutSubNavBtns = Array.prototype.slice.call(document.querySelectorAll(".workout-sub-nav-btn"));
    const workoutSubPanels = Array.prototype.slice.call(document.querySelectorAll(".workout-sub-panel"));
    setupTabGroup(workoutSubNavBtns, workoutSubPanels, function (targetId) {
      if (window.JarvisWorkout && typeof window.JarvisWorkout.onSubTabChange === "function") {
        window.JarvisWorkout.onSubTabChange(targetId);
      }
    });

    const videoSubNavBtns = Array.prototype.slice.call(document.querySelectorAll(".video-sub-nav-btn"));
    const videoSubPanels = Array.prototype.slice.call(document.querySelectorAll(".video-sub-panel"));
    setupTabGroup(videoSubNavBtns, videoSubPanels);

    const briefingBtn = document.getElementById("dailyBriefingBtn");
    if (briefingBtn) briefingBtn.addEventListener("click", showBriefing);
    const briefingCloseBtn = document.getElementById("briefingCloseBtn");
    if (briefingCloseBtn) briefingCloseBtn.addEventListener("click", function () { closeModal("briefingModal"); });
    registerServiceWorker();

    // Feature modules read their data (from localStorage, possibly just
    // refreshed by auth.js's Firestore sync) as soon as they init, so they
    // must not start until auth.js says it's safe to — otherwise a synced
    // account's data could arrive a moment after these modules already
    // rendered an empty/stale first paint. auth.js fires this once it's
    // resolved to one of: not configured, network unreachable (fails
    // open), logged out, or logged in and synced.
    let started = false;
    function startFeatureModules() {
      if (started) return;
      started = true;
      if (window.JarvisWorkout && typeof window.JarvisWorkout.init === "function") window.JarvisWorkout.init();
      if (window.JarvisHabits && typeof window.JarvisHabits.init === "function") window.JarvisHabits.init();
      if (window.JarvisBusiness && typeof window.JarvisBusiness.init === "function") window.JarvisBusiness.init();
      if (window.JarvisCalories && typeof window.JarvisCalories.init === "function") window.JarvisCalories.init();
      if (window.JarvisTrading && typeof window.JarvisTrading.init === "function") window.JarvisTrading.init();
      if (window.JarvisVideoConnections && typeof window.JarvisVideoConnections.init === "function") window.JarvisVideoConnections.init();
      if (window.JarvisVideo && typeof window.JarvisVideo.init === "function") window.JarvisVideo.init();
      if (window.JarvisVideoStudio && typeof window.JarvisVideoStudio.init === "function") window.JarvisVideoStudio.init();
      maybeAutoShowBriefing();
    }

    document.addEventListener("jarvis-ready-to-start", startFeatureModules, { once: true });
    // Safety net: if auth.js itself never loads/runs at all (e.g. its
    // script tag fails outright, not just the Firebase CDN fetch it
    // already handles), don't leave the app dead — start anyway after a
    // few seconds so a broken login layer can never brick the rest of
    // JARVIS.
    window.setTimeout(startFeatureModules, 8000);
  });
})();
