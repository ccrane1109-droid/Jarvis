# Video Lab (Marketing > Video Lab)

Follows each Gratiel video through **PLAN, EVALUATE, PUBLISH, MEASURE, DIAGNOSE, IMPROVE, LEARN**. This file is the plan of record: what exists, what does not, how the pieces connect, and which facts about the platforms are verified and which are not.

## What exists now (step 1: foundation)

- **Marketing > Video Lab** tab: a Library of videos, an Add/Edit form, Campaigns, search and filters, delete with Undo.
- A video is **one post on one platform** (Instagram Reels, TikTok, YouTube Shorts). The same piece of work posted on three platforms is three videos sharing a `workId` (and an `ideaId` when it came from the Idea Library), because each platform reports its own numbers.
- **Add to Video Lab** on an idea in Marketing > Saved Library opens the form filled from the idea. Ideas are linked by id, never copied.
- **Content pillars are read from Marketing > Settings** (`JarvisContentIntel.getPillars()`), never written. A video needs a main pillar from that list. A pillar that is later renamed does not make an existing video uneditable.
- Code: `js/video-intel-logic.js` (pure rules, tested in Node), `js/video-intel-ui.js` (screens). Tests: `functions/test/video-intel-logic.test.js`, `functions/test/video-intel-backup.test.js`, and the browser tests/audits (`vl-test`, `vl-axe`).

Not built yet: evaluations, results entry, retention graph, diagnosis, reports, improvement engine, learning, dashboard comparisons, platform connectors. Nothing on screen pretends to be them.

## Storage and backup

One key, `jarvisVideoIntel`, in the **merge-based cloud backup** (`js/backup-logic.js` BACKUP_KEYS + `mergeVideoIntel`), not in the older shared document (which replaces a whole key, shares a ~1 MiB cap and fails silently).

```
{ version, settings,
  videos[], campaigns[],                       // used now
  evaluations[], snapshots[], curves[], reports[], experiments[], recommendations[]   // empty until their step exists
}
```

- Every record has a string `id` and numeric `createdAt` / `updatedAt` (ms). Lists merge **by id**; the newer `updatedAt` wins, this device's on a tie; records from both devices are kept.
- **Deleting is a tombstone** (`deletedAt` set, `updatedAt` bumped), so a delete reaches other devices and an undo wins over it. Tombstones are dropped after 90 days, with anything that belonged to the deleted video.
- Unknown lists/fields from a newer version of the app are kept, not dropped.
- Unknown values are empty (`null`/`""`), never `0`.

## How an evaluation will connect to published analytics (design, not built)

1. A video record exists from the moment it is planned. Its `id` never changes.
2. An **evaluation** (`evaluations[]`, `videoId`) is appended, never edited. It stores the video's script/hook/structure at that time, the AI ratings (labelled as predictions, with model and prompt version), and, separately, any rating the owner overrides.
3. When the video is published the owner adds `publishedDate`, `publishedTime` and the post link (`url`, with `platformKey` parsed from the link where the platform puts an id in it).
4. **Result snapshots** (`snapshots[]`, `videoId`, `collectedAt`, `source`: manual | import | api) record whatever numbers are known at that moment. Age = days since `publishedDate`, so comparisons use snapshots taken at the same age.
5. **Retention curves** (`curves[]`) hold timestamp points with their source and resolution.
6. A **report** (`reports[]`) cites the evaluation id and snapshot ids it was built from, so the original prediction and the observed result are both kept and compared, never overwritten.

## Platform data: what is verified and what is not

These notes come from searching the platforms' own documentation. **This session could not fetch the developer sites directly** (network policy), so what follows is from search excerpts of the official pages, not full reads. Re-verify each point against the full page before building a connector.

| Platform | Verified (official page excerpts) | Not verified |
|---|---|---|
| YouTube | An audience-retention report exists: dimension `elapsedVideoTimeRatio` (100 points per video, 0.01 to 1.0), metrics `audienceWatchRatio` (can exceed 1) and `relativeRetentionPerformance`; one video per query. In Testing status for an external app, refresh tokens expire after 7 days. | Behaviour for Shorts specifically; OAuth scope classification and verification needs; the Analytics API's default quota. |
| Instagram | Reels media insights documented: `views`, `reach`, `saved`, `shares`, `total_interactions`, `ig_reels_avg_watch_time`; `ig_reels_video_view_total_time` is marked in development; a Reels skip-rate metric (first 3 seconds) was added in December 2025. Data can lag up to 48 hours. Long-lived tokens last 60 days and can be refreshed after 24 hours. No per-second retention curve was found in the documented list (not confirmed absent). | Account requirements; App Review / access level for reading your own account; whether the metric names above apply to your account type. |
| TikTok | Display API v2 `/v2/video/list/` returns the account owner's public videos, newest first; scopes `video.list` and `user.info.basic`; the app needs Login Kit and Display API products approved; TikTok says apps still in development will not be approved. | The full field list (likes, comments, shares); review timing; any official API returning watch time or retention for an organic account (third-party sites mention one; eligibility unverified); what Studio's data export contains. |

Consequence: **manual entry is a full path**, not a fallback. Connectors only automate typing, so they come last, and each stays marked "not connected" until built and tested against a real account. No API key goes in the browser: platform tokens would be exchanged and stored server-side.

## Build order (each step tested and audited before the next)

1. Foundation (this step).
2. Evaluation: transparent script checks (local, free) and, only when a Claude key is set on the Marketing server, AI ratings through a new server function that reuses the existing key handling and monthly budget guard. Labelled as predictions; the owner can override.
3. Manual results entry with a collection time on every number; reminders to collect at about 24 hours, 3 days and 7 days.
4. Retention graph and drop-off diagnosis: hypotheses with evidence and confidence, never a single "cause".
5. Performance report: prediction versus result, both preserved.
6. Improvement engine: top three changes to test, revised scripts, save as task or idea.
7. Learning: patterns only after enough comparable videos (grouped by platform, length, age), labelled as correlations.
8. Dashboard comparisons and filters.
9. Connectors: YouTube first, then Instagram, then TikTok.

## Cost

Steps 1, 3, 4 (rule-based), 5 (rule-based), 7 and 8 add no running cost. AI ratings (step 2, and AI-written revisions in step 6) need a Claude API key on the Marketing server: by the prices in `functions/lib/idea-spec.js`, roughly a few cents per call on the default model, drawn from the existing monthly AI budget and refused when it would exceed it. These are estimates; the app shows the cost before each call. OpenAI is not wired in; adding it would need a second server path and verified prices.
