# 03 - Prose → Discourse API inventory

Written 2026-10-12 from `forward-trust-community-mobile-app` @ `8482d824f7` (`api/src`, excluding `generated/` and `lib/`). This is the list Layer B (contract tests) is built from. Re-check it before each future upgrade.

**93 distinct outbound calls** plus 1 inbound webhook. Every authenticated GraphQL request first calls `GET /session/csrf.json` (`client.ts:283`).

Auth column:
- **user** = the member's relayed session cookie (`context.client`), or anonymous when logged out
- **anon** = a fresh CSRF and session
- **admin** = `Api-Key` header

## Calls by area

| Area | Count | Rows |
|---|---|---|
| Auth / session | 14 | 1-14 |
| Users & profiles | 15 | 15-29 |
| Notifications | 4 | 30-33 |
| Topics & posts (polls, bookmarks, PMs, timings) | 23 | 34-56 |
| Reactions | 2 | 57-58 |
| Search | 1 | 59 |
| Categories / tags / site | 7 | 60-66 |
| Groups (admin) | 2 | 67-68 |
| Uploads | 2 | 69-70 |
| Chat (9 `/chat/api`, 3 old style) | 12 | 71-82 |
| Lexicon push plugin | 5 | 83-87 |
| Admin | 6 | 88-93 |

## Full table

