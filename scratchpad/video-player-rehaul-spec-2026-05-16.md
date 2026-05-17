# Bolo Synced Bilingual Video Player Spec

Created: 2026-05-16 23:31 PKT  
Owner: Hasan / Codex  
Status: Draft for implementation

## Product Intent

Bolo is changing from a text reader into a synced bilingual video player. A user pastes a YouTube URL, Bolo processes the video audio, generates a timestamped transcript, translates it, and lets the user watch the video while reading original + translated text in sync.

The core product promise is:

> Watch, listen, read the original, and understand the translation in rhythm with the video.

## Confirmed Requirements

- Input is a YouTube URL.
- The app is allowed to use `yt-dlp` for audio extraction.
- Target platforms are Android and iOS.
- Video playback happens inside the app with a YouTube-like player.
- Portrait and landscape layouts must both be optimized.
- The video and bilingual translation/transcript should get maximum useful real estate. Secondary metadata, cost, and debug details should stay out of the main viewing surface.
- UI must follow the existing Bolo design/theme. Preserve the current Gruvbox-inspired palette, heavy borders, friendly rounded geometry, typography weight, spacing rhythm, and calm grandma-friendly tone unless a specific interaction requires a focused adjustment.
- The rehaul should feel like Bolo evolved into a video player, not like a new product skin.
- Max video length is 2 hours.
- Users can leave the processing screen and return later from history.
- Synced transcript behavior:
  - highlight current segment as video plays
  - auto-scroll transcript
  - tap a segment to seek video
  - pause or suspend auto-scroll when the user manually scrolls away
- Default reading mode is bilingual.
- Additional modes: original only, translation only.
- Raw Whisper output should be merged into readable 8-18 second bilingual blocks for the UI.
- Translation failure fails the whole job, because the bilingual sync is the charm of the product.
- Audio/chunks are temporary and should be deleted after successful processing.
- Failed artifacts should only be retained briefly if needed for debugging.
- Per-video processing/cost/debug data is hidden behind an information button in a minimal sheet.
- The debug sheet needs a one-tap copy button so diagnostics can be shared.
- Old saved entries created on Saturday, May 16, 2026 should be automatically reprocessed.
- Older entries from before May 16, 2026 are out of scope for automatic migration unless explicitly requested later.

## High-Level Architecture

```text
Expo app
  -> Convex mutation queues entry
  -> Convex Workflow orchestrates processing
  -> Cloudflare Container prepares media
       - yt-dlp
       - ffprobe
       - ffmpeg normalize/chunk
       - upload chunk files to R2
  -> Convex Workflow calls Cloudflare Worker for Whisper per chunk
  -> Cloudflare Worker calls Workers AI whisper-large-v3-turbo
  -> Convex merges timed transcript segments
  -> Convex calls OpenRouter for translation batches
  -> Convex stores timed bilingual segments + usage ledger
  -> Expo renders synced bilingual player
```

Convex owns durable state and workflow orchestration. Cloudflare Container owns binary-heavy media prep. Cloudflare Worker owns Workers AI access and runs Whisper through Cloudflare Workers AI. R2 owns temporary audio chunks.

Whisper inference does not run inside Convex. Convex Workflow schedules and retries transcription steps, but the actual model call happens on Cloudflare via a Worker endpoint.

The Cloudflare Container should not stay alive waiting for Whisper. It should return the chunk manifest after `yt-dlp`/ffmpeg/R2 upload and then shut down. Convex Workflow should wait on Whisper as separate durable steps so retries, progress, telemetry, and costs remain visible.

## Runtime Responsibilities

### Expo App

- Accept YouTube URL.
- Show preview when available.
- Queue processing through Convex.
- Show stage progress:
  - Queued
  - Downloading audio
  - Preparing audio
  - Transcribing
  - Translating
  - Finalizing player
  - Ready
- Render the synced player.
- Subscribe to Convex updates for job status and segments.
- Show admin/debug sheet behind an information button.

### Convex Workflow

