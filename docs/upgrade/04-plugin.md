# 04 - discourse-forward-trust plugin

## Before the plugin (stock core)

Setup: core reset to stock upstream cfa281a697 (`git diff --stat cfa281a697 -- app lib config db plugins/chat ':!lib/tasks/fix_notification_levels.rake'` prints nothing), the empty plugin skeleton installed, container `ft-plugin-baseline`, hop `plugin-baseline`.

Layer A: 31 examples, 23 failures, 8 passes. The 8 passes are the 2 rate limit examples (see below) and these 6: plugin loads, "does count messages sent after joining", "includes ignored_usernames on the user serializer" (stock sends it on your own profile), "says you cannot chat with yourself", `/c/{id}/show.json` is included for admins only, "does not email the owner when a user resets their password". The failing list below is the to-do list for Tasks 3-8.

Failing Layer A tests (spec/yalla):

- core_changes_spec.rb
  - category group_permissions: reports 'everyone' with full access for a public category (:23)
  - category group_permissions: lists the groups of a restricted category (:31)
  - category group_permissions: is included for categories in /categories.json (:42)
  - category group_permissions: is included for categories in /site.json (:75)
  - post previews: returns the full cooked HTML as the post excerpt (:91)
  - post previews: keeps links in the topic excerpt (:95)
  - post previews: keeps links even when a caller asks to strip them (:99)
  - post previews: turns uploaded videos into a [Video](url) link (:110)
  - flagged_by_user: is false in topic lists until the user flags the topic (:132)
  - flagged_by_user: is true on the topic page after the user flags it (:142)
  - flagged_by_user: is false for another user who did not flag it (:150)
  - search results include cooked HTML on posts and flagged_by_user on topics (:165)
  - group owner email: emails the owner of a holding group on signup, with holding wording (:203)
  - group owner email: uses plain group wording for groups that are not holding groups (:214)
- chat_notifications_spec.rb
  - new channel memberships default to notifying always, on desktop and on mobile (:44)
  - a message in a channel the member watches creates exactly one chat_message notification (:60)
  - a message in a channel the member watches fires :created_chat_notification once (:76)
  - a member who turned mobile notifications off gets no notification and no Lexicon event (:94)
  - a member whose mobile level is 'mention' is notified when mentioned (:109)
  - a member whose mobile level is 'mention' is not notified for a message that doesn't mention them (:118)
  - messages sent before the member joined are not counted as unread (:130)
  - chat serializers: includes admin on chatable users (:148)
  - chat serializers: includes each group's users, with admin, in /chat/api/chatables (:166)

Rate limit spec: it checks `deploy/forward-trust.env` (the test environment ignores DISCOURSE_* env vars), so both its examples pass on stock core. An earlier version asserted GlobalSetting values and could not pass.

Layer B: 95 passed, 11 failed. Checks that changed from the baseline (PASS -> FAIL):

- #15 Users: Another member's profile (UserLite): `user.ignored_usernames`
- #34 Topics: Latest / Top / Category / Tag / Category + tag topic list: `topic_list.topics[].flagged_by_user`
- #42 Topics: Private messages inbox: `topic_list.topics[].flagged_by_user`
- #43 Topics: Private messages sent: `topic_list.topics[].flagged_by_user`
- #59 Search: `topics[].flagged_by_user`
- #61 Category list with subcategories: `category_list.categories[].group_permissions` (and its `group_name`, `permission_type`)
- #72 Chat: Chatables: `groups[].users` (and `model.id`, `model.username`, `model.avatar_template`, `model.admin`)

Plugin note: stock core reports version 3.4.0.beta4-dev, which is older than 3.4.0, so the
plugin uses `required_version: 3.4.0.beta3` (3.4.0 would stop Discourse activating it).

## Result with the plugin

Equivalence run `plugin-baseline_20261013-191425` on a restored staging backup: Layer A 43 examples, 0 failures. Layer B 106 of 106 checks pass, 0 changed from the baseline. Layer C 29 of 29 flows pass. Without the plugin, Layer A has 30 failures.

After the final-review fixes (rulings R11a, R16, R17): Layer A 48 examples, 0 failures. Layer B 106 of 106, 0 changed. The 5 new examples (no `chat_mention` for a new mention, one web alert, `chat_mention` on edit, thread join trigger, thread backfill) pass on production code too, except the thread backfill, which names the plugin's migration.

## What the plugin does

Each feature is one file in `plugins/discourse-forward-trust/lib/discourse_forward_trust/`. The plugin README lists the Yalla commits each file replaces and what to re-check on every Discourse upgrade.

The plugin has one site setting, `forward_trust_chat_summary_emails` (default off). Production's chat "while you were away" summary email query is broken (`PG::UndefinedTable`, verified), so production sends none. The plugin keeps that. Turning the setting on starts them.

The plugin has three migrations:

1. `20261013120000` chat level defaults. Production already has level 2 (always), so nothing changes there.
2. `20261013120001` one-time unread backfill. It marks messages from before each existing member joined as read. The SQL is frozen in the migration and runs one correlated subquery per membership. On the staging copy (EXPLAIN ANALYZE, rolled back): channel UPDATE 3.6 ms, 81 channel memberships, 3 rows changed; thread UPDATE 0.04 ms, 0 rows. Time both on the AWS practice copy of production before the cutover.
3. `20261013120002` BEFORE INSERT triggers on `user_chat_channel_memberships` and `user_chat_thread_memberships`. A new membership starts with earlier messages read, including bulk inserts that skip Rails callbacks. The triggers live in the database. Their functions live in the schema `forward_trust` (`forward_trust.channel_membership_last_read()`, `forward_trust.thread_membership_last_read()`), not in `public` (see "Backup and restore"). The migration's `down` drops the triggers, the functions and the schema. Removing the plugin without rolling the migration back leaves them in place.

