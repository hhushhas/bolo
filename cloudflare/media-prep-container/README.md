# Bolo Media Prep Container

This container performs the binary-heavy media step for the synced player pipeline.

It is intentionally limited to:

- downloading YouTube audio with `yt-dlp`
- validating the 2 hour max duration
- normalizing audio with `ffmpeg`
- splitting audio into duration-based MP3 chunks
- uploading chunks into R2 through the Cloudflare Container outbound binding
- returning the chunk manifest to Convex Workflow

It does not call Whisper and should not stay alive while Whisper runs. Convex Workflow waits on Whisper through the separate Cloudflare Worker.

## Runtime Contract

```http
POST /prepare
Authorization: Bearer <BOLO_CONTAINER_SECRET>
Content-Type: application/json

{
  "entryId": "entry-id",
  "jobId": "unguessable-job-id",
  "youtubeUrl": "https://www.youtube.com/watch?v=...",
  "chunkSeconds": 45
}
```

Response:

```json
{
  "durationSec": 1830.2,
  "downloadSec": 18.4,
  "ffmpegSec": 12.1,
  "totalSec": 31.7,
  "chunkSeconds": 45,
  "chunks": [
    {
      "index": 0,
      "startMs": 0,
      "durationMs": 45000,
      "r2Key": "jobs/entry-id/unguessable-job-id/chunks/00000.mp3",
      "sizeBytes": 731212,
      "sha256": "...",
      "status": "prepared"
    }
  ]
}
```

## Required Environment

```text
BOLO_CONTAINER_SECRET
R2_OUTBOUND_BASE_URL=http://example.com
CHUNK_SECONDS=45
MAX_VIDEO_SECONDS=7200
YOUTUBE_COOKIES_B64=<optional base64 Netscape cookies.txt>
```

The Cloudflare Worker wrapper intercepts `example.com` as an outbound handler. The Python container only sends `PUT http://example.com/<r2Key>` and never receives direct R2 credentials or uploads to public internet.

For local-only testing, omit `R2_OUTBOUND_BASE_URL` and mount a writable directory at `R2_MOUNT_PATH=/mnt/r2`.

Cloudflare egress can trigger YouTube's anti-bot checks. When that happens, `yt-dlp` needs authenticated cookies. Store a Netscape-format cookies file as base64 in the `YOUTUBE_COOKIES_B64` Worker secret; the container writes it to a temporary file for the single job and deletes it with the rest of the work directory.
