#!/usr/bin/env bash
# Layer C setup: the real app (Maestro) -> Prose on this Mac -> a hop's Discourse in Docker.
#
#   script/layer-c.sh up       expose the hop's Discourse on localhost:3000, start Prose on :8929,
#                              write the app repo's git-ignored .maestro/env/docker.env
#   script/layer-c.sh status   show what is running
#   script/layer-c.sh down     stop Prose and the port forward
#   script/layer-c.sh android-http      allow plain http:// to this Mac in the LOCAL Android build
#   script/layer-c.sh android-http-off  remove that again
#   script/layer-c.sh run      do everything: up, boot the emulator, build the app if
#                              needed, run the Maestro flows, save the results, then down
#                              (BUILD=1 forces a rebuild, WINDOW=1 shows the emulator)
#
# Prose runs from the app repo with settings passed on the command line. Its
# .env (dotenv 8, which never overrides existing values) is not used for any of
# them: the Discourse host, the admin keys (the local seed's test key) and
# empty SendGrid / Sentry / staging keys, so nothing real is contacted.
#
# CONTAINER picks the hop container (default ft-baseline). APP_REPO defaults to
# ~/yalla/forward-trust-community-mobile-app. The script never switches its
# branch: it tests whatever is checked out, and records the app branch and
# commit with every run, so results from different app versions are flagged.
#
# DATA picks which Discourse data the flows run on:
#   DATA=seed     (default) the small contract seed; uses contract/.local/docker.json
#                 and the contract_* test accounts
#   DATA=staging  a restored staging backup (docs/upgrade/05-backup-restore.md);
#                 uses contract/.local/staging-data.json and the accounts from the
#                 app repo's staging.env, with PROSE_URL pointed at the LOCAL Prose
set -uo pipefail

CONTAINER="${CONTAINER:-ft-baseline}"
APP_REPO="${APP_REPO:-$HOME/yalla/forward-trust-community-mobile-app}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$REPO/contract/.local"
PROXY="ft-discourse-api"
PROSE_PORT=8929
DATA="${DATA:-seed}"
case "$DATA" in
  seed) KEY_FILE="$LOGS/docker.json"; MAESTRO_ENV="docker" ;;
  staging) KEY_FILE="$LOGS/staging-data.json"; MAESTRO_ENV="docker-staging" ;;
  *) echo "DATA must be seed or staging"; exit 2 ;;
esac
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$HOME/.maestro/bin"
ADB="$ANDROID_HOME/platform-tools/adb"
AVD="${AVD:-Pixel_16k_API36}"
APP_ID="com.forwardtrust.community"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

forward() {
  local ip
  ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
  docker rm -f "$PROXY" >/dev/null 2>&1
  docker run -d --name "$PROXY" -p 127.0.0.1:3000:3000 alpine/socat \
    tcp-listen:3000,fork,reuseaddr "tcp-connect:$ip:3000" >/dev/null
  echo "Discourse ($CONTAINER) is on http://localhost:3000"
}

start_prose() {
  local key
  local admin_user
  key="$(node -e 'console.log(require(process.argv[1]).admin.api_key)' "$KEY_FILE")"
  admin_user="$(node -e 'console.log(require(process.argv[1]).admin.username)' "$KEY_FILE")"
  pkill -f "$APP_REPO/api.*src/index.ts" >/dev/null 2>&1
  (
    cd "$APP_REPO/api" || exit 1
    PROSE_DISCOURSE_HOST="http://localhost:3000" \
    PROSE_APP_HOSTNAME="0.0.0.0" \
    PROSE_APP_PORT="$PROSE_PORT" \
    SETTINGS_ADMIN_API_KEY="$key" \
    ADD_USERS_TO_GROUP_API_KEY="$key" \
    GET_USER_BY_ADMIN_API_KEY="$key" \
    SETTINGS_API_USERNAME="$admin_user" \
    STAGING_SETTINGS_ADMIN_API_KEY="" \
    STAGING_ADD_USERS_TO_GROUP_API_KEY="" \
    STAGING_GET_USER_BY_ADMIN_API_KEY="" \
    STAGING_SETTINGS_API_USERNAME="" \
    SENDGRID_API_KEY="" \
    SENTRY_DSN="" \
    DISCOURSE_WEBHOOK_SECRET="" \
    STAGING_DISCOURSE_WEBHOOK_SECRET="" \
    nohup yarn dev > "$LOGS/prose.log" 2>&1 &
  )
  for _ in $(seq 1 60); do
    sleep 2
    curl -s -o /dev/null -f -X POST -H 'Content-Type: application/json' \
      --data '{"query":"{ __typename }"}' "http://localhost:$PROSE_PORT/" && break
  done
  if curl -s -o /dev/null -f -X POST -H 'Content-Type: application/json' \
      --data '{"query":"{ __typename }"}' "http://localhost:$PROSE_PORT/"; then
    echo "Prose is on http://localhost:$PROSE_PORT (log: contract/.local/prose.log)"
  else
    echo "Prose did not start. See contract/.local/prose.log"
    return 1
  fi
}