For new chat messages the plugin creates no `chat_mention` notification (ruling R16). Production's `Chat::Notifier#notify_new` had no mention job, so a mentioned member got one `chat_message` notification and the Lexicon push, nothing more. Stock would add a `chat_mention` row and a mention push for every mention (with `@all`/`@here`, for the whole channel). Editing a message to add a mention still creates a `chat_mention`, as in production. Mentioned members still get the web chat alert, from Discourse's NotifyWatching job, as in production.

## Backup and restore

Discourse backs up only the `public` schema (`pg_dump --schema=public`) and restores it in one transaction that stops at the first error. Core keeps its own functions in the `discourse_functions` schema for this reason. The plugin's trigger functions live in the schema `forward_trust`, so they are not in the dump. The triggers are part of the tables, so they are in the dump and point at `forward_trust.*`.

So a backup taken with the plugin restores onto a site where the plugin is installed and migrated (the functions are already there). A backup taken before the plugin (production today) restores anywhere; on a site with the plugin, the restore's migration step then runs the plugin's migrations on the restored data.

An earlier version of the migration put the functions in `public`. That broke every restore on a site with the plugin: `ERROR: function "forward_trust_channel_membership_last_read" already exists with same argument types`, then rollback, `[FAILED]`. The current migration drops those old functions if a database has them.

Round trip tested on 2026-10-13 in `ft-plugin-baseline` (dev database, plugin installed and migrated): `script/discourse backup`, then `script/discourse restore` of that file in place. With the functions in `public`: `[FAILED]` with the error above. With the functions in `forward_trust`: `[SUCCESS]`, functions and triggers in place afterwards.

## Differences from production

Each is a deliberate ruling.

- The group owner email no longer crashes when a group has no full name. It uses the group's name.
- `flagged_by_user` is false for logged-out viewers. Production raised an error.
- On password reset, Discourse's own `:user_confirmed_email` listeners (for example core webhooks) now fire, as in stock. Production suppressed the event for every listener. The plugin's own group owner email still only fires on signup.
- Thread mentions are counted by the thread's own last-read. Production also hid thread mentions older than the channel's last-read. This is a rare difference in badge counts.
- `PrettyText.excerpt` comes from the Lexicon plugin (plain text, "uploaded a video"). This is unchanged from production.
- Stock `Jobs::Chat::NotifyWatching` sends the desktop/web chat alert to members whose mobile level is "never". Production's edited job skipped them. This is web only: phone pushes come from Lexicon, through the plugin's job, which still skips "never".

## How production switches (at the final cutover, not now)

Production's `containers/app.yml` changes in four places:

1. **Stock Discourse instead of the fork.** Remove the `after_code` commands that reset the code to `yalla-coop/discourse` `main`. Pin the version instead, under `params:` then `version: <the final hop's tag>`.
2. **Install the plugin** next to Lexicon in the plugin `git clone` list, pinned to a tag or commit: `git clone https://github.com/yalla-coop/discourse-forward-trust.git && git -C discourse-forward-trust checkout <tag or commit>`. The repo must be cloneable **without credentials** during `./launcher rebuild` (a public repo, or a token in the URL). A failed clone stops the rebuild and leaves the site down. Test the exact clone command on the server before the cutover.
3. **Rate limits as environment variables.** Copy the 8 lines of `deploy/forward-trust.env` into the `env:` section, as `KEY: "value"`. The Layer A rate limit test checks that file, because the test environment ignores `DISCOURSE_*` variables.
4. **Stop installing reactions and data-explorer separately.** From 3.5.4 they are bundled in core, so remove their `git clone` lines at the final hop.

On the first rebuild the plugin's three migrations run (see above). The chat level defaults change nothing. The backfill runs once. The schema `forward_trust`, its two functions and the triggers are created.

Cutover checklist additions:

- Before the rebuild, take a Discourse backup and copy it off the server (see 05-backup-restore.md).
- After the rebuild, run the backup round trip on the AWS practice copy (not on production): `discourse backup`, then `discourse restore <that file>` on the same site. It must end with `[SUCCESS]`. This proves backups taken with the plugin restore.
- Check with `psql` that `\df forward_trust.*` lists both functions and that `public` has no `forward_trust_*` functions.

### Rollback

Revert `app.yml` to the fork (the `after_code` reset commands back, the plugin `git clone` line removed) and rebuild. What the plugin left in the database is harmless to the fork: the triggers only fill `last_read_message_id` for new memberships (production's own queries already hide pre-join messages), the backfill only marked pre-join messages read, and the three `schema_migrations` rows are ignored. To remove the triggers too, run `DROP SCHEMA forward_trust CASCADE` (this drops the two functions and the triggers that use them). If you roll back by restoring a backup, use the one taken before the cutover, or keep the `forward_trust` schema: a backup taken with the plugin needs its functions.

The old core migration `20240710161417` stays recorded in production's `schema_migrations`. With stock code it is never run again.
