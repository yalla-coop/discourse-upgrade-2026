// Inventory rows 34-37, 41-43: topic lists, topic detail, PM lists, read timings.
// Source: forward-trust-community-mobile-app/api/src/
//   resolvers/topics/topicsQuery.ts, helpers/parseTopicUrl.ts
//   helpers/topicDetail.ts, resolvers/topics/topicDetailQuery.ts,
//   resolvers/topics/privateMessageDetailQuery.ts, resolvers/topics/pinnedPostsQuery.ts
//   resolvers/topics/privateMessageQuery.ts, helpers/privateMessagesMerger.ts
//   resolvers/topics/timingsMutation.ts, helpers/getTopicTimings.ts
//   typeSchemas/Topic.ts, TopicList.ts, TopicPoster.ts, UserIcon.ts, TopicDetailOutput.ts,
//   TopicDetail.ts, Participant.ts, PostStream.ts, Post.ts, Poll.ts, PollOption.ts
//
// Nexus is configured with nonNullDefaults (schema.ts), so `t.int('x')` is
// non-null: if Discourse stops sending it, the GraphQL query errors.
//
// The rows that change topics (38, 39, 40) run in 32-posts.mjs, after row 46
// has created a topic and a PM they can safely change and delete.
//
// This file also exports the shared shapes used by 32-posts.mjs,
// 34-polls-reactions.mjs and 40-search-categories-site.mjs.

// Prefix every path in `shape` with `prefix`, keeping a leading "?" in front.
export function prefixed(prefix, shape) {
  const out = {};
  for (const [key, type] of Object.entries(shape)) {
    if (key.startsWith("?")) out[`?${prefix}${key.slice(1)}`] = type;
    else out[`${prefix}${key}`] = type;
  }
  return out;
}

// UserIcon / BaseUserIcon (typeSchemas/UserIcon.ts). `name` is left out when
// the enable_names site setting is off.
export const userIcon = {
  id: "number",
  username: "string",
  "?name": "string|null",
  avatar_template: "string",
};

// Post (typeSchemas/Post.ts). Every field below except the "?" ones is
// non-null in Prose, so a Post query fails if Discourse drops any of them.
// This is longer than most checks because Post is Prose's biggest type and
// it is returned by 9 different calls.
export const post = {
  id: "number",
  "?name": "string|null",
  username: "string",
  avatar_template: "string",
  created_at: "string",
  cooked: "string",
  post_number: "number",
  post_type: "number",
  updated_at: "string",
  reply_count: "number",
  reply_to_post_number: "number|null",
  quote_count: "number",
  incoming_link_count: "number",
  reads: "number",
  score: "number",
  yours: "boolean",
  topic_id: "number",
  topic_slug: "string",
  "?display_username": "string|null",
  version: "number",
  can_edit: "boolean",
  can_delete: "boolean",
  can_recover: "boolean",
  can_wiki: "boolean",
  bookmarked: "boolean",
  // topicDetailQuery.ts calls actionsSummary.find() with no guard, and
  // LikeOutputUnion picks Post vs LikedTopic by whether actionsSummary exists.
  actions_summary: "array",
  moderator: "boolean",
  admin: "boolean",
  staff: "boolean",
  user_id: "number",
  hidden: "boolean",
  trust_level: "number",
  user_deleted: "boolean",
  can_view_edit_history: "boolean",
  wiki: "boolean",
  "?polls": "array",
  "?polls_votes": "object",
  "?link_counts": "array",
  "?user_status": "object|null",
  // discourse-reactions plugin (installed on production)
  reactions: "array",
  current_user_reaction: "object|null",
  "?reaction_users_count": "number|null",
};

// Poll (typeSchemas/Poll.ts, PollOption.ts). preloaded_voters is reshaped by
// helpers/poll.ts and can be an object or an array.
export const poll = {
  name: "string",
  type: "string",
  status: "string",
  results: "string",
  options: "array",
  "options[].id": "string",
  "options[].html": "string",
  "?options[].votes": "number",
  voters: "number",
  chart_type: "string",
  "?title": "string|null",
  "?public": "boolean",
  "?close": "string|null",
  "?preloaded_voters": "object|array",
};

// Topic (typeSchemas/Topic.ts) as it appears in topic lists.
export const listTopic = {
  id: "number",
  title: "string",
  fancy_title: "string",
  slug: "string",
  posts_count: "number",
  reply_count: "number",
  highest_post_number: "number",
  created_at: "string",
  last_posted_at: "string|null",
  bumped: "boolean",
  bumped_at: "string",
  archetype: "string",
  image_url: "string|null",
  unseen: "boolean",
  pinned: "boolean",
  // Only sent for pinned topics or when always_include_topic_excerpts is on.
  "?excerpt": "string|null",
  visible: "boolean",
  closed: "boolean",
  archived: "boolean",
  liked: "boolean|null",
  bookmarked: "boolean|null",
  views: "number",
  like_count: "number",
  category_id: "number|null",
  "?notification_level": "number",
  "?tags": "array",
  last_poster_username: "string|null",
  // Yalla patch (group D). topicsQuery.ts drops topics where this is true.
  flagged_by_user: "boolean",
  posters: "array",
  "posters[].description": "string",
  "posters[].user_id": "number",
  "?posters[].extras": "string|null",
};

