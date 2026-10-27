/* ==========================================================================
   JARVIS — Discipline: drawing the Trends charts (pure functions that return
   markup as strings, so they can be tested outside the browser).

   Two things it is careful about:
   - A day with no scored review is a gap, never a zero. The line is only drawn
     between scored days that are next to each other, and a lone day is a dot.
   - Colour is never the only carrier. Every point and every calendar square has
     its date and score in text, and the chart comes with the same numbers as a list.
   The scale is always 0 to 100, so a small change never looks like a big one.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./discipline-logic"));
  else root.JarvisDisciplineCharts = factory(root.JarvisDisciplineLogic);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const BUCKET_LABELS = { 4: "80–100", 3: "60–79", 2: "40–59", 1: "0–39" };

  function esc(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function longDate(iso) { return WEEKDAYS[L.weekdayOf(iso)] + ", " + L.shortDate(iso); }
  function num(n) { return Math.round(n * 10) / 10; }

  function describe(p) {
    return longDate(p.date) + ": " + (p.score === null ? (p.planned ? "plan saved, no review" : "no entry") : p.score + " out of 100");
  }

  // Scored days next to each other make one line; a scored day on its own is a dot.
  function runs(points) {
    const out = [];
    let cur = [];
    points.forEach(function (p, i) {
      if (p.score !== null) cur.push(i);
      else if (cur.length) { out.push(cur); cur = []; }
    });
    if (cur.length) out.push(cur);
    return out;
  }

  // The daily-score line chart as an inline SVG. points: [{ date, score | null, planned }], oldest first.
  function lineChart(points, today) {
    const W = 320, H = 176, left = 30, right = 10, top = 12, bottom = 26;
    const n = points.length;
    const plotW = W - left - right, plotH = H - top - bottom;
    const x = function (i) { return num(n === 1 ? left + plotW / 2 : left + (i * plotW) / (n - 1)); };
    const y = function (score) { return num(top + plotH * (1 - score / 100)); };
    const scored = points.filter(function (p) { return p.score !== null; });
    const span = "Daily discipline scores for the last " + (n === 1 ? "day" : n + " days") + ". ";
    const label = scored.length
      ? span + scored.length + " scored " + (scored.length === 1 ? "day" : "days") + ", from " + Math.min.apply(null, scored.map(function (p) { return p.score; })) + " to " + Math.max.apply(null, scored.map(function (p) { return p.score; })) + " out of 100."
      : span + "No scored days yet.";
    const r = n <= 7 ? 4 : 2.8;
    let g = "";
    [0, 50, 100].forEach(function (v) {
      g += '<line class="dc-grid" x1="' + left + '" x2="' + (W - right) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="dc-axis-text" x="' + (left - 6) + '" y="' + (y(v) + 3.5) + '" text-anchor="end">' + v + '</text>';
    });
    runs(points).forEach(function (run) {
      if (run.length < 2) return;
      g += '<path class="dc-line" d="' + run.map(function (i, k) { return (k ? "L" : "M") + x(i) + " " + y(points[i].score); }).join(" ") + '"/>';
    });
    points.forEach(function (p, i) {
      if (p.score !== null) {
        g += '<circle class="dc-dot' + (p.date === today ? " today" : "") + '" cx="' + x(i) + '" cy="' + y(p.score) + '" r="' + r + '"><title>' + esc(describe(p)) + '</title></circle>';
      } else if (p.planned) {
        g += '<circle class="dc-plan-dot" cx="' + x(i) + '" cy="' + y(0) + '" r="2.4"><title>' + esc(describe(p)) + '</title></circle>';
      }
    });
    // the days along the bottom: a letter for each day in a week, three dates for a month
    if (n <= 7) {
      points.forEach(function (p, i) { g += '<text class="dc-axis-text" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + WEEKDAYS[L.weekdayOf(p.date)].charAt(0) + '</text>'; });
    } else {
      [[0, "start"], [Math.floor((n - 1) / 2), "middle"], [n - 1, "end"]].forEach(function (t) {
        g += '<text class="dc-axis-text" x="' + x(t[0]) + '" y="' + (H - 8) + '" text-anchor="' + t[1] + '">' + esc(L.shortDate(points[t[0]].date)) + '</text>';
      });
    }
    return '<svg class="dc-linechart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + '" focusable="false">' + g + '</svg>';
  }

  // The same numbers as the chart, as a list (newest first).
  function chartList(points) {
    return '<ul class="dc-datalist">' + points.slice().reverse().map(function (p) {
      return "<li>" + esc(describe(p)) + "</li>";
    }).join("") + "</ul>";
  }

  // The consistency calendar: weeks as rows, Monday first. rows: from JarvisDisciplineInsights.calendar.
  function heatmap(rows, today) {
    const inWindow = [].concat.apply([], rows).filter(function (c) { return c.state === "scored" || c.state === "planned" || c.state === "none"; });
    const scored = inWindow.filter(function (c) { return c.state === "scored"; }).length;
    const head = '<div class="dc-heat-head" aria-hidden="true">' + ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(function (d) { return "<span>" + d + "</span>"; }).join("") + "</div>";
    const body = rows.map(function (row) {
      return '<div class="dc-heat-row">' + row.map(function (c) {
        const day = Number(c.date.slice(8, 10));
        if (c.state === "future" || c.state === "outside") return '<div class="dc-heat-cell s-' + c.state + '" aria-hidden="true"><span class="dc-heat-d">' + day + "</span></div>";
        const text = c.state === "scored" ? c.score + " out of 100" : c.state === "planned" ? "plan saved, no review" : "no entry";
        return '<div class="dc-heat-cell s-' + c.state + (c.bucket ? " b" + c.bucket : "") + (c.today ? " today" : "") + '" role="listitem" aria-label="' + esc(longDate(c.date) + ": " + text) + '">' +
          '<span class="dc-heat-d">' + day + '</span><span class="dc-heat-n" aria-hidden="true">' + (c.state === "scored" ? c.score : c.state === "planned" ? "·" : "") + "</span></div>";
      }).join("") + "</div>";
    }).join("");
    const legend = '<div class="dc-heat-legend" aria-hidden="true">' + [4, 3, 2, 1].map(function (b) {
      return '<span><i class="dc-heat-sw s-scored b' + b + '"></i>' + BUCKET_LABELS[b] + "</span>";
    }).join("") + '<span><i class="dc-heat-sw s-planned"></i>plan only</span><span><i class="dc-heat-sw s-none"></i>no entry</span></div>';
    return '<div class="dc-heat" role="list" aria-label="' + esc("Calendar of the last days: " + scored + " scored of " + inWindow.length + " days shown.") + '">' + head + body + "</div>" + legend;
  }

  return { lineChart: lineChart, chartList: chartList, heatmap: heatmap, runs: runs, esc: esc, longDate: longDate, BUCKET_LABELS: BUCKET_LABELS };
});
