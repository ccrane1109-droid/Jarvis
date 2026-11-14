# JARVIS server (Firebase Cloud Functions) — optional

The server does three things: it stores and times **Reminders**, it sends
**phone notifications**, and it holds the connection to your **Shopify store**
(Business tab). Nothing else in JARVIS needs it. It holds the notification keys
as Firebase secrets, and your Shopify credentials in a part of the database
browsers cannot read, so none of them reach a browser or this repo:

| Function | What it does | Costs money? |
|---|---|---|
| `reminders` | Reminders: create, edit, delete, turn on or off, time zone and quiet hours (Habits → Reminders). Stores them and works out when each is next due, daylight saving included. Also what you do about each one: mark it done, skip it, snooze it, undo that, and the recent history | Nothing beyond free-tier Firestore |
| `notifications` | Phone notifications: remembers which phones you turned notifications on for, and sends the "Send a test now" and "Test in 90 seconds" messages | Nothing (free push services from Apple, Google, Mozilla and Microsoft) |
| `shopify` | Business tab → Shopify store: connect, check, disconnect. Exchanges your app's Client ID and Client Secret for a short-lived access token, reads the store's name to prove it works, and keeps the credentials server-side. Also reads the last 30 days of orders (name, time, total, whether cancelled or a test) to total them for the Sales snapshot. Reads no customer details, stores no orders, and writes nothing to the store | Nothing (Shopify doesn't charge for these calls; Firebase's free tier covers it) |
| `reminderTick` | Runs **every minute** (Cloud Scheduler). Finds reminders that are due, records each one once, and sends it to your phones. Reminders more than 30 minutes late are marked missed, not sent | Free tier covers it; see "Reminder delivery" below |

## One-time setup

There are two separate pieces.

### A. Firestore rules (free, no command line, about 2 minutes)

The rules let your signed-in account read and write its own data (account sync,
the cloud backup) and keep Reminders and the phone-notification records
writable only by the server. Works on the free plan. Publishing them replaces
the project's whole rules file, so check it first if other apps use this
Firebase project.

1. Open `firestore.rules` in this GitHub repo and copy all of it.
2. Firebase console → project **jarvis-f01e7** → Firestore Database → **Rules**.
3. Replace everything in the editor with what you copied, then **Publish**.

These rules keep the existing `users/{uid}` rule JARVIS's sync already uses.
Only your signed-in account can read your data. Three rules for the removed
Marketing section (`marketing`, `marketingIdeas`, `marketingFindings`) are kept
for now so JARVIS's one-time "Erase the data from the removed sections?"
question can delete those documents from your account; once you have answered
it on every device you use, you can delete those three rules.

### B. The server (Cloud Functions)

