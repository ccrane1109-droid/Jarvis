/* ==========================================================================
   JARVIS — Business tab: connect your Shopify store.

   The page never talks to Shopify. It sends the store address, Client ID and Client Secret to the JARVIS server's
   `shopify` function once (functions/lib/shopify.js), and the server keeps them where browsers can't read. What
   comes back, and all this page ever shows, is the store's name and address, the permissions Shopify granted, and
   when it was last confirmed. The Client Secret is only ever held in the form field while you type it: it is
   cleared after a successful connect, never stored in the browser, and never shown again.

   Keys: none. Nothing about the store is saved in this browser (so nothing here is touched by the retired
   sections' erase, and none of it syncs through the account document).
   ========================================================================== */

(function () {
  "use strict";

  let started = false, busy = false, view = null, confirming = false, lastFocus = "";

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.JarvisCore.escapeHtml(s); }
  function cloud() { return window.JarvisCloud && window.JarvisCloud.isSignedIn && window.JarvisCloud.isSignedIn() ? window.JarvisCloud : null; }

  /* ---------------- talking to the server ---------------- */

  function call(data) {
    const c = cloud();
    if (!c) return Promise.reject(Object.assign(new Error("Sign in to JARVIS to connect your store."), { code: "functions/unauthenticated" }));
    return c.call("shopify", data, { timeout: 65000 });
  }

  // -> { text, setup }: what to tell the person, and whether it is the "server needs the update" case.
  function describeError(err) {
    const code = (err && err.code) || "";
    const message = (err && err.message) || "";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { text: "You're offline. Connect to the internet and try again." };
    if (code === "functions/unauthenticated") return { text: "Sign in to JARVIS to connect your store." };
    if (code === "functions/permission-denied") return { text: "This account isn't allowed to use the store connection." };
    if (code === "functions/not-found" && /^Shopify/.test(message)) return { text: message };
    if (code === "functions/not-found") return { text: "The JARVIS server doesn't have the Shopify feature yet. It needs the update described below.", setup: true };
    if (code === "functions/internal") {
      const ref = err.details && err.details.ref;
      if (ref) return { text: "The server hit an unexpected error (reference " + ref + "). Find that reference in Firebase console → Functions → Logs." };
      return { text: "Couldn't get an answer from the JARVIS server. Either the connection dropped, or the server hasn't been updated with the Shopify feature yet (see below).", setup: true };
    }
    if (code === "functions/invalid-argument" && /Unknown Shopify action/i.test(message)) return { text: "The JARVIS server needs its latest update before this works (see below).", setup: true };
    if (code === "functions/unavailable" && !/Shopify/.test(message)) return { text: "Couldn't reach the JARVIS server. Check your connection and try again." };
    if (code === "functions/invalid-argument" || code === "functions/failed-precondition" || code === "functions/unavailable") return { text: message };
    if (code === "functions/deadline-exceeded") return { text: "The server took too long to answer. Try again in a minute." };
    return { text: "Something went wrong" + (message ? ": " + message : ".") };
  }

  /* ---------------- pieces of the screen ---------------- */

  function when(iso) {
    const t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function steps() {
    return '<ol class="bz-steps">' +
      '<li>In your Shopify admin, open <strong>Settings → Apps → Develop apps</strong> and choose <strong>Build apps in Dev Dashboard</strong>.</li>' +
      '<li>Create an app (any name, such as JARVIS). Then create a <strong>version</strong> of it and choose its Admin API access: pick <strong>read-only</strong> permissions only (names starting with <code>read_</code>, for example <code>read_orders</code> and <code>read_products</code>). <strong>Release</strong> the version.</li>' +
      '<li>On the app’s page, <strong>install it on your store</strong>. The app and the store must belong to the same Shopify organization, which they do if you create the app while signed in to your own account.</li>' +
      '<li>In the app’s <strong>Settings</strong>, copy the <strong>Client ID</strong> and the <strong>Client Secret</strong>, and paste them below with your store’s <code>.myshopify.com</code> address.</li>' +
      '</ol>' +
      '<p class="bz-small">These steps follow Shopify’s documentation; Shopify may word its screens a little differently. Your store’s <code>.myshopify.com</code> address is the one in your admin’s web address, not your own website’s address.</p>';
  }

  function serverSetup() {
    return '<details class="bz-details" id="bzServerSetup"><summary>How to update the JARVIS server</summary>' +
      '<p>The Shopify connection runs on your JARVIS server, which has to be updated once (it isn’t part of this app’s automatic updates). In Google Cloud Shell:</p>' +
      '<pre class="bz-code">cd ~/Jarvis &amp;&amp; git checkout main &amp;&amp; git pull\ncd functions &amp;&amp; npm ci &amp;&amp; cd ..\nnpx firebase-tools deploy --only functions,firestore:rules</pre>' +
      '<p class="bz-small">The full steps are in <code>functions/README.md</code> (sections B and E) in the JARVIS repository.</p></details>';
  }

  function form(prefill) {
    const p = prefill || {};
    return '<form id="bzForm" class="bz-form" novalidate autocomplete="off">' +
      '<div class="form-row"><label for="bzShop">Store address</label>' +
      '<input type="text" id="bzShop" inputmode="url" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="your-store.myshopify.com" value="' + esc(p.shop || "") + '" aria-describedby="bzShopHint">' +
      '<p class="field-hint" id="bzShopHint">Ends in <code>.myshopify.com</code>. Pasting the web address of your Shopify admin works too.</p></div>' +
      '<div class="form-row"><label for="bzClientId">Client ID</label>' +
      '<input type="text" id="bzClientId" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + esc(p.clientId || "") + '"></div>' +
      '<div class="form-row"><label for="bzClientSecret">Client Secret</label>' +
      '<div class="bz-secret-row"><input type="text" id="bzClientSecret" class="bz-secret" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-describedby="bzSecretHint">' +
      '<button type="button" class="btn btn-secondary" id="bzShowSecret" aria-pressed="false">Show</button></div>' +
      '<p class="field-hint" id="bzSecretHint">Sent once to your JARVIS server over a secure connection and kept there. It is never saved in this browser, never shown again, and never sent anywhere except to Shopify to get access.</p></div>' +
      '<p class="bz-error hidden" id="bzError" role="alert" tabindex="-1"></p>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary" id="bzConnect">Connect store</button></div>' +
      '</form>';
  }

  function connectedCard(s) {
    const scopes = Array.isArray(s.scopes) ? s.scopes : [];
    const chips = scopes.length ? scopes.map(function (x) { return '<li class="bz-chip' + (x.indexOf("read_") === 0 ? "" : " bz-chip-warn") + '">' + esc(x) + '</li>'; }).join("") : "";
    const perms = !scopes.length
      ? '<p class="bz-small">Shopify didn’t list any permissions for this app, so JARVIS can only confirm the store’s name.</p>'
      : '<ul class="bz-chips" aria-label="Permissions Shopify granted">' + chips + '</ul>' +
        (s.readOnly
          ? '<p class="bz-small">All of these are read-only: they let the app look at your store, not change it.</p>'
          : '<p class="bz-small bz-warn"><strong>Some of these permissions can change your store</strong> (the highlighted ones). JARVIS doesn’t use them. To be safe, release a new version of the app in Shopify with read-only permissions only.</p>');
    const problem = s.problem ? '<p class="bz-error" role="alert">' + esc(s.problem) + '</p>' : "";
    const status = s.problem
      ? '<span class="bz-badge bz-badge-bad">Problem</span>'
      : '<span class="bz-badge bz-badge-ok">Connected</span>';
    const seen = s.verifiedAt ? '<p class="bz-small">Last confirmed ' + esc(when(s.verifiedAt)) + '.</p>' : "";
    const confirm = confirming
      ? '<div class="bz-confirm" role="group" aria-labelledby="bzConfirmTitle"><p id="bzConfirmTitle"><strong>Disconnect this store?</strong></p>' +
        '<p>This deletes the saved Client Secret and access token from your JARVIS server. It does not remove the app from your store; to cut off access completely, also uninstall or delete the app in Shopify.</p>' +
        '<div class="form-actions"><button type="button" class="btn btn-danger" id="bzDisconnectYes">Yes, disconnect</button><button type="button" class="btn btn-secondary" id="bzDisconnectNo">Cancel</button></div></div>'
      : '<div class="form-actions"><button type="button" class="btn btn-secondary" id="bzCheck">Check connection</button><button type="button" class="btn btn-secondary" id="bzDisconnect">Disconnect</button></div>';
    return '<div class="bz-store">' +
      '<div class="bz-store-head"><div><h3 class="bz-store-name" id="bzStoreName" tabindex="-1">' + esc(s.shopName || s.shop) + '</h3>' +
      '<p class="bz-store-shop">' + esc(s.shop) + '</p></div>' + status + '</div>' +
      problem + seen + perms + confirm + '</div>';
  }

  /* ---------------- render ---------------- */

  function setStatus(text) { const e = $("bzLive"); if (e) e.textContent = text || ""; }

  function render(opts) {
    const host = $("bzShopify");
    if (!host) return;
    const o = opts || {};
    let h = '<section class="card bz-card" aria-labelledby="bzTitle"><div class="card-title-row"><h2 class="card-title" id="bzTitle">Shopify store</h2></div>';
    if (!cloud()) {
      h += '<p>Sign in to JARVIS to connect your store. The connection is kept on your JARVIS server, which needs your account.</p>';
    } else if (view === null) {
      h += '<p role="status">' + (o.problem ? "" : "Checking…") + '</p>';
      if (o.problem) h += '<p class="bz-error" role="alert">' + esc(o.problem) + '</p><div class="form-actions"><button type="button" class="btn btn-secondary" id="bzRetry">Try again</button></div>';
      if (o.setup) h += serverSetup();
    } else if (view.connected) {
      h += connectedCard(view);
    } else {
      h += '<p>Connect your Shopify store so JARVIS can work with it. You’ll need a small read-only app from your own Shopify account; it takes about five minutes.</p>' +
        '<details class="bz-details" id="bzHow"' + (o.openSteps ? " open" : "") + '><summary>How to get the store address, Client ID and Client Secret</summary>' + steps() + '</details>' +
        form(o.prefill);
      if (o.setup) h += serverSetup();
    }
    h += '</section>';
    host.innerHTML = h;
    if (o.error) showError(o.error);
    if (lastFocus) { const f = $(lastFocus); lastFocus = ""; if (f) f.focus(); }
  }

  function showError(text) {
    const e = $("bzError");
    if (!e) return;
    e.textContent = text;
    e.classList.remove("hidden");
    e.focus();
  }

  /* ---------------- actions ---------------- */

  function load() {
    if (busy) return Promise.resolve();
    if (!cloud()) { view = null; render(); return Promise.resolve(); }
    busy = true;
    render();
    return call({ action: "status" }).then(function (s) {
      view = s && typeof s === "object" ? s : { connected: false };
      busy = false; render();
    }, function (err) {
      busy = false; view = null;
      const d = describeError(err);
      render({ problem: d.text, setup: d.setup });
    });
  }

  function connect(e) {
    e.preventDefault();
    if (busy) return;
    const data = { action: "connect", shop: $("bzShop").value, clientId: $("bzClientId").value, clientSecret: $("bzClientSecret").value };
    const btn = $("bzConnect");
    busy = true;
    btn.disabled = true; btn.textContent = "Connecting…";
    $("bzForm").setAttribute("aria-busy", "true");
    setStatus("Connecting to Shopify…");
    call(data).then(function (s) {
      busy = false;
      data.clientSecret = ""; data.clientId = "";
      view = s;
      confirming = false;
      lastFocus = "bzStoreName";
      render();
      setStatus("Connected to " + (s && (s.shopName || s.shop) || "your store") + ".");
    }, function (err) {
      busy = false;
      const d = describeError(err);
      setStatus("");
      const prefill = { shop: data.shop, clientId: data.clientId };
      const secret = data.clientSecret;
      render({ prefill: prefill, openSteps: false, setup: d.setup, error: d.text });
      const sec = $("bzClientSecret");
      if (sec) sec.value = secret;     // kept in the field so a typo can be fixed; never stored anywhere else
    });
  }

  function check() {
    if (busy) return;
    busy = true;
    const btn = $("bzCheck");
    if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    setStatus("Checking with Shopify…");
    call({ action: "check" }).then(function (s) {
      busy = false; view = s; lastFocus = "bzCheck"; render();
      setStatus(s && s.connected ? (s.problem ? "Problem: " + s.problem : "Connection confirmed.") : "Not connected.");
    }, function (err) {
      busy = false; lastFocus = "bzCheck";
      const d = describeError(err);
      render();
      cardError(d.text);
      setStatus(d.text);
    });
  }

  // an error from a failed action (the connection itself is unchanged), shown above the buttons
  function cardError(text) {
    const card = document.querySelector("#bzShopify .bz-store");
    if (!card) return;
    const p = document.createElement("p");
    p.className = "bz-error"; p.setAttribute("role", "alert"); p.textContent = text;
    card.insertBefore(p, card.querySelector(".form-actions"));
  }

  function disconnect() {
    if (busy) return;
    busy = true;
    const yes = $("bzDisconnectYes");
    if (yes) { yes.disabled = true; yes.textContent = "Disconnecting…"; }
    call({ action: "disconnect" }).then(function () {
      busy = false; view = { connected: false }; confirming = false;
      render({ openSteps: false });
      setStatus("Disconnected. The saved credentials were deleted from your JARVIS server.");
      const t = $("bzTitle"); if (t) { t.setAttribute("tabindex", "-1"); t.focus(); }
    }, function (err) {
      busy = false;
      const d = describeError(err);
      render();
      cardError("Couldn't disconnect: " + d.text);
    });
  }

  function onClick(e) {
    const t = e.target.closest("button");
    if (!t) return;
    switch (t.id) {
      case "bzCheck": check(); break;
      case "bzRetry": view = null; load(); break;
      case "bzDisconnect": confirming = true; lastFocus = "bzDisconnectNo"; render(); break;
      case "bzDisconnectNo": confirming = false; lastFocus = "bzDisconnect"; render(); break;
      case "bzDisconnectYes": disconnect(); break;
      case "bzShowSecret": {
        const f = $("bzClientSecret"), on = t.getAttribute("aria-pressed") !== "true";
        f.classList.toggle("bz-secret", !on);
        t.setAttribute("aria-pressed", on ? "true" : "false");
        t.textContent = on ? "Hide" : "Show";
        break;
      }
      default: break;
    }
  }

  /* ---------------- start ---------------- */

  function init() {
    if (started || !window.JarvisCore) return;
    const host = $("bzShopify");
    if (!host) return;
    started = true;
    host.addEventListener("click", onClick);
    host.addEventListener("submit", function (e) { if (e.target && e.target.id === "bzForm") connect(e); });
    render();
  }

  // The Business tab was opened: look at the saved connection (this doesn't call Shopify).
  function onShow() { if (started) { if (!busy) load(); } }

  window.JarvisShopify = { init: init, onShow: onShow, describeError: describeError };
})();