// TopicsOutput / PrivateMessageOutput: topic_list plus the sideloaded users
// that topicsQuery.ts matches to each poster (TopicPoster.user is non-null).
const topicList = {
  "topic_list.can_create_topic": "boolean",
  "topic_list.per_page": "number",
  "topic_list.topics": "array",
  ...prefixed("topic_list.topics[].", listTopic),
  users: "array",
  ...prefixed("users[].", userIcon),
};

// TopicDetailOutput: only `id` and `post_stream.posts` are non-null in Prose,
// but the app reads the rest to show a topic.
const topicDetail = {
  id: "number",
  title: "string",
  fancy_title: "string",
  slug: "string",
  posts_count: "number",
  highest_post_number: "number",
  created_at: "string",
  archetype: "string",
  views: "number",
  // likeTopicOrPostMutation.ts uses it to build LikedTopic.likeCount (non-null).
  like_count: "number",
  category_id: "number|null",
  image_url: "string|null",
  pinned: "boolean",
  visible: "boolean",
  closed: "boolean",
  archived: "boolean",
  "?tags": "array",
  actions_summary: "array",
  // TopicDetail (typeSchemas/TopicDetail.ts): these are non-null in Prose.
  "details.notification_level": "number",
  "details.participants": "array",
  ...prefixed("details.participants[].", { ...userIcon, post_count: "number" }),
  ...prefixed("details.created_by.", userIcon),
  ...prefixed("details.last_poster.", userIcon),
  "?details.can_edit": "boolean",
  "?details.allowed_users": "array",
  // topicDetailQuery.ts reads stream[0] to fetch the first post.
  "post_stream.stream": "array",
  "post_stream.posts": "array",
  ...prefixed("post_stream.posts[].", post),
  "?suggested_topics": "array",
  "?suggested_topics[].id": "number",
  "?suggested_topics[].title": "string",
  "?suggested_topics[].like_count": "number",
  "?suggested_topics[].posters[].description": "string",
  "?suggested_topics[].posters[].user.id": "number",
  "?suggested_topics[].posters[].user.username": "string",
};

function firstTag(topic) {
  const tag = topic?.tags?.[0];
  return typeof tag === "string" ? tag : tag?.name;
}