Needed for Reminders and phone notifications. (The Firebase SDK reports
"internal" when no usable response comes back, which is what happens when the
functions aren't deployed.)

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
3. **Notification keys.** Reminders and phone notifications use the key pair
   made in B2 below; there is nothing else to enter here.
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

- Firebase console → Functions should list `reminders`, `notifications` and
  `reminderTick`. Cloud Scheduler (Google Cloud console) should show the job
  for `reminderTick`.
- In JARVIS: Habits → Reminders → the notification tests ("Send a test now").
- If a row shows "unexpected error (reference abc123ef)", search for that
  reference in Firebase console → Functions → Logs.

### D. If you used the removed Marketing section: clean up the server side

JARVIS can erase what the removed sections saved on your phone and in your
account (it asks once, and only erases if you tap "Erase permanently"). It
cannot touch what was set up on the Firebase side. These steps are optional and
free; do them if you want that gone too. They are done in the Firebase / Google
Cloud console, or with the same Cloud Shell as above.

1. **Delete the old functions.** Firebase console → Functions → delete
   `marketingStatus`, `insightRequest`, `runResearch`, `researchNiche`,
   `marketingLibrary`, `dailyResearch` and `generateIdeas`. (The next
   `npx firebase-tools deploy --only functions` should also offer to delete
   functions that are no longer in the code; I haven't run it against your
   project, so check the list it shows before you confirm.) Deleting
   `dailyResearch` also removes its Cloud Scheduler job, so it stops running.
2. **Delete the old secrets** `INSIGHTSOCIAL_API_KEY` and `ANTHROPIC_API_KEY`:
   Google Cloud console → Secret Manager. (If you unsubscribed from InsightSocial,
   its key no longer does anything either way.)
3. **Delete the research records the old server saved.** These were written only
   by the server, so the app is not allowed to erase them: Firebase console →
   Firestore Database → `users` → your user → delete the collections
   `marketingSnapshots`, `marketingState`, `marketingUsage`, `marketingCache`
   and `marketingPosts`. The JARVIS question lists these when it finishes.

### E. Connect your Shopify store (Business tab)

Shopify doesn't let a web page call its Admin API (browsers are refused), and it no
longer shows a permanent token for new apps, so JARVIS connects through this server
using a small app you create in your own Shopify account. Facts below are from
Shopify's documentation (shopify.dev → "Access tokens", "Create apps using the Dev
Dashboard"); I have tested JARVIS against a stand-in for Shopify, not against your
store, and Shopify's screens may be worded a little differently from what's written here.

1. **Deploy the update** (once, from Cloud Shell, as in "After an update" below). This
   adds the `shopify` function. Until you do, the Business tab says the server doesn't
   have the Shopify feature yet.
2. **Create the app in Shopify.** Shopify admin → Settings → Apps → Develop apps →
   **Build apps in Dev Dashboard** (this opens dev.shopify.com, signed in as you).
   Create an app, name it (for example "JARVIS"), then create a **version** of it:
   - choose the Admin API access scopes. Pick **read-only** ones only (names that start
     with `read_`). Choose `read_orders` (needed for the Sales snapshot) and, if you like,
     `read_products` (not used yet). Scopes can be changed later by releasing a new version
     and approving it in Shopify; JARVIS asks Shopify for a fresh token when it finds
     `read_orders` missing, so you shouldn't need to reconnect after adding it.
   - **Release** the version.
3. **Install the app on your store** (the app page → Installs → Install app → pick your store).
   The app and the store must belong to the same Shopify organization, which they will if you
   made the app while logged into your own account. (Shopify refuses with
   `shop_not_permitted` otherwise.)
4. **Copy the Client ID and the Client Secret** from the app's Settings in the Dev Dashboard
   (Shopify's guide says you get them once a version is released).
5. **In JARVIS**: Business → Shopify store → enter your store's address (the
   `your-store.myshopify.com` one; not your own website's address), the Client ID and the
   Client Secret, then **Connect**. JARVIS shows the store's name, its address and the
   permissions Shopify granted, and says whether they are all read-only.

Where the credentials live: `users/{yourUid}/shopify/connection`, which the security rules close
to browsers completely (`allow read, write: if false`); only this server can read it. The page never
receives the Client Secret or the access token back, they aren't logged, and they aren't copied
into error messages. They are stored as plain fields in that document (Google encrypts Firestore at
rest), not in Secret Manager, because you enter them in the app rather than from this terminal.

**Disconnect** in JARVIS deletes the saved credentials and token from the database. It does not
remove the app from your store: to cut off access completely, also uninstall the app (or delete
it) in Shopify. If you ever think the Client Secret was exposed, rotate it in the Dev Dashboard and
reconnect.

**Sales snapshot** (Business tab, under the store card). Orders and totals for Today, the last 7 days
and the last 30 days, plus your latest orders, read from Shopify when you open the tab (and when you tap
Refresh; the figures are kept in memory for five minutes, never saved in the browser or the database).
How it counts, so you can check it against Shopify's own reports:
- Days are calendar days in your phone's time zone; "last 7 days" and "last 30 days" include today.
- Each order's amount is its current total price in the store's currency as Shopify reports it (so it
  reflects returns and edits, and includes whatever Shopify includes in an order total, such as shipping
  and tax). Nothing is converted. If orders come in more than one currency they are not added together.
- Cancelled orders and test orders are left out and counted on the screen.
- It reads newest first and stops once it passes 30 days back, up to 1,000 orders. If a store has more
  recent orders than that, the screen says "at least" instead of showing a partial total as complete.
- It never looks further back than 30 days: Shopify's default `read_orders` permission only covers the
  last 60 days (per Shopify's documentation), and reaching further needs an extra approval.
- If anything in Shopify's answer isn't what JARVIS expects (a missing time or total, orders not newest
  first), it shows an error and counts nothing; it never fills in a zero.
Not yet verified: this has been tested against a stand-in for Shopify. The exact field names it asks
for (name, createdAt, cancelledAt, test, currentTotalPriceSet, and the orders query's sort and paging
options) come from my knowledge of Shopify's Admin API; I couldn't open Shopify's reference pages from
the environment I built this in. If Shopify rejects one, the Business tab shows Shopify's own message.

The access token lasts about a day (Shopify's figure for this kind of app); the server asks for a
new one automatically when the old one is close to running out.

## Changing things later

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
  adds one job (`reminderTick`). When nothing is due the
  tick makes two empty database queries a minute, which Firestore counts as
  about one read each: roughly 2,900 reads a day against the 50,000 a day the
  free tier lists.
- **Answering a reminder.** Tapping a notification opens JARVIS on that reminder's
  options (iPhone web notifications can't carry Done or Snooze buttons on the
  lock screen, as far as I can tell; I haven't confirmed this on your phone).
  **Done** and **Skip** record your answer on the reminder's record
  (`outcome`: `done` or `skipped`, with `outcomeAt`). **Snooze** (5, 10, 15, 30
  minutes or 1 hour; up to 6 times) puts the same record back in the delivery
  queue for that time, so the next once-a-minute run sends it again and the new
  notification replaces the old one. Marking a reminder done *before* its time
  writes its record in advance as `cancelled`, so it doesn't go off; undoing that
  while the time is still ahead removes the record. **Only a tap from you ever
  sets an answer. Nothing on the server does, and medication is no exception.**
  Today's progress (done out of everything you didn't skip) and the "still open"
  list are worked out from these records by `functions/lib/reminder-events.js`,
  the same file the page uses, with no Claude calls. Records are kept; nothing
  deletes them yet (about 20 a day at most).
- The Shopify connection is stored at `users/{yourUid}/shopify/connection`, written and read only by the server.
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
  already exist.)
- Rotate the notification keys: see B2 (`--force-new`), then redeploy. Every phone then needs to turn notifications on again.
- Tests: `cd functions && npm test` (uses fakes; no real calls).
