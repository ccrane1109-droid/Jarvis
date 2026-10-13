# JARVIS server (Firebase Cloud Functions)

Holds the InsightSocial API key as a Firebase secret and answers only the
owner's signed-in account. The website (GitHub Pages) calls these functions;
the key never reaches the browser or this repo.

| Function | What it does | Spends credits? |
|---|---|---|
| `marketingStatus` | Server/key status and this month's usage | No |
| `insightRequest` | Allow-listed InsightSocial lookups, cached 12h, capped monthly | Only on a fresh request |

## One-time setup

1. **Blaze plan** (Firebase console → ⚙ → Usage and billing). Cloud Functions
   and secrets require it. Set a budget alert in Google Cloud Billing first.
2. **Install Node.js 22**, then in this repo:
   ```
   npx firebase-tools login
   cd functions && npm install && cd ..
   ```
3. **Store the key as a secret** (paste it when prompted; it isn't echoed):
   ```
   npx firebase-tools functions:secrets:set INSIGHTSOCIAL_API_KEY
   ```
4. **Deploy** (you'll be asked for `OWNER_UID`: copy your user's UID from
   Firebase console → Authentication → Users):
   ```
   npx firebase-tools deploy --only functions,firestore:rules
   ```
   `firestore:rules` replaces the rules in the console with `../firestore.rules`.

## Changing things later

- Monthly credit cap: Firestore document `users/{yourUid}/marketing/settings`,
  field `monthlyCreditCap` (number). Default 1500.
- Rotate the key: rerun step 3, then redeploy.
- Tests: `cd functions && npm test` (uses fakes; no real calls).
