# Google Calendar and JARVIS: status and design

**Status: not connected.** Nothing in JARVIS talks to Google today. The calendar works fully without it.
What exists now:

- **Calendar files (.ics)**, in Calendar settings › *Google Calendar and calendar files*. Export your events as a file, or read
  events from a file, with no account or key. It moves events once; it is not a sync. See "What works today" below.
- **`functions/lib/gcal-sync.js`**, the rules for a future sync (how events turn into Google's shape and back, what to send, what
  to pull, what happens when both sides changed). It is **not connected to anything**, and its tests use payloads written by hand
  to match Google's documentation, not real answers from Google.

What does **not** exist: signing in to Google, any server code that calls Google, any stored Google credential. Building those
needs things only you can provide (below), and I could not test them without your Google account.

## What works today: calendar files

- **Take events out:** Calendar settings › Google Calendar and calendar files › *Download .ics file*. Includes repeats, skipped
  days and reminders. Google accepts import files up to 1 MB; the screen warns when the file is bigger.
- **Bring events in:** *Choose an .ics file*. You see what would be added, what is already here and what is skipped or changed
  (and why) before anything happens. Nothing is added until you press **Add**; **Undo** takes it back. Importing the same file again
  adds nothing twice.
- **Moving between Google and JARVIS (Google's own steps, from its help pages):**
  - *Google to JARVIS:* Google Calendar on a computer › Settings › Import & export › Export. It downloads a .zip; open it and use
    the .ics for the calendar you want.
  - *JARVIS to Google:* Google Calendar on a computer › Settings › Import & export › pick the file, pick the calendar, press Import.
- **Limits, stated plainly:** one-time moves only (later changes don't follow). Not imported: to-dos, one changed showing of a
  repeating event, repeats more detailed than daily/weekly/monthly/yearly (those come in once, with a note). Checked against
  JARVIS's own files and hand-written files; **not** checked against a file from Google, Apple or Outlook, and not against Google's
  importer. Downloads were tested in Chromium only, not on an iPhone.

## What has been verified, and where

Read from Google's pages while preparing this (links are the pages the answers came from):

| Fact | Source |
|---|---|
| An app with an **External** user type and **Testing** publishing status gets refresh tokens that **expire after 7 days**, unless it asks only for name/email/profile. Moving to **In production** stops that. Testing is limited to 100 test users. | [Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en), [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) |
| Production use of sensitive or restricted scopes usually needs Google's verification. | same pages |
| A refresh token left unused for a long time (typically six months) can stop working; there is a limit of 100 refresh tokens per account per OAuth client, and a new one silently invalidates the oldest. | [Using OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) and the pages above |
| **Incremental sync:** the sync token comes only on the **last page**; a `410 Gone` means wipe and do a full sync (reasons `fullSyncRequired`, `updatedMinTooLongAgo`; `deleted` needs nothing); the token can't be combined with `timeMin`, `timeMax`, `updatedMin`, `q`. | [Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync), [Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors) |
| Timed events use `start.dateTime`/`end.dateTime`; all-day events use `start.date`/`end.date`. A repeating event has `recurrence`; changed or cancelled showings are separate items with `recurringEventId` and `originalStartTime`, and a cancelled one has `status: "cancelled"`. | [Recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents), [Events: instances](https://developers.google.com/workspace/calendar/api/v3/reference/events/instances) |
| Custom event ids may use only lowercase `a`–`v` and digits `0`–`9`, 5 to 1024 characters; Google warns a collision may not be caught at creation. | Google's client-library reference for the Event resource |
| Reminders are an object with `useDefault` and `overrides` (`method`, `minutes`). | [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events) |
| Scopes: `calendar.app.created` lets an app make secondary calendars and manage events on them only; `calendar.events` covers events on all the user's calendars. Google says to choose the narrowest scope. | [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth) |
| **Push channels** (watch) need an HTTPS endpoint, expire (default 7 days) and must be renewed by hand. | [Push notifications](https://developers.google.com/workspace/calendar/api/guides/push) |
| **Cost and quota:** standard use is free; the daily threshold is 1,000,000 requests per project (not raisable), 10,000 per minute per project, 600 per minute per user per project. Google says exceeding the daily threshold is planned to be charged **later in 2026**, with notice. JARVIS would use a few dozen requests a day. | [Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota) |
| Google Calendar import: Settings › Import & export; files up to 1 MB; export gives a .zip of one .ics per calendar. | [Import events](https://support.google.com/calendar/answer/37118?hl=en&co=GENIE.Platform%3DDesktop), [Export events](https://support.google.com/calendar/answer/37111?hl=en) |

### Not verified (so not relied on)

- Whether the Calendar scopes count as *sensitive* in the console (decides if production use needs verification). Check on the OAuth consent screen when setting up.
- The **service-account** route (share a calendar with a service account's email). Only community posts describe it, from 2019–2022, and none is official. It would avoid the 7-day token expiry, but it is a long-lived key on the server and events it creates are owned by the service account.
- The exact field names `updated` and `etag` on events (used in `gcal-sync.js`; I'm confident of them from the Events reference but did not re-read it here), `extendedProperties` (**not used**; the design keeps its own link table instead), and that Google's `end.date` for all-day events is exclusive (the file format's is; Google's help pages weren't checked for it). All of these should be confirmed against a real response in the first test with your account.
- The OAuth request details for a server-side app (`access_type=offline`, a consent prompt to get a refresh token, the redirect URI rules). Standard for Google web-server OAuth, but not re-read here.

## Design, if you decide to build it

**Principle:** credentials live only on the server. The browser never sees a Google token, client secret or key. The calendar keeps
working with no Google connection, and disconnecting changes nothing already in JARVIS.

```
Browser (JARVIS)                         Your server (Firebase Functions)                 Google
 owns the events and the merge            thin, signed-in-only proxy                      Calendar API v3
 runs gcal-sync.js (loaded from           holds the refresh token (server-only
   the site, as reminder-spec.js is)        collection, not readable by browsers)
        |  "status" / "connect" / "disconnect" /  |
        |  "list" / "insert|patch|delete"  ------>|  ----- access token from refresh ---->|
        |<---- results (never tokens) ------------|<--------------------------------------|
```

1. **Connect (once):** the browser asks the server for a Google consent address; you approve in Google's page; Google redirects to a
   server function with a one-time code and a `state` value that the server checks (blocks forged requests); the server exchanges
   the code for tokens and stores the refresh token in a collection browsers cannot read (the same pattern as the phone push
   subscriptions). The browser is only told "connected" or "not".
2. **Sync (when JARVIS is open, and on "Sync now"):** the browser asks the server to `list` changes since the stored sync token (or a
   full list), runs `planPull` to see what to add, change and remove here, applies those with the calendar's own rules (so Undo and the
   30-day trash keep working), then runs `planPush` and asks the server to `insert`/`patch`/`delete` at Google, then records what was done
   (`commit`). No background job and no push channel: those need an HTTPS endpoint, renewal every 7 days, and a scheduler job.
3. **Which events:** only kinds *event, block, content* and *milestone*. To-dos and reminders have no Google event kind.
4. **When both sides changed:** the newer edit wins; a deletion wins (the event stays in JARVIS's 30-day trash); every such case is
   listed for you. Modified single showings of a repeating event come in as a note, not as events.
5. **Loops:** pulled events are remembered with the time they were saved, so they are not sent straight back; events JARVIS creates
   carry an id derived from the JARVIS id (with a checksum), so a retried create can't make a second copy and Google's copy can be
   recognised.
6. **Never:** store a token in the browser, put a key in the site's files, delete a Google event without it being something you deleted,
   or send tasks. Nothing would be added, moved or deleted at Google without your having made that change in JARVIS.

### Decisions only you can make

1. **How to sign in to Google.** *OAuth (the spec's choice)*: you approve once; tokens expire every **7 days while the app is in Testing**
   (you'd reconnect weekly) or stop expiring once published, which may need Google's verification. *Service account*: no weekly
   reconnect, but unconfirmed in official docs, a long-lived key, and events owned by the service account.
2. **Which scope.** `calendar.app.created` (only a calendar JARVIS makes: narrowest, but your existing Google events would not appear)
   versus `calendar.events` (your calendars: broader, needed to see existing events). Google advises the narrowest that works.
3. **Whether to build it at all.** The file route above already moves events in and out, once.

### What you would need to do (nothing here is done)

- Create a Google Cloud project, enable the Calendar API, set up the OAuth consent screen, and create an OAuth client (a **web**
  application client) with the redirect address of the server function. Google's console wording changes, so follow its current pages.
- Add the client id and secret to the server as secrets (never to the website's files).
- Redeploy the server folder from Cloud Shell, as for the existing functions.
- Cost: the Calendar API is free at JARVIS's volume (see the table); the server runs on the same Firebase project as today's functions.

### First test with real credentials (not yet possible)

Connect; run a full sync and compare counts with Google; create, edit and delete one event on each side and watch it arrive; make a
repeating event with a skipped day and a changed showing; an all-day event and a multi-day one; a time-zone-different event; wait for
a `410` (or force a bad token) and confirm the full resync; confirm the refresh token still works after 7 days (Testing status) or note
that it doesn't; disconnect and confirm nothing in JARVIS is lost.
