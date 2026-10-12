// Inventory rows 15-16, 23-29: users, profiles, user status, ignoring, user
// search, activity and badges.
// Source: forward-trust-community-mobile-app/api/src/resolvers/user/*,
// typeSchemas/UserDetail.ts, UserLite.ts, UserStatus.ts, SearchUser*.ts,
// UserActions.ts, Badge*.ts, scalars/UserUnion.ts.
// Field lists follow what the app's GraphQL documents select
// (frontend/src/graphql/server/profile.ts, editProfile.ts, search.ts,
// userActivity.ts, singleBadge.ts); a non-null Prose field only breaks a query
// when the app selects it.
//
// Row 18 (avatar pick) needs an upload, so it runs in 60-uploads.mjs.
//
// Skipped:
//   14 DELETE /u/{username}.json                          deletes the account
//   17 PUT /u/{username}/preferences/username.json        changes the member's username
//   19 POST /u/{username}/preferences/email.json          adds an email (sends a confirmation email)
//   20 PUT /users/{username}/preferences/email.json       changes the member's email
//   21 DELETE /users/{username}/preferences/email.json    removes an email
//   22 PUT /users/{username}/preferences/primary-email.json  changes the primary email

export default {
  area: "Users",
  checks: [
    {
      id: 15,
      name: "Own profile (UserDetail)",
      as: "member",
      method: "GET",
      path: (ctx) => `/users/${ctx.username}.json`,
      status: 200,
      expect: {
        "user.id": "number",
        "user.username": "string",
        "user.avatar_template": "string",
        "?user.name": "string|null",
        // UserUnion picks UserDetail only when `email` is present.
        "user.email": "string",
        "user.secondary_emails": "array|null",
        "user.unconfirmed_emails": "array|null",
        "user.can_edit_username": "boolean",
        "user.admin": "boolean",
        "user.moderator": "boolean",
        // Yalla patch (chat plugin.rb add_to_serializer). Non-null list in Prose.
        "user.ignored_usernames": "array",
        "user.ignored_usernames[]": "string",
        "?user.website_name": "string|null",
        "?user.bio_raw": "string|null",
        "?user.location": "string|null",
        // Selected by the app; stock Discourse never serializes it.
        "?user.date_of_birth": "string|null",
        "?user.status": "object|null",
        "?user.status.description": "string",
        "?user.status.emoji": "string",
        "?user.status.ends_at": "string|null",
      },
      capture: (data, ctx) => {
        const user = data?.user;
        ctx.memberId = user?.id;
        ctx.memberEmail = user?.email;
        ctx.memberProfile = {
          name: user?.name ?? undefined,
          bio_raw: user?.bio_raw ?? undefined,
          website: user?.website ?? undefined,
          location: user?.location ?? undefined,
        };
      },
      write: false,
    },
    {
      // Same resolver: when the profile has an email, Prose also fetches unread
      // notifications and reads `notifications.length` with no guard.
      id: 15,
      name: "Own profile: unread notifications lookup",
      as: "member",
      method: "GET",
      path: "/notifications.json?filter=unread&limit=30",
      status: 200,
      expect: { notifications: "array" },
      write: false,
    },
    {
      id: 15,
      name: "Another member's profile (UserLite)",
      as: "member",
      method: "GET",
      path: (ctx) => `/users/${ctx.member2Username}.json`,
      status: 200,
      expect: {
        "user.id": "number",
        "user.username": "string",
        "user.avatar_template": "string",
        "?user.name": "string|null",
        "?user.bio_raw": "string|null",
        // Yalla patch: stock Discourse only sends this on your own profile.
        "user.ignored_usernames": "array",
      },
      // Prose types the user as UserDetail if `email` is present, which would
      // break the app's `... on UserLite` selection.
      verify: (data) =>
        data?.user && "email" in data.user
          ? ["user.email: present on another member's profile, so Prose would type it as UserDetail"]
          : [],
      capture: (data, ctx) => {
        ctx.member2Id = data?.user?.id;
      },
      write: false,
    },
    {
      id: 16,
      name: "Edit profile (writes back the current values)",
      as: "member",
      method: "PUT",
      path: (ctx) => `/users/${ctx.username}.json`,
      // Prose sends snakecased EditProfileInput as JSON. Same values back, so nothing changes.
      json: (ctx) => ({ ...(ctx.memberProfile ?? {}) }),
      status: 200,
      expect: {
        "user.id": "number",
        "user.username": "string",
        "user.avatar_template": "string",
        "?user.name": "string|null",
        "?user.website_name": "string|null",
        "?user.bio_raw": "string|null",
        "?user.location": "string|null",
        "?user.date_of_birth": "string|null",
        "user.admin": "boolean",
        "user.ignored_usernames": "array",
      },
      write: true,
    },
    {
      id: 23,
      name: "Set user status",
      as: "member",
      method: "PUT",
      path: "/user-status.json",
      json: {
        description: "[contract check] status set by the contract checks",
        emoji: "test_tube",
        ends_at: "",
      },
      status: 200,
      expect: {},
      write: true,
    },
    {
      id: 25,
      name: "Ignore another member",
      as: "member",
      method: "PUT",
      path: (ctx) => `/u/${ctx.member2Username}/notification_level.json`,
      form: (ctx) => ({
        notification_level: "ignore",
        expiring_at: "3024-06-01 08:00+02:00",
        acting_user_id: ctx.memberId,
      }),
      status: 200,
      expect: {},
      write: true,
    },
    {
      // A read, but it only means something after rows 23 and 25 ran, so it
      // runs (and is skipped) with the writes.
      id: 15,
      name: "Own profile shows the status and the ignored member",
      as: "member",
      method: "GET",
      path: (ctx) => `/users/${ctx.username}.json`,
      status: 200,
      expect: {
        "user.status": "object",
        "user.status.description": "string",
        "user.status.emoji": "string",
        "user.status.ends_at": "string|null",
        "user.ignored_usernames": "array",
        "user.ignored_usernames[]": "string",
      },
      write: true,
    },
    {
      id: 25,
      name: "Stop ignoring the other member (cleanup)",
      as: "member",
      method: "PUT",
      path: (ctx) => `/u/${ctx.member2Username}/notification_level.json`,
      form: (ctx) => ({
        notification_level: "normal",
        expiring_at: "3024-06-01 08:00+02:00",
        acting_user_id: ctx.memberId,
      }),
      status: 200,
      expect: {},
      write: true,
    },
    {
      id: 24,
      name: "Clear user status (cleanup)",
      as: "member",
      method: "DELETE",
      path: "/user-status.json",
      status: 200,
      expect: {},
      write: true,
    },
    {
      id: 26,
      name: "Search users",
      as: "member",
      method: "GET",
      path:
        "/u/search/users.json?term=contract&include_groups=false&include_mentionable_groups=false&include_messageable_groups=true&topic_allowed_users=false",
      status: 200,
      expect: {
        // Prose defaults a missing `users`/`groups` to [], so only item shapes matter.
        "?users[].id": "number",
        "?users[].username": "string",
        "?users[].name": "string|null",
        "?users[].avatar_template": "string",
      },
      verify: (data) => (Array.isArray(data?.users) && data.users.length ? [] : ["users: no users found for term \"contract\""]),
      write: false,
    },
    {
      id: 26,
      name: "Search users finds messageable groups",
      as: "member",
      method: "GET",
      path:
        "/u/search/users.json?term=peer&include_groups=false&include_mentionable_groups=false&include_messageable_groups=true&topic_allowed_users=false",
      status: 200,
      expect: {
        "?groups[].name": "string",
        "?groups[].full_name": "string|null",
      },
      write: false,
    },
    {
      id: 27,
      name: "User activity",
      as: "member",
      method: "GET",
      path: (ctx) =>
        `/user_actions.json?offset=0&username=${ctx.username}&filter=1,4,5&no_results_help_key=user_activity.no_default`,
      status: 200,
      expect: {
        user_actions: "array",
        "user_actions[].action_type": "number",
        "user_actions[].avatar_template": "string",
        "user_actions[].category_id": "number|null",
        "user_actions[].created_at": "string",
        // Yalla patch: full cooked HTML. Non-null in Prose.
        "user_actions[].excerpt": "string",
        "user_actions[].post_id": "number|null",
        "user_actions[].post_number": "number",
        "user_actions[].title": "string",
        "user_actions[].topic_id": "number",
        "user_actions[].username": "string",
        "?user_actions[].hidden": "boolean|null",
      },
      write: false,
    },
    {
      // Prose exposes this as `badge`, but the app never queries it today.
      id: 28,
      name: "All badges",
      as: "member",
      method: "GET",
      path: "/badges.json",
      status: 200,
      expect: {
        badge_groupings: "array",
        "badge_groupings[].id": "number",
        "badge_groupings[].name": "string",
        "badge_groupings[].position": "number",
        badge_types: "array",
        "badge_types[].id": "number",
        "badge_types[].name": "string",
        "badge_types[].sort_order": "number",
        badges: "array",
        "badges[].id": "number",
        "badges[].name": "string",
        "badges[].description": "string",
        "badges[].badge_type_id": "number",
        "badges[].badge_grouping_id": "number",
        "badges[].slug": "string",
      },
      capture: (data, ctx) => {
        const badges = Array.isArray(data?.badges) ? data.badges : [];
        ctx.badgeId = (badges.find((b) => b?.enabled) ?? badges[0])?.id;
      },
      write: false,
    },
    {
      id: 29,
      name: "Single badge",
      as: "member",
      method: "GET",
      path: (ctx) => `/badges/${ctx.badgeId ?? 1}.json`,
      status: 200,
      expect: {
        badge_types: "array",
        "badge_types[].id": "number",
        "badge_types[].name": "string",
        "badge_types[].sort_order": "number",
        "badge.id": "number",
        "badge.name": "string",
        "badge.description": "string",
      },
      write: false,
    },
  ],
};
