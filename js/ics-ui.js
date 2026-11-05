/* ==========================================================================
   JARVIS — Google Calendar and calendar files (the screen).

   Two honest things live here:
   1. The state of Google Calendar sync: it is NOT connected. Syncing needs a server piece that is not set up, so nothing in
      JARVIS talks to Google. The calendar works completely without it.
   2. Moving events by file (.ics), which needs no account or key: export your JARVIS events, or read events from a file.
      It moves them once; it is not a sync. Nothing is added until you press Add, and Undo takes it back.

   The rules are in ics-logic.js. Saving and Undo go through the Calendar (window.JarvisCalendar).
   ========================================================================== */

(function () {
  "use strict";

  const C = window.JarvisCalendarLogic;
  const F = window.JarvisICS;
  const MAX_FILE = 5 * 1024 * 1024, GOOGLE_LIMIT = 1024 * 1024;
  let st = null;

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(s); }
  function cal() { return window.JarvisCalendar && window.JarvisCalendar.commitEvents ? window.JarvisCalendar : null; }
  function announce(text) { const el = $("calLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = text; }, 30); } }
  function focusSoon(sel) { window.setTimeout(function () { const e = document.querySelector(sel); if (e) e.focus(); }, 0); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function kb(bytes) { return bytes < 1024 ? bytes + " bytes" : bytes < 1048576 ? Math.round(bytes / 102.4) / 10 + " KB" : Math.round(bytes / 104857.6) / 10 + " MB"; }
  function size(text) { return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length; }

  /* ---------------- what is exported ---------------- */

  function exportList(futureOnly) {
    const c = cal(), today = c.today(), events = c.getEvents().filter(function (e) { return !e.deletedAt; });
    if (!futureOnly) return events;
    return events.filter(function (e) { return (e.endDate || e.date) >= today || (e.repeat && (!e.repeat.until || e.repeat.until >= today) && !e.repeat.count); });
  }
  function exportText(futureOnly) {
    return F.toICS(exportList(futureOnly), { now: Date.now(), allDayAt: cal().getSettings().notify.allDayAt, name: "JARVIS" });
  }

  /* ---------------- drawing ---------------- */

  function homeHtml() {
    const n = exportList(st.future).length, txt = n ? exportText(st.future) : "", bytes = txt ? size(txt) : 0;
    let h = '';
    if (st.msg) h += '<div class="cal-banner" role="status">' + esc(st.msg) + '</div>';
    h += '<div class="cr-limit"><strong>Google Calendar sync: not connected</strong><p>Syncing with Google isn’t set up on your server, so nothing in JARVIS talks to Google. Your calendar works fully without it. You can move events by file instead (below).</p></div>';
    h += '<section class="as-grp"><h3 class="as-h">Take events out</h3><label class="cal-check"><input type="checkbox" id="ics_future"' + (st.future ? " checked" : "") + '> Only events from today on (a smaller file)</label>';
    h += '<p class="field-hint" id="icsInfo">' + (n ? esc(plural(n, "event", "events") + ", about " + kb(bytes) + ".") : "There are no events to export.") + (bytes > GOOGLE_LIMIT ? ' Google Calendar only accepts files up to 1 MB, so tick the box above to make it smaller, or import it in parts.' : "") + '</p>';
    h += '<button type="button" class="btn btn-primary" data-ics="export"' + (n ? "" : " disabled") + '>Download .ics file</button>';
    h += '<p class="field-hint">Repeats, skipped days and reminders are included. Which ones other calendars keep is up to them: I have only checked this file by reading it back into JARVIS. If nothing downloads (some phone browsers don’t allow it), try from a computer.</p></section>';
    h += '<section class="as-grp"><h3 class="as-h">Bring events in</h3><label class="btn btn-secondary ics-file" for="ics_file">Choose an .ics file</label><input type="file" id="ics_file" class="visually-hidden" accept=".ics,text/calendar">';
    h += '<p class="field-hint">You’ll see what would be added first. Nothing changes until you press Add, and Undo takes it back. Importing the same file again adds nothing twice.</p></section>';
    h += '<section class="as-grp"><h3 class="as-h">Using it with Google Calendar</h3><ul class="ics-steps">' +
      '<li><strong>Google to JARVIS:</strong> in Google Calendar on a computer, open Settings, then Import &amp; export, then Export. It downloads a .zip; open it and choose the .ics file for the calendar you want here.</li>' +
      '<li><strong>JARVIS to Google:</strong> download the file above, then in Google Calendar on a computer open Settings, Import &amp; export, choose the file, pick the calendar and press Import. Google accepts files up to 1 MB.</li></ul></section>';
    h += '<div class="cal-actions"><button type="button" class="btn btn-secondary" data-ics="close">Close</button></div>';
    return h;
  }

  function previewHtml() {
    const p = st.plan, parsed = st.parsed;
    let h = '';
    if (st.error) h += '<div class="cal-banner" role="alert">' + esc(st.error) + '</div>';
    h += '<p class="field-hint"><strong>Nothing has been added yet.</strong> This is what the file would do.</p>';
    h += '<ul class="as-stats" aria-label="Summary"><li><strong>' + p.add.length + '</strong> to add</li><li><strong>' + p.duplicates.length + '</strong> already here</li><li><strong>' + p.skipped.length + '</strong> skipped</li></ul>';
    if (p.add.length) {
      h += '<section class="as-grp"><h3 class="as-h">To add</h3><ul class="as-props">' + p.add.slice(0, 8).map(function (e) {
        const i = e.input, when = i.allDay ? C.fmtDate(i.date, { month: "short", day: "numeric", year: "numeric" }) + (i.endDate && i.endDate !== i.date ? " – " + C.fmtDate(i.endDate, { month: "short", day: "numeric" }) : "") + " · all day" : C.fmtDate(i.date, { month: "short", day: "numeric", year: "numeric" }) + " · " + C.timeLabel(i.time);
        return '<li class="as-slot"><span class="as-body"><span class="as-t">' + esc(i.title) + '</span><span class="as-sub">' + esc(when) + (i.repeat ? " · repeats " + esc(i.repeat.freq) : "") + '</span></span></li>';
      }).join("") + '</ul>' + (p.add.length > 8 ? '<p class="field-hint">and ' + (p.add.length - 8) + ' more</p>' : "") + '</section>';
    }
    const noted = p.add.filter(function (e) { return e.notes.length; });
    if (noted.length) h += '<section class="as-grp"><h3 class="as-h">Changed to fit <span class="as-n">' + noted.length + '</span></h3>' + noted.slice(0, 6).map(function (e) { return '<p class="as-note"><strong>' + esc(e.input.title) + ':</strong> ' + esc(e.notes.join(" ")) + '</p>'; }).join("") + (noted.length > 6 ? '<p class="field-hint">and ' + (noted.length - 6) + ' more</p>' : "") + '</section>';
    if (p.skipped.length) h += '<section class="as-grp"><h3 class="as-h">Skipped <span class="as-n">' + p.skipped.length + '</span></h3>' + p.skipped.slice(0, 8).map(function (s) { return '<p class="as-note"><strong>' + esc(s.title) + ':</strong> ' + esc(s.reason) + '.</p>'; }).join("") + (p.skipped.length > 8 ? '<p class="field-hint">and ' + (p.skipped.length - 8) + ' more</p>' : "") + '</section>';
    if (parsed.other) h += '<p class="as-note">' + esc(plural(parsed.other, "item that isn’t an event (such as a to-do) was", "items that aren’t events (such as to-dos) were")) + ' left out.</p>';
    if (p.capped) h += '<p class="as-note">A file can add ' + F.MAX_IMPORT + ' events at a time, so ' + p.capped + ' were left out. Import the file again after this to bring in the rest.</p>';
    h += '<div class="cal-actions">' + (p.add.length ? '<button type="submit" class="btn btn-primary" id="icsAdd">Add ' + esc(plural(p.add.length, "event", "events")) + '</button>' : "") + '<button type="button" class="btn btn-secondary" data-ics="home">' + (p.add.length ? "Cancel" : "Back") + '</button></div>';
    return h;
  }

  function draw() {
    $("icsTitle").textContent = st.step === "preview" ? "Import from a file" : "Google Calendar and calendar files";
    $("icsBody").innerHTML = st.step === "preview" ? previewHtml() : homeHtml();
    $("icsModal").classList.remove("hidden");
  }

  /* ---------------- actions ---------------- */

  function open(opener) {
    if (!cal() || !F) return;
    st = { step: "home", opener: opener || document.activeElement, future: false, msg: "", plan: null, parsed: null, error: "" };
    draw(); focusSoon("#icsBody .btn-primary, #icsBody .ics-file");
  }
  function close() {
    const s = st; st = null;
    $("icsModal").classList.add("hidden"); $("icsBody").innerHTML = "";
    if (s && s.opener && s.opener.focus && document.contains(s.opener)) s.opener.focus();
  }

  function download() {
    const text = exportText(st.future), day = cal().today();
    try {
      const blob = new Blob([text], { type: "text/calendar;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "jarvis-calendar-" + day + ".ics"; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      st.msg = "Started the download of jarvis-calendar-" + day + ".ics (" + kb(size(text)) + "). I can’t see whether your browser finished saving it.";
    } catch (e) { st.msg = "The browser wouldn’t start the download."; }
    draw(); focusSoon('[data-ics="export"]');
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) { st.msg = "That file is " + kb(file.size) + ". Files over " + kb(MAX_FILE) + " aren’t read; export a shorter date range."; draw(); return; }
    const reader = new FileReader();
    reader.onerror = function () { if (st) { st.msg = "The file couldn’t be read."; draw(); } };
    reader.onload = function () {
      if (!st) return;
      const c = cal(), s = c.getSettings(), parsed = F.parse(String(reader.result || ""), { zone: c.zone(), allDayAt: s.notify.allDayAt });
      if (parsed.problem) { st.msg = parsed.problem; draw(); return; }
      st.parsed = parsed; st.plan = F.plan(c.getEvents(), parsed, { defaultDuration: s.defaultDuration });
      st.step = "preview"; st.error = ""; draw(); focusSoon("#icsAdd, #icsBody .btn");
      announce(plural(st.plan.add.length, "event", "events") + " would be added. Nothing has been added yet.");
    };
    reader.readAsText(file);
  }

  function add() {
    const c = cal(), prev = c.getEvents(), res = F.apply(prev, st.plan, c.ctx());
    if (!res.added) { st.error = res.failed.length ? "Nothing could be added: " + res.failed[0].reason : "Nothing to add."; draw(); return; }
    if (!c.commitEvents(res.events)) { st.error = "The browser would not save the calendar, so nothing was added."; draw(); return; }
    const n = res.added, failed = res.failed.length;
    close(); c.refresh();
    c.undoable("Added " + plural(n, "event", "events") + " from the file.", prev, res.events);
    if (failed) core().showToast(plural(failed, "event", "events") + " couldn’t be added: " + res.failed[0].reason);
    announce("Added " + plural(n, "event", "events") + " from the file.");
  }

  /* ---------------- events ---------------- */

  function onClick(e) {
    if (!st) return;
    if (e.target === $("icsModal")) { close(); return; }
    const el = e.target.closest("[data-ics]"); if (!el) return;
    const a = el.getAttribute("data-ics");
    if (a === "close") close();
    else if (a === "home") { st.step = "home"; st.msg = ""; draw(); focusSoon(".ics-file"); }
    else if (a === "export") download();
  }
  function onChange(e) {
    if (!st) return;
    if (e.target.id === "ics_future") { st.future = e.target.checked; draw(); focusSoon("#ics_future"); }
    else if (e.target.id === "ics_file") readFile(e.target.files && e.target.files[0]);
  }
  function onSubmit(e) { e.preventDefault(); if (st && st.step === "preview") add(); }
  function onKey(e) { if (st && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }

  function init() {
    if (!C || !F || !$("icsModal")) return;
    $("icsModal").addEventListener("click", onClick);
    $("icsBody").addEventListener("change", onChange);
    $("icsBody").addEventListener("submit", onSubmit);
    document.addEventListener("keydown", onKey, true);
  }

  window.JarvisCalFile = { init: init, open: open };
})();
