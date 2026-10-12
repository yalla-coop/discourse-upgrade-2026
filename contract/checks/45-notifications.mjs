// Inventory rows 30-33: notifications list, mark read, topic and category
// notification levels.
// Source: forward-trust-community-mobile-app/api/src/resolvers/notifications/*,
// typeSchemas/Notifications.ts, NotificationDetail.ts,
// scalars/NotificationDataType.ts and the data member types. The app selects
// these in frontend/src/graphql/server/notification.ts.
//
// Rows 32 and 33 write the member's CURRENT level back (read first), so they
// never change anyone's notification settings. Row 79 (chat notification
// settings) is in 50-chat.mjs.

const REPLY = 2; // Discourse Notification.types[:replied]

export default {
  area: "Notifications",
  checks: [
    {
      id: 30,
      name: "Notifications list",
      as: "member",
      method: "GET",
      path: "/notifications.json?filter=all&offset=0",
      status: 200,
      expect: {
        notifications: "array",
        "notifications[].id": "number",
        "notifications[].notification_type": "number|null",
        "notifications[].read": "boolean",
        "notifications[].created_at": "string",
        "notifications[].post_number": "number|null",
        "notifications[].topic_id": "number|null",
        // Omitted by Discourse when the notification has no topic.
        "?notifications[].fancy_title": "string",
        "notifications[].data": "object",
        // The data union is decided by which keys are present, so types are
        // only checked when a key is there. The reply notification is checked
        // strictly in `verify`.
        "?notifications[].data.badge_id": "number",
        "?notifications[].data.badge_name": "string",
        "?notifications[].data.original_post_id": "number",
        "?notifications[].data.topic_title": "string",
        "?notifications[].data.original_username": "string",
        "?notifications[].data.display_username": "string",
        "?notifications[].data.count": "number|string",
        "?notifications[].data.group_id": "number",
        "?notifications[].data.group_name": "string",
        "?notifications[].data.inbox_count": "number",
        total_rows_notifications: "number",
        seen_notification_id: "number|null",
        load_more_notifications: "string",
      },
      // The seeded reply by contract_member2 must come through as an
      // ActionPostNotification, whose non-null fields the app selects.
      verify: (data) => {
        const list = Array.isArray(data?.notifications) ? data.notifications : [];
        const reply = list.find((n) => n?.notification_type === REPLY);
        if (!reply) return ["notifications: no reply notification found (seed data missing?)"];
        const d = reply.data ?? {};
        const problems = [];
        for (const [key, type] of [
          ["original_post_id", "number"],
          ["topic_title", "string"],
          ["original_username", "string"],
          ["display_username", "string"],
        ]) {
          if (typeof d[key] !== type) problems.push(`reply notification data.${key}: expected ${type}, got ${d[key] === null ? "null" : typeof d[key]}`);
        }
        return problems;
      },
      capture: (data, ctx) => {
        const list = Array.isArray(data?.notifications) ? data.notifications : [];
        const seeded = list.find(
          (n) => n?.notification_type === REPLY && /weekly recovery circle/i.test(n?.fancy_title ?? n?.data?.topic_title ?? ""),
        );
        const chosen = seeded ?? list.find((n) => n?.topic_id) ?? list[0];
        ctx.notificationId = chosen?.id;
        ctx.notifTopicId = chosen?.topic_id ?? undefined;
      },
      write: false,
    },
    {
      id: 31,
      name: "Mark a notification read",
      as: "member",
      method: "PUT",
      path: "/notifications/mark-read.json",
      // Prose sends { id } as JSON. With no id Discourse marks all read, which
      // is harmless for the test member.
      json: (ctx) => ({ id: ctx.notificationId }),
      status: 200,
      expect: {},
      write: true,
    },
    {
      // Not a Prose call on its own (row 35 covers the shape). Reads the
      // current levels so rows 32 and 33 can write them back unchanged.
      id: "prep-32",
      name: "Read the topic's current notification level",
      as: "member",
      method: "GET",
      path: (ctx) => `/t/${ctx.notifTopicId}.json`,
      status: 200,
      expect: {
        "details.notification_level": "number",
        category_id: "number|null",
      },
      capture: (data, ctx) => {
        ctx.notifTopicLevel = data?.details?.notification_level;
        ctx.notifCategoryId = data?.category_id ?? undefined;
      },
      write: false,
    },
    {
      id: 32,
      name: "Set topic notification level (unchanged)",
      as: "member",
      method: "POST",
      path: (ctx) => `/t/${ctx.notifTopicId}/notifications.json`,
      // Falls back to Regular (1) only if the read above failed.
      form: (ctx) => ({ notification_level: String(ctx.notifTopicLevel ?? 1) }),
      status: 200,
      expect: {},
      write: true,
    },
    {
      // Not a Prose call on its own (row 62 covers the shape).
      id: "prep-33",
      name: "Read the category's current notification level",
      as: "member",
      method: "GET",
      path: (ctx) => `/c/${ctx.notifCategoryId}/show.json`,
      status: 200,
      expect: { "category.notification_level": "number|null" },
      capture: (data, ctx) => {
        ctx.notifCategoryLevel = data?.category?.notification_level ?? undefined;
      },
      write: false,
    },
    {
      id: 33,
      name: "Set category notification level (unchanged)",
      as: "member",
      method: "POST",
      // Prose's path has no leading slash; axios joins it onto the base URL.
      path: (ctx) => `/category/${ctx.notifCategoryId}/notifications.json`,
      form: (ctx) => ({ notification_level: String(ctx.notifCategoryLevel ?? 1) }),
      status: 200,
      expect: {},
      write: true,
    },
  ],
};
