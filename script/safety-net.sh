#!/usr/bin/env bash
# Runs the upgrade safety net locally, in Docker. Nothing leaves your Mac.
#
#   script/safety-net.sh            Layer A tests + Layer B contract checks (about 2 minutes)
#   script/safety-net.sh full       A + B + Layer C: the real Android app through Maestro
#                                   (boots the emulator, builds the app only when needed)
#   script/safety-net.sh tests      Layer A only: tests for our 19 custom changes
#   script/safety-net.sh contract   Layer B only: every Prose -> Discourse call
#   script/safety-net.sh up         just start the container and the Discourse server
#   script/safety-net.sh restart    restart the Discourse server (after editing Discourse code)
#   script/safety-net.sh down       stop the container (data is kept)
#
# CONTAINER picks the hop container (default: ft-baseline) and HOP names the
# hop in the results (default: baseline), for example:
#   CONTAINER=ft-hop-3.4.7 HOP=3.4.7 script/safety-net.sh
#
# A full run records itself in results/runs/<hop>_<time>.json. Drop that file
# into the upgrade tracker to log it there, and commit it for the git history.
set -uo pipefail

CONTAINER="${CONTAINER:-ft-baseline}"
HOP="${HOP:-baseline}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
IN=(docker exec -u discourse:discourse -w /src -e LOAD_PLUGINS=1 "$CONTAINER")

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

up() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker isn't running. Open Docker Desktop and try again."
    exit 1
  fi
  if [ -z "$(docker ps -q -f name="^${CONTAINER}$")" ]; then
    if [ -z "$(docker ps -aq -f name="^${CONTAINER}$")" ]; then
      echo "Container $CONTAINER doesn't exist yet. See docs/upgrade/02-safety-net.md to create it."
      exit 1
    fi
    say "Starting container $CONTAINER"
    docker start "$CONTAINER" >/dev/null
    sleep 10
  fi
  if ! docker exec "$CONTAINER" curl -s -o /dev/null -f http://localhost:3000/session/csrf.json; then
    say "Starting the Discourse server inside $CONTAINER (about 30 seconds)"
    docker exec -d -u discourse:discourse -w /src -e LOAD_PLUGINS=1 -e UNICORN_PORT=3000 -e UNICORN_WORKERS=2 -e UNICORN_BIND_ALL=true \
      "$CONTAINER" bash -lc 'bin/unicorn > log/contract-server.log 2>&1'
    for _ in $(seq 1 45); do
      sleep 2
      docker exec "$CONTAINER" curl -s -o /dev/null -f http://localhost:3000/session/csrf.json && break
    done
  fi
  if [ ! -f "$REPO/contract/.local/docker.json" ]; then
    say "Seeding test data"
    "${IN[@]}" bin/rails runner contract/seed/docker_seed.rb
  fi
}

RSPEC_OUT="$(mktemp)"

tests() {
  say "Layer A: tests for our 19 custom changes (spec/yalla)"
  "${IN[@]}" bin/rspec spec/yalla 2>&1 | tee "$RSPEC_OUT"
  return "${PIPESTATUS[0]}"
}

contract() {
  say "Layer B: contract checks for every Prose -> Discourse call"
  "$REPO/contract/docker-run.sh" "$CONTAINER" --writes --compare baseline --label last-run
}

record() {
  local version
  version="$(grep -m1 'STRING = ' "$REPO/lib/version.rb" | sed -E 's/.*"(.*)".*/\1/')"
  node "$REPO/contract/summarize.mjs" \
    --hop "$HOP" \
    --rspec "$RSPEC_OUT" \
    --report "$REPO/contract/reports/last-run.json" \
    --compare "$REPO/contract/reports/baseline.json" \
    --version "$version" \
    --branch "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" \
    --commit "$(git -C "$REPO" rev-parse --short HEAD)" \
    "$@"
}

layer_c() {
  say "Layer C: Maestro flows on the real Android app"
  CONTAINER="$CONTAINER" "$REPO/script/layer-c.sh" run
}

case "${1:-all}" in
  up) up ;;
  down) docker stop "$CONTAINER" >/dev/null && echo "Stopped $CONTAINER (data kept)." ;;
  restart)
    # Use after editing Discourse code while the server runs: the dev server
    # hot-reloads code, and some Discourse files don't survive that cleanly
    # (e.g. "superclass mismatch for class ApprovalActivator").
    docker exec "$CONTAINER" bash -lc 'pkill -f unicorn; pkill -f sidekiq' >/dev/null 2>&1
    sleep 3
    up
    echo "Discourse server restarted in $CONTAINER."
    ;;
  tests) up; tests ;;
  contract) up; contract ;;
  all)
    up
    tests; a=$?
    contract; b=$?
    say "Summary"
    [ $a -eq 0 ] && echo "  Layer A (our changes):    PASS" || echo "  Layer A (our changes):    FAIL"
    [ $b -eq 0 ] && echo "  Layer B (API contract):   PASS" || echo "  Layer B (API contract):   FAIL"
    record
    exit $(( a || b ))
    ;;
  full)
    up
    tests; a=$?
    contract; b=$?
    layer_c
    say "Summary"
    [ $a -eq 0 ] && echo "  Layer A (our changes):    PASS" || echo "  Layer A (our changes):    FAIL"
    [ $b -eq 0 ] && echo "  Layer B (API contract):   PASS" || echo "  Layer B (API contract):   FAIL"
    record --maestro "$REPO/contract/.local/layer-c-last.json" \
      --maestro-baseline "$REPO/contract/reports/layer-c-baseline.json"
    exit $?
    ;;
  *) sed -n 2,19p "$0"; exit 2 ;;
esac