export default {
  area: "Topics",
  checks: [
    {
      id: 34,
      name: "Latest topic list",
      as: "member",
      method: "GET",
      path: "/latest.json?page=0",
      status: 200,
      expect: { ...topicList, "topic_list.top_tags": "array" },
      capture: (data, ctx) => {
        const topics = data?.topic_list?.topics ?? [];
        const topic =
          topics.find((t) => t?.title?.includes("recovery circle")) ?? topics[0];
        ctx.topicId = topic?.id;
        ctx.categoryId = topic?.category_id ?? undefined;
        ctx.tag = firstTag(topic) ?? firstTag(topics.find((t) => firstTag(t))) ?? "wellbeing";
      },
    },
    {
      id: 34,
      name: "Top topic list",
      as: "member",
      method: "GET",
      path: "/top.json?page=0",
      status: 200,
      // Topics can be empty until Discourse's daily top-topics job has run.
      expect: { ...topicList, "topic_list.for_period": "string" },
    },
    {
      // parseTopicUrl.ts builds /top/{period}.json. Discourse only keeps that
      // as a 301 to /top.json?period=..., which Prose's axios follows. If the
      // redirect is ever removed, the period filter breaks.
      id: 34,
      name: "Top topic list with a period (old URL, redirect)",
      as: "member",
      method: "GET",
      path: "/top/weekly.json",
      status: [200, 301],
      expect: {},
    },
    {
      id: 34,
      name: "Category topic list",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.categoryId && `/c/${ctx.categoryId}/l/latest.json?page=0`,
      status: 200,
      expect: topicList,
    },
    {
      id: 34,
      name: "Tag topic list",
      as: "member",
      method: "GET",
      path: (ctx) => `/tag/${encodeURIComponent(ctx.tag ?? "wellbeing")}/l/latest.json?page=0`,
      status: 200,
      // Every topic here has the tag, so this is the one list where checking
      // each tag is a string is safe (empty arrays elsewhere would be "not verified").
      // Prose declares Topic.tags as [String].
      expect: { ...topicList, "topic_list.topics[].tags[]": "string" },
    },
    {
      id: 34,
      name: "Category + tag topic list",
      as: "member",
      method: "GET",
      path: (ctx) =>
        ctx.categoryId &&
        `/tags/c/${ctx.categoryId}/${encodeURIComponent(ctx.tag ?? "wellbeing")}/l/latest.json?page=0`,
      status: 200,
      expect: topicList,
    },
    {
      id: 35,
      name: "Topic detail",
      as: "member",
      method: "GET",
      // Prose also sends track_visit=true, which records a view. Left out so
      // this stays a read-only check; it does not change the response shape.
      path: (ctx) => ctx.topicId && `/t/${ctx.topicId}.json?include_raw=true`,
      status: 200,
      expect: { ...topicDetail, "?post_stream.posts[].raw": "string" },
      capture: (data, ctx) => {
        const posts = data?.post_stream?.posts ?? [];
        const first = posts.find((p) => p?.post_number === 1);
        const reply =
          posts.find((p) => p?.post_number > 1 && p?.username === ctx.member2Username) ??
          posts.find((p) => p?.post_number > 1 && p?.username !== ctx.username);
        ctx.firstPostId = first?.id ?? data?.post_stream?.stream?.[0];
        ctx.replyPostId = reply?.id;
        ctx.replyPostNumber = reply?.post_number;
        ctx.topicPostNumbers = posts.map((p) => p?.post_number).filter(Boolean);
        const firstPoll = first?.polls?.[0];
        ctx.pollPostId = firstPoll ? first.id : undefined;
        ctx.pollName = firstPoll?.name;
        ctx.pollOptionId = firstPoll?.options?.[0]?.id;
      },
    },
    {
      id: 36,
      name: "Topic detail from a post number",
      as: "member",
      method: "GET",
      path: (ctx) =>
        ctx.topicId && `/t/${ctx.topicId}/${ctx.replyPostNumber ?? 1}.json?include_raw=true`,
      status: 200,
      expect: {
        id: "number",
        like_count: "number",
        "details.notification_level": "number",
        ...prefixed("details.created_by.", userIcon),
        "post_stream.stream": "array",
        "post_stream.posts": "array",
        ...prefixed("post_stream.posts[].", post),
      },
    },
    {
      id: 37,
      name: "Topic posts by id (topicDetail with postIds)",
      as: "member",
      method: "GET",
      path: (ctx) =>
        ctx.topicId &&
        ctx.firstPostId &&
        `/t/${ctx.topicId}/posts.json?post_ids[]=${ctx.firstPostId}&include_raw=true`,
      status: 200,
      expect: {
        id: "number",
        "post_stream.posts": "array",
        ...prefixed("post_stream.posts[].", post),
        "?post_stream.posts[].raw": "string",
      },
    },
    {
      // pinnedPostsQuery.ts filters on post.custom_fields.pinned. Stock
      // Discourse never serialises post custom_fields, so this is optional
      // here; see the report for what that means for pinned posts.
      id: 37,
      name: "Topic posts (pinnedPosts)",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.topicId && `/t/${ctx.topicId}/posts.json`,
      status: 200,
      expect: {
        "post_stream.posts": "array",
        ...prefixed("post_stream.posts[].", post),
        "?post_stream.posts[].custom_fields": "object",
      },
    },
    {
      id: 42,
      name: "Private messages inbox",
      as: "member",
      method: "GET",
      path: (ctx) => `/topics/private-messages/${ctx.username}.json?page=0`,
      status: 200,
      expect: {
        ...topicList,
        "topic_list.topics[].participants": "array",
        "topic_list.topics[].allowed_user_count": "number",
      },
      capture: (data, ctx) => {
        const topics = data?.topic_list?.topics ?? [];
        ctx.pmTopicId = (
          topics.find((t) => t?.title?.includes("Checking in")) ?? topics[0]
        )?.id;
      },
    },
    {
      id: 43,
      name: "Private messages sent",
      as: "member",
      method: "GET",
      path: (ctx) => `/topics/private-messages-sent/${ctx.username}.json?page=0`,
      status: 200,
      expect: {
        ...topicList,
        "topic_list.topics[].participants": "array",
        "topic_list.topics[].allowed_user_count": "number",
      },
    },
    {
      id: 41,
      name: "Post read timings",
      as: "member",
      write: true,
      method: "POST",
      path: (ctx) => ctx.topicId && "/topics/timings.json",
      // Same body as helpers/getTopicTimings.ts. Only marks posts as read.
      json: (ctx) => ({
        timings: Object.fromEntries((ctx.topicPostNumbers?.length ? ctx.topicPostNumbers : [1]).map((n) => [n, 1000])),
        topic_id: ctx.topicId,
        topic_time: 1000,
      }),
      status: 200,
      expect: {},
    },
  ],
};
