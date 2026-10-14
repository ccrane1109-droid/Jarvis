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

1. **Blaze plan** (Firebase console → ⚙ → Usage and billing). Cloud Functions,
   scheduled functions and secrets require it. Set a budget alert in Google
   Cloud Billing first.
2. **Install Node.js 22**, then in this repo:
   ```
   npx firebase-tools login
   cd functions && npm install && cd ..
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
   `firestore:rules` replaces the rules in the console with `../firestore.rules`.

## Changing things later

- Budget, InsightSocial plan price, credit cap, AI model, brand profile,
  content pillars and the competitor watchlist are edited in the app
  (Marketing → Settings / Competitors). They're stored in
  `users/{yourUid}/marketing/settings`.
- Rotate a key: rerun step 3 for that secret, then redeploy.
- Tests: `cd functions && npm test` (uses fakes; no real calls).
