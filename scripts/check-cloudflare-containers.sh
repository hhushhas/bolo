#!/usr/bin/env bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

LOG_DIR="$HOME/Library/Logs/bolo"
LOG_FILE="$LOG_DIR/cloudflare-container-check.log"
EXPECTED_ACCOUNT_ID="5281943bd26d5bdcf4c3915606cd6bfb"
BOLO_APP_ID="a0396983-d385-4d65-bde7-61fe9f796ae2"
BOLO_INSTANCE_TYPE="basic"
BOLO_MAX_ACTIVE_INSTANCES=0
mkdir -p "$LOG_DIR"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

notify() {
  local title="$1"
  local message="$2"

  /usr/bin/osascript -e "display notification \"${message//\"/\\\"}\" with title \"${title//\"/\\\"}\"" >/dev/null 2>&1 || true
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE"
}

check_app() {
  local label="$1"
  local app_id="$2"
  local expected_running_max="$3"

  local output
  if ! output="$(wrangler containers instances "$app_id" --per-page 100 --json 2>&1)"; then
    log "ERROR $label: wrangler check failed: $output"
    notify "Cloudflare container check failed" "$label: wrangler check failed"
    return 1
  fi

  local running_count
  if ! running_count="$(node -e '
const fs = require("fs");
const input = fs.readFileSync(0, "utf8");
const rows = JSON.parse(input);
if (!Array.isArray(rows)) throw new Error("Expected array response");
const activeStates = new Set(["running", "healthy", "starting", "scheduling"]);
const active = rows.filter((row) => activeStates.has(row.state));
console.log(active.length);
if (active.length > 0) {
  console.error(active.map((row) => `${row.name}:${row.state}:${row.created}`).join(", "));
}
' 2> >(tee /tmp/bolo-container-active.txt >&2) <<<"$output")"; then
    log "ERROR $label: could not parse wrangler JSON"
    notify "Cloudflare container check failed" "$label: could not parse wrangler JSON"
    return 1
  fi

  local active_details
  active_details="$(cat /tmp/bolo-container-active.txt 2>/dev/null || true)"

  if (( running_count > expected_running_max )); then
    log "ALERT $label: $running_count active container(s). $active_details"
    notify "Cloudflare container active" "$label has $running_count active container(s)"
    return 2
  fi

  log "OK $label: $running_count active container(s)"
}

check_app_absent() {
  local label="$1"
  local app_name="$2"

  local output
  if ! output="$(wrangler containers list 2>&1)"; then
    log "ERROR $label: wrangler container list failed: $output"
    notify "Cloudflare container check failed" "$label: wrangler list failed"
    return 1
  fi

  if [[ "$output" == *"$app_name"* ]]; then
    log "ALERT $label: container app exists unexpectedly"
    notify "Cloudflare container exists" "$label container app exists unexpectedly"
    return 2
  fi

  log "OK $label: container app absent"
}

log "Starting Cloudflare container check"

if ! whoami_output="$(wrangler whoami 2>&1)"; then
  log "ERROR wrangler auth check failed: $whoami_output"
  notify "Cloudflare container check failed" "Wrangler auth check failed"
  exit 1
fi

if [[ "$whoami_output" != *"$EXPECTED_ACCOUNT_ID"* ]]; then
  log "ERROR wrong Cloudflare account active; expected account $EXPECTED_ACCOUNT_ID"
  notify "Cloudflare account mismatch" "Wrangler is not logged into the Bolo Cloudflare account"
  exit 1
fi

log "Bolo expected baseline: 0 active containers; deployed cap: max_instances=1, instance_type=$BOLO_INSTANCE_TYPE"
check_app "bolo-media-prep" "$BOLO_APP_ID" "$BOLO_MAX_ACTIVE_INSTANCES" || true
check_app_absent "invy-dashboard-whatsappbridge" "invy-dashboard-whatsappbridgecontainer" || true
log "Finished Cloudflare container check"
