#!/usr/bin/env bash

set -euo pipefail
umask 077

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
manifest="$repo_root/release/manifest.json"
output_dir=${SIGNED_OUTPUT_DIR:-"$repo_root/build/release"}
if [[ "$output_dir" != /* ]]; then
  output_dir="$repo_root/$output_dir"
fi
temp_dir=$(mktemp -d "${RUNNER_TEMP:-/private/tmp}/bolo-android-signing.XXXXXX")

cleanup() {
  find "$temp_dir" -depth -delete 2>/dev/null || true
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

store_password_file="$temp_dir/store-password"
key_alias_file="$temp_dir/key-alias"
key_password_file="$temp_dir/key-password"
jq -er '.fields[] | select(.label == "storePassword") | .value' "$item_json" > "$store_password_file"
jq -er '.fields[] | select(.label == "keyAlias") | .value' "$item_json" > "$key_alias_file"
jq -er '.fields[] | select(.label == "keyPassword") | .value' "$item_json" > "$key_password_file"
expected_certificate=$(jq -er '.android.certificate_sha256' "$manifest")

properties_path="$temp_dir/keystore.properties"
{
  printf 'storeFile=%s\n' "$keystore_path"
  printf 'storePassword='
  cat "$store_password_file"
  printf 'keyAlias='
  cat "$key_alias_file"
  printf 'keyPassword='
  cat "$key_password_file"
} > "$properties_path"
chmod 600 "$properties_path" "$store_password_file" "$key_alias_file" "$key_password_file"

chmod 600 "$keystore_path" "$item_json"

build_gradle="$repo_root/android/app/build.gradle"
if ! rg -q '^import java\.io\.FileInputStream$' "$build_gradle"; then
  perl -0pi -e 's/\A/import java.io.FileInputStream\nimport java.util.Properties\n\ndef signingPropertiesPath = findProperty("android.signingPropertiesFile")\ndef keystorePropertiesFile = signingPropertiesPath ? file(signingPropertiesPath) : rootProject.file("keystore.properties")\ndef keystoreProperties = new Properties()\n\nif (keystorePropertiesFile.exists()) {\n    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n}\n/' "$build_gradle"
fi
if ! rg -q '^def signingPropertiesPath' "$build_gradle"; then
  perl -0pi -e 's/^def keystorePropertiesFile = rootProject\.file\("keystore\.properties"\)$/def signingPropertiesPath = findProperty("android.signingPropertiesFile")\ndef keystorePropertiesFile = signingPropertiesPath ? file(signingPropertiesPath) : rootProject.file("keystore.properties")/m' "$build_gradle"
fi
if ! rg -q 'android\.signedOutputDirectory' "$build_gradle"; then
  perl -0pi -e 's/\nandroid \{/\ndef signedOutputDirectory = findProperty("android.signedOutputDirectory")\nif (signedOutputDirectory) {\n    layout.buildDirectory.set(file(signedOutputDirectory))\n}\n\nandroid {/s' "$build_gradle"
fi

mkdir -p "$output_dir" "$temp_dir/gradle"
(cd "$repo_root/android" && GRADLE_USER_HOME="$temp_dir/gradle" ./gradlew --no-daemon -Pandroid.signingPropertiesFile="$properties_path" -Pandroid.signedOutputDirectory="$output_dir" bundleRelease)
built_bundle=$(find "$output_dir/outputs/bundle/release" -type f -name '*.aab' -print -quit)
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