write_env() {
  local file="$APP_REPO/.maestro/env/$MAESTRO_ENV.env"
  if [ "$DATA" = staging ]; then
    # Staging's test accounts exist in the restored copy with the same passwords.
    # Only the Prose address changes, to the local Prose.
    { echo "# Restored staging data on the local Docker copy (written by discourse-upgrade/script/layer-c.sh). Git-ignored."
      grep -vE "^PROSE_URL=" "$APP_REPO/.maestro/env/staging.env"
      echo "PROSE_URL=http://localhost:$PROSE_PORT"
    } > "$file"
  else
    # localhost:8929 works for the app (adb reverse, see ensure_emulator) and for
    # the flows' helper scripts, which call Prose from this Mac.
    cat > "$file" <<EOF
# Local Docker hop (written by discourse-upgrade/script/layer-c.sh). Git-ignored.
PROSE_URL=http://localhost:$PROSE_PORT
E2E_EMAIL=contract_member@example.com
E2E_EMAIL2=contract_member2@example.com
E2E_EMAIL3=
E2E_PASSWORD=contract-checks-2026!
E2E_POST_GROUP=peer_mentors
E2E_ADMIN_EMAIL=contract_admin@example.com
E2E_ADMIN_PASSWORD=contract-checks-2026!
E2E_DUPLICATE_EMAIL=contract_member@example.com
EOF
  fi
  git -C "$APP_REPO" check-ignore -q "$file" && echo "Wrote .maestro/env/$MAESTRO_ENV.env (git-ignored)" \
    || echo "WARNING: $file is not git-ignored. Do not commit it."
}

ANDROID_DIR="$APP_REPO/frontend/android/app/src/main"
NSC_FILE="$ANDROID_DIR/res/xml/network_security_config.xml"

# Android release builds refuse plain http://. Allow it only for the emulator's
# address for this Mac (10.0.2.2) and localhost, in the app's GENERATED android/
# folder, which is git-ignored and rebuilt by Expo; store builds generate their
# own and are not affected. `android-http-off` removes it again.
android_http_on() {
  [ -f "$ANDROID_DIR/AndroidManifest.xml" ] || { echo "No generated android/ folder in $APP_REPO/frontend"; return 1; }
  git -C "$APP_REPO" check-ignore -q "$ANDROID_DIR/AndroidManifest.xml" || { echo "android/ is tracked in git here; not touching it."; return 1; }
  mkdir -p "$(dirname "$NSC_FILE")"
  cat > "$NSC_FILE" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<!-- Local E2E only, written by discourse-upgrade/script/layer-c.sh: lets the
     emulator reach Prose on this Mac over plain HTTP. -->
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
EOF
  python3 - "$ANDROID_DIR/AndroidManifest.xml" <<'EOF'
import sys
path = sys.argv[1]
s = open(path).read()
attr = 'android:networkSecurityConfig="@xml/network_security_config"'
if attr not in s:
    s = s.replace("<application ", "<application " + attr + " ", 1)
    open(path, "w").write(s)
EOF
  echo "Plain HTTP allowed to 10.0.2.2 and localhost in the local Android build. Rebuild the app (--build) to apply."
}

android_http_off() {
  rm -f "$NSC_FILE"
  python3 - "$ANDROID_DIR/AndroidManifest.xml" <<'EOF'
import sys
path = sys.argv[1]
s = open(path).read()
s = s.replace('android:networkSecurityConfig="@xml/network_security_config" ', "")
open(path, "w").write(s)
EOF
  echo "Removed the local HTTP allowance. Rebuild the app before testing against staging or production."
}


# The emulator running our AVD (another emulator may be running too).
booted_device() {
  local serial
  for serial in $("$ADB" devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1 }'); do
    if [ "$("$ADB" -s "$serial" emu avd name 2>/dev/null | tr -d '\r' | head -1)" = "$AVD" ]; then
      echo "$serial"
      return
    fi
  done
}

