/* ==========================================================================
   JARVIS — shared utilities and app boot
   Exposes window.JarvisCore for use by workout.js, habits.js, nutrition.js and the
   other screens. Handles top-level tab switching and toast notifications.
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
        // A tab that was just switched to may have been display:none until
        // now, so its own nav bar's scroll width wasn't measurable yet —
        // re-check on the next frame once the browser has laid it out.
        window.requestAnimationFrame(refreshScrollFades);
      });
    });
  }

  // Horizontally-scrolling nav bars (.main-nav, every .sub-nav) get a real,
  // non-scrolling overlay indicator on whichever edge still has hidden
  // content, so a hard-cut tab at the viewport edge reads as "more tabs
  // this way" instead of a clipped label. The indicator spans are plain
  // DOM siblings of the nav (via .nav-scroll-wrap, built once below) rather
  // than content layered inside the scrolling element itself, so they can
  // never overlap or get dragged along with the tab text scrolling under
  // them. Called on load, on each nav's own scroll, on window resize, and
  // after every tab switch (a newly-visible nav may not have been
  // measurable before).
  function updateScrollFadeState(nav) {
    const wrap = nav.parentElement;
    if (!wrap || !wrap.classList.contains("nav-scroll-wrap")) return;
    const atStart = nav.scrollLeft <= 1;
    const atEnd = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 1;
    wrap.setAttribute("data-at-start", atStart ? "true" : "false");
    wrap.setAttribute("data-at-end", atEnd ? "true" : "false");
  }
  function refreshScrollFades() {
    document.querySelectorAll(".main-nav, .sub-nav").forEach(updateScrollFadeState);
  }
  function initScrollFades() {
    document.querySelectorAll(".main-nav, .sub-nav").forEach(function (nav) {
      const wrap = document.createElement("div");
      wrap.className = "nav-scroll-wrap" + (nav.classList.contains("main-nav") ? " main-nav-scroll-wrap" : "");
      nav.parentNode.insertBefore(wrap, nav);
      const edgeStart = document.createElement("span");
      edgeStart.className = "nav-scroll-edge nav-scroll-edge-start";
      edgeStart.setAttribute("aria-hidden", "true");
      edgeStart.textContent = "‹";
      const edgeEnd = document.createElement("span");
      edgeEnd.className = "nav-scroll-edge nav-scroll-edge-end";
      edgeEnd.setAttribute("aria-hidden", "true");
      edgeEnd.textContent = "›";
      wrap.appendChild(edgeStart);
      wrap.appendChild(nav);
      wrap.appendChild(edgeEnd);
      updateScrollFadeState(nav);
      nav.addEventListener("scroll", function () { updateScrollFadeState(nav); }, { passive: true });
    });
    window.addEventListener("resize", refreshScrollFades);
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
    refreshScrollFades: refreshScrollFades,
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

    if (window.JarvisHome && typeof window.JarvisHome.briefingLine === "function") {
      const line = window.JarvisHome.briefingLine();
      if (line) rows.push('<div class="briefing-row"><strong>Schedule:</strong> ' + escapeHtml(line) + '</div>');
    }

    if (window.JarvisHabits && typeof window.JarvisHabits.getSummary === "function") {
      const h = window.JarvisHabits.getSummary();
      const habitsText = h.total === 0
        ? "no habits added yet"
        : h.doneToday + "/" + h.total + " done today &middot; best streak " + h.bestStreak + " day" + (h.bestStreak === 1 ? "" : "s");
      rows.push('<div class="briefing-row"><strong>Habits:</strong> ' + habitsText + '</div>');
    }

    if (window.JarvisDiscipline && typeof window.JarvisDiscipline.getSummary === "function") {
      const dsum = window.JarvisDiscipline.getSummary();
      if (dsum.hasData) {
        rows.push(
          '<div class="briefing-row"><strong>Discipline:</strong> ' + (dsum.plannedToday ? "today's plan is set" : "no plan set yet today") +
          ' &middot; ' + dsum.streak + ' day review streak' + (dsum.programDay ? ' &middot; program day ' + dsum.programDay + ' of 30' : '') + (dsum.last ? ' &middot; last score ' + dsum.last.score + ' (' + dsum.last.when + ')' : '') + '</div>'
        );
      }
    }

    if (window.JarvisWorkout && typeof window.JarvisWorkout.getSummary === "function") {
      const w = window.JarvisWorkout.getSummary();
      const lastText = w.lastWorkout ? ("last: " + escapeHtml(w.lastWorkout.name) + " on " + formatDate(w.lastWorkout.date)) : "no workouts logged yet";
      rows.push(
        '<div class="briefing-row"><strong>Workouts:</strong> ' + w.streak + ' day streak &middot; ' + w.thisWeek + ' this week &middot; ' + lastText + '</div>'
      );
    }

    if (window.JarvisNutrition && typeof window.JarvisNutrition.getSummary === "function") {
      const n = window.JarvisNutrition.getSummary();
      if (n.goal > 0) {
        const calClass = n.remaining >= 0 ? "text-positive" : "text-negative";
        rows.push(
          '<div class="briefing-row"><strong>Nutrition:</strong> ' + n.todayTotal + ' / ' + n.goal + ' cal today (' + n.mode + ') &middot; ' +
          '<span class="' + calClass + '">' + (n.remaining >= 0 ? n.remaining + ' remaining' : Math.abs(n.remaining) + ' over') + '</span> &middot; score ' + n.score + '/100</div>'
        );
      } else {
        rows.push('<div class="briefing-row"><strong>Nutrition:</strong> ' + n.todayTotal + ' cal logged today &middot; score ' + n.score + '/100</div>');
      }
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

  // ---- phone navigation: the bottom tab bar and its "More" sheet ----
  // The header's tab row (.main-nav-btn) stays the source of truth for which section is open. These buttons press the
  // matching one there, and follow it whenever anything else switches section (other modules do, e.g. opening a
  // reminder from a notification), so the bar always shows where you are. When the open section is one of the ones
  // behind "More", that button takes its name so the current section is still named on screen.
  const PRIMARY_NAV = ["navBtnHome", "navBtnWorkout", "navBtnNutrition", "navBtnHabits", "navBtnCalendar"];
  const SHORT_NAV_LABELS = {};
  const TEXT_FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file]), textarea, select";

  function initBottomNav() {
    const bar = document.getElementById("bottomNav");
    const sheet = document.getElementById("moreSheet");
    const moreBtn = document.getElementById("bottomNavMore");
    const moreLabel = document.getElementById("bottomNavMoreLabel");
    if (!bar || !sheet || !moreBtn || !moreLabel) return function () {};
    let returnFocus = null;

    function markActive(btn, on) {
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
    }
    function sync() {
      const current = document.querySelector(".main-nav-btn.active");
      const id = current ? current.id : "";
      const inMore = !!id && PRIMARY_NAV.indexOf(id) === -1;
      Array.prototype.forEach.call(document.querySelectorAll("#bottomNav [data-nav], #moreSheet [data-nav]"), function (b) {
        markActive(b, b.getAttribute("data-nav") === id);
      });
      markActive(moreBtn, inMore);
      const name = inMore ? (SHORT_NAV_LABELS[id] || current.textContent.trim()) : "More";
      moreLabel.textContent = name;
      moreBtn.setAttribute("aria-label", inMore ? current.textContent.trim() + ", more sections" : "More sections");
    }

    function openSheet() {
      returnFocus = document.activeElement;
      sheet.classList.remove("hidden");
      moreBtn.setAttribute("aria-expanded", "true");
      const target = sheet.querySelector(".more-item.active") || sheet.querySelector(".more-item");
      if (target) target.focus();
    }
    function closeSheet(restoreFocus) {
      if (sheet.classList.contains("hidden")) return;
      sheet.classList.add("hidden");
      moreBtn.setAttribute("aria-expanded", "false");
      if (restoreFocus && returnFocus && returnFocus.focus) returnFocus.focus();
    }
    function go(id) {
      const tab = document.getElementById(id);
      if (!tab) return;
      const same = tab.classList.contains("active");
      if (!same) tab.click();
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: same && !reduce ? "smooth" : "auto" }); // tapping the open section again goes back to its top
    }

    bar.addEventListener("click", function (e) {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn === moreBtn) { if (sheet.classList.contains("hidden")) openSheet(); else closeSheet(true); return; }
      const id = btn.getAttribute("data-nav");
      if (id) go(id);
    });
    sheet.addEventListener("click", function (e) {
      if (e.target === sheet) { closeSheet(true); return; }
      const item = e.target.closest("[data-nav]");
      if (!item) return;
      closeSheet(false);
      go(item.getAttribute("data-nav"));
    });
    document.addEventListener("keydown", function (e) {
      if (sheet.classList.contains("hidden")) return;
      if (e.key === "Escape") { closeSheet(true); return; }
      if (e.key !== "Tab") return;
      const items = Array.prototype.slice.call(sheet.querySelectorAll(".more-item"));
      if (!items.length) return;
      const at = items.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && at === items.length - 1) { e.preventDefault(); items[0].focus(); }
    });

    // The on-screen keyboard covers the bottom of the page; a fixed bar would sit on top of what is being typed.
    document.addEventListener("focusin", function (e) {
      if (e.target.matches && e.target.matches(TEXT_FIELD)) document.body.classList.add("keyboard-open");
    });
    document.addEventListener("focusout", function () {
      window.setTimeout(function () {
        const a = document.activeElement;
        if (!a || !a.matches || !a.matches(TEXT_FIELD)) document.body.classList.remove("keyboard-open");
      }, 80);
    });

    sync();
    return sync;
  }

  document.addEventListener("DOMContentLoaded", function () {
    let syncBottomNav = function () {};
    const mainNavBtns = Array.prototype.slice.call(document.querySelectorAll(".main-nav-btn"));
    const mainPanels = Array.prototype.slice.call(document.querySelectorAll(".tab-panel"));
    setupTabGroup(mainNavBtns, mainPanels, function (targetId) {
      syncBottomNav();
      if (targetId === "panel-calendar" && window.JarvisCalendar && typeof window.JarvisCalendar.onShow === "function") window.JarvisCalendar.onShow();
      if (targetId === "panel-home" && window.JarvisHome && typeof window.JarvisHome.onShow === "function") window.JarvisHome.onShow();
      if (targetId === "panel-business" && window.JarvisShopify && typeof window.JarvisShopify.onShow === "function") window.JarvisShopify.onShow();
      if (window.JarvisLearning) {
        if (targetId === "panel-learning" && typeof window.JarvisLearning.onShow === "function") window.JarvisLearning.onShow();
        else if (typeof window.JarvisLearning.onHide === "function") window.JarvisLearning.onHide();
      }
    });
    syncBottomNav = initBottomNav();

    const workoutSubNavBtns = Array.prototype.slice.call(document.querySelectorAll(".workout-sub-nav-btn"));
    const workoutSubPanels = Array.prototype.slice.call(document.querySelectorAll(".workout-sub-panel"));
    setupTabGroup(workoutSubNavBtns, workoutSubPanels, function (targetId) {
      if (window.JarvisWorkout && typeof window.JarvisWorkout.onSubTabChange === "function") {
        window.JarvisWorkout.onSubTabChange(targetId);
      }
    });

    const nutritionSubNavBtns = Array.prototype.slice.call(document.querySelectorAll(".nutrition-sub-nav-btn"));
    const nutritionSubPanels = Array.prototype.slice.call(document.querySelectorAll(".nutrition-sub-panel"));
    setupTabGroup(nutritionSubNavBtns, nutritionSubPanels, function (targetId) {
      if (window.JarvisNutrition && typeof window.JarvisNutrition.onSubTabChange === "function") {
        window.JarvisNutrition.onSubTabChange(targetId);
      }
    });

    const habitsSubNavBtns = Array.prototype.slice.call(document.querySelectorAll(".habits-sub-nav-btn"));
    const habitsSubPanels = Array.prototype.slice.call(document.querySelectorAll(".habits-sub-panel"));
    setupTabGroup(habitsSubNavBtns, habitsSubPanels, function (targetId) {
      if (window.JarvisHabits && typeof window.JarvisHabits.onSubTabChange === "function") {
        window.JarvisHabits.onSubTabChange(targetId);
      }
    });

    const disciplineSubNavBtns = Array.prototype.slice.call(document.querySelectorAll(".discipline-sub-nav-btn"));
    const disciplineSubPanels = Array.prototype.slice.call(document.querySelectorAll(".discipline-sub-panel"));
    setupTabGroup(disciplineSubNavBtns, disciplineSubPanels, function (targetId) {
      if (window.JarvisDiscipline && typeof window.JarvisDiscipline.onSubTabChange === "function") {
        window.JarvisDiscipline.onSubTabChange(targetId);
      }
    });

    initScrollFades();

    const briefingBtn = document.getElementById("dailyBriefingBtn");
    if (briefingBtn) briefingBtn.addEventListener("click", showBriefing);
    const briefingCloseBtn = document.getElementById("briefingCloseBtn");
    if (briefingCloseBtn) briefingCloseBtn.addEventListener("click", function () { closeModal("briefingModal"); });
    registerServiceWorker();

    // Profile/account menu — keeps the header compact by tucking email,
    // 2-step verification, Daily Briefing, and Log Out behind one button.
    const profileMenuBtn = document.getElementById("profileMenuBtn");
    const profileMenu = document.getElementById("profileMenu");
    if (profileMenuBtn && profileMenu) {
      profileMenuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        const wasOpen = !profileMenu.classList.contains("hidden");
        profileMenu.classList.toggle("hidden", wasOpen);
        profileMenuBtn.setAttribute("aria-expanded", String(!wasOpen));
      });
      document.addEventListener("click", function (e) {
        if (!profileMenu.classList.contains("hidden") && !profileMenu.contains(e.target) && e.target !== profileMenuBtn) {
          profileMenu.classList.add("hidden");
          profileMenuBtn.setAttribute("aria-expanded", "false");
        }
      });
      profileMenu.addEventListener("click", function (e) {
        if (e.target.closest("button")) {
          profileMenu.classList.add("hidden");
          profileMenuBtn.setAttribute("aria-expanded", "false");
        }
      });
    }

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
      try {
        if (window.JarvisWorkoutUI && typeof window.JarvisWorkoutUI.init === "function") window.JarvisWorkoutUI.init();
      } catch (err) {
        if (window.console) console.error("The new Workout screens failed to start; the classic logger still works", err);
      }
      try {
        if (window.JarvisRoutinesUI && typeof window.JarvisRoutinesUI.init === "function") window.JarvisRoutinesUI.init();
      } catch (err) {
        if (window.console) console.error("The new Routines screen failed to start; the older one is still in the page", err);
        const legacy = document.getElementById("rtLegacy"), mine = document.getElementById("rtRoot");
        if (legacy && mine) { legacy.hidden = false; mine.hidden = true; }   // fall back to the earlier screen rather than show nothing
      }
      try {
        if (window.JarvisHistoryUI && typeof window.JarvisHistoryUI.init === "function") window.JarvisHistoryUI.init();
      } catch (err) {
        if (window.console) console.error("The new History screen failed to start; the older list is still in the page", err);
        const legacy = document.getElementById("hsLegacy"), mine = document.getElementById("hsRoot");
        if (legacy && mine) { legacy.hidden = false; mine.hidden = true; }
      }
      try {
        if (window.JarvisProgressUI && typeof window.JarvisProgressUI.init === "function") window.JarvisProgressUI.init();
      } catch (err) {
        if (window.console) console.error("The new Progress screen failed to start; the older one is still in the page", err);
        const legacy = document.getElementById("pgLegacy"), mine = document.getElementById("pgRoot");
        if (legacy && mine) { legacy.hidden = false; mine.hidden = true; }
      }
      try {
        if (window.JarvisLibraryUI && typeof window.JarvisLibraryUI.init === "function") window.JarvisLibraryUI.init();
      } catch (err) {
        if (window.console) console.error("The exercise library failed to start; the exercise picker still works", err);
      }
      try {
        if (window.JarvisInsights && typeof window.JarvisInsights.init === "function") window.JarvisInsights.init();
      } catch (err) {
        if (window.console) console.error("The training notes failed to start; the rest of Workout is unaffected", err);
      }
      if (window.JarvisNutrition && typeof window.JarvisNutrition.init === "function") window.JarvisNutrition.init();
      if (window.JarvisGroceries && typeof window.JarvisGroceries.init === "function") window.JarvisGroceries.init();
      try {
        if (window.JarvisHabits && typeof window.JarvisHabits.init === "function") window.JarvisHabits.init();
      } catch (err) {
        if (window.console) console.error("Habits failed to start; the rest of the app is unaffected", err);
      }
      try {
        if (window.JarvisDayPlan && typeof window.JarvisDayPlan.init === "function") window.JarvisDayPlan.init();
      } catch (err) {
        if (window.console) console.error("The day planner failed to start; the rest of the app is unaffected", err);
      }
      if (window.JarvisReminders && typeof window.JarvisReminders.init === "function") window.JarvisReminders.init();
      if (window.JarvisVideoConnections && typeof window.JarvisVideoConnections.init === "function") window.JarvisVideoConnections.init();
      if (window.JarvisFormCheck && typeof window.JarvisFormCheck.init === "function") window.JarvisFormCheck.init();
      // The Calendar and Home read dates from Habits, so they start after it has loaded.
      try {
        if (window.JarvisCalendar && typeof window.JarvisCalendar.init === "function") window.JarvisCalendar.init();
      } catch (err) {
        if (window.console) console.error("The calendar failed to start; the rest of the app is unaffected", err);
      }
      try {
        if (window.JarvisAssistant && typeof window.JarvisAssistant.init === "function") window.JarvisAssistant.init();
      } catch (err) {
        if (window.console) console.error("The planning assistant failed to start; the calendar is unaffected", err);
      }
      try {
        if (window.JarvisCalReminders && typeof window.JarvisCalReminders.init === "function") window.JarvisCalReminders.init();
      } catch (err) {
        if (window.console) console.error("Calendar reminders failed to start; the calendar is unaffected", err);
      }
      try {
        if (window.JarvisCalFile && typeof window.JarvisCalFile.init === "function") window.JarvisCalFile.init();
      } catch (err) {
        if (window.console) console.error("Calendar files failed to start; the calendar is unaffected", err);
      }
      try {
        if (window.JarvisHome && typeof window.JarvisHome.init === "function") window.JarvisHome.init();
      } catch (err) {
        if (window.console) console.error("Home failed to start; the rest of the app is unaffected", err);
      }
      // Last of the modules (before the briefing, which reads its summary), and guarded: a problem starting the
      // Discipline tab must never stop the other tabs from working.
      try {
        if (window.JarvisDiscipline && typeof window.JarvisDiscipline.init === "function") window.JarvisDiscipline.init();
      } catch (err) {
        if (window.console) console.error("Discipline tab failed to start", err);
      }
      try {
        if (window.JarvisWakeCheck && typeof window.JarvisWakeCheck.init === "function") window.JarvisWakeCheck.init();
      } catch (err) {
        if (window.console) console.error("Wake check failed to start", err);
      }
      try {
        if (window.JarvisShopify && typeof window.JarvisShopify.init === "function") window.JarvisShopify.init();
      } catch (err) {
        if (window.console) console.error("The Business tab failed to start; the rest of the app is unaffected", err);
      }
      try {
        if (window.JarvisLearning && typeof window.JarvisLearning.init === "function") window.JarvisLearning.init();
      } catch (err) {
        if (window.console) console.error("The Learning hub failed to start; the rest of the app is unaffected", err);
      }
      try {
        if (window.JarvisRetiredUI && typeof window.JarvisRetiredUI.init === "function") window.JarvisRetiredUI.init();
      } catch (err) {
        if (window.console) console.error("The check for leftover data failed to run; nothing was erased", err);
      }
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
