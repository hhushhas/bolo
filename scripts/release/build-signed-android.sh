#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
manifest="$repo_root/release/manifest.json"
output_dir=${SIGNED_OUTPUT_DIR:-"$repo_root/build/release"}
temp_dir=$(mktemp -d "${RUNNER_TEMP:-/private/tmp}/bolo-android-signing.XXXXXX")

cleanup() {
  find "$temp_dir" -depth -delete 2>/dev/null || true
  if [[ -f "$repo_root/android/keystore.properties" ]]; then
    find "$repo_root/android/keystore.properties" -delete 2>/dev/null || true
  fi
}

trap cleanup EXIT HUP INT TERM

command -v jq >/dev/null
command -v op >/dev/null

signing_item=$(jq -r '.android.signing_item // empty' "$manifest")
if [[ -z "$signing_item" ]]; then
  echo "Bolo Android signed build is blocked: no verified production upload keystore is stored in 1Password." >&2
  echo "The local android/app/bolo-release.jks could not be opened with the available recovery material, so it was not migrated." >&2
  exit 2
fi

keystore_path="$temp_dir/upload.jks"
item_json="$temp_dir/signing-item.json"
op document get "$signing_item" --vault "Mobile App Releases" --out-file "$keystore_path" --force >/dev/null
op item get "$signing_item" --vault "Mobile App Releases" --format json > "$item_json"

store_password=$(jq -er '.fields[] | select(.label == "storePassword") | .value' "$item_json")
key_alias=$(jq -er '.fields[] | select(.label == "keyAlias") | .value' "$item_json")
key_password=$(jq -er '.fields[] | select(.label == "keyPassword") | .value' "$item_json")
expected_certificate=$(jq -er '.android.certificate_sha256' "$manifest")

cat > "$repo_root/android/keystore.properties" <<EOF
storeFile=$keystore_path
storePassword=$store_password
keyAlias=$key_alias
keyPassword=$key_password
EOF
chmod 600 "$repo_root/android/keystore.properties" "$keystore_path" "$item_json"

mkdir -p "$output_dir"
(cd "$repo_root/android" && ./gradlew --no-daemon bundleRelease)
built_bundle=$(find "$repo_root/android/app/build/outputs/bundle/release" -type f -name '*.aab' -print -quit)
if [[ -z "$built_bundle" ]]; then
  echo "Bolo Android signed build did not produce an AAB." >&2
  exit 1
fi

certificate_sha256=$(keytool -printcert -jarfile "$built_bundle" 2>/dev/null | awk '/SHA256:/{sub(/^[[:space:]]*SHA256: /, ""); print; exit}')
if [[ "$certificate_sha256" != "$expected_certificate" ]]; then
  echo "Bolo Android bundle certificate does not match the recovery manifest." >&2
  exit 1
fi

cp "$built_bundle" "$output_dir/bolo-android-signed.aab"
printf 'android_bundle=%s\n' "$output_dir/bolo-android-signed.aab"
printf 'certificate_sha256=%s\n' "$certificate_sha256"
