// Inventory rows 67 and 88-93: calls Prose makes with the admin API key.
// Source: forward-trust-community-mobile-app/api/src/resolvers/auth/groupsQuery.ts,
// resolvers/user/userSilencInfoQuery.ts, resolvers/auth/checkEmailQuery.ts,
// resolvers/site/siteSettingsAdminQuery.ts, webhooks/groupWebhook.ts,
// typeSchemas/Groups.ts, Group.ts, SilenceInfoOutput.ts, SiteSettingsAdmin.ts.
// App selections: frontend/src/graphql/server/groups.ts, userSilenceInfo.ts,
// siteSettingsAdmin.ts.
//
// Skipped:
//   68 PUT groups/{id}/members.json  adds a user to a group. Discourse then fires
//      the group-membership webhook, and Prose sends a welcome PM, a push and a
//      welcome email. Not safe to repeat on any shared environment.
//   92 POST invites                  creates an invite (and emails it when
//      send_email is true). Would need a delete afterwards and leaves staff
//      action logs; not clearly safe, so left out.

export default {
  area: "Admin",
  checks: [
    {
      id: 67,
      name: "Groups list",
      as: "admin",
      method: "GET",
      path: "/groups.json",
      status: 200,
      expect: {
        groups: "array",
        "groups[].id": "number",
        "groups[].name": "string",
        "groups[].full_name": "string|null",
        total_rows_groups: "number",
      },
      write: false,
    },
    {
      // Used by userSilenceInfo and by the group-membership webhook.
      id: 88,
      name: "Admin user detail",
      as: "admin",
      method: "GET",
      path: (ctx) => `/admin/users/${ctx.memberId}.json`,
      status: 200,
      expect: {
        username: "string",
        // Discourse only sends these when the user is silenced.
        "?silenced": "boolean",
        "?silenced_till": "string|null",
        "?silence_reason": "string|null",
        groups: "array",
        "groups[].id": "number",
        "groups[].name": "string",
        "groups[].automatic": "boolean",
        "groups[].full_name": "string|null",
      },
      write: false,
    },
    {
      // Prose only reads the array length.
      id: 89,
      name: "Active users filtered by email",
      as: "admin",
      method: "GET",
      path: (ctx) => `/admin/users/list/active.json?filter=${encodeURIComponent(ctx.memberEmail ?? ctx.username)}`,
      status: 200,
      expect: { "[]": "object" },
      write: false,
    },
    {
      id: 90,
      name: "New users filtered by email",
      as: "admin",
      method: "GET",
      path: (ctx) => `/admin/users/list/new.json?filter=${encodeURIComponent(ctx.memberEmail ?? ctx.username)}`,
      status: 200,
      // Usually empty for the seeded member; this still fails if the body stops
      // being an array.
      expect: { "[]": "object" },
      write: false,
    },
    {
      id: 91,
      name: "Admin site settings",
      as: "admin",
      method: "GET",
      path: "/admin/site_settings.json",
      status: 200,
      expect: {
        site_settings: "array",
        "site_settings[].setting": "string",
        "site_settings[].value": "string",
        "site_settings[].default": "string",
        "?site_settings[].valid_values[].name": "string",
        // GraphQL String accepts numbers and booleans, and some enums use them.
        "?site_settings[].valid_values[].value": "string|number|boolean",
      },
      write: false,
    },
    {
      // A GET, but Discourse records a staff action log entry every time.
      id: 93,
      name: "Member's email (group welcome email)",
      as: "admin",
      method: "GET",
      path: (ctx) => `/u/${encodeURIComponent(ctx.username)}/emails.json`,
      status: 200,
      expect: { email: "string" },
      write: true,
    },
  ],
};
