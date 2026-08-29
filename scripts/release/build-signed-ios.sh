#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
manifest="$repo_root/release/manifest.json"

bundle_id=$(jq -r '.apple.bundle_id // empty' "$manifest")
if [[ -z "$bundle_id" ]]; then
  echo "Bolo iOS signed build is blocked: no production App Store bundle identifier, certificate, and provisioning profile are available in 1Password." >&2
  exit 2
fi

echo "Bolo iOS signing recovery is not configured for bundle $bundle_id." >&2
exit 2
