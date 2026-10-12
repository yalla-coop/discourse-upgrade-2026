# 01 - Yalla patch inventory

Phase 0, step 2. Written 2026-10-12.

## Why this exists

The Untapped review lists the Lexicon plugin as the only custom code. In fact production (`yalla-coop/discourse` `main`, tagged here as `baseline/prod-3.4.0.beta4-dev`) also carries **19 Yalla commits on Discourse core**, about 350 lines. Prose depends on several of them, and the Lexicon plugin depends on one. If they are lost during the upgrade, the app keeps running but returns wrong data or stops sending notifications, and nothing reports an error.

Production branched from upstream `main` on **2025-01-29** (`cfa281a697`).

## Trial cherry-pick results

Each commit was cherry-picked on its own onto three upstream versions. A skipped commit makes later commits that build on it conflict too, so these numbers are the worst case.

| Target | Clean | Conflict |
|---|---|---|
| v3.4.7 (first hop) | 13 | 5 (chat + Gemfile.lock) |
| v3.5.4 | 10 | 8 |
| v2026.9.0 (current release) | 7 | 11 |

Non-chat patches mostly apply. **The chat patches conflict from the first hop onward**, because upstream redesigned chat notification levels in October 2024 (see group E).

## Inventory by group

Decision key: **Keep** = carry forward with the same behaviour. **Rewrite** = behaviour must be kept, but the code has to change. **Setting** = replace the code with configuration. **Drop** = not needed.

### A. Rate limits turned off - Setting

- `4f86acaa3e` (part): `config/discourse_defaults.conf` raises every API and per-IP limit to 1,000,000 and sets `max_reqs_per_ip_mode = warn`.
- These are global settings, so they can be set as `DISCOURSE_MAX_REQS_PER_IP_PER_MINUTE` and similar variables in `app.yml` with no code change.
- Note for later: this switches rate limiting off for everyone, not only for Prose. A tighter option is to exempt only Prose's IP.

### B. Category group permissions in `/site.json` - Keep

- `4f86acaa3e` (part): adds `group_permissions` to `BasicCategorySerializer`. Prose reads it.
- The same commit also **accidentally removed** `has_one :uploaded_background_dark`, probably while resolving a merge. Do not carry that line removal forward.

### C. Excerpts return full HTML and links - Keep (high blast radius)

- `fed449dc55` un-strip links, `51c2f73fc1` return video links and include cooked/blurb/thumbnails in search, `3cf8b666e0` `Post.excerpt` returns the full cooked HTML, `1f373c7c58` post item excerpt uses cooked.
- These change Discourse **globally**, not only for the app. `ExcerptParser`'s `strip_links` and `strip_images` logic is inverted, and `Post.excerpt` no longer truncates. This affects emails, push bodies, summaries and search.
- For the upgrade: keep behaviour identical. Refactoring this into app-only fields is technical debt for later.
- The edit to the 2014 migration `20140318150412_add_excerpt_to_topics.rb` is **Drop**, because that migration never runs again.
- At v2026.9.0, `lib/excerpt_parser.rb` and `app/serializers/post_item_excerpt.rb` conflict.

### D. `flagged_by_user` on topics - Keep

- `fe124c10cf`, `fb61063527`: adds `flagged_by_user` to topic list, topic view and search results.
- Flag IDs `[3,4,6,7,8,9,10]` are hardcoded. These IDs are **unchanged** in v2026.9.0.
- Note: this runs 2 extra queries per topic in every list (N+1). It's fine for now, but worth fixing later.

### E. Chat notifications - Rewrite (highest risk)

- `4f86acaa3e` (chat part), `4814174c29` migration `20240710161417` (default level "always"), `9c849ac9b8` (messages from before you joined are not unread), `d1b1f3be45`, `fb0ad7f1f5`, `68b411e9cd`.
- Behaviour to preserve:
  1. Watching/mention logic driven by the **mobile** notification level.
  2. A `Notification` record is created for every chat message, and the custom event **`created_chat_notification`** is fired. **The Lexicon plugin listens to this event (`plugin.rb:86`) to send chat pushes.**
  3. Messages sent before a user joined don't count as unread, aren't emailed and aren't notified.
  4. New memberships default to "always".
- Why it must be rewritten: in October 2024 upstream replaced `desktop_notification_level` and `mobile_notification_level` with a single `notification_level` column. Upstream still ignores the old columns today (checked on `main`, 2026-10-12). Our fork un-ignores them (`fb0ad7f1f5`) and reads them.
- **Open question:** which column does Prose write when a user changes chat notification settings? The answer decides the data migration at cutover.

### F. Chat serializers - Keep

- `4f86acaa3e` (part):
  - `admin` on chatable users
  - `can_chat` uses `can_direct_message?`
  - chatable groups include their `users`
  - `ignored_usernames` on the user serializer
  - `can_chat_user` is false for yourself
- Note: chatable groups load every user in the group, which could get slow for large groups.

### G. Group owner email on signup - Keep

- `fb087acfbb`, `160a49046f`, `081062113b`, `d66f43f15d`: the `config/initializers/notify_group_owner.rb` initializer emails group owners when a new user confirms their email. The "holding group" wording is decided in code.
- `b327885ba6`, `a7ecc2fc43`: `EmailToken.confirm` fires `user_confirmed_email` only on signup, not on password reset. Without this, owners get an email on every password reset.
- The locale strings added in `server.en.yml` have been unused since `d66f43f15d` hardcoded the text. **Drop** them.
- `email_token.rb` conflicts from v3.5.4 onward.

### H. Gemfile.lock - Drop

- `3cf8b666e0` (part), `1f7697ae2f`. Use upstream's lockfile.

### Not in git: `lib/tasks/fix_notification_levels.rake`

- This sits untracked in the old working copy (`~/yalla/discourse`) and was never committed. It moves group categories from Watching to Watching First Post.
- Commit it to the new repo so it isn't lost.

## Recommendation: move custom code into one in-house plugin

Groups B, C, D, F and G can be done with `add_to_serializer`, event handlers and `prepend` patches inside a single plugin, for example `discourse-forward-trust`. E needs rewriting anyway, so it can go in the same plugin. A becomes `app.yml` settings.

If we do this, **Discourse core goes back to stock**:
- Every future upgrade becomes "bump the version tag, rebuild, run the checklist".
- There's no core fork to rebase.
- We'd own just two pieces of code: Lexicon and our plugin.

This is the strongest lever for keeping to the 6-monthly upgrade schedule.

The cost is a few extra days now, and C is the hardest group to move cleanly. A middle path: re-apply C as core patches for this upgrade, and move everything else into the plugin.

**Decision needed (Mahmoud + Alex):** core patches vs plugin vs middle path.

## Next actions

1. Answer the open question in E: which chat notification column does Prose write?
2. Decide the approach above.
3. Commit the untracked rake task.
