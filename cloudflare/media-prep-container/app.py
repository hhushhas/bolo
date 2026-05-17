from __future__ import annotations

import hashlib
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


AUTH_SECRET = os.environ.get("BOLO_CONTAINER_SECRET", "")
R2_MOUNT_PATH = Path(os.environ.get("R2_MOUNT_PATH", "/mnt/r2"))
R2_OUTBOUND_BASE_URL = os.environ.get("R2_OUTBOUND_BASE_URL", "")
YOUTUBE_COOKIES_B64 = os.environ.get("YOUTUBE_COOKIES_B64", "")
DEFAULT_CHUNK_SECONDS = int(os.environ.get("CHUNK_SECONDS", "45"))
MAX_VIDEO_SECONDS = int(os.environ.get("MAX_VIDEO_SECONDS", str(2 * 60 * 60)))


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict[str, Any]) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("cache-control", "no-store")
    handler.send_header("content-length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def run_command(args: list[str], cwd: Path, timeout: int = 900) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=True,
        cwd=cwd,
        stderr=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def upload_chunk(source_path: Path, r2_key: str, mounted_prefix: Path) -> None:
    if R2_OUTBOUND_BASE_URL:
        with source_path.open("rb") as file:
            request = urllib.request.Request(
                f"{R2_OUTBOUND_BASE_URL.rstrip('/')}/{r2_key}",
                data=file.read(),
                headers={"content-type": "audio/mpeg"},
                method="PUT",
            )

        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                if response.status < 200 or response.status >= 300:
                    raise RuntimeError(f"R2 upload failed with status {response.status}.")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"R2 upload failed with status {error.code}: {body}") from error

        return

    if not R2_MOUNT_PATH.exists():
        raise RuntimeError(f"R2 mount path does not exist: {R2_MOUNT_PATH}")

    output_dir = R2_MOUNT_PATH / mounted_prefix
    output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_path, output_dir / Path(r2_key).name)


def ffprobe_duration(path: Path) -> float:
    result = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        cwd=path.parent,
        timeout=120,
    )
    return float(result.stdout.strip())


def download_audio(workdir: Path, youtube_url: str) -> Path:
    output_template = str(workdir / "source.%(ext)s")
    args = [
        "yt-dlp",
        "--no-playlist",
        "--no-warnings",
        "--print",
        "after_move:filepath",
        "-f",
        "worstaudio[abr<=64]/worstaudio/bestaudio/best",
        "-o",
        output_template,
    ]

    if YOUTUBE_COOKIES_B64:
        cookies_path = workdir / "youtube-cookies.txt"
        cookies_path.write_bytes(base64.b64decode(YOUTUBE_COOKIES_B64))
        args.extend(["--cookies", str(cookies_path)])

    args.append(youtube_url)
    result = run_command(
        args,
        cwd=workdir,
        timeout=1800,
    )
    candidates = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]

    if candidates:
        return candidates[-1]

    files = sorted(workdir.glob("source.*"))
    if not files:
        raise RuntimeError("yt-dlp did not produce an audio file.")

    return files[0]


def chunk_audio(source_path: Path, chunks_dir: Path, chunk_seconds: int) -> list[Path]:
    chunks_dir.mkdir(parents=True, exist_ok=True)
    run_command(
        [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "32k",
            "-f",
            "segment",
            "-segment_time",
            str(chunk_seconds),
            "-reset_timestamps",
            "1",
            str(chunks_dir / "%05d.mp3"),
        ],
        cwd=source_path.parent,
        timeout=1800,
    )
    chunks = sorted(chunks_dir.glob("*.mp3"))

    if not chunks:
        raise RuntimeError("ffmpeg did not produce audio chunks.")

    return chunks


def prepare_media(payload: dict[str, Any]) -> dict[str, Any]:
    entry_id = payload.get("entryId")
    job_id = payload.get("jobId")
    youtube_url = payload.get("youtubeUrl")
    chunk_seconds = int(payload.get("chunkSeconds", DEFAULT_CHUNK_SECONDS))

    if not isinstance(entry_id, str) or not entry_id:
        raise ValueError("entryId is required.")
    if not isinstance(job_id, str) or not job_id:
        raise ValueError("jobId is required.")
    if not isinstance(youtube_url, str) or not youtube_url:
        raise ValueError("youtubeUrl is required.")
    if chunk_seconds < 15 or chunk_seconds > 90:
        raise ValueError("chunkSeconds must be between 15 and 90.")
    started_at = time.monotonic()
    workdir = Path(tempfile.mkdtemp(prefix=f"bolo-{entry_id}-"))

    try:
      download_started_at = time.monotonic()
      source_path = download_audio(workdir, youtube_url)
      download_sec = time.monotonic() - download_started_at

      duration_sec = ffprobe_duration(source_path)
      if duration_sec > MAX_VIDEO_SECONDS:
          raise ValueError("This video is longer than the 2 hour limit.")

      ffmpeg_started_at = time.monotonic()
      chunk_paths = chunk_audio(source_path, workdir / "chunks", chunk_seconds)
      ffmpeg_sec = time.monotonic() - ffmpeg_started_at

      entry_prefix = Path("jobs") / entry_id / job_id / "chunks"
      chunks = []
      start_ms = 0
      total_duration_ms = round(duration_sec * 1000)
      nominal_chunk_ms = chunk_seconds * 1000

      for index, chunk_path in enumerate(chunk_paths):
          remaining_ms = max(total_duration_ms - start_ms, 0)
          duration_ms = min(nominal_chunk_ms, remaining_ms) if remaining_ms else nominal_chunk_ms
          r2_key = str(entry_prefix / f"{index:05d}.mp3")
          upload_chunk(chunk_path, r2_key, entry_prefix)

          chunks.append(
              {
                  "durationMs": duration_ms,
                  "index": index,
                  "r2Key": r2_key,
                  "sha256": sha256_file(chunk_path),
                  "sizeBytes": chunk_path.stat().st_size,
                  "startMs": start_ms,
                  "status": "prepared",
              }
          )
          start_ms += duration_ms

      total_sec = time.monotonic() - started_at

      return {
          "chunkSeconds": chunk_seconds,
          "chunks": chunks,
          "downloadSec": download_sec,
          "durationSec": duration_sec,
          "ffmpegSec": ffmpeg_sec,
          "totalSec": total_sec,
      }
    finally:
      shutil.rmtree(workdir, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/health":
            json_response(self, 200, {"ok": True})
            return
        json_response(self, 404, {"error": "Not found."})

    def do_POST(self) -> None:
        if self.path != "/prepare":
            json_response(self, 404, {"error": "Not found."})
            return

        authorization = self.headers.get("authorization", "")
        if not AUTH_SECRET or authorization != f"Bearer {AUTH_SECRET}":
            json_response(self, 401, {"error": "Unauthorized."})
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = prepare_media(payload)
            json_response(self, 200, result)
        except ValueError as error:
            json_response(self, 400, {"error": str(error)})
        except subprocess.CalledProcessError as error:
            stderr = error.stderr[-2000:]
            is_youtube_bot_check = "not a bot" in stderr
            json_response(
                self,
                409 if is_youtube_bot_check else 502,
                {
                    "details": stderr,
                    "error": (
                        "YouTube blocked the download request. Configure YOUTUBE_COOKIES_B64 for the media-prep container or try again later."
                        if is_youtube_bot_check
                        else "Media command failed."
                    ),
                },
            )
        except Exception as error:
            json_response(self, 500, {"error": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"bolo media prep container listening on {port}", flush=True)
    server.serve_forever()
