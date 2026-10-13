# 05 - Backups: Discourse backup, tested by restoring it

Written 2026-10-13.

## Decision

Use a **Discourse backup**, not a plain `pg_dump`. It bundles the database **and the uploads** (images, files) in one `.tar.gz`, and Discourse's own restore checks the version and re-points URLs to the new host.

On the server (Alex), from the Discourse container:

```bash
cd /var/discourse && ./launcher enter app
discourse backup          # writes /var/discourse/shared/standalone/backups/default/<name>.tar.gz
```

Then copy the file **off the server** (for example to S3 or a laptop). A backup on the same server is lost with the server.

A backup restores on the **same or a newer** Discourse version. The version is in the file name (`-v20250205104150` = the last migration it contains).

## Restore test with the staging backup (2026-10-13)

File: `yalla-community-2026-10-13-135532-v20250205104150.tar.gz` (24 MB), from staging.
Restored into a **separate database** (`discourse_restore_test`) in the local `ft-baseline` container, so the safety-net test data was not touched, and with no server or background jobs running, so nothing could email or push to staging users.

```bash
cp <backup>.tar.gz ~/yalla/discourse-upgrade/public/backups/default/   # git-ignored
docker exec -u discourse:discourse -w /src -e LOAD_PLUGINS=1 -e DISCOURSE_DEV_DB=discourse_restore_test ft-baseline \
  bash -lc 'bin/rake db:create db:migrate && bin/rails runner "SiteSetting.allow_restore = true"'
docker exec -u discourse:discourse -w /src -e LOAD_PLUGINS=1 -e DISCOURSE_DEV_DB=discourse_restore_test -e USER=discourse ft-baseline \
  bash -lc 'yes y | bundle exec script/discourse restore <backup>.tar.gz'
```

**Result: `[SUCCESS]`.** Restored: 34 users, 93 groups, 7 categories, 168 topics, 177 posts, 10 chat channels, 41 chat messages, 27 uploads. All upload files present on disk. Site title "Yalla Community", schema version 20250205104150. Background jobs queued by the restore were cleared afterwards.

## What we learned

1. **The restoring machine needs an up-to-date PostgreSQL client.** Since the August 2025 PostgreSQL security releases, dumps contain a `\restrict` line. Older `psql` (our container had 15.10) stops with `invalid command \restrict`. Upgrading only the client to 15.19 fixed it. The real cutover uses a current Discourse image, so production is fine; keep this in mind for any older machine.
2. **Local dev quirk only:** in the dev container the restore connects as `$USER`, which `docker exec` doesn't set, so pass `-e USER=discourse`. Not relevant on a real server.
3. **A restored copy holds real push subscriptions** (`push_notifications=1` was remapped). Never run a server with background jobs on a restored copy of production or staging without blocking push and email first. This is the same rule as for the AWS practice copy.

## Layer C on staging data (2026-10-13)

The Maestro flows were written for staging, so Layer C runs best on a restored staging backup instead of the small contract seed:

```bash
STAGING_BACKUP=~/Downloads/yalla-community-...tar.gz script/safety-net.sh full
```

That restores the backup fresh (`script/restore-staging.sh`: emails, Lexicon push and webhooks off; queued jobs cleared), runs the flows with the staging test accounts against the **local** Prose, compares with `contract/reports/layer-c-baseline-staging.json`, then switches the server back to the test database.

**Baseline on staging data: 29 / 30 flows** (seed data: 18 / 30).
- **TC100** is not run locally: its helper script refuses unless the Discourse host contains "staging". Deliberate guard.
- **TC003** is marked flaky (failed once returning from the browser; passed 4 other times). A flaky failure is reported but doesn't fail the hop.

For every hop, restore the **same** backup, so each hop starts from identical data. This also proves at every hop that an older backup restores into a newer Discourse, which is what the production cutover does.

Two setup lessons:
- The app and the flows' helper scripts both use `http://localhost:8929`; `adb reverse` connects the emulator's localhost to the Mac's. (The emulator-only address `10.0.2.2` broke the helper scripts, which run on the Mac.)
- Upgrading the PostgreSQL client in the container also replaced server extension files; restart PostgreSQL (`sv restart postgres` as root) so the server matches them. `script/restore-staging.sh` keeps the client current.
