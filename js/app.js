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

    if (window.JarvisWorkout && typeof window.JarvisWorkout.init === "function") window.JarvisWorkout.init();
    if (window.JarvisHabits && typeof window.JarvisHabits.init === "function") window.JarvisHabits.init();
    if (window.JarvisBusiness && typeof window.JarvisBusiness.init === "function") window.JarvisBusiness.init();
    if (window.JarvisTrading && typeof window.JarvisTrading.init === "function") window.JarvisTrading.init();
  });
})();
