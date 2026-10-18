# JARVIS server (Firebase Cloud Functions) — optional

Marketing works without this server: competitors, hand-logged competitor
numbers, research notes, the idea library and settings are saved in the
`jarvisMarketing` key, which JARVIS's normal account sync already stores in
`users/{uid}`. The server adds the features that need API keys, and holds
those keys as Firebase secrets so they never reach a browser or this repo:

| Function | What it does | Costs money? |
|---|---|---|
| `marketingStatus` | Server/key status, this month's usage and budget, last research run | No |
| `insightRequest` | Allow-listed InsightSocial lookups (profiles cached 12h, searches 20h), capped monthly | InsightSocial credits, only on a fresh request |
| `researchNiche` | "Research My Niche": a **quick refresh** (3 TikTok keywords that rotate day by day, 30 credits) or a **full sweep** (up to 7 TikTok keywords + 3 Instagram hashtags, up to 220 credits; suggested once a week). Both are limited per run and per month, and the posts found are saved to your research library | InsightSocial credits, only for searches not already saved in the last 20 hours |
| `reminders` | Reminders: create, edit, delete, turn on or off, time zone and quiet hours (Habits → Reminders). Stores them and works out when each is next due, daylight saving included | Nothing beyond free-tier Firestore |
| `notifications` | Phone notifications: remembers which phones you turned notifications on for, and sends the "Send a test now" and "Test in 90 seconds" messages | Nothing (free push services from Apple, Google, Mozilla and Microsoft) |
| `reminderTick` | Runs **every minute** (Cloud Scheduler). Finds reminders that are due, records each one once, and sends it to your phones. Reminders more than 30 minutes late are marked missed, not sent | Free tier covers it; see "Reminder delivery" below |
| `marketingLibrary` | Reads your research library (every post past runs found) and bookmarks posts | No |
| `runResearch` | "Run research now": refreshes every watchlist handle (at most once per 30 min) | InsightSocial credits (1 request per handle) |
| `dailyResearch` | Same as above, automatically every day at 08:00 New York time | InsightSocial credits (1 request per handle) |
| `generateIdeas` | Content ideas from Claude, using your saved research | Claude API tokens, blocked when the AI budget would be exceeded |

## One-time setup

There are two separate pieces. The app's **Server Health** card (Marketing →
Overview) tells you which one is missing.

### A. Firestore rules (optional; free, no command line, about 2 minutes)

Not needed for Research My Niche, search results, or the credit caps: the app
sends your saved settings and niche with each server call, and results come
back through the server. The rules are only needed for the competitor
snapshot history and run list that the Competitors/Research tabs read straight
from Firestore, and they fix "Firestore blocked this". Works on the free plan.
Publishing them replaces the project's whole rules file, so check it first if
other apps use this Firebase project.

1. Open `firestore.rules` in this GitHub repo and copy all of it.
2. Firebase console → project **jarvis-f01e7** → Firestore Database → **Rules**.
3. Replace everything in the editor with what you copied, then **Publish**.

These rules keep the existing `users/{uid}` rule JARVIS's sync already uses
and add the Marketing documents underneath it. Only your signed-in account can
read your data; usage, cache, snapshots and run history can only be written by
the server.

### B. Marketing server (Cloud Functions)

