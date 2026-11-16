/* ==========================================================================
   JARVIS — Strategic Planning Center: small SVG charts (no libraries).

   bars(spec)  columns, one or two series side by side
   line(spec)  lines over time (a missing value is a gap in the line, never a zero)

   spec: { title, summary (read out by screen readers), labels: ["Jun", ...], series: [{ name, color, values: [number|null] }],
           format: fn(value) -> text (axis ticks, tooltip and table), reference: { value, label } | null, height }

   Rules these follow (the data-visualization checklist the app uses):
     - one axis, starting at zero; a value that isn't known (null) is drawn as nothing and called "not tracked" in the tooltip and table,
       so an unknown month can never be mistaken for a month of zero
     - columns at most 24 px wide, 4 px rounded at the top and square on the baseline, a 2 px gap between neighbours; lines 2 px;
       the end dot is 8 px with a 2 px ring in the surface colour; grid lines and axes are 1 px, solid and quiet
     - two or more series always get a legend (a single series is named by its title)
     - text is never drawn in a series colour; the colour sits in a mark next to the text
     - every figure also has a "Show the numbers" table, and a tooltip that opens on hover, tap or keyboard focus
     - colours come from the CSS variables --viz-1..3 (blue, orange, aqua), checked against the card surface with the palette validator

   The builders only make strings (so they are tested without a browser). The tooltip is wired up once, at the bottom.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisPlanCharts = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const W = 320;                       // the drawing is 320 wide and scales to the width it is given
  const M = { left: 44, right: 12, top: 12, bottom: 24 };

  function esc(s) { return String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function r1(n) { return Math.round(n * 10) / 10; }

  // A clean top for the axis and the ticks up to it: 0, then three or four steps of 1, 2, 2.5 or 5 times a power of ten.
  function niceScale(max) {
    if (!isNum(max) || max <= 0) return { max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
    const raw = max / 4, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
    const top = Math.ceil(max / step - 1e-9) * step, ticks = [];
    for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { max: top, step: step, ticks: ticks };
  }

  // Which x labels fit: every k-th, counted back from the latest so the newest one always shows.
  function labelEvery(labels, band) {
    const longest = labels.reduce(function (m, l) { return Math.max(m, String(l).length); }, 1);
    return Math.max(1, Math.ceil((longest * 6.6 + 6) / Math.max(1, band)));
  }
  function legend(series) {
    if (series.length < 2) return "";
    return '<ul class="viz-legend">' + series.map(function (s) { return '<li><span class="viz-key" style="background:' + esc(s.color) + '" aria-hidden="true"></span>' + esc(s.name) + '</li>'; }).join("") + '</ul>';
  }
  function table(spec, fmt) {
    const rows = spec.labels.map(function (lab, i) {
      return '<tr><th scope="row">' + esc(lab) + '</th>' + spec.series.map(function (s) { return '<td>' + (isNum(s.values[i]) ? esc(fmt(s.values[i])) : '<span class="viz-na">not tracked</span>') + '</td>'; }).join("") + '</tr>';
    }).join("");
    return '<details class="viz-table"><summary>Show the numbers</summary><table><caption class="visually-hidden">' + esc(spec.title) + '</caption><thead><tr><th scope="col"><span class="visually-hidden">Period</span></th>' + spec.series.map(function (s) { return '<th scope="col">' + esc(s.name) + '</th>'; }).join("") + '</tr></thead><tbody>' + rows + '</tbody></table></details>';
  }
  // What the tooltip shows for one position: the value first, the series name after it.
  function tipFor(spec, fmt, i) {
    return JSON.stringify({ title: spec.labels[i], rows: spec.series.map(function (s) { return { color: s.color, name: s.name, value: isNum(s.values[i]) ? fmt(s.values[i]) : "not tracked" }; }) });
  }
  function tipLabel(spec, fmt, i) {
    return spec.labels[i] + ": " + spec.series.map(function (s) { return s.name + " " + (isNum(s.values[i]) ? fmt(s.values[i]) : "not tracked"); }).join(", ");
  }
  function maxOf(spec) {
    let m = 0;
    spec.series.forEach(function (s) { s.values.forEach(function (v) { if (isNum(v) && v > m) m = v; }); });
    if (spec.reference && isNum(spec.reference.value) && spec.reference.value > m) m = spec.reference.value;
    return m;
  }
  function frame(spec, fmt, H, extra) {
    const sc = niceScale(maxOf(spec)), plotH = H - M.top - M.bottom, plotW = W - M.left - M.right;
    const y = function (v) { return M.top + plotH - (plotH * v / sc.max); };
    let g = '';
    sc.ticks.forEach(function (t) {
      g += '<line class="viz-grid" x1="' + M.left + '" x2="' + (W - M.right) + '" y1="' + r1(y(t)) + '" y2="' + r1(y(t)) + '"/><text class="viz-tick" x="' + (M.left - 6) + '" y="' + r1(y(t) + 4) + '" text-anchor="end">' + esc(fmt(t, true)) + '</text>';
    });
    return { sc: sc, plotH: plotH, plotW: plotW, y: y, grid: g, base: M.top + plotH };
  }
  function referenceLine(spec, fmt, f) {
    const ref = spec.reference;
    if (!ref || !isNum(ref.value) || ref.value <= 0) return "";
    const yy = r1(f.y(ref.value));
    return '<line class="viz-ref" x1="' + M.left + '" x2="' + (W - M.right) + '" y1="' + yy + '" y2="' + yy + '"/><text class="viz-reflabel" x="' + (W - M.right) + '" y="' + (yy - 4) + '" text-anchor="end">' + esc(ref.label || "Target") + ' ' + esc(fmt(ref.value)) + '</text>';
  }
  function wrap(spec, svg, fmt, kind) {
    return '<figure class="viz viz-' + kind + '"><figcaption class="viz-title">' + esc(spec.title) + '</figcaption>' + legend(spec.series) +
      '<svg class="viz-svg" viewBox="0 0 ' + W + ' ' + (spec.height || 180) + '" role="group" aria-label="' + esc(spec.summary || spec.title) + '" preserveAspectRatio="xMidYMid meet">' + svg + '</svg>' + table(spec, fmt) + '</figure>';
  }
  function hasAny(spec) { return spec.series.some(function (s) { return s.values.some(isNum); }); }
  function empty(spec) { return '<figure class="viz viz-empty"><figcaption class="viz-title">' + esc(spec.title) + '</figcaption><p class="viz-none">' + esc(spec.emptyText || "Nothing tracked for this yet, so there is nothing to draw.") + '</p></figure>'; }

  // A 4 px rounded top, square at the baseline.
  function colPath(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    if (h <= 0) return "";
    return "M" + r1(x) + "," + r1(y + h) + " L" + r1(x) + "," + r1(y + r) + " Q" + r1(x) + "," + r1(y) + " " + r1(x + r) + "," + r1(y) + " L" + r1(x + w - r) + "," + r1(y) + " Q" + r1(x + w) + "," + r1(y) + " " + r1(x + w) + "," + r1(y + r) + " L" + r1(x + w) + "," + r1(y + h) + " Z";
  }

  function bars(spec) {
    const fmt = spec.format || function (v) { return String(v); };
    if (!hasAny(spec)) return empty(spec);
    const H = spec.height || 180, f = frame(spec, fmt, H), n = spec.labels.length, k = spec.series.length, band = f.plotW / n;
    const gap = 2, bw = Math.max(4, Math.min(24, (band * 0.72 - gap * (k - 1)) / k)), groupW = bw * k + gap * (k - 1), every = labelEvery(spec.labels, band);
    let svg = f.grid + '<line class="viz-axis" x1="' + M.left + '" x2="' + (W - M.right) + '" y1="' + f.base + '" y2="' + f.base + '"/>';
    for (let i = 0; i < n; i++) {
      const cx = M.left + band * i + band / 2, x0 = cx - groupW / 2;
      let col = '<g class="viz-col" tabindex="0" role="img" aria-label="' + esc(tipLabel(spec, fmt, i)) + '" data-tip="' + esc(tipFor(spec, fmt, i)) + '"><rect class="viz-hit" x="' + r1(M.left + band * i) + '" y="' + M.top + '" width="' + r1(band) + '" height="' + f.plotH + '"/>';
      spec.series.forEach(function (s, j) {
        const v = s.values[i];
        if (!isNum(v)) return;
        const h = Math.max(0, f.plotH * v / f.sc.max), x = x0 + j * (bw + gap);
        col += '<path class="viz-bar" d="' + colPath(x, f.base - h, bw, h) + '" fill="' + esc(s.color) + '"/>';
        if (k === 1 && n <= 7 && band >= 36 && v > 0) col += '<text class="viz-val" x="' + r1(x + bw / 2) + '" y="' + r1(Math.max(M.top + 10, f.base - h - 4)) + '" text-anchor="middle">' + esc(fmt(v)) + '</text>';
      });
      svg += col + '</g>' + ((n - 1 - i) % every === 0 ? '<text class="viz-xlab" x="' + r1(cx) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(spec.labels[i]) + '</text>' : "");
    }
    svg += referenceLine(spec, fmt, f);
    return wrap(spec, svg, fmt, "bars");
  }

  function line(spec) {
    const fmt = spec.format || function (v) { return String(v); };
    if (!hasAny(spec)) return empty(spec);
    const H = spec.height || 180, f = frame(spec, fmt, H), n = spec.labels.length, step = n > 1 ? f.plotW / (n - 1) : 0;
    const xAt = function (i) { return n > 1 ? M.left + step * i : M.left + f.plotW / 2; };
    let svg = f.grid + '<line class="viz-axis" x1="' + M.left + '" x2="' + (W - M.right) + '" y1="' + f.base + '" y2="' + f.base + '"/>';
    const every = labelEvery(spec.labels, n > 1 ? step : f.plotW);
    for (let i = 0; i < n; i++) if ((n - 1 - i) % every === 0) svg += '<text class="viz-xlab" x="' + r1(xAt(i)) + '" y="' + (H - 6) + '" text-anchor="' + (i === n - 1 && n > 1 ? "end" : i === 0 && n > 1 && every === 1 ? "start" : "middle") + '">' + esc(spec.labels[i]) + '</text>';
    svg += referenceLine(spec, fmt, f);
    spec.series.forEach(function (s) {
      let seg = [], last = -1;
      const flush = function () {
        if (seg.length > 1) svg += '<polyline class="viz-line" points="' + seg.map(function (p) { return r1(p[0]) + "," + r1(p[1]); }).join(" ") + '" stroke="' + esc(s.color) + '"/>';
        else if (seg.length === 1) svg += '<circle class="viz-dot" cx="' + r1(seg[0][0]) + '" cy="' + r1(seg[0][1]) + '" r="4" fill="' + esc(s.color) + '"/>';
        seg = [];
      };
      s.values.forEach(function (v, i) {
        if (!isNum(v)) { flush(); return; }
        seg.push([xAt(i), f.y(v)]); last = i;
      });
      flush();
      if (last >= 0) svg += '<circle class="viz-end" cx="' + r1(xAt(last)) + '" cy="' + r1(f.y(s.values[last])) + '" r="4" fill="' + esc(s.color) + '"/>';
    });
    // hit columns: one per position, with a hairline that shows on hover or focus
    for (let i = 0; i < n; i++) {
      const w = n > 1 ? step : f.plotW, x = xAt(i) - w / 2;
      svg += '<g class="viz-col" tabindex="0" role="img" aria-label="' + esc(tipLabel(spec, fmt, i)) + '" data-tip="' + esc(tipFor(spec, fmt, i)) + '"><rect class="viz-hit" x="' + r1(Math.max(M.left - 4, x)) + '" y="' + M.top + '" width="' + r1(w) + '" height="' + f.plotH + '"/><line class="viz-cross" x1="' + r1(xAt(i)) + '" x2="' + r1(xAt(i)) + '" y1="' + M.top + '" y2="' + f.base + '"/>';
      spec.series.forEach(function (s) { if (isNum(s.values[i])) svg += '<circle class="viz-pt" cx="' + r1(xAt(i)) + '" cy="' + r1(f.y(s.values[i])) + '" r="4" fill="' + esc(s.color) + '"/>'; });
      svg += '</g>';
    }
    return wrap(spec, svg, fmt, "line");
  }

  /* ---------------- the tooltip (browser only) ---------------- */

  if (typeof document !== "undefined") {
    let tip = null;
    const ensure = function () { if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true; document.body.appendChild(tip); } return tip; };
    const hide = function () { if (tip) tip.hidden = true; };
    const show = function (el, x, y) {
      let d; try { d = JSON.parse(el.getAttribute("data-tip")); } catch (e) { return; }
      const t = ensure();
      t.textContent = "";
      const head = document.createElement("div"); head.className = "viz-tip-h"; head.textContent = d.title; t.appendChild(head);
      d.rows.forEach(function (r) {
        const row = document.createElement("div"); row.className = "viz-tip-r";
        const key = document.createElement("span"); key.className = "viz-key"; key.style.background = r.color;
        const val = document.createElement("strong"); val.textContent = r.value;
        const nm = document.createElement("span"); nm.className = "viz-tip-n"; nm.textContent = r.name;
        row.appendChild(key); row.appendChild(val); row.appendChild(nm); t.appendChild(row);
      });
      t.hidden = false;
      const b = t.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      t.style.left = Math.max(8, Math.min(vw - b.width - 8, x - b.width / 2)) + "px";
      t.style.top = Math.max(8, y - b.height - 12) + "px";
    };
    const colOf = function (e) { return e.target && e.target.closest ? e.target.closest(".viz-col") : null; };
    document.addEventListener("pointerover", function (e) { const c = colOf(e); if (c) show(c, e.clientX, e.clientY); else hide(); });
    document.addEventListener("pointermove", function (e) { const c = colOf(e); if (c && tip && !tip.hidden) show(c, e.clientX, e.clientY); });
    document.addEventListener("focusin", function (e) { const c = colOf(e); if (c) { const r = c.getBoundingClientRect(); show(c, r.left + r.width / 2, r.top + 24); } else hide(); });
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
    document.addEventListener("pointerdown", function (e) { if (!colOf(e)) hide(); });
  }

  return { niceScale: niceScale, bars: bars, line: line, colPath: colPath };
});
