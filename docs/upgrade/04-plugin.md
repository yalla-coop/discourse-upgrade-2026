# 04 - discourse-forward-trust plugin

## Before the plugin (stock core)

Setup: core reset to stock upstream cfa281a697 (`git diff --stat cfa281a697 -- app lib config db plugins/chat ':!lib/tasks/fix_notification_levels.rake'` prints nothing), the empty plugin skeleton installed, container `ft-plugin-baseline`, hop `plugin-baseline`.

Layer A: 31 examples, 23 failures. The 6 that pass on stock: plugin loads, "does count messages sent after joining", "includes ignored_usernames on the user serializer" (stock sends it on your own profile), "says you cannot chat with yourself", `/c/{id}/show.json` is included for admins only, "does not email the owner when a user resets their password". The failing list below is the to-do list for Tasks 3-8.

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