Fixes "Couldn't get a response from the Marketing server" (the Firebase SDK
reports this as `internal` when no usable response comes back, which is what
happens when the functions aren't deployed).

1. **Blaze plan**: Firebase console → ⚙ → Usage and billing. Cloud Functions,
   scheduled functions and secrets require it. Set a budget alert in Google
   Cloud Billing first. These Google charges are separate from the $20 budget
   the app tracks.
2. **Open a terminal.** From any browser, including an iPhone or iPad, open
   Google Cloud Shell at shell.cloud.google.com (or use a computer with
   Node.js 22). Then:
   ```
   git clone https://github.com/ccrane1109-droid/Jarvis.git
   cd Jarvis/functions && npm ci && cd ..
   npx firebase-tools login --no-localhost
   npx firebase-tools use jarvis-f01e7
   ```
3. **Store the keys as secrets** (paste each when prompted; it isn't echoed):
   ```
   npx firebase-tools functions:secrets:set INSIGHTSOCIAL_API_KEY
   npx firebase-tools functions:secrets:set ANTHROPIC_API_KEY
   ```
   No Claude API key yet? Enter `none` for `ANTHROPIC_API_KEY`. Everything
   except idea generation works, and the app says the key isn't set.
   Claude API keys come from console.anthropic.com and are billed separately
   from a Claude.ai subscription.
4. **Deploy** (you'll be asked for `OWNER_UID`: copy your user's UID from
   Firebase console → Authentication → Users):
   ```
   npx firebase-tools deploy --only functions
   ```
   The first deploy can take several minutes while Google turns on the
   services it needs. It also asks how many days to keep old container
   images; the default of 1 keeps storage costs lowest. (To publish the
   rules from step A in the same command, use `--only functions,firestore:rules`.)

### B2. Notification keys (once, before the first deploy that includes reminders)

Phone notifications need a key pair that identifies your server to Apple's
(and other) push services. The private half is a Firebase secret; the public
half goes to the phone. One command makes both and stores them. It never
prints them, never overwrites existing ones, and doesn't ask you to paste
anything:

```
cd ~/Jarvis/functions && node scripts/setup-vapid.js && cd ..
```

Run it after `npm ci` and `firebase use` (steps above) and **before**
`npx firebase-tools deploy --only functions`, because the deploy attaches the
secrets. If it says the keys already exist, that's fine: leave them. Replacing
them (`node scripts/setup-vapid.js --force-new`) makes every phone turn
notifications on again.

### C. Check it worked

- Firebase console → Functions should list `marketingStatus`,
  `insightRequest`, `runResearch`, `researchNiche`, `marketingLibrary`,
  `reminders`, `notifications`, `reminderTick`, `dailyResearch` and
  `generateIdeas`. Cloud Scheduler (Google Cloud console) should show the jobs
  for `dailyResearch` and `reminderTick`.
- In JARVIS: Marketing → Overview → Server Health → **Check again**. Every row
  should say OK.
- If a row shows "unexpected error (reference abc123ef)", search for that
  reference in Firebase console → Functions → Logs.

## Changing things later

- Budget, InsightSocial plan price, monthly credit cap, credits per niche
  research run, AI model, brand profile, content pillars and the competitor
  watchlist are edited in the app (Marketing → Settings / Competitors). The app
  sends them with its server calls and the server keeps a clamped copy in
  `users/{yourUid}/marketing/settings`, which the daily run and the credit caps
  use. Niche research results are stored at
  `users/{yourUid}/marketingState/niche`, and the research library (one
  document per post, written only by the server) at
  `users/{yourUid}/marketingPosts`. The library keeps up to 1,000 posts: past
  that, the least recently seen posts that aren't bookmarked are removed.
  Each research run also compares InsightSocial's reported balance with the
  cost its searches reported and flags any difference (Marketing → Research
  History).
- Reminders are stored at `users/{yourUid}/reminders` (one document each) and
  `users/{yourUid}/reminderSettings/main`, written only by the server. Each
  reminder keeps its own time zone and a `nextFireAt` moment (empty while it is
  turned off). Time-zone math uses the `luxon` package (pinned to an exact
  version); a time that doesn't exist when clocks spring forward fires shifted
  forward by the gap, and a time that happens twice when clocks fall back fires
  once.
- **Reminder delivery.** `reminderTick` runs every minute. Each run (1) claims
  the reminders whose moment has arrived in one database transaction that also
  writes a record named after the reminder and the exact moment, so two runs,
  a retry or a crash cannot create two notifications for one moment, then
  (2) sends the records that are due to your phones, with a short lease so
  another run leaves them alone. A failed send is retried after 2 minutes, up
  to 3 attempts. The record's status is `sent` (a push service accepted it),
  `missed` (over 30 minutes late), `failed` or `no-device`. **`sent` means a
  push service accepted the message. It can't show whether the phone then
  displayed it**; only the phone can show that, which is what the in-app tests
  are for. Without the notification keys the tick does nothing and leaves the
  reminders' moments untouched.
  Cloud Scheduler allows a small number of jobs free per account (3 is what the
  documentation lists; I couldn't confirm whether that is per billing account
  or per project) and about $0.10 per month for each job beyond that. JARVIS
  adds two jobs (`dailyResearch`, `reminderTick`). When nothing is due the
  tick makes two empty database queries a minute, which Firestore counts as
  about one read each: roughly 2,900 reads a day against the 50,000 a day the
  free tier lists.
- Phone subscriptions, reminder records and reminder bookkeeping are stored at
  `users/{yourUid}/pushSubscriptions`, `reminderEvents` and `reminderState`,
  written only by the server and not readable from a browser. A phone's push
  address never leaves the server.
- **After an update to this folder**, redeploy from Cloud Shell (the app
  itself updates automatically; the server doesn't):
  ```
  cd ~/Jarvis && git checkout main && git pull
  cd functions && npm ci && cd ..
  node functions/scripts/setup-vapid.js
  npx firebase-tools deploy --only functions
  ```
  (`setup-vapid.js` is safe to run every time: it does nothing if the keys
  already exist.) The Niche tab says when the server needs this ("needs the latest update").
- Rotate a key: rerun step 3 for that secret, then redeploy.
- Tests: `cd functions && npm test` (uses fakes; no real calls).
