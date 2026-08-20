## Bolo outage investigation - 2026-08-20

- Confirmed the local checkout has pre-existing uncommitted Cloudflare, Convex, YouTube parsing, TypeScript, lockfile, monitor-script, and billing-note changes. No source files were edited during this investigation.
- OrbStack was unavailable during the first local probe, then came up and now reports `Running`; no Bolo container image or local Bolo process is present. The deployed Cloudflare container is independent of OrbStack.
- The Cloudflare monitor log shows the original container was deleted during the June billing incident, then a replacement app (`a0396983-d385-4d65-bde7-61fe9f796ae2`) was ready with a one-instance cap from June 15 through August 20 00:18Z. Later checks fail before container inspection because Wrangler auth returns `400 Bad Request`, `fetch failed`, or `Not logged in`.
- The Convex dev deployment `shocking-bandicoot-353` responds to HTTP and `entries.listEntries` returns 50 records. The latest ready job at 2026-08-19T21:20:36Z recorded `cloudflare/succeeded` and `openrouter/succeeded`, so the pipeline and OpenRouter key worked at that time.
- Recent failed jobs are mostly YouTube download failures (`HTTP 403`, bot-check `409` asking for `YOUTUBE_COOKIES_B64`), with one explicit container-cap error and several wrapper `502` errors. This points to YouTube egress/cookie and container-cap pressure, not a currently proven expired OpenRouter key.
- Local `.env.local` contains literal `op://` references. Expo loads those references unchanged, so a plain `pnpm start` cannot construct a usable Convex endpoint until the values are resolved.
- Verification: direct Vitest passed (27 tests), TypeScript typecheck passed, Python syntax passed, and ESLint failed because the uncommitted TypeScript `7.0.1-rc` package has no exported main path for the installed ESLint config.
- Hypothesis checks: the raw `op://` Convex URL fails client construction with `Invalid deployment address`, while the known dev URL returns 50 entries; no recent record contains a missing `BOLO_*` or OpenRouter environment error; malformed-URL failures contain 59-character `v` values, while media failures contain valid 11-character IDs.
- The local Wrangler OAuth access token expired at `2026-08-20T01:18:03Z`; current `wrangler containers list` fails with invalid access token code `9109`, and the token scope list includes `containers:write`. This explains monitor/deploy failures, not the already-running Bolo runtime.
- The deployed image pins `yt-dlp==2026.3.17`, while the official release list now has `2026.08.19` with multiple YouTube player-client and extractor fixes. A local A/B test was inconclusive because this machine refused the YouTube HTTPS connection.

### Hypothesis checklist

- [x] OpenRouter key expired or missing: ruled out by a recent full success and zero OpenRouter/missing-env errors in the sampled records.
- [x] Convex deployment unavailable: ruled out by a successful HTTP query and 50 returned entries.
- [x] Cloudflare container app deleted: ruled out for the replacement app; it was `ready` and served a later successful job.
- [x] Local Wrangler permissions or login: confirmed as a separate failure; the OAuth access token expired and the API now returns code `9109`.
- [x] Local Expo bootstrap: confirmed broken when `.env.local` is used as-is because the `op://` value is rejected as a deployment address.
- [x] Bad pasted YouTube IDs: confirmed for the invalid-URL records; their `v` values are 59 characters instead of 11.
- [x] Media download boundary: confirmed as the backend failure point for valid IDs; errors are YouTube HTTP 403 and bot-check 409.
- [x] Container capacity: confirmed as a secondary backend failure; one record reports the deployed `max_instances=1` cap.
- [ ] Exact YouTube cause: cookie export missing/invalid versus stale `yt-dlp` remains open until Cloudflare access is restored or a controlled Cloudflare smoke test is approved.

## Additional timeline evidence

- A single valid video (`Y82dhTHL4ok`) completed twice at 2026-08-15T19:07:36Z and 19:08:29Z, then returned YouTube HTTP 403 at 19:57:21Z without a Bolo deployment. Other valid videos show the same pattern: transient 403s followed by successful retries, then later failures. This rules out a permanently broken URL, parser, or container image and points to YouTube-side egress blocking/rate limiting or a cookie/session policy change.
- New Convex records at 2026-08-20T04:45Z-04:46Z still fail at media download with HTTP 403, while the replacement Cloudflare app remains the known deployed app. The runtime failure is therefore ongoing and upstream of Whisper/OpenRouter.
- Refined conclusion: the root-cause boundary is YouTube media access from Cloudflare egress. The exact trigger is most likely an upstream anti-bot/rate-limit change interacting with an old pinned `yt-dlp` and/or unavailable/expired `YOUTUBE_COOKIES_B64`; distinguishing those two requires restored Cloudflare inspection or a controlled smoke test.
- After Wrangler OAuth re-authentication, `wrangler secret list --config cloudflare/media-prep-container/wrangler.toml` showed only `BOLO_CONTAINER_SECRET`; `YOUTUBE_COOKIES_B64` is absent from the live worker. The `dev` 1Password vault has a `Kaadr YouTube` login item but no cookie-export item or local `cookies.txt` file was found. This makes missing YouTube cookies the confirmed immediate configuration gap.
- Updated `cloudflare/media-prep-container/Dockerfile` from `yt-dlp==2026.3.17` to `2026.08.19`, built the image, and deployed it to app `a0396983-d385-4d65-bde7-61fe9f796ae2` as image `cdd12c5f` / version `cdd12c5f-9025-4729-95ce-4d2ec21dc3a4`. Cloudflare reports the app healthy with no errors and one healthy instance.
- Retried two previously failed entries after deployment. Both passed media download, transcription, translation, and cleanup, and reached `ready` with `translationStatus: ready`; the succeeding media-prep events used the new image without YouTube cookies. Local Vitest (27 tests), TypeScript, Python syntax, and the built image's `yt-dlp --version` (`2026.08.19`) all passed.
- The full ESLint command is blocked before linting by the pre-existing `typescript@7.0.1-rc` change: Expo's ESLint parser requires the legacy TypeScript compiler entry point, which TypeScript 7 RC does not export. This does not affect the deployed Python downloader or the verified Convex retry path, and the TypeScript type-check still passes.
- All existing modified and untracked files were staged for the user's approved commit and push, including the Dockerfile update, container hardening, URL validation, TypeScript/lockfile change, monitor script, billing note, and this log.
