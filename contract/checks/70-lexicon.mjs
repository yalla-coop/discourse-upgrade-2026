// Inventory rows 83-87: Lexicon push notification plugin.
// Source: forward-trust-community-mobile-app/api/src/resolvers/notifications/pushNotificationMutation.ts,
// resolvers/auth/logoutMutation.ts, resolvers/notifications/unsubcribeMutation.ts,
// webhooks/groupWebhook.ts. Plugin: plugins/discourse-lexicon-plugin
// (routes: push_notifications/subscribe and push_notifications/delete_subscribe only).
//
// Prose only looks at the status code for these calls.
//
// Rows 83 and 87 call routes the plugin does not have. They are checked for
// 404 to record today's behaviour: if one starts answering, Prose's behaviour
// changes (row 83 = 200 makes logout call row 84; row 87 starts sending pushes).
//
// Skipped:
//   84 POST /lexicon/push_notifications/remove_user_tokens.json  only called
//      when row 83 answers 200, which it never does.

const FAKE_TOKEN = "ExponentPushToken[contract-check-not-a-real-device]";

export default {
  area: "Lexicon push",
  checks: [
    {
      id: 83,
      name: "Token-removal endpoint check (route absent in the plugin)",
      as: "member",
      method: "GET",
      path: "/lexicon/push_notifications/check_endpoint.json",
      status: 404,
      expect: {},
      write: false,
    },
    {
      id: 86,
      name: "Subscribe a push token",
      as: "member",
      method: "POST",
      path: "/lexicon/push_notifications/subscribe.json",
      // user_identifier is undefined in practice, so JSON.stringify drops it.
      json: {
        push_notifications_token: FAKE_TOKEN,
        application_name: "[contract check] Mobile App",
        platform: "ios",
        experience_id: "@contract-check/not-a-real-app",
      },
      // 404 here means the plugin is missing or disabled; Prose reports that
      // as "lexicon plugin not installed" and push stops working.
      status: 200,
      expect: {},
      write: true,
    },
    {
      id: 85,
      name: "Unsubscribe the push token (cleanup, as logout does)",
      as: "member",
      method: "POST",
      path: "/lexicon/push_notifications/delete_subscribe.json",
      json: (ctx) => ({ push_notifications_token: FAKE_TOKEN, username: ctx.username }),
      status: 200,
      expect: {},
      write: true,
    },
    {
      // Sent by the group-membership webhook with the admin API key. Absent in
      // the plugin today, so the welcome push is never sent.
      id: 87,
      name: "Admin push (route absent in the plugin)",
      as: "admin",
      method: "POST",
      path: "/lexicon/push_notifications/push.json",
      json: (ctx) => ({
        user_id: ctx.memberId,
        title: "[contract check] push",
        body: "[contract check] push sent by the contract checks",
        url: "/groups/peer_mentors",
      }),
      status: 404,
      expect: {},
      write: true,
    },
  ],
};
