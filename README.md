# Bolo

Bolo is a calm synced bilingual video player for people who want to paste a YouTube link, watch the video, and read the translation in rhythm with the audio.

## What is built

- Expo React Native app with a single, grandma-friendly flow
- YouTube URL preview for normal videos and Shorts
- Convex-backed history for saved transcripts and translations
- Convex Workflow pipeline for durable media prep, transcription, translation, and cleanup
- Cloudflare Worker proxy for Groq `whisper-large-v3-turbo`
- Cloudflare Container scaffold for `yt-dlp` + `ffmpeg` audio prep
- Synced bilingual video player with compact controls, tap-to-seek transcript segments, and debug/cost copy
- Translation pipeline using AI SDK 6 with the OpenRouter community provider
- Gruvbox light and dark theming

## Architecture

- Expo client stays thin and subscribes to Convex for job status, saved entries, timed segments, and debug/cost info.
- Video preview is fetched directly in the app with YouTube oEmbed.
- New submissions create `processingVersion: 2` entries and start a Convex Workflow.
- Convex Workflow calls a Cloudflare Container for audio download/normalize/chunk, a Cloudflare Worker proxy for Groq Whisper, and OpenRouter for segment-preserving translation pinned to Cerebras.
- R2 chunk keys are scoped by entry and random job id, then deleted through the Worker cleanup endpoint after success.

## Local setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy the Expo client env:

```bash
cp .env.example .env.local
```

3. Set your Convex project:

```bash
pnpm convex:dev
```

4. Put your Convex deployment URL into `.env.local`:

```bash
EXPO_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
```

5. Set the AI and media pipeline environment in Convex. The translation model is routed to Cerebras by the Convex action:

```bash
pnpm exec convex env set OPENROUTER_API_KEY=your_key
pnpm exec convex env set OPENROUTER_TRANSLATION_MODEL=google/gemma-4-31b-it
pnpm exec convex env set BOLO_MEDIA_PREP_URL=https://your-media-prep-container.example.com
pnpm exec convex env set BOLO_CONTAINER_SECRET=your_shared_container_secret
pnpm exec convex env set BOLO_WHISPER_WORKER_URL=https://bolo-whisper-worker.your-subdomain.workers.dev
pnpm exec convex env set BOLO_WORKER_SECRET=your_shared_worker_secret
```

6. Deploy the Cloudflare Worker after creating the `bolo-media` R2 bucket and setting both Worker secrets. `GROQ_API_KEY` must be a valid Groq API key and must not be committed:

```bash
wrangler secret put BOLO_WORKER_SECRET --config cloudflare/whisper-worker/wrangler.toml
wrangler secret put GROQ_API_KEY --config cloudflare/whisper-worker/wrangler.toml
wrangler deploy --config cloudflare/whisper-worker/wrangler.toml
```

7. Deploy the media-prep Container Worker after setting `BOLO_CONTAINER_SECRET` as a Worker secret:

```bash
wrangler secret put BOLO_CONTAINER_SECRET --config cloudflare/media-prep-container/wrangler.toml
wrangler deploy --config cloudflare/media-prep-container/wrangler.toml
```

Cloudflare egress can trigger YouTube bot checks. If that happens for your account/IP mix, set `YOUTUBE_COOKIES_B64` on the media-prep Worker to a base64-encoded Netscape `cookies.txt` export.

8. Start the app:

```bash
pnpm start
```

## Convex notes

- The legacy caption-reader action remains in [convex/transcribe.ts](convex/transcribe.ts) for old saved entries.
- The synced video workflow is in [convex/syncedVideoWorkflow.ts](convex/syncedVideoWorkflow.ts).
- The media/AI step actions are in [convex/syncPipeline.ts](convex/syncPipeline.ts).
- The table definition is [convex/schema.ts](convex/schema.ts).
- Run `pnpm exec convex dev --once` after changing Convex functions or schema.

## Publishing plan

1. Run the local gate:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

2. Log into Expo Application Services:

```bash
eas login
```

3. Create internal preview builds:

```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```

4. Create production builds:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

5. Submit when the store metadata is ready:

```bash
eas submit --platform ios --profile production
eas submit --platform android --profile production
```