ensure_emulator() {
  local device
  device="$(booted_device)"
  if [ -z "$device" ]; then
    say "Starting the Android emulator ($AVD)"
    local window_flag="-no-window"
    [ "${WINDOW:-0}" = 1 ] && window_flag=""
    nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD" $window_flag -no-snapshot-save -no-boot-anim \
      > "$LOGS/emulator.log" 2>&1 &
    "$ADB" wait-for-device
  fi
  for _ in $(seq 1 90); do
    device="$(booted_device)"
    [ -n "$device" ] && [ "$("$ADB" -s "$device" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
    sleep 2
  done
  device="$(booted_device)"
  [ -n "$device" ] || { echo "The emulator did not boot. See contract/.local/emulator.log"; return 1; }
  # The app and the flows' helper scripts both use http://localhost:8929. adb
  # reverse makes the emulator's localhost:8929 lead to this Mac's.
  "$ADB" -s "$device" reverse "tcp:$PROSE_PORT" "tcp:$PROSE_PORT" >/dev/null
  # Pin Maestro (via run.sh) to this emulator, in case another one is running.
  export E2E_DEVICE="$device"
  echo "Emulator ready: $device (localhost:$PROSE_PORT forwarded to this Mac)"
}

needs_build() {
  # Rebuild when forced, when the app isn't installed, or when the app code or
  # the Prose address changed since the last local build.
  local stamp="$LOGS/android-build.stamp" want
  want="$(git -C "$APP_REPO" rev-parse HEAD) http://localhost:$PROSE_PORT"
  [ "${BUILD:-0}" = 1 ] && return 0
  "$ADB" -s "$E2E_DEVICE" shell pm path "$APP_ID" >/dev/null 2>&1 || return 0
  [ "$(cat "$stamp" 2>/dev/null)" = "$want" ] || return 0
  return 1
}

run_flows() {
  local build_flag="" log="$LOGS/maestro-last.log"
  echo "Testing the app as checked out: $(git -C "$APP_REPO" rev-parse --abbrev-ref HEAD) @ $(git -C "$APP_REPO" rev-parse --short HEAD)"
  if needs_build; then
    build_flag="--build"
    say "Building the Android app for the local Prose (one time, about 10-20 minutes)"
  else
    say "Reusing the installed app build"
  fi
  (cd "$APP_REPO" && .maestro/run.sh "$MAESTRO_ENV" --platform android $build_flag) 2>&1 | tee "$log"
  local status="${PIPESTATUS[0]}"
  if [ -n "$build_flag" ] && grep -qE "\[(Passed|Failed)\]" "$log"; then
    echo "$(git -C "$APP_REPO" rev-parse HEAD) http://localhost:$PROSE_PORT" > "$LOGS/android-build.stamp"
  fi
  node "$REPO/contract/maestro-summary.mjs" "$log" "$LOGS/layer-c-last.json"
  # Record which app version the flows tested.
  node -e '
    const fs = require("fs"); const [file, branch, commit] = process.argv.slice(1);
    const c = JSON.parse(fs.readFileSync(file, "utf8")); c.app_branch = branch; c.app_commit = commit;
    fs.writeFileSync(file, JSON.stringify(c, null, 2));
  ' "$LOGS/layer-c-last.json" "$(git -C "$APP_REPO" rev-parse --abbrev-ref HEAD)" "$(git -C "$APP_REPO" rev-parse --short HEAD)"
  return "$status"
}

run_all() {
  rm -f "$LOGS/layer-c-last.json"
  say "Exposing $CONTAINER's Discourse"; forward || return 1
  say "Starting Prose against it"; start_prose || return 1
  write_env
  android_http_on || return 1
  ensure_emulator || { stop_all; return 1; }
  run_flows; local status=$?
  stop_all
  return "$status"
}

stop_all() {
  pkill -f "$APP_REPO/api.*src/index.ts" >/dev/null 2>&1
  docker rm -f "$PROXY" >/dev/null 2>&1
  echo "Stopped Prose and the port forward (the emulator keeps running for the next run)."
}

case "${1:-status}" in
  run) run_all ;;
  android-http) android_http_on ;;
  android-http-off) android_http_off ;;
  up)
    say "Exposing $CONTAINER's Discourse"; forward
    say "Starting Prose against it"; start_prose
    say "Maestro settings"; write_env
    ;;
  down) stop_all ;;
  status)
    docker ps --format '{{.Names}} {{.Status}}' | grep -E "^($CONTAINER|$PROXY) " || true
    curl -s -o /dev/null -w "Prose: HTTP %{http_code}\n" -X POST -H 'Content-Type: application/json' \
      --data '{"query":"{ __typename }"}' "http://localhost:$PROSE_PORT/" || echo "Prose: not running"
    ;;
  *) sed -n 2,21p "$0"; exit 2 ;;
esac