- Queue entry and workflow run.
- Call the Cloudflare Container media-prep endpoint.
- Validate returned duration against the 2-hour max.
- Persist chunk manifest.
- Call Whisper per chunk through a Cloudflare Worker endpoint.
- Retry safe transient failures.
- Merge chunk-level Whisper results into one canonical segment timeline.
- Build readable 8-18 second display segments.
- Translate display segments through OpenRouter while preserving segment IDs.
- Persist final bilingual segments.
- Persist usage/cost/debug telemetry.
- Mark job ready or failed.
- Trigger cleanup of R2 chunks after success.

### Cloudflare Container

The container is a media-prep worker, not the full pipeline.

- Receive an authenticated media-prep job from Convex.
- Run `yt-dlp` for audio-only download.
- Capture duration and basic metadata with `ffprobe`/`yt-dlp`.
- Reject or report videos over 2 hours.
- Normalize audio with `ffmpeg`:
  - mono
  - Whisper-friendly sample rate
  - stable container/codec format
  - light loudness normalization if it does not damage speech
- Split audio into duration-based chunks, not byte chunks.
- Preserve exact `startSec` and `durationSec` for each chunk.
- Upload chunks to R2.
- Return a chunk manifest to Convex.
- Delete local temp files.
- Do not call or wait for Whisper from the container in the default architecture.

### Cloudflare Worker

- Expose an authenticated `transcribeChunk` endpoint.
- Read chunk audio from R2.
- Call Workers AI model `@cf/openai/whisper-large-v3-turbo`.
- Return timed `segments` or `vtt` plus request metadata.
- Do not decide product state; Convex remains the source of truth.

### OpenRouter

- Translate batches of display segments.
- Preserve segment IDs exactly.
- Return structured JSON.
- Capture provider-reported usage/cost metadata where available.

## Data Model

Avoid storing long bilingual transcripts as a single field on `entries`. A 2-hour video can produce enough text to make a single document brittle. Use separate segment and usage tables.

### `entries`

Add or evolve fields:

```ts
{
  videoId: string;
  youtubeUrl: string;
  title: string;
  channelTitle?: string;
  thumbnailUrl: string;

  status: 'queued' | 'processing' | 'ready' | 'failed';
  processingStage?: string;
  processingVersion: number; // v2 for synced pipeline

  durationSec?: number;
  sourceLanguage?: string;
  sourceLanguageLabel?: string;
  targetLanguage: string;
  targetLanguageLabel: string;

  migrationReason?: 'today-entries-reprocess';
  errorMessage?: string;

  createdAt: number;
  updatedAt: number;
}
```

Keep old flat `transcriptText` and `translationText` during transition for backward compatibility, but new synced playback should read from segments.

### `entrySegments`

One row per readable display block.

```ts
{
  entryId: Id<'entries'>;
  index: number;
  startMs: number;
  endMs: number;
  originalText: string;
  translatedText: string;
  sourceChunkIndexes: number[];
  createdAt: number;
}
```

Indexes:

- by `entryId`
- by `entryId, index`
- optionally by `entryId, startMs`

### `mediaChunks`

Temporary processing manifest.

```ts
{
  entryId: Id<'entries'>;
  index: number;
  r2Key: string;
  startMs: number;
  durationMs: number;
  sizeBytes: number;
  sha256?: string;
  status: 'prepared' | 'transcribing' | 'transcribed' | 'failed' | 'deleted';
  createdAt: number;
  updatedAt: number;
}
```

### `aiUsageEvents`

First-class cost ledger.

```ts
{
  entryId: Id<'entries'>;
  stage:
    | 'media_prep'
    | 'transcription'
    | 'translation'
    | 'migration'
    | 'cleanup';
  provider: 'cloudflare' | 'openrouter' | 'internal';
  model?: string;
  status: 'started' | 'succeeded' | 'failed';

  unitType?: 'audio_minute' | 'token' | 'runtime_second' | 'request';
  quantity?: number;
  unitPriceUsd?: number;
  estimatedCostUsd?: number;
  providerReportedCostUsd?: number;

  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;

  providerRequestId?: string;
  generationId?: string;
  metadata?: string; // JSON string for flexible debug details

  createdAt: number;
}
```

### `processingRuns`

Useful for debug sheet and migration visibility.

