// Inventory rows 71-82: chat.
// Source: forward-trust-community-mobile-app/api/src/resolvers/chat/*,
// resolvers/notifications/chatNotificationsMutation.ts, typeSchemas/DMs/*.
// Most chat responses are passed to the app as opaque JSON, so the field lists
// below come from what the app reads: frontend/src/screens/Chats/Chats.tsx,
// DirectMessageDetails.tsx, Components/MessageItem.tsx, ChatOptions.tsx and
// screens/Preferences/PushNotifications.tsx.
//
// Every write happens in the direct-message channel between the two contract
// members (found or created by row 75), never in a public channel, so no real
// member is notified on any environment. Row 79 writes the member's current
// level back to the category channel, which changes nothing.
//
// Skipped:
//   80 GET chat/emojis.json  the route does not exist in Discourse (known Prose
//      bug 4 in the inventory), so it fails today and there is nothing to protect.

// Prose builds this with getDate()/getMonth()+1/getFullYear(), no zero padding.
function tomorrow() {
  const d = new Date(new Date().setDate(new Date().getDate() + 1));
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
}

function stagedId() {
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

// What sendNewMessageMutation sends: querystring.stringify of
// { message, staged_id, archetype, upload_ids: [], in_reply_to_id: undefined },
// which puts both of the last two on the wire as empty values.
function newMessageForm(message) {
  return { message, staged_id: stagedId(), archetype: "private_message", upload_ids: "", in_reply_to_id: "" };
}

const messageShape = {
  messages: "array",
  "messages[].id": "number",
  "messages[].chat_channel_id": "number",
  "messages[].message": "string",
  "messages[].cooked": "string",
  "messages[].created_at": "string",
  "messages[].user": "object",
  "messages[].user.id": "number",
  "messages[].user.username": "string",
  "messages[].user.avatar_template": "string",
  "?messages[].user.name": "string|null",
  "messages[].uploads": "array",
  "messages[].mentioned_users": "array",
  "?messages[].deleted_at": "string|null",
  "?messages[].in_reply_to": "object|null",
  "?messages[].in_reply_to.id": "number",
  "?messages[].in_reply_to.excerpt": "string",
  "?messages[].reactions[].emoji": "string",
  "?messages[].reactions[].count": "number",
  "?messages[].reactions[].reacted": "boolean",
  "?messages[].reactions[].users": "array",
  "?messages[].bookmark.id": "number",
  "?messages[].bookmark.name": "string|null",
  meta: "object",
  "meta.can_load_more_past": "boolean",
  tracking: "object",
};

export default {
  area: "Chat",
  checks: [
    {
      id: 71,
      name: "My chat channels",
      as: "member",
      method: "GET",
      path: "/chat/api/me/channels.json",
      status: 200,
      expect: {
        public_channels: "array",
        direct_message_channels: "array",
        // Non-null JSON fields on Prose's DirectMessages type.
        tracking: "object",
        "tracking.channel_tracking": "object",
        meta: "object",
        unread_thread_overview: "object",
        global_presence_channel_state: "object",
        "public_channels[].id": "number",
        "public_channels[].title": "string",
        "public_channels[].slug": "string",
        "public_channels[].chatable_type": "string",
        "public_channels[].memberships_count": "number",
        "public_channels[].chatable": "object|null",
        "?public_channels[].chatable.uploaded_logo": "object|null",
        "?public_channels[].chatable.uploaded_logo_dark": "object|null",
        "public_channels[].current_user_membership": "object",
        "public_channels[].current_user_membership.notification_level": "string",
        "public_channels[].current_user_membership.last_read_message_id": "number|null",
        // The app reads last_message.id with no guard.
        "public_channels[].last_message": "object",
        "public_channels[].last_message.id": "number|null",
        "public_channels[].last_message.created_at": "string|null",
        "direct_message_channels[].id": "number",
        "direct_message_channels[].chatable_type": "string",
        "direct_message_channels[].chatable.users": "array",
        "direct_message_channels[].chatable.users[].id": "number",
        "direct_message_channels[].chatable.users[].username": "string",
        "direct_message_channels[].chatable.users[].avatar_template": "string",
        "?direct_message_channels[].chatable.users[].name": "string|null",
        "direct_message_channels[].current_user_membership.last_read_message_id": "number|null",
        "direct_message_channels[].last_message": "object",
        "direct_message_channels[].last_message.id": "number|null",
        "direct_message_channels[].last_message.message": "string|null",
        "direct_message_channels[].last_message.created_at": "string|null",
      },
      // Prose reads tracking.channel_tracking[channel.id].unread_count for every
      // channel with no guard, so a missing entry throws.
      verify: (data) => {
        const tracking = data?.tracking?.channel_tracking ?? {};
        const channels = [
          ...(Array.isArray(data?.public_channels) ? data.public_channels : []),
          ...(Array.isArray(data?.direct_message_channels) ? data.direct_message_channels : []),
        ];
        return channels
          .filter((c) => !tracking[c?.id] || typeof tracking[c.id] !== "object")
          .map((c) => `tracking.channel_tracking[${c?.id}]: missing`);
      },
      capture: (data, ctx) => {
        const publicChannels = Array.isArray(data?.public_channels) ? data.public_channels : [];
        const dms = Array.isArray(data?.direct_message_channels) ? data.direct_message_channels : [];
        const general = publicChannels.find((c) => c?.title === "Contract General") ?? publicChannels[0];
        ctx.chatChannelId = general?.id;
        ctx.chatChannelLevel = general?.current_user_membership?.notification_level;
        ctx.chatChannelLastMessageId = general?.last_message?.id ?? undefined;
        const dm = dms.find((c) => c?.chatable?.users?.some((u) => u?.username === ctx.member2Username));
        ctx.dmChannelId = dm?.id;
      },
      write: false,
    },
    {
      id: 72,
      name: "Chatables (users available for direct messages)",
      as: "member",
      method: "GET",
      path: "/chat/api/chatables",
      status: 200,
      expect: {
        groups: "array",
        "groups[].model.name": "string",
        // Yalla patch: groups carry their users. Prose maps group.users with no guard.
        "groups[].users": "array",
        "groups[].users[].model.id": "number",
        "groups[].users[].model.username": "string",
        "groups[].users[].model.avatar_template": "string",
        "?groups[].users[].model.name": "string|null",
        // Yalla patch.
        "groups[].users[].model.admin": "boolean",
      },
      write: false,
    },
    {
      // Returns the existing DM channel when there is one, so this is idempotent.
      id: 75,
      name: "Open the direct message with the other member",
      as: "member",
      method: "POST",
      path: "/chat/api/direct-message-channels.json",
      // querystring.stringify({ target_usernames: [name] }) sends a plain key.
      form: (ctx) => ({ target_usernames: ctx.member2Username }),
      status: 200,
      expect: { "channel.id": "number" },
      capture: (data, ctx) => {
        ctx.dmChannelId = data?.channel?.id ?? ctx.dmChannelId;
      },
      write: true,
    },
    {
      id: 81,
      name: "Send a chat message (old-style route)",
      as: "member",
      method: "POST",
      path: (ctx) => `/chat/${ctx.dmChannelId}.json`,
      form: () => newMessageForm("[contract check] message sent by the contract checks"),
      status: 200,
      expect: { success: "string", message_id: "number" },
      capture: (data, ctx) => {
        ctx.contractMessageId = data?.message_id;
      },
      write: true,
    },
    {
      id: 76,
      name: "Edit a chat message",
      as: "member",
      method: "PUT",
      path: (ctx) => `/chat/api/channels/${ctx.dmChannelId}/messages/${ctx.contractMessageId}`,
      form: { message: "[contract check] message edited by the contract checks" },
      status: 200,
      // Every EditChatMessageOutput field is nullable; Discourse only sends
      // `success` and `message_id`, so the app gets nulls for the rest.
      expect: { success: "string" },
      write: true,
    },
    {
      id: 82,
      name: "React to a chat message (old-style route)",
      as: "member",
      method: "PUT",
      path: (ctx) => `/chat/${ctx.dmChannelId}/react/${ctx.contractMessageId}.json`,
      json: { react_action: "add", emoji: "heart" },
      status: 200,
      expect: {},
      write: true,
    },
    {
      // Default chatDetails path (no target message).
      id: 73,
      name: "Chat messages, latest page (direct message)",
      as: "member",
      method: "GET",
      path: (ctx) =>
        `/chat/api/channels/${ctx.dmChannelId ?? ctx.chatChannelId}/messages.json?fetch_from_last_read=false&page_size=25&&target_date=${tomorrow()}`,
      status: 200,
      expect: messageShape,
      capture: (data, ctx) => {
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        ctx.lastDmMessageId = messages[messages.length - 1]?.id ?? ctx.contractMessageId;
      },
      write: false,
    },
    {
      // chatDetails with a target message, as used when paging.
      id: 73,
      name: "Chat messages around a target message (category channel)",
      as: "member",
      method: "GET",
      path: (ctx) =>
        ctx.chatChannelLastMessageId
          ? `/chat/api/channels/${ctx.chatChannelId}/messages.json?direction=past&page_size=25&target_message_id=${ctx.chatChannelLastMessageId}`
          : `/chat/api/channels/${ctx.chatChannelId}/messages.json?fetch_from_last_read=false&page_size=25&&target_date=${tomorrow()}`,
      status: 200,
      expect: messageShape,
      write: false,
    },
    {
      id: 74,
      name: "Channel memberships",
      as: "member",
      method: "GET",
      path: (ctx) => `/chat/api/channels/${ctx.chatChannelId}/memberships?limit=50`,
      status: 200,
      expect: {
        memberships: "array",
        "memberships[].user": "object",
        "memberships[].user.id": "number",
        "memberships[].user.username": "string",
        "memberships[].user.avatar_template": "string",
        "?memberships[].user.name": "string|null",
      },
      write: false,
    },
    {
      id: 82,
      name: "Remove the reaction (cleanup)",
      as: "member",
      method: "PUT",
      path: (ctx) => `/chat/${ctx.dmChannelId}/react/${ctx.contractMessageId}.json`,
      json: { react_action: "remove", emoji: "heart" },
      status: 200,
      expect: {},
      write: true,
    },
    {
      // Mirrors Prose's path exactly, including the quirk (inventory bug 2):
      // Discourse receives message_id=123.json.
      id: 77,
      name: "Mark chat messages read",
      as: "member",
      method: "PUT",
      path: (ctx) => `/chat/api/channels/${ctx.dmChannelId}/read?message_id=${ctx.lastDmMessageId}.json`,
      json: {},
      status: 200,
      expect: {},
      write: true,
    },
    {
      id: 79,
      name: "Chat notification level (writes the current level back)",
      as: "member",
      method: "PUT",
      // No .json, as in Prose.
      path: (ctx) => `/chat/api/channels/${ctx.chatChannelId}/notifications-settings/me`,
      form: (ctx) => ({ notifications_settings: { notification_level: ctx.chatChannelLevel ?? "always" } }),
      status: 200,
      expect: {},
      write: true,
    },
    {
      // Setup for row 78: a fresh message from the other member, because a
      // message can only be flagged once and you cannot flag your own.
      id: 81,
      name: "Other member sends a message to flag (setup)",
      as: "member2",
      method: "POST",
      path: (ctx) => `/chat/${ctx.dmChannelId}.json`,
      form: () => newMessageForm("[contract check] message for the flag check, safe to ignore"),
      status: 200,
      expect: { success: "string", message_id: "number" },
      capture: (data, ctx) => {
        ctx.flagTargetMessageId = data?.message_id;
      },
      write: true,
    },
    {
      // Leaves a reviewable in the staff review queue (on the deleted test message).
      id: 78,
      name: "Flag a chat message",
      as: "member",
      method: "POST",
      path: (ctx) => `/chat/api/channels/${ctx.dmChannelId}/messages/${ctx.flagTargetMessageId}/flags.json`,
      // Exactly what Prose sends; 3 = off topic, one of the app's four options.
      json: { flag_type_id: 3, message: "Test" },
      status: 200,
      expect: {},
      write: true,
    },
    {
      id: "cleanup-78",
      name: "Delete the flagged test message (cleanup, not a Prose call)",
      as: "member2",
      method: "DELETE",
      path: (ctx) => `/chat/api/channels/${ctx.dmChannelId}/messages/${ctx.flagTargetMessageId}`,
      status: [200, 204],
      expect: {},
      write: true,
    },
    {
      id: "cleanup-81",
      name: "Delete the sent test message (cleanup, not a Prose call)",
      as: "member",
      method: "DELETE",
      path: (ctx) => `/chat/api/channels/${ctx.dmChannelId}/messages/${ctx.contractMessageId}`,
      status: [200, 204],
      expect: {},
      write: true,
    },
  ],
};
