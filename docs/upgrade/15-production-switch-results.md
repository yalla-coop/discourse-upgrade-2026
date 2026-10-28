# 15 - Production switch: what happened on 27 Oct 2026

Production was switched to Discourse 2026.9 on the evening of 27 Oct 2026, following `14-production-switch.md` (option B: new server from a snapshot, upgraded while production was read-only, then the static IP moved). This file records what actually happened, the numbers, and what we would do differently. Times are UTC.

## Result

| | |
|---|---|
| Live on `app.forwardtrust.org.uk` | Discourse `2026.9.0`, commit `343b20f9`, PostgreSQL 18 |
| Server | `forwardtrust-prod-2026-9` (built from the pre-upgrade snapshot), with `StaticIp-1` (51.24.109.181) |
| Launcher | discourse_docker `1deba5f` |
| Plugins | `discourse-forward-trust` `264cbd2`, Lexicon `83a747c` (Lexicon PR #1 merged after the switch as `7a67746`, which contains `83a747c`) |
| Content | users, topics, posts, categories and user emails unchanged |
| Posting paused | about an hour; members could read throughout |
| Way back | old server `forwardtrust-prod-4gb`, stopped, plus two pre-upgrade snapshots |

## Timeline

| Time | What |
|---|---|
| evening | Production set to read-only; snapshot taken |
| | `docker update --restart=no app` run on the old server, then a **second** snapshot (see surprise 1) |
| | New server built from the second snapshot; internet blocked; email, push and webhooks switched off; read-only switched on by hand (see surprise 2) |
| | "Before" numbers taken on the new server |
| 22:43 - 22:47 | Rebuild 1: PostgreSQL 13 to 18, 3 min 53 s (rehearsal: 4 min 6 s) |
| 22:47 - 22:54 | Rebuild 2: Discourse 2026.9.0, 6 min 38 s (rehearsal: 6 min 29 s) |
| | Health, version and features checked; new bundled features switched off; "after" numbers compared |
| about 23:30 | `StaticIp-1` moved to the new server; old forum stopped; email, push and webhooks 1, 2 and 4 switched back on; read-only off |
| 23:40 | Push fixed with a restart (see surprise 3) |
| 23:46 | Lexicon PR #1 merged |

## Checks after the switch

- `https://app.forwardtrust.org.uk/srv/status`: `200`. Certificate valid until 15 Dec 2026, renewal due 15 Nov (both the RSA and the EC certificates).
- The page's generator tag shows `Discourse 2026.9.0 ... 343b20f9`.
- Store app 1.0.48: login, feed and posting work; push received on two phones; Admin test email received.
- QA passed on production.

## Before and after

Taken on the new server, before and after the two rebuilds, with `script/upgrade-checks/numbers.rb` and `compare.rb` (counts and fingerprints only).

| | Before | After | Why |
|---|---|---|---|
| Version | 3.4.0.beta4-dev `eeb36c20` | 2026.9.0 `343b20f9` | |
| Users / topics / posts / categories | 804 / 2,685 / 3,385 / 84 | **same** | |
| User emails | 805 | **same** | |
| Uploads / files | 1,710 / 6,974 | 1,714 / 6,978 | +4 added by the upgrade, as in the rehearsal |
| Groups | 59 | 61 | +2 built-in groups (`anonymous_users`, `logged_in_users`), as in the rehearsal |
| Database | 515 MB | 416 MB | dump and restore packs the data |

Fewer rows after:

- `notifications` 233,815 to 233,810. All five were private-message notifications (type 6: 915 to 910). Discourse's migration `20260807182856_cleanup_stranded_pm_notifications` deletes PM notifications for people who are no longer in that conversation. Not in the rehearsal because those cases arose later. Expected.
- `topic_hot_scores` 1,133 to 1,129 and `problem_check_trackers` 28 to 25: Discourse's own clean-up and admin dashboard checks.

Tables gone, settings changed and plugins added were the same as in the rehearsal (`13-production-rehearsal.md`, step 10). New bundled features were switched off as planned.

## Surprises, and what changed in the runbook

1. **The first snapshot was taken before `docker update --restart=no app`.** A server built from it starts Discourse at boot with email and push on. The new server ran for about 3 minutes like that before it was stopped; members may have received a few duplicate notifications. A second snapshot, taken after the command, was used instead. Runbook step 4 now says to run it first and check with `docker inspect`.
2. **Read-only did not come over in the snapshot.** The setting lives in Redis, which had not saved it to disk yet. It was switched on by hand on the new server. Runbook step 5 now covers this.
3. **No push was sent after the switch.** Notifications were created and nothing failed, but no push left the server. Lexicon only sets up push (its job and its `before_create_notification` listener) when the forum starts, and only if `lexicon_push_notifications_enabled` is on at that moment. The new server had started with push off (silenced in step 5). `docker exec app sv restart unicorn` fixed it (about a minute of downtime). Runbook step 9 now includes the restart and a check. Pushes for activity between the switch and the restart were not sent.

Also worth knowing:

- The launcher prints the container's environment, including the SMTP password, in its `docker run` line. Do not paste rebuild output anywhere shared. The SMTP key was replaced after the switch as a precaution.
- `about.json` does not answer anonymous requests on this login-required site. To check the version from outside, read the generator tag: `curl -s https://app.forwardtrust.org.uk/login | grep -o 'name="generator" content="[^"]*"'`.

## Follow-ups

| When | What |
|---|---|
| until 10 Nov | Keep `forwardtrust-prod-4gb` stopped and do not start it except to roll back (its forum would start by itself with email and push on). It is billed while stopped. |
| after 15 Nov | Check the certificate renewed: the expiry should move past 15 Dec 2026. |
| 10 Nov | Delete `forwardtrust-prod-4gb` and both pre-upgrade snapshots; on the new server remove `/var/discourse/shared/standalone/postgres_data_old`. |
| late Nov | Archive the old fork `yalla-coop/discourse`. |
