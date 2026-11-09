/* ==========================================================================
   JARVIS — the one-time question about the removed sections (Business, Marketing, Trading, AI Video).

   Their saved data is still stored on this phone and in your account. On the first start after the update, JARVIS looks for it
   (reading only) and, if any is there, asks whether to erase it. Nothing is erased unless the "Erase permanently" button is
   pressed. "Not now" leaves everything as it is and the question comes back the next time JARVIS starts. The rules (what is
   erased, and what never is) are in retired-data.js and its tests.

   It remembers what it finished in jarvisRetiredState (this device only), so once the phone and the account are clean it never
   asks again, and a second phone checks the account once and says nothing if there is nothing left.
   ========================================================================== */

(function () {
  "use strict";

  const R = window.JarvisRetiredData;
  let started = false, busy = false, found = null, opener = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.JarvisCore.escapeHtml(s); }
  function store() { try { return window.localStorage; } catch (e) { return null; } }
  function cloud() { return window.JarvisCloud && window.JarvisCloud.isSignedIn && window.JarvisCloud.isSignedIn() ? window.JarvisCloud : null; }

  function areasOn(local, hasConnections) {
    const keys = local ? local.keys.slice() : [];
    if (hasConnections) keys.push(R.CONNECTIONS_KEY);
    return R.areasOf(keys);
  }
  function cloudAreas(c) {
    if (!c) return [];
    const keys = c.fields.slice();
    if (c.backup) keys.push(R.BACKUP_DOC);
    const out = R.areasOf(keys);
    if (R.OWNER_COLLECTIONS.some(function (n) { return c.docs[n] && c.docs[n].length; }) && out.indexOf("Marketing") === -1) out.push("Marketing");
    return out;
  }
  function list(a) { return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }

  /* ---------------- the dialog ---------------- */

  function focusables() {
    return Array.prototype.slice.call($("rdDialog").querySelectorAll("button, [tabindex]:not([tabindex='-1'])")).filter(function (e) { return !e.disabled && e.offsetParent !== null; });
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); if (!busy) close(); return; }
    if (e.key !== "Tab") return;
    const f = focusables();
    if (!f.length) return;
    const inside = $("rdDialog").contains(document.activeElement);
    if (!inside) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
    else if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  function build() {
    if ($("rdDialog")) return;
    const o = document.createElement("div");
    o.id = "rdDialog";
    o.className = "modal-overlay rd-scope hidden";
    o.setAttribute("role", "alertdialog");
    o.setAttribute("aria-modal", "true");
    o.setAttribute("aria-labelledby", "rdTitle");
    o.setAttribute("aria-describedby", "rdBody");
    o.innerHTML = '<div class="modal-box rd-box"><h2 id="rdTitle" tabindex="-1"></h2><div id="rdBody"></div><div class="rd-actions" id="rdActions"></div></div>';
    o.addEventListener("click", onClick);
    // Tapping the dim background does nothing, and must not pull focus out of the dialog.
    o.addEventListener("mousedown", function (e) { if (e.target === o) e.preventDefault(); });
    document.body.appendChild(o);
  }
  function show(title, bodyHtml, buttons) {
    build();
    $("rdTitle").textContent = title;
    $("rdBody").innerHTML = bodyHtml;
    $("rdActions").innerHTML = buttons.map(function (b) { return '<button type="button" class="btn ' + b.cls + '" data-rd="' + b.act + '"' + (b.disabled ? " disabled" : "") + '>' + esc(b.label) + '</button>'; }).join("");
    if ($("rdDialog").classList.contains("hidden")) {
      opener = document.activeElement;
      $("rdDialog").classList.remove("hidden");
      document.body.classList.add("rd-open");
      document.addEventListener("keydown", onKey, true);
    }
    window.setTimeout(function () { $("rdTitle").focus(); }, 0);
  }
  function close() {
    const o = $("rdDialog");
    if (!o || o.classList.contains("hidden")) return;
    o.classList.add("hidden");
    document.body.classList.remove("rd-open");
    document.removeEventListener("keydown", onKey, true);
    const back = opener; opener = null;
    window.setTimeout(function () { if (back && document.body.contains(back) && typeof back.focus === "function") back.focus(); }, 0);
  }

  function askHtml() {
    const here = areasOn(found.local, found.local && found.local.connections > 0).concat(found.idb ? ["AI Video"] : []).filter(function (a, i, arr) { return arr.indexOf(a) === i; });
    const there = cloudAreas(found.cloud);
    let h = '<p>The old Business, Marketing, Trading and AI Video sections have been removed from JARVIS. What you saved in them is still stored:</p><ul class="rd-list">';
    if (here.length) h += '<li><strong>On this phone:</strong> ' + esc(list(here)) + '</li>';
    if (there.length) h += '<li><strong>In your account:</strong> ' + esc(list(there)) + '</li>';
    h += '</ul>' +
      '<p class="rd-warn"><strong>Erasing deletes it permanently, from this phone and from your account. There is no undo and no copy is kept.</strong></p>' +
      '<p>Your workouts, nutrition, habits, calendar, Discipline and every other section are not touched. Nutrition\'s AI recipe connection is kept.</p>' +
      '<p class="rd-small">If you use JARVIS on other devices, open it there after updating and this question comes up once on each. ' +
      'Research records saved by the old Marketing server can\'t be erased from the app; they are private to your account, and you can delete them in the Firebase console.</p>';
    return h;
  }
  function ask() {
    show("Erase the data from the removed sections?", askHtml(), [
      { act: "later", label: "Not now", cls: "btn-secondary" },
      { act: "erase", label: "Erase permanently", cls: "btn-danger" }
    ]);
  }

  /* ---------------- erasing ---------------- */

  function erase() {
    if (busy) return;
    busy = true;
    show("Erasing…", '<p role="status">Erasing what was saved in the removed sections. Please keep JARVIS open.</p>', [{ act: "wait", label: "Erasing…", cls: "btn-secondary", disabled: true }]);
    const st = store(), c = cloud();
    const l = R.eraseLocal(st);
    R.eraseIndexedDb(window.indexedDB).then(function (idb) {
      const cp = c ? c.eraseRetired(found.cloud && !found.cloudError ? found.cloud : undefined) : Promise.resolve(null);
      return cp.then(function (cr) { return { l: l, idb: idb, cr: cr, signedIn: !!c }; });
    }).catch(function () {
      return { l: l, idb: { ok: false, errors: ["jarvisVideoBlobs"] }, cr: { ok: false, errors: ["Couldn't erase it from your account"] }, signedIn: !!c };
    }).then(done);
  }
  function done(r) {
    busy = false;
    const st = store();
    const localOk = r.l.ok && r.idb.ok, cloudOk = r.signedIn ? !!(r.cr && r.cr.ok) : null;
    const prev = R.readState(st);
    R.writeState(st, { localDone: localOk || prev.localDone, cloudDone: cloudOk === null ? prev.cloudDone : cloudOk });
    let h = '<ul class="rd-list">';
    h += localOk ? '<li>Erased from this phone.</li>' : '<li class="rd-bad">Couldn\'t erase everything on this phone. Open JARVIS again later to retry.</li>';
    if (r.signedIn) h += cloudOk ? '<li>Erased from your account.</li>' : '<li class="rd-bad">' + esc((r.cr && r.cr.errors && r.cr.errors[0]) || "Couldn't erase it from your account") + '. Check your connection and open JARVIS again to retry.</li>';
    else h += '<li class="rd-bad">You aren\'t signed in, so your account\'s copy (if any) was not erased. Sign in and open JARVIS again to erase it.</li>';
    h += '</ul>';
    if (r.signedIn && r.cr && r.cr.ok) h += '<p class="rd-small">Not erasable from the app: research records the old Marketing server saved in your account (' + esc(r.cr.leftBehind.join(", ")) + '). They are private to you; delete them in the Firebase console if you want them gone.</p>';
    show("Done", h, [{ act: "close", label: "Close", cls: "btn-primary" }]);
  }

  function onClick(e) {
    const t = e.target.closest("[data-rd]");
    if (!t || busy) return;
    const a = t.getAttribute("data-rd");
    if (a === "erase") erase();
    else if (a === "later" || a === "close") close();
  }

  /* ---------------- start ---------------- */

  function idbPresent() {
    const idb = window.indexedDB;
    if (!idb || typeof idb.databases !== "function") return Promise.resolve(false);
    return idb.databases().then(function (dbs) { return dbs.some(function (d) { return R.INDEXEDDB_NAMES.indexOf(d.name) !== -1; }); }, function () { return false; });
  }

  // Looks (reading only) and asks only if something is there.
  function check() {
    const st = store();
    if (!R || !st) return Promise.resolve();
    const state = R.readState(st), c = cloud();
    const local = state.localDone ? null : R.scanLocal(st);
    const wantCloud = !!c && !state.cloudDone;
    return Promise.all([
      state.localDone ? Promise.resolve(false) : idbPresent(),
      wantCloud ? c.scanRetired().then(function (x) { return { cloud: x }; }, function () { return { error: true }; }) : Promise.resolve({})
    ]).then(function (res) {
      const idb = res[0], cl = res[1];
      const hasLocal = !!(local && local.any) || idb;
      const hasCloud = !!(cl.cloud && cl.cloud.any);
      found = { local: local, idb: idb, cloud: cl.cloud || null, cloudError: !!cl.error };
      if (hasLocal || hasCloud) { ask(); return; }
      // nothing to erase: remember it, but only for the parts that were actually checked
      R.writeState(st, { localDone: state.localDone || !!local || false, cloudDone: state.cloudDone || (wantCloud && !cl.error) });
    });
  }

  function init() {
    if (started || !R || !window.JarvisCore) return;
    started = true;
    check();
  }

  window.JarvisRetiredUI = { init: init, check: check };
})();
