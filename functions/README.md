# JARVIS server (Firebase Cloud Functions)

Holds the InsightSocial and Claude API keys as Firebase secrets and answers
only the owner's signed-in account. The website (GitHub Pages) calls these
functions; the keys never reach the browser or this repo.

| Function | What it does | Costs money? |
|---|---|---|
| `marketingStatus` | Server/key status, this month's usage and budget, last research run | No |
| `insightRequest` | Allow-listed InsightSocial lookups, cached 12h, capped monthly | InsightSocial credits, only on a fresh request |
| `runResearch` | "Run research now": refreshes every watchlist handle (at most once per 30 min) | InsightSocial credits (1 request per handle) |
| `dailyResearch` | Same as above, automatically every day at 08:00 New York time | InsightSocial credits (1 request per handle) |
| `generateIdeas` | Content ideas from Claude, using your saved research | Claude API tokens, blocked when the AI budget would be exceeded |

## One-time setup

There are two separate pieces. The app's **Server Health** card (Marketing →
Overview) tells you which one is missing.

### A. Firestore rules (free, no command line, about 2 minutes)

Fixes "Firestore blocked this" / "Firestore rules don't allow this". Works on
the free plan.

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
   npx firebase-tools deploy --only functions,firestore:rules
   ```
   The first deploy can take several minutes while Google turns on the
   services it needs. `firestore:rules` publishes `../firestore.rules` (the
   same thing as step A).

### C. Check it worked

- Firebase console → Functions should list `marketingStatus`,
  `insightRequest`, `runResearch`, `dailyResearch` and `generateIdeas`.
- In JARVIS: Marketing → Overview → Server Health → **Check again**. Every row
  should say OK.
- If a row shows "unexpected error (reference abc123ef)", search for that
  reference in Firebase console → Functions → Logs.

## Changing things later

- Budget, InsightSocial plan price, credit cap, AI model, brand profile,
  content pillars and the competitor watchlist are edited in the app
  (Marketing → Settings / Competitors). They're stored in
  `users/{yourUid}/marketing/settings`.
- Rotate a key: rerun step 3 for that secret, then redeploy.
- Tests: `cd functions && npm test` (uses fakes; no real calls).