```ts
{
  entryId: Id<'entries'>;
  workflowRunId?: string;
  processingVersion: number;
  status: 'running' | 'ready' | 'failed';

  startedAt: number;
  completedAt?: number;
  failedAt?: number;

  downloadSec?: number;
  ffmpegSec?: number;
  whisperSec?: number;
  translationSec?: number;
  totalSec?: number;
  realtimeFactor?: number;

  errorMessage?: string;
}
```

## Workflow Detail

### 1. Queue Entry

- User submits a YouTube URL.
- Convex creates an `entries` row with `processingVersion = 2`.
- Convex starts a workflow run.

### 2. Media Prep

- Workflow calls the Cloudflare Container.
- Container downloads audio with `yt-dlp`.
- Container validates/returns duration.
- If duration exceeds 2 hours, fail cleanly.
- Container normalizes and chunks audio.
- Container uploads chunks to R2.
- Container returns manifest.
- Convex stores `mediaChunks`.
- Convex writes media-prep timing/cost/debug events.

### 3. Whisper

- After the container has returned the chunk manifest and shut down, Workflow calls Cloudflare Worker per chunk.
- Use controlled concurrency, initially 3-5 chunks in flight.
- Worker returns chunk-local timed segments.
- Convex shifts each segment timestamp by `chunk.startMs`.
- Convex stores raw interim transcript data only as needed for the run.

### 4. Merge Segments

- Sort all segments by start time.
- Remove empty segments.
- Smooth overlaps at chunk boundaries.
- Merge raw Whisper segments into readable 8-18 second display segments.
- Keep source chunk/index references for debugging.

### 5. Translate

- Batch display segments for OpenRouter.
- Prompt must preserve IDs exactly.
- Expected response shape:

```json
{
  "segments": [
    { "id": "12", "translatedText": "..." }
  ]
}
```

- If any segment is missing or malformed, retry.
- If translation cannot be completed, fail the job.
- Store OpenRouter token/cost metadata.

### 6. Finalize

- Write final `entrySegments`.
- Mark entry `ready`.
- Compute debug aggregates.
- Delete R2 audio chunks.
- Mark chunks `deleted` or remove chunk rows after cleanup.

## Whisper Timing Expectation

This is an estimate, not a guaranteed SLA. We need benchmark telemetry from real jobs.

Whisper does not run inside the container. The container prepares chunks, then Convex/Worker sends those chunks to Cloudflare Workers AI.

Planning assumptions:

```text
Whisper stage alone, with 3-5 concurrent chunks:
  expected:      4x-8x realtime
  conservative: 2x-4x realtime

Whole pipeline, including yt-dlp, ffmpeg, Whisper, merge, translation:
  expected:      ~3x realtime
  conservative: ~2x realtime
```

Approximate user-facing processing times:

```text
Video length   Expected whole pipeline   Conservative
5 min          2-4 min                   4-7 min
30 min         10-15 min                 15-25 min
60 min         20-30 min                 30-45 min
120 min        40-60 min                 60-90 min
```

Why this range is wide:

- `yt-dlp` download speed can vary by YouTube throttling and network conditions.
- `ffmpeg` should be fast on `standard-2`; it is unlikely to be the bottleneck.
- Whisper latency depends on chunk size, request concurrency, and Workers AI load.
- Translation latency depends on OpenRouter model/provider behavior and retry rate.

Required instrumentation:

```text
videoDurationSec
downloadSec
ffmpegSec
whisperSec
translationSec
totalSec
realtimeFactor = videoDurationSec / totalSec
chunkCount
whisperConcurrency
retryCount
```

## Cost Tracking

### Cloudflare Whisper

- Track audio minutes per chunk.
- Model: `@cf/openai/whisper-large-v3-turbo`.
- Store estimated cost from current configured unit price.
- Store request count and failures.
- At 150 audio minutes/day, expected Workers AI usage is under the included daily allocation on the existing $5 Cloudflare plan.

### Cloudflare Container

- Track runtime seconds for media prep.
- Use `standard-2` as the production starting point.
- Containers must scale to zero.
- Do not run an always-on polling worker.

### OpenRouter

