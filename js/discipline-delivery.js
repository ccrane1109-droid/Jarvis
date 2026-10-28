/* ==========================================================================
   JARVIS — Discipline Setup: what it can honestly say about reminders and
   notifications (pure functions, no page access, so they can be tested outside
   the browser).

   Four different things are easy to mix up, and Setup keeps them apart:
     Saved      the server confirmed it has the reminder.
     Scheduled  the server worked out when it will next send it.
     Sent       the phone maker's push service accepted it from the server.
     Delivered  it appeared on your phone. Only you can know that.
   JARVIS can see the first three, from what the server told it. It cannot see
   the fourth, so it never says "delivered" and never says a notification will
   arrive with JARVIS closed. The only evidence of that is a closed-app test
   you ran on this phone and told JARVIS the result of.

   Nothing here changes a reminder. Setup shows what exists and opens the
   Reminders screen for you to change it.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisDisciplineDelivery = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STATES = [
    { key: "saved", label: "Saved", text: "Your JARVIS server confirmed it has the reminder." },
    { key: "scheduled", label: "Scheduled", text: "The server worked out when it will send it next (shown as “Next”)." },
    { key: "sent", label: "Sent", text: "The phone maker's push service accepted it from the server. Reminders → Today lists what was sent." },
    { key: "delivered", label: "Delivered", text: "It appeared on your phone. JARVIS can't see this, only you can. The closed-app test is how you find out." }
  ];

  const ALTERNATIVE = "Until notifications work on this phone, a repeating alarm in the iPhone Clock app at the same time works without JARVIS open.";

  function norm(t) { return String(t === undefined || t === null ? "" : t).replace(/\s+/g, " ").trim().toLowerCase(); }

  function formatTime(hhmm) {
    const m = String(hhmm).match(/^(\d{2}):(\d{2})$/);
    if (!m) return String(hhmm);
    const h = Number(m[1]);
    return (h % 12 === 0 ? 12 : h % 12) + ":" + m[2] + " " + (h < 12 ? "AM" : "PM");
  }

  // The reminder with this title, or null. Matched by name, so a reminder you renamed in Reminders is not recognised.
  function matchReminder(title, reminders) {
    const want = norm(title);
    return (reminders || []).filter(function (r) { return norm(r.title) === want; })[0] || null;
  }

  // How one of Discipline's suggested reminders stands.
  //   nudge: { title, wantedTime: "HH:MM", what: "evening review time" }   reminders: the list, or null when it hasn't been loaded
  //   -> { state: "unknown" | "none" | "off" | "saved", reminder, scheduled, label, note }
  function nudgeStatus(nudge, reminders) {
    if (!Array.isArray(reminders)) return { state: "unknown", reminder: null, scheduled: false, label: "Not checked yet", note: "" };
    const r = matchReminder(nudge.title, reminders);
    if (!r) return { state: "none", reminder: null, scheduled: false, label: "Not set up", note: "" };
    if (!r.enabled) return { state: "off", reminder: r, scheduled: false, label: "Saved, turned off", note: "It won't send anything until you turn it on in Reminders." };
    const times = r.schedule && Array.isArray(r.schedule.times) ? r.schedule.times : [];
    const mismatch = !!nudge.wantedTime && times.length > 0 && times.indexOf(nudge.wantedTime) === -1;
    const note = mismatch ? "Saved for " + times.map(formatTime).join(" and ") + ", but your " + nudge.what + " is " + formatTime(nudge.wantedTime) + ". Edit the reminder if you want them to match." : "";
    return { state: "saved", reminder: r, scheduled: !!r.nextFireAt, label: r.nextFireAt ? "Saved and scheduled" : "Saved", note: note, mismatch: mismatch };
  }

  // Which words and which badge for this phone's notification state. snap is JarvisReminders.snapshot().push plus signedIn.
  //   fmt turns an ISO time into text for the person ("Oct 28, 8:30 PM").
  //   -> { cls: "ok" | "off" | "bad", icon, label, text, canTest, alternative }
  function pushStatus(snap, fmt) {
    const show = typeof fmt === "function" ? fmt : function (iso) { return iso; };
    const mode = snap.signedIn === false ? "signed-out" : snap.push.mode;
    const out = function (cls, icon, label, text, canTest) { return { cls: cls, icon: icon, label: label, text: text, canTest: !!canTest, alternative: canTest ? "" : ALTERNATIVE }; };
    if (mode === "signed-out") return out("off", "⊘", "Signed out", "Reminders and phone notifications need your JARVIS account. Sign in first.");
    if (mode === "needs-home-screen") return out("off", "⊘", "Needs the Home Screen", "iPhone only allows notifications for web apps that were added to the Home Screen. It won't work from a Safari tab. Reminders has the steps.");
    if (mode === "unsupported") return out("off", "⊘", "Not supported here", "This browser can't receive notifications from JARVIS.");
    if (mode === "denied") return out("bad", "✕", "Blocked", "Notifications are blocked for JARVIS on this phone. In the iPhone's Settings app, find JARVIS under Notifications and allow them.");
    if (mode === "keys-missing") return out("off", "⊘", "Server setup needed", "Your JARVIS server doesn't have its notification keys yet. That's a one-time setup step (it's written in functions/README.md).");
    if (mode === "on") {
      const c = snap.push.check;
      const closed = !c
        ? "Whether notifications reach a locked phone with JARVIS closed hasn't been tested on this phone."
        : c.result === "arrived"
          ? "You reported on " + show(c.at) + " that a closed-app test arrived."
          : "You reported on " + show(c.at) + " that a closed-app test did not arrive. Check Settings → Notifications → JARVIS, Focus modes and Low Power Mode, then test again.";
      return out("ok", "✓", "On for this phone", "This phone is registered with your server. " + closed, true);
    }
    return out("off", "⊘", "Not on yet", "Turn notifications on once in Reminders. iPhone will ask you to allow them.");
  }

  // How fresh the list of saved reminders is, in words. Setup reads a copy kept on the phone, not the server.
  function freshness(snap, fmt) {
    const show = typeof fmt === "function" ? fmt : function (iso) { return iso; };
    if (!snap.available) return "Reminders aren't available in this version.";
    if (!snap.signedIn) return "Sign in to see your reminders.";
    if (snap.error) return snap.error + (snap.loaded || snap.cachedAt ? " What's shown is from the last time it loaded." : "");
    if (snap.loaded && !snap.fromCache) return "Checked with your server since JARVIS was opened.";
    if (snap.cachedAt) return "From the copy saved on this phone on " + show(snap.cachedAt) + ". Tap “Check now” to ask your server again.";
    return "Not checked yet. Tap “Check now” to ask your server what you have saved.";
  }

  // Is the time zone the reminders use the one the phone is in? -> "" or a sentence.
  function zoneNote(snap) {
    const used = snap.settings && snap.settings.timezone;
    if (!used || !snap.deviceZone || used === snap.deviceZone) return "";
    return "Your reminders run on " + used.replace(/_/g, " ") + " time, but this phone is in " + snap.deviceZone.replace(/_/g, " ") + ". Change it in Reminders → Settings if you've moved.";
  }

  return { STATES: STATES, ALTERNATIVE: ALTERNATIVE, norm: norm, formatTime: formatTime, matchReminder: matchReminder, nudgeStatus: nudgeStatus, pushStatus: pushStatus, freshness: freshness, zoneNote: zoneNote };
});