| # | Method | Path | Where (api/src) | Fields Prose reads | Auth |
|---|---|---|---|---|---|
| 1 | GET | /session/csrf.json | helpers/auth.ts:17 | `csrf`, set-cookie | none/user |
| 2 | POST | /session.json | helpers/auth.ts:94 | `error`, `failed`, `user`, `user_badges`, `badges`, `users`, `topics`; set-cookie becomes the token | anon |
| 3 | GET | /users/hp.json | helpers/auth.ts:127 | `value`, `challenge`, `errors` | anon |
| 4 | GET | /session/hp.json | helpers/auth.ts:131 | same as 3 (fallback) | anon |
| 5 | GET | /session/current.json | helpers/auth.ts:157 | `current_user.id/username/name`, set-cookie | user |
| 6 | DELETE | /session/{username}.json | auth/logoutMutation.ts:90 | status | user |
| 7 | POST | /session/forgot_password.json | auth/changePasswordMutation.ts:25 | `success === 'OK'` | user/anon |
| 8 | POST | /users.json | auth/registerMutation.ts:31 | `user_id`, `message` | anon |
| 9 | PUT | /u/activate-account/{token}.json | auth/activateAccountMutation.ts:32 | `success`, `message` | anon |
| 10 | PUT | /u/password-reset/{token}.json | auth/resetPasswordMutation.ts:28 | `success`, `message`, `errors` | anon |
| 11 | GET | /invites/{token}?t= (Accept json) | auth/inviteInfoQuery.ts:28 | `email`, `username`, `invited_by.username`, `expired`, `error` | anon |
| 12 | PUT | /invites/show/{token}.json | auth/inviteRegisterMutation.ts:50 | `success`, `errors`, `failed`, `message`, `user` | anon |
| 13 | GET | /u/check_username | auth/checkUsernameQuery.ts:15 | `available`, `error` | user |
| 14 | DELETE | /u/{username}.json | auth/deleteAccount.ts:18 | status | user |
| 15 | GET | /users/{username}.json | user/userProfileQuery.ts:14 | `user` (+ **`ignored_usernames`**, `groups`, `user_option`, `group_users[].notification_level`), badges | user |
| 16 | PUT | /users/{username}.json | user/editProfileMutation.ts:52 | `user` | user |
| 17 | PUT | /u/{username}/preferences/username.json | user/changeUsernameMutation.ts:21 | `id`, `username` | user |
| 18 | PUT | /u/{username}/preferences/avatar/pick.json | user/saveProfilePictureMutation.ts:22 | status | user |
| 19 | POST | /u/{username}/preferences/email.json | email/addEmailMutation.ts:23 | status | user |
| 20 | PUT | /users/{username}/preferences/email.json | email/changeEmailMutation.ts:18 | status | user |
| 21 | DELETE | /users/{username}/preferences/email.json | email/deleteEmailMutation.ts:21 | `success` | user |
| 22 | PUT | /users/{username}/preferences/primary-email.json | email/setPrimaryEmailMutation.ts:18 | `success` | user |
| 23 | PUT | /user-status.json | user/editUserStatusMutation.ts:24 | status | user |
| 24 | DELETE | /user-status.json | user/deleteUserStatusMutation.ts:17 | status | user |
| 25 | PUT | /u/{username}/notification_level.json | user/ignoreUserMutation.ts:20 | status | user |
| 26 | GET | /u/search/users.json | user/searchUserQuery.ts:27 | `users[]`, `groups[].name/full_name` | user |
| 27 | GET | /user_actions.json | user/userActivityQuery.ts:53 | `user_actions[]` incl. `excerpt` | user |
| 28 | GET | /badges.json | user/badgeQuery.ts:22 | `badge_groupings`, `badge_types`, `badges` | user |
| 29 | GET | /badges/{id}.json | user/singleBadgeQuery.ts:14 | `badge_types`, `badge` | user |
| 30 | GET | /notifications.json | notifications/notificationQuery.ts:56 | `notifications[]` (id, notification_type, read, created_at, post_number, topic_id, fancy_title, slug, data.*), `total_rows_notifications`, `seen_notification_id`, `load_more_notifications` | user |
| 31 | PUT | /notifications/mark-read.json | notifications/markReadMutation.ts:19 | status | user |
| 32 | POST | /t/{id}/notifications.json | notifications/postNotificationsMutation.ts:20 | status | user |
| 33 | POST | category/{id}/notifications.json | notifications/categoryNotificationsMutation.ts:21 | status | user |
| 34 | GET | /latest, /top[/{period}], /c/{id}/l/{sort}, /tag/{tag}/l/{sort}, /tags/c/{id}/{tag}/l/{sort} (.json) | topics/topicsQuery.ts:33 | `topic_list.topics[]` incl. **`flagged_by_user`**, `excerpt`, `image_url`, `liked`, `notification_level`, `posters[]`; `users[]` | user |
| 35 | GET | /t/{id}.json | helpers/topicDetail.ts:43 | `post_stream`, `details`, `like_count`, `image_url`, `actions_summary`, `suggested_topics` | user |
| 36 | GET | /t/{id}/{post_number}.json | helpers/topicDetail.ts:43 | same as 35 | user |
| 37 | GET | /t/{id}/posts.json | helpers/topicDetail.ts:43; topics/pinnedPostsQuery.ts:22 | same as 35; `custom_fields.pinned` | user |
| 38 | PUT | /t/-/{id}.json | topics/editTopicMutation.ts:22 | `basic_topic` | user |
| 39 | DELETE | /t/{id}.json | topics/deletePostMutation.ts:19 | status (sends a post id, see bugs) | user |
| 40 | PUT | /t/{id}/remove-allowed-user.json | topics/leaveMessageMutation.ts:19 | status | user |
| 41 | POST | /topics/timings.json | topics/timingsMutation.ts:20 | status | user |
| 42 | GET | /topics/private-messages/{username}.json | topics/privateMessageQuery.ts:23 | `topic_list.topics`, `users`, `primary_groups` | user |
| 43 | GET | /topics/private-messages-sent/{username}.json | topics/privateMessageQuery.ts:29 | same as 42 | user |
| 44 | GET | /posts/{id}.json | helpers/fetchPost.ts:19 | post fields (cooked, raw, actions_summary, polls, reactions, custom_fields) | user |
| 45 | PUT | /posts/{id}.json | topics/editPostMutation.ts:23 | `post` | user |
| 46 | POST | /posts.json | topics/newTopicMutation.ts:25; replyMutation.ts:53; newPrivateMessageMutation.ts:26; webhooks/groupWebhook.ts:210 | post fields | user; admin (webhook) |
| 47 | GET | /posts/{id}/raw.json | topics/postRawQuery.ts:25 | raw body | user |
| 48 | GET | /posts/{id}/cooked.json | topics/postRawQuery.ts:28 | `cooked` | user |
| 49 | GET | /posts/{id}/replies.json | topics/repliesQuery.ts:16 | `[].id` | user |
| 50 | GET | /posts/{id}/reply-history.json | topics/replyingToQuery.ts:25 | `[0].id` | user |
| 51 | POST | /post_actions.json | topics/flagPostMutation.ts:32 | post fields | user |
| 52 | POST | /bookmarks.json | topics/bookmarkPostMutation.ts:29; chat/pinChatMessageMutation.ts:48 | `success`, `id` | user |
| 53 | DELETE | /bookmarks/{id}.json | chat/unpinChatMessageMutation.ts:37 | status | user |
| 54 | PUT | /polls/vote.json | topics/votePollMutation.ts:21 | `poll`, `vote` | user |
| 55 | DELETE | /polls/vote.json | topics/undoVotePollMutation.ts:22 | `poll` | user |
| 56 | PUT | /polls/toggle_status.json | topics/togglePollStatusMutation.ts:20 | `poll` | user |
| 57 | PUT | discourse-reactions/posts/{id}/custom-reactions/{reaction}/toggle.json | topics/likeTopicOrPostMutation.ts:103 | post body; `error_type` | user |
| 58 | GET | discourse-reactions/posts/{id}/reactions-users.json | topics/reactionsUsersQuery.ts:15 | `reaction_users[]` | user |
| 59 | GET | /search.json | topics/searchQuery.ts:35 | `topics[]` incl. **`flagged_by_user` (non-null in Prose schema)**, `posts[]` (`topic_id`, `blurb`), `grouped_search_result` | user |
| 60 | GET | /tags/filter/search.json | topics/searchTagsQuery.ts:35 | `results[]` | user |
| 61 | GET | /categories.json?include_subcategories=true | topics/categoryQuery.ts:14 | `category_list.categories[]` incl. **`group_permissions`**, `notification_level` | user |
| 62 | GET | /c/{id}/show.json | topics/showCategoryQuery.ts:24 | `category` incl. **`group_permissions`** | user |
| 63 | GET | /site.json | site/siteQuery.ts:28; health/healthQuery.ts:35 | `can_create_tag`, `can_tag_topics`, `topic_flag_types`, `post_action_types`, `uncategorized_category_id`, `groups[]` | user |
| 64 | GET | /site/settings.json | site/siteQuery.ts:97 | ~19 named settings | user |
| 65 | GET | /about.json | site/aboutQuery.ts:20 | `about.stats.topic_count/post_count` | user |
| 66 | GET | / | server/validate.ts:21 | status, `x-discourse*` headers | none |
| 67 | GET | /groups.json | auth/groupsQuery.ts:38 | `groups[]`, `total_rows_groups` | admin |
| 68 | PUT | groups/{id}/members.json | user/addUserToGroupMutation.ts:21 | status | admin |
| 69 | POST | /uploads.json | upload/uploadMutation.ts:34 | upload fields | user |
| 70 | POST | /uploads/lookup-urls.json | upload/lookupUrlsQuery.ts:24 | `short_url`, `url`, `short_path` | user |
| 71 | GET | /chat/api/me/channels.json | chat/directMessagesQuery.ts:25 | `public_channels`, `direct_message_channels` (raw JSON incl. `current_user_membership`), `tracking` | user |
| 72 | GET | /chat/api/chatables | chat/availableUsersQuery.ts:25 | **`groups[].users[].model`** (id, username, name, avatar_template, **admin**, …), `groups[].model.name` | user |
| 73 | GET | /chat/api/channels/{id}/messages.json | chat/chatDetailsQuery.ts:30 | `messages`, `meta`, `tracking`, `messages[].bookmark` | user |
| 74 | GET | /chat/api/channels/{id}/memberships | chat/chatDetailsQuery.ts:36 | `memberships[].user` | user |
| 75 | POST | /chat/api/direct-message-channels.json | chat/createChatQuery.ts:22 | `channel.id` | user |
| 76 | PUT | /chat/api/channels/{id}/messages/{mid} | chat/editChatMessageMutation.ts:30 | message body | user |
| 77 | PUT | /chat/api/channels/{id}/read | chat/markMessageReadMutation.ts:18 | status | user |
| 78 | POST | /chat/api/channels/{id}/messages/{mid}/flags.json | chat/reportMessageMutation.ts:19 | status | user |
| 79 | PUT | chat/api/channels/{id}/notifications-settings/me | notifications/chatNotificationsMutation.ts:20 | status. **Writes only `notification_level`** | user |
| 80 | GET | chat/emojis.json (old) | chat/chatEmojisQuery.ts:20 | emoji groups. **Route not found in production code (see below)** | user |
| 81 | POST | /chat/{id}.json (old) | chat/sendNewMessageMutation.ts:80 | `success`, `message_id`. Still exists in v2026.9.0 | user |
| 82 | PUT | /chat/{id}/react/{mid}.json (old) | chat/sendChatEmojiMutation.ts:19 | status. Still exists in v2026.9.0 | user |
| 83 | GET | /lexicon/push_notifications/check_endpoint.json | auth/logoutMutation.ts:29 | status (absent in plugin) | user |
| 84 | POST | /lexicon/push_notifications/remove_user_tokens.json | auth/logoutMutation.ts:41 | status (absent in plugin) | user |
| 85 | POST | /lexicon/push_notifications/delete_subscribe.json | auth/logoutMutation.ts:71 | status | user |
| 86 | POST | /lexicon/push_notifications/subscribe.json | notifications/pushNotificationMutation.ts:51 | status (404 = plugin missing) | user |
| 87 | POST | /lexicon/push_notifications/push.json | webhooks/groupWebhook.ts:232 | status (absent in plugin) | admin |
| 88 | GET | /admin/users/{id}.json | user/userSilencInfoQuery.ts:19; webhooks/groupWebhook.ts:59 | `silenced*`; `username`, `groups[]` | admin |
| 89 | GET | /admin/users/list/active.json | auth/checkEmailQuery.ts:24 | array length | admin |
| 90 | GET | /admin/users/list/new.json | auth/checkEmailQuery.ts:39 | array length | admin |
| 91 | GET | admin/site_settings.json | site/siteSettingsAdminQuery.ts:22 | `site_settings[]` | admin |
| 92 | POST | invites | user/createInvitationMutation.ts:36 | invite fields | admin |
| 93 | GET | /u/{username}/emails.json | webhooks/groupWebhook.ts:131 | `email` | admin |