- Capture provider-reported usage/cost where available.
- Store prompt/completion/total tokens.
- Store generation/request ID when available.
- Fall back to estimated token cost only if provider-reported cost is unavailable.

## Admin / Debug Sheet

Accessible from an information button on the player and history item.

Show:

- entry ID
- video duration
- processing status/stage
- processing version
- total processing time
- realtime factor
- per-stage timings
- chunk count
- Whisper concurrency
- retry count
- Cloudflare estimated cost
- OpenRouter reported/estimated cost
- total estimated cost
- latest error if failed

Actions:

- Copy debug report
- Retry failed job
- Reprocess entry

The copy payload should be compact plain text so Hasan can paste it into Codex.

## Player UX

Principle: the player surface should prioritize video and synced bilingual text. Avoid permanent panels for metadata, summaries, or cost details on the primary screen. Put diagnostics behind the information sheet. Controls should be compact and familiar.

### Portrait

```text
┌─────────────────────────────────────┐
│ ‹  Bolo                         ⓘ  │
├─────────────────────────────────────┤
│ ┌───────────────────────────────┐   │
│ │        YouTube Player          │   │
│ │      ▶ 00:42 / 12:18           │   │
│ └───────────────────────────────┘   │
│                                     │
│ Video title                         │
│ Channel name                        │
│                                     │
│ [Bilingual] [Original] [Translation]│
│ Auto-scroll on        1x            │
├─────────────────────────────────────┤
│ 00:38                               │
│ Original segment text...            │
│ Translated segment text...          │
│                                     │
│ ▌00:42                              │
│ ▌Current original segment...        │
│ ▌Current translated segment...      │
│                                     │
│ 00:55                               │
│ Next original segment...            │
│ Next translated segment...          │
└─────────────────────────────────────┘
```

### Landscape

```text
┌─────────────────────────────────────────────────────────────────────┐
│ ‹  Video title                                          ⓘ   ⋮       │
├───────────────────────────────┬─────────────────────────────────────┤
│                               │ [Bilingual] [Original] [Translation]│
│        YouTube Player          │ Auto-scroll on      1x              │
│                               │                                     │
│                               │  00:38                              │
│                               │  Original segment text...            │
│ ───────────●──────────         │  Translated segment text...          │
│ 00:42             12:18        │                                     │
│                               │ ▌00:42                              │
│ ⏪10     ▶/Ⅱ     10⏩           │ ▌Current original segment...         │
│                               │ ▌Current translated segment...       │
└───────────────────────────────┴─────────────────────────────────────┘
```

## Migration

Automatic migration scope:

- Only entries created on Saturday, May 16, 2026.
- Use `createdAt` timestamps to filter from local-day boundaries for Asia/Karachi unless app/user timezone support is added.
- Mark migration reason as `today-entries-reprocess`.
- Reprocess through the full v2 pipeline.

Migration behavior:

- Queue in batches, not all at once.
- Still show normal processing stages.
- Preserve old flat text until v2 result is ready.
- Replace playback source with v2 segments once ready.
- If migration fails, keep old entry visible but mark synced upgrade as failed in debug info.

Recommended initial batch:

```text
2 concurrent migration jobs
pause between batches if failure rate is high
log cost/timing for every migrated entry
```

## Failure Behavior

Fail the whole job if:

- YouTube URL cannot be processed by `yt-dlp`.
- Video duration exceeds 2 hours.
- ffmpeg normalization/chunking fails.
- Required chunk upload fails.
- Whisper cannot produce a usable transcript after retries.
- Segment merge produces no readable transcript.
- OpenRouter translation fails after retries.
- Cleanup failure should not fail a ready job, but must be recorded for follow-up.

User-facing copy should be clean and specific:

- “We could not download audio for this YouTube video.”
- “This video is longer than the 2 hour limit.”
- “We could not prepare the audio.”
- “We could not transcribe this video clearly.”
- “We could not translate this video.”

## Security

- Container and Worker endpoints require shared-secret or signed job authentication.
- Secrets stay server-side:
  - Cloudflare credentials
  - R2 credentials if needed
  - OpenRouter API key
  - container auth secret
