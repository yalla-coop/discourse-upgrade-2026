# 12 - Staging clone: the real upgrade on a server

Done on 2026-10-20 and 2026-10-21. This is the procedure production will repeat.

## What was done

1. **Snapshot of staging, then a new Lightsail instance from it** (the clone). Real staging was not touched.
2. **The old Discourse was stopped straight away** (`./launcher stop app`), because the clone starts with staging's email, push and webhooks.
3. **Checks:** PostgreSQL 13 (`/shared/postgres_data/PG_VERSION`) and 40 GB free.
   - The launcher was pinned at `aa547bc` (May 2025, detached HEAD), with the `image/` folder and `shared/.gitkeep` deleted locally.
   - Those were restored (`git checkout -- image shared/.gitkeep`), then the launcher was moved to `main` at **`1deba5f` (2026-10-16)**. **Pin production's launcher to the same commit.**
4. **New `containers/app.yml`:**
   - stock Discourse `version: v2026.9.0`
   - the old fork reset block removed
   - plugins pinned: `discourse-forward-trust` `264cbd2…`, Lexicon `upgrade-2026` (`845bf9b…`, then `83a747c…`)
   - the Reactions and Data Explorer clones removed (bundled since 3.5.4)
   - the 8 rate-limit settings from `deploy/forward-trust.env` added to `env`
   - `SKIP_POST_DEPLOYMENT_MIGRATIONS` removed
   - on the clone: a `nip.io` name, no SSL, and an email server that does not exist
5. **First rebuild with `postgres.13.template.yml` failed:**
   - error: `Errno::ENOENT … /etc/postgresql/13/main/postgresql.conf`
   - cause: the current base image (`discourse/base:2.0.20260915-0028`, Debian 13) still installs PostgreSQL 13 but no longer creates its cluster config, so **the PostgreSQL 13 template cannot be built with the current launcher**
   - nothing was changed on disk
6. **Switched to `postgres.18.template.yml`.** The first rebuild upgraded the data: it checked for twice the database size in free disk, dumped 13 and restored into 18, kept the old data in `/shared/postgres_data_old`, then asked for a second rebuild.
   - **This took 52 s on staging's data.**
   - The `role "postgres" already exists` and `current user cannot be dropped` errors are expected.
7. **The second rebuild** installed Discourse 2026.9.0 with the plugins and ran every migration. The clone then served Discourse 2026.9.0 (`343b20f`) with all of staging's data.
8. **Made safe:** `disable_emails = yes`, Lexicon push off, all webhooks inactive.

## App tests against the clone

`DATA=remote script/layer-c.sh run`. The key file is `contract/.local/staging-next.json` (git-ignored), holding the clone's admin key and `discourse_url`.

| Check | Result |
|---|---|
| 30 app flows | 30 / 30 (TC007, TC024 and TC031 failed while the Mac slept and passed on re-run) |
| TC100 (staging only) | pass, the first time it could run |
| Pending TC005, TC009, TC081, TC101 | all pass |

Prose was the app repo's `staging` branch, with the CSRF and both tag fixes.

## Lessons for production

- **PostgreSQL 13 → 18 happens in the same switch as Discourse 2026.9.** Budget two rebuilds. Time the data upgrade on the AWS rehearsal with production's data.
- **Prose picks `STAGING_*` API keys whenever the Discourse host contains "staging"** (`api/src/helpers/apiKeys.ts`). Our script now passes the key in both slots.
- **Discourse limits logins per IP** on a real server (`max_logins_per_ip_per_hour`, 30 by default; developer mode turns it off). A full test run from one machine logs in about 35 times. On the clone the limit was raised to 500 per hour and 60 per minute, and the rate-limit keys were cleared. Real users are unaffected.
- **Admin notices on 2026.9:** Lexicon's deep-link page used `.js.es6` and `.hbs` files. Converted on `upgrade-2026` (`83a747c`); 5 / 5 of its tests pass.
- **Run the robot headless and keep the Mac awake** (`caffeinate`). Sleep stretched flows to 30 minutes and caused 3 timing failures.

## Making the clone the new staging

1. Deploy staging Prose (#658, #660).
2. Attach a static IP.
3. Point the staging DNS at it.
4. Switch the clone's `app.yml` to the real name with SSL (keep emails off), then rebuild.
5. Stop the old staging instance and keep it as the way back.
6. QA and PM test with the existing staging app builds.
7. Turn email, push and webhooks back on later.
