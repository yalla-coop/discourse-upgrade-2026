#!/usr/bin/env bash
# Runs the contract checks inside a hop container (default: ft-baseline).
# Clears Discourse's rate limits first: on the local Docker copy they only
# reflect our own repeated runs, not a contract change.
#
#   contract/docker-run.sh [container] [run.mjs options...]
#   contract/docker-run.sh ft-baseline --writes --label baseline
set -euo pipefail
container="${1:-ft-baseline}"
shift || true
docker exec -u discourse:discourse -w /src -e LOAD_PLUGINS=1 "$container" \
  bin/rails runner 'r = Discourse.redis.without_namespace; keys = r.scan_each(match: "*#{RateLimiter.key_prefix}*").to_a; r.del(*keys) if keys.any?; puts "cleared #{keys.size}"' >/dev/null 2>&1
docker exec -u discourse:discourse -w /src "$container" node contract/run.mjs --env docker "$@"