- The mobile app never receives raw audio URLs or private R2 keys.
- R2 chunk keys should be unguessable and scoped by entry/job.

## Verification Plan

### Unit Tests

- YouTube URL parsing remains covered.
- Segment merge creates 8-18 second display segments.
- Segment merge shifts chunk-local timestamps correctly.
- Translation response parser rejects missing IDs.
- Cost ledger math handles estimated and provider-reported costs.

### Integration Tests

- Mock media-prep manifest -> Whisper mock -> OpenRouter mock -> ready entry.
- Failed Whisper chunk retries and then fails cleanly.
- Translation failure fails the job.
- Cleanup runs after success.
- Migration only selects entries created on May 16, 2026.

### Manual QA

Use real videos:

- 5 minute video
- 30 minute video
- 60 minute video
- 120 minute video
- video with music/noisy speech
- non-English source
- YouTube URL that `yt-dlp` cannot process

Record:

- total processing time
- realtime factor
- transcript quality
- translation alignment
- player sync behavior
- auto-scroll behavior
- tap-to-seek behavior
- debug copy payload quality

### External UI/UX Review

Use the local Gemini CLI for a focused UI/UX critique once there is a concrete mock, screenshot, or implemented screen.

Target reviewer:

```text
Gemini 3 Pro Preview via CLI, if available
```

Review prompt should ask specifically for:

- maximizing video and bilingual text real estate
- portrait and landscape ergonomics
- whether controls feel too heavy
- whether the active segment is obvious without hiding nearby context
- accessibility/readability for older users
- places where metadata/debug/cost UI is stealing attention
- concrete layout improvements, not generic praise

Treat Gemini output as design critique, not authority. Codex should review suggestions, accept only what fits the product, and verify with screenshots.

## Open Implementation Choices

- R2 bucket name: `bolo-media`.
- Cloudflare Container deployment: `cloudflare/media-prep-container`, Worker name `bolo-media-prep`, `standard-2`, `max_instances = 20`, `sleepAfter = 30s`, R2 writes through an outbound handler instead of direct R2 credentials inside Python.
- Whether debug sheet is visible for all users or gated behind a dev/admin flag.

## Recommended First Build Slice

1. Add v2 schema tables and debug/cost ledger.
2. Build segment merge utilities and tests.
3. Build mocked workflow end-to-end with fake media/Whisper/OpenRouter.
4. Build player UI against mocked timed bilingual segments.
5. Run Gemini CLI UI/UX pass on the mocked player screens and fold in accepted improvements.
6. Add Cloudflare Worker Whisper endpoint.
7. Add Cloudflare Container media-prep endpoint.
8. Wire real workflow.
9. Run May 16, 2026 migration batch.

## Exit Gate

The rehaul is complete when:

- New YouTube submissions create `processingVersion: 2` entries and start a Convex Workflow automatically.
- Convex Workflow orchestrates media prep, chunk transcription, segment translation, final segment persistence, status updates, retries, and clean failure states.
- Cloudflare Container only runs `yt-dlp`/`ffmpeg` media prep, writes chunks to R2, returns a manifest, and shuts down without waiting for Whisper.
- Cloudflare Workers AI Whisper runs through the authenticated Worker endpoint and returns timestamped segments.
- OpenRouter translation preserves segment IDs and stores translated bilingual timed segments.
- The player uses the existing Bolo/Gruvbox design theme, not a visual redesign: same warm palette, heavy borders, friendly rounded geometry, typography weight, spacing rhythm, and calm older-user-friendly tone.
- Portrait and landscape layouts prioritize video and bilingual transcript real estate with compact controls.
- Cost/debug data for Cloudflare and OpenRouter is available behind the information button in a minimal sheet with one-tap copy.
- Entries created on Saturday May 16, 2026 are automatically reprocessed into the v2 synced pipeline.
- Success cleans up retained media artifacts or confirms lifecycle cleanup is configured; failures are clear and recoverable from history.
- Verification passes: lint, typecheck, unit tests, Cloudflare Worker dry-run/deploy checks, media-prep container build or equivalent compile check, and a manual end-to-end run against at least one real YouTube URL.
