#!/usr/bin/env bash
# Restores a staging Discourse backup into a SEPARATE database of a hop container
# (discourse_restore_test), makes it safe, and serves it on :3000 / :4200.
# Every Layer C run on staging data starts from this exact state.
#
#   script/restore-staging.sh <backup.tar.gz>
#   CONTAINER=ft-hop-3.4.7 script/restore-staging.sh <backup.tar.gz>
#
# Safe means: emails disabled, Lexicon push disabled, all webhooks inactive,
# queued background jobs cleared. Only then is the server started (with
# background jobs). The contract-test database (discourse_development) is not
# touched. Switch back to it with script/safety-net.sh restart.
#
# Then run Layer C on it:  DATA=staging script/layer-c.sh run
set -euo pipefail

BACKUP="${1:?usage: script/restore-staging.sh <backup.tar.gz>}"
CONTAINER="${CONTAINER:-ft-baseline}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DB="discourse_restore_test"
NAME="$(basename "$BACKUP")"
IN=(docker exec -u discourse:discourse -w /src -e LOAD_PLUGINS=1 -e DISCOURSE_DEV_DB="$DB" -e USER=discourse "$CONTAINER")

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Copying the backup into $CONTAINER"
mkdir -p "$REPO/public/backups/default"
cp "$BACKUP" "$REPO/public/backups/default/$NAME"

say "Stopping the server while restoring"
docker exec "$CONTAINER" bash -lc 'pkill -f "[u]nicorn|[p]itchfork"; pkill -f "[s]idekiq"' >/dev/null 2>&1 || true
sleep 3

say "Making sure the restore tools are current"
# Backups made since PostgreSQL's August 2025 releases contain \restrict lines
# that older psql clients can't read. The upgrade also replaces the server's
# extension files, so PostgreSQL is restarted to match them (minor version
# only; the data is compatible).
docker exec -u root "$CONTAINER" bash -lc \
  'before=$(psql --version); apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --only-upgrade postgresql-client-15 postgresql-15 >/dev/null 2>&1; after=$(psql --version); if [ "$before" != "$after" ]; then sv restart postgres >/dev/null; fi; echo "$after"'

# Wait until PostgreSQL really accepts queries (a fixed pause was not enough:
# on 2026-10-19 the restore started while the server was still shutting down,
# so nothing was restored and Layer C ran on an empty copy).
for _ in $(seq 1 60); do
  docker exec -u discourse:discourse "$CONTAINER" psql -d postgres -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 2
done
docker exec -u discourse:discourse "$CONTAINER" psql -d postgres -tAc 'select 1' >/dev/null 2>&1 \
  || { echo "PostgreSQL did not come back in $CONTAINER"; exit 1; }

say "Preparing a fresh $DB database"
docker exec -u discourse:discourse "$CONTAINER" bash -lc "dropdb --if-exists $DB" >/dev/null
"${IN[@]}" bash -lc 'bin/rake db:create db:migrate >/dev/null 2>&1 && bin/rails runner "SiteSetting.allow_restore = true" >/dev/null 2>&1'

say "Restoring $NAME"
result="$("${IN[@]}" bash -lc "yes y | bundle exec script/discourse restore $NAME 2>&1 | grep -E '^\[(SUCCESS|FAILED)\]|EXCEPTION'")"
echo "$result"
# Stop here unless the restore really succeeded: Layer C on a half-restored
# copy fails in confusing ways.
echo "$result" | grep -q '^\[SUCCESS\]' || { echo "The restore did not succeed. Stopping."; exit 1; }

say "Making the restored copy safe"
"${IN[@]}" bash -lc 'bin/rails runner "
  require %q(sidekiq/api)
  SiteSetting.disable_emails = %q(yes)
  SiteSetting.lexicon_push_notifications_enabled = false if SiteSetting.respond_to?(:lexicon_push_notifications_enabled=)
  WebHook.update_all(active: false)
  Sidekiq::Queue.all.each(&:clear); Sidekiq::RetrySet.new.clear; Sidekiq::ScheduledSet.new.clear
  admin = User.where(admin: true).where(%q(id > 0)).order(:id).first
  key = ApiKey.create!(user: admin, created_by: admin, description: %q(local Layer C on restored staging copy))
  File.write(%q(contract/.local/staging-data.json), JSON.pretty_generate(admin: { username: admin.username, api_key: key.key }))
  puts %(emails=#{SiteSetting.disable_emails} webhooks_active=#{WebHook.where(active: true).count} users=#{User.real.count} topics=#{Topic.count})
" 2>&1 | tail -1'
"${IN[@]}" bash -lc 'bin/rake posts:rebake_uncooked_posts >/dev/null 2>&1' || true

say "Starting the server on the restored data (background jobs on)"
docker exec -d -u discourse:discourse -w /src -e LOAD_PLUGINS=1 -e DISCOURSE_DEV_DB="$DB" \
  -e UNICORN_PORT=3000 -e UNICORN_WORKERS=2 -e UNICORN_SIDEKIQS=1 -e UNICORN_BIND_ALL=true \
  --env-file "$REPO/deploy/forward-trust.env" "$CONTAINER" bash -lc 'if [ -x bin/pitchfork ]; then s=bin/pitchfork; else s=bin/unicorn; fi; $s > log/restore-server.log 2>&1' 2>/dev/null \
  || docker exec -d -u discourse:discourse -w /src -e LOAD_PLUGINS=1 -e DISCOURSE_DEV_DB="$DB" \
    -e UNICORN_PORT=3000 -e UNICORN_WORKERS=2 -e UNICORN_SIDEKIQS=1 -e UNICORN_BIND_ALL=true \
    "$CONTAINER" bash -lc 'if [ -x bin/pitchfork ]; then s=bin/pitchfork; else s=bin/unicorn; fi; $s > log/restore-server.log 2>&1'
for _ in $(seq 1 40); do
  sleep 3
  docker exec "$CONTAINER" curl -s -o /dev/null -f http://localhost:3000/session/csrf.json && break
done
echo "Restored staging copy is being served by $CONTAINER. Next: DATA=staging script/layer-c.sh run"