**Inbound:** `POST /webhooks/discourse/group-membership` (`webhooks/index.ts:196`). It uses an HMAC signature and acts on `group_user` / `user_added_to_group`.

## How Prose uses the Yalla-patched fields

| Field | Used by the app? | Notes |
|---|---|---|
| `flagged_by_user` | **Yes**, critical | Filters topic lists and search. `SearchTopic.flagged_by_user` is non-null, so search breaks if it disappears. |
| `group_permissions` | **Yes** | Read from `/categories.json` and `/c/{id}/show.json`, passed through to the app. |
| `ignored_usernames` | **Yes** | `userProfileQuery.ts:19`. |
| chatable `groups[].users` | **Yes**, critical | `availableUsersQuery.ts:31` has no guard and throws if it's missing. |
| chatable user `admin` | **Yes** | Exposed on AvailableDMUsers. |
| `excerpt` | **Yes**, passthrough | Prose doesn't process it as HTML. |
| `blurb` (search posts) | **Yes** | `SearchPost.blurb` is non-null. |
| `can_chat_user` | **No** | Not referenced in Prose. |
| search `cooked`, `thumbnails`, `image_url` | **No** | Dropped by Prose's schema. |
| `mobile_` / `desktop_notification_level` | **No** | Prose never reads or writes them. It writes `notification_level` only (row 79). |

