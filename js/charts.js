/* ==========================================================================
   JARVIS — Charts: small SVG / HTML chart builders for Progress (pure functions that
   return strings, so the geometry can be tested outside the browser).

   Rules followed (from the data-visualisation guidance used for this app):
     - One series, one colour (the app accent). Nothing is coloured by rank.
     - Columns are at most 24px wide with a 4px rounded top and a square base; lines are 2px;
       markers are at least 8px across with a 2px ring in the card colour; the grid is a
       solid hairline.
     - A number is printed only where it helps (the newest point, the best point). Every
       value is in the tooltip AND in a table view, so a tooltip never gates a number.
     - Text is never drawn in the series colour: labels use the muted text colour.
     - A lighter column means a part week, and a caption under the chart says so.
   Sizes are in real pixels: the screen measures its box and passes the width in, so the
   12px text stays 12px on a 320px phone.

   Everything that came from your data (names, dates) is escaped here; the screen puts the
   tooltip text in with textContent.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisCharts = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // One hue, light at the top: the body map and any "how much" colouring. Checked against the card colour.
  const HEAT_RAMP = ["#3460a8", "#4373c8", "#5b8def", "#8bb0ff", "#c3d6ff"];
  const MAX_BAR = 24, BAR_RADIUS = 4;

  function esc(v) {
    return String(v === undefined || v === null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function r1(n) { return Math.round(n * 10) / 10; }

  /* ---------------- numbers on an axis ---------------- */

  // Round axis numbers: a step of 1, 2, 5 or 10 times a power of ten. Returns { min, max, step, ticks }.
  function niceScale(lo, hi, target) {
    const want = Math.max(2, target || 4);
    let a = Number(lo), b = Number(hi);
    if (!isFinite(a) || !isFinite(b)) { a = 0; b = 1; }
    if (b < a) { const t = a; a = b; b = t; }
    if (a === b) { b = a + (a === 0 ? 1 : Math.abs(a) * 0.1); }
    const raw = (b - a) / want, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
    const min = Math.floor(a / step + 1e-9) * step, max = Math.ceil(b / step - 1e-9) * step;
    const ticks = [];
    for (let v = min; v <= max + step / 2; v += step) ticks.push(r1(v * 1000) / 1000);
    return { min: min, max: max, step: step, ticks: ticks };
  }

  // Full numbers under 10,000; 12K once the axis reaches it. One style per axis.
  function axisFormatter(maxValue) {
    const compact = Math.abs(maxValue) >= 10000;
    return function (v) {
      if (!compact) return String(Math.round(v * 10) / 10);
      const k = v / 1000;
      return (Math.abs(k - Math.round(k)) < 0.05 ? String(Math.round(k)) : String(r1(k))) + "K";
    };
  }

  function textWidth(s) { return String(s).length * 7; }

  function xLabelIndexes(n, plotW, minGap) {
    if (n <= 0) return [];
    if (n === 1) return [0];
    const maxLabels = Math.max(2, Math.floor(plotW / (minGap || 64)));
    const out = [0];
    const step = (n - 1) / (maxLabels - 1);
    for (let i = 1; i < maxLabels - 1; i++) out.push(Math.round(i * step));
    out.push(n - 1);
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  /* ---------------- shared pieces ---------------- */

  function gridAndAxis(scale, fmt, left, right, top, plotH, width) {
    return scale.ticks.map(function (t) {
      const y = top + plotH - (t - scale.min) / (scale.max - scale.min) * plotH;
      return '<line class="ch-grid" x1="' + left + '" x2="' + (width - right) + '" y1="' + r1(y) + '" y2="' + r1(y) + '"/>' +
        '<text class="ch-axis-text" x="' + (left - 6) + '" y="' + r1(y + 4) + '" text-anchor="end">' + esc(fmt(t)) + '</text>';
    }).join("");
  }

  function dataAttr(obj) { return esc(JSON.stringify(obj)); }

  // The wrapper every chart sits in: a labelled group the arrow keys can step through, the shared tooltip, a live region.
  function wrap(kind, svg, o, data) {
    return '<div class="ch ch-kind-' + kind + '" tabindex="0" role="group" aria-label="' + esc(o.ariaLabel || "Chart") + '. Use the left and right arrow keys to read each point." data-chart="' + dataAttr(data) + '">' +
      svg + '<div class="ch-tip" aria-hidden="true" hidden><span class="ch-tip-value"></span><span class="ch-tip-label"></span></div><span class="ch-live visually-hidden" role="status" aria-live="polite"></span></div>' +
      (o.caption ? '<p class="ch-caption">' + esc(o.caption) + '</p>' : '') + (o.table ? tableView(o.table) : "");
  }

  // The table twin of a chart: every number, readable without a pointer.
  function tableView(t) {
    return '<details class="ch-table"><summary>Show the numbers</summary><div class="ch-table-wrap"><table><caption class="visually-hidden">' + esc(t.caption || "Chart data") + '</caption><thead><tr>' +
      t.headers.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join("") + '</tr></thead><tbody>' +
      t.rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return i === 0 ? '<th scope="row">' + esc(c) + '</th>' : '<td>' + esc(c) + '</td>'; }).join("") + '</tr>'; }).join("") +
      '</tbody></table></div></details>';
  }

  /* ---------------- columns (one per week, etc.) ---------------- */

  // items: [{ label (axis text), title (tooltip heading), value, valueText, state: "" | "soft" }]
  // o: { width, height, ariaLabel, caption, table, yFormat }
  function columns(items, o) {
    const width = Math.max(240, Math.round(o.width || 320)), height = o.height || 180;
    const top = 12, bottom = 26, right = 8;
    const maxV = items.reduce(function (m, it) { return Math.max(m, Number(it.value) || 0); }, 0);
    const scale = niceScale(0, maxV || 1, 4);
    const fmt = o.yFormat || axisFormatter(scale.max);
    const left = 10 + Math.max.apply(null, scale.ticks.map(function (t) { return textWidth(fmt(t)); }));
    const plotW = width - left - right, plotH = height - top - bottom, n = items.length;
    const band = n ? plotW / n : plotW;
    const bw = Math.max(2, Math.min(MAX_BAR, band - 2));
    const base = top + plotH;
    const xs = items.map(function (_, i) { return r1(left + band * i + band / 2); });
    const bars = items.map(function (it, i) {
      const v = Number(it.value) || 0;
      if (v <= 0) return "";
      const h = Math.max(1, v / scale.max * plotH), y = base - h, x = xs[i] - bw / 2, r = Math.min(BAR_RADIUS, bw / 2, h);
      const d = "M" + r1(x) + "," + r1(base) + " L" + r1(x) + "," + r1(y + r) + " A" + r1(r) + "," + r1(r) + " 0 0 1 " + r1(x + r) + "," + r1(y) +
        " L" + r1(x + bw - r) + "," + r1(y) + " A" + r1(r) + "," + r1(r) + " 0 0 1 " + r1(x + bw) + "," + r1(y + r) + " L" + r1(x + bw) + "," + r1(base) + " Z";
      return '<path class="ch-bar' + (it.state === "soft" ? " is-soft" : "") + '" data-i="' + i + '" d="' + d + '"/>';
    }).join("");
    const labels = xLabelIndexes(n, plotW, 60).map(function (i) {
      return '<text class="ch-axis-text" x="' + xs[i] + '" y="' + (height - 6) + '" text-anchor="' + (i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle") + '">' + esc(items[i].label) + '</text>';
    }).join("");
    const svg = '<svg class="ch-svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '" aria-hidden="true" focusable="false">' +
      gridAndAxis(scale, fmt, left, right, top, plotH, width) + bars + labels + '</svg>';
    const data = { kind: "columns", xs: xs, left: left, right: width - right, top: top, bottom: base, band: r1(band), tips: items.map(function (it) { return { t: it.title, v: it.valueText, l: it.title + ": " + it.valueText }; }) };
    return wrap("columns", svg, o, data);
  }

  /* ---------------- a line over dates ---------------- */

  function dayNumber(k) { const p = String(k).split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; }

  // points: [{ x: "YYYY-MM-DD", y, label (axis text), title, valueText }], oldest first, at least two.
  // o: { width, height, ariaLabel, caption, table, peak (label the best point) }
  function line(points, o) {
    const width = Math.max(240, Math.round(o.width || 320)), height = o.height || 190;
    const top = 16, bottom = 26, right = 14;
    const ys = points.map(function (p) { return Number(p.y); });
    const lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = (hi - lo) * 0.15 || Math.max(1, Math.abs(hi) * 0.05);
    const scale = niceScale(lo - pad, hi + pad, 4);
    const fmt = o.yFormat || axisFormatter(scale.max);
    const left = 10 + Math.max.apply(null, scale.ticks.map(function (t) { return textWidth(fmt(t)); }));
    const plotW = width - left - right, plotH = height - top - bottom, base = top + plotH;
    const d0 = dayNumber(points[0].x), span = Math.max(1, dayNumber(points[points.length - 1].x) - d0);
    const px = points.map(function (p) { return r1(left + (dayNumber(p.x) - d0) / span * plotW); });
    const py = points.map(function (p) { return r1(base - (Number(p.y) - scale.min) / (scale.max - scale.min) * plotH); });
    const path = points.map(function (_, i) { return (i ? "L" : "M") + px[i] + "," + py[i]; }).join(" ");
    const area = path + " L" + px[px.length - 1] + "," + r1(base) + " L" + px[0] + "," + r1(base) + " Z";
    const showAll = points.length <= 40;
    const dots = points.map(function (_, i) { return showAll || i === points.length - 1 ? '<circle class="ch-dot" cx="' + px[i] + '" cy="' + py[i] + '" r="4"/>' : ""; }).join("");
    // Label the newest point, and the best one when it is a different point and there is room.
    let best = 0; ys.forEach(function (v, i) { if (v > ys[best]) best = i; });
    const last = points.length - 1;
    const tag = function (i, anchorEnd) {
      const txt = points[i].valueText.split(" ")[0];
      const x = anchorEnd ? Math.min(px[i], width - right) : px[i];
      return '<text class="ch-point-text" x="' + r1(x) + '" y="' + r1(Math.max(11, py[i] - 9)) + '" text-anchor="' + (anchorEnd ? "end" : "middle") + '">' + esc(txt) + '</text>';
    };
    let tags = tag(last, true);
    if (o.peak !== false && best !== last && Math.abs(px[best] - px[last]) > 56) tags += tag(best, false);
    const labels = xLabelIndexes(points.length, plotW, 72).map(function (i) {
      const edge = i === 0 ? "start" : i === last ? "end" : "middle";
      return '<text class="ch-axis-text" x="' + px[i] + '" y="' + (height - 6) + '" text-anchor="' + edge + '">' + esc(points[i].label) + '</text>';
    }).join("");
    const svg = '<svg class="ch-svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '" aria-hidden="true" focusable="false">' +
      gridAndAxis(scale, fmt, left, right, top, plotH, width) +
      '<path class="ch-area" d="' + area + '"/><path class="ch-line" d="' + path + '"/>' + dots + tags + labels +
      '<line class="ch-cross" x1="0" x2="0" y1="' + top + '" y2="' + r1(base) + '" visibility="hidden"/><circle class="ch-hot" r="5" cx="0" cy="0" visibility="hidden"/></svg>';
    const data = { kind: "line", xs: px, ys: py, left: left, right: width - right, top: top, bottom: r1(base), tips: points.map(function (p) { return { t: p.title, v: p.valueText, l: p.title + ": " + p.valueText }; }) };
    return wrap("line", svg, o, data);
  }

  /* ---------------- ranked bars (HTML, values at the tip) ---------------- */

  // rows: [{ label, value, valueText, note }] largest first. The bar is 8px, rounded at its end, never taller than 24px.
  function rankedBars(rows, o) {
    const max = rows.reduce(function (m, r) { return Math.max(m, Number(r.value) || 0); }, 0);
    return '<ul class="ch-rows"' + (o && o.ariaLabel ? ' aria-label="' + esc(o.ariaLabel) + '"' : '') + '>' + rows.map(function (r) {
      const pct = max > 0 ? Math.max(2, Math.round((Number(r.value) || 0) / max * 100)) : 0;
      return '<li class="ch-row"><span class="ch-row-label">' + esc(r.label) + '</span><span class="ch-row-track" aria-hidden="true"><span class="ch-row-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="ch-row-val">' + esc(r.valueText) + '</span>' + (r.note ? '<span class="ch-row-note">' + esc(r.note) + '</span>' : '') + '</li>';
    }).join("") + '</ul>';
  }

  /* ---------------- the heat colouring ---------------- */

  // Five steps over 1..max (0 stays uncoloured). Returns [{ from, to, color }] with whole-number set counts.
  function heatBands(max) {
    const m = Math.max(1, Math.ceil(max));
    const per = Math.max(1, Math.ceil(m / HEAT_RAMP.length));
    const bands = [];
    for (let i = 0; i < HEAT_RAMP.length; i++) {
      const from = i * per + 1;
      if (from > m) break;
      const to = i === HEAT_RAMP.length - 1 ? m : Math.min(m, (i + 1) * per);
      bands.push({ from: from, to: to, color: HEAT_RAMP[i] });
    }
    return bands;
  }

  function heatColor(value, max) {
    if (!(value > 0)) return null;
    const b = heatBands(max);
    for (let i = 0; i < b.length; i++) if (value <= b[i].to) return b[i].color;
    return b[b.length - 1].color;
  }

  return { HEAT_RAMP: HEAT_RAMP, esc: esc, niceScale: niceScale, axisFormatter: axisFormatter, xLabelIndexes: xLabelIndexes, columns: columns, line: line, rankedBars: rankedBars, tableView: tableView, heatBands: heatBands, heatColor: heatColor };
});