## Existing Prose bugs found (not caused by the upgrade, separate tickets)

1. `deletePostMutation.ts:19` sends a **post id** to `DELETE /t/{id}.json`, which is the topic delete endpoint.
2. `markMessageReadMutation.ts:19` builds `read?message_id=${id}.json`, so Discourse receives `123.json` as the id.
3. `EditChatMessageOutput.ts:10-11` declares snake_case `created_at` / `updated_at`, but the resolver camelCases the body, so these fields are always null.
4. `chatEmojisQuery.ts:20` calls `chat/emojis.json`. No such route exists in the production Discourse code (core has `/emojis`), so this probably fails today.
5. `bookmarkPostMutation.ts:27` ignores `reminderType`, `reminderAt` and `name`.
6. `helpers/pinnedMessagesStorage-discourse.ts` is dead code.

## Existing automated tests in api/

Jest tests cover login (stub Discourse), the group-membership webhook (mocked), health, error handling, client interceptors and a few helpers. There are **no resolver-level tests** for chat, search, topics, categories, notifications or user profile.

## Layer B status (2026-10-12)

`contract/` holds **106 checks** covering the rows above. **All 106 pass** on the baseline container (`contract/reports/baseline.json`, run with `--writes`). Removing one Yalla field (`flagged_by_user`) on purpose made 8 checks fail with the exact field named.

Rows not run, and why:
- 9, 10, 11, 12: need a token from a real email or invite.
- 14, 17, 19-22: delete the account or change username/email.
- 68: fires the group webhook (welcome PM, push and email).
- 92: creates an invite and sends email.
- 80: route doesn't exist today (bug 4).
- 84: Prose only calls it when row 83 succeeds, which it never does.

Row 51 uses a like instead of a flag (same response, reversible). Row 78 (flag a chat message) leaves a reviewable in the staff queue.

## More existing issues found by the contract checks (not caused by the upgrade)

7. **Logout reports "failed" every time.** Discourse answers `DELETE /session/{u}.json` with a 302, axios follows it as a DELETE and gets a 404, so `logoutMutation` returns `"failed"`. The session is still destroyed.
8. **The About screen shows 0 topics and 0 posts.** Prose reads `about.stats.topic_count/post_count`, but Discourse sends `topics_count/posts_count`.
9. **Registration never gets `user_id`** (Discourse only sends it to API-key callers). Prose returns `success: false` plus Discourse's "check your email" message.
10. **`/users/hp.json` is already gone (404).** Registration works only through Prose's fallback to `/session/hp.json`.
11. **Bookmarking a post fails with 400.** Prose sends only `post_id`, but Discourse needs `bookmarkable_id` and `bookmarkable_type`.
12. **Pinned posts can't work.** Discourse never returns post `custom_fields`, and `PUT /posts/{id}.json` ignores them.
13. **Editing a chat message returns mostly nulls.** Discourse returns only `success` and `message_id`.
14. **`dateOfBirth` is always null.** Stock Discourse never sends it.
15. **The group welcome push is never sent.** Lexicon has no `push.json` route (row 87 returns 404).
16. **Some Prose non-null fields are never sent by Discourse:** `draftKey` on topic and category lists, `minimunRequiredTags` (a typo), `topicsDay` etc. on `/c/{id}/show.json`, `SearchPost.excerpt`, `Tag.pmCount` (staff only) and `searchLogId`. A query that selects one of them errors.
17. **Upgrade risk to watch:** the site setting `poll_minimum_trust_level_to_create`, which Prose reads, is deprecated upstream and will probably disappear after the upgrade.
