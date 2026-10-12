// Inventory rows 38-40, 44-53: single posts, creating and editing topics/posts/PMs,
// post actions and bookmarks.
// Source: forward-trust-community-mobile-app/api/src/
//   helpers/fetchPost.ts, resolvers/topics/postQuery.ts, postRawQuery.ts,
//   repliesQuery.ts, replyingToQuery.ts, editPostMutation.ts, editTopicMutation.ts,
//   newTopicMutation.ts, replyMutation.ts, newPrivateMessageMutation.ts,
//   deletePostMutation.ts, leaveMessageMutation.ts, flagPostMutation.ts,
//   bookmarkPostMutation.ts, chat/pinChatMessageMutation.ts, chat/unpinChatMessageMutation.ts
//   typeSchemas/Post.ts, BasicTopic.ts, BookmarkOutput.ts, PostInput.ts, EditPostInput.ts
//
// Write checks only touch content they create in the same run, labelled
// "[contract check]", and clean up after themselves:
//   46 creates a topic -> 38 edits its title -> 45 edits its first post -> 39 deletes it
//   46 creates a reply in the seeded topic, deleted again by the admin straight away
//   46 creates a PM from member2 to the member -> 40 the member leaves it -> admin deletes it
//   51 likes member2's seeded reply, then the like is removed
//   52 creates a bookmark -> 53 deletes it
//
// Row 51 (flagPostMutation) posts to /post_actions.json with a flag type. A
// real flag cannot be withdrawn by the member and would hide the seeded topic
// from every Prose list (flagged_by_user), so this check uses the like type
// (2), which returns the same post body and can be undone.
//
// Row 39 note: Prose's deletePostMutation.ts sends a post id to DELETE /t/{id}.json
// (known bug). This check calls the endpoint the way Discourse defines it,
// with the topic id.

import { prefixed, post, poll } from "./30-topics.mjs";

const run = Date.now();
const note = "This was created by the automated upgrade contract checks and is removed again straight away.";

const adminDelete = (pathFor) => async ({ admin }, ctx) => {
  const target = pathFor(ctx);
  if (target) await admin.request("DELETE", target, { form: { context: "contract check cleanup" } });
};

export default {
  area: "Posts",
  checks: [
    // ---- Read-only ----
    {
      id: 44,
      name: "Single post (first post, with poll and link)",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.firstPostId && `/posts/${ctx.firstPostId}.json?include_raw=true`,
      status: 200,
      expect: {
        ...post,
        raw: "string",
        polls: "array",
        ...prefixed("polls[].", poll),
        "?link_counts[].url": "string",
        "?link_counts[].clicks": "number",
        "?link_counts[].internal": "boolean",
        "?link_counts[].reflection": "boolean",
      },
    },
    {
      id: 44,
      name: "Single post (reply by another member)",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.replyPostId && `/posts/${ctx.replyPostId}.json?include_raw=true`,
      status: 200,
      expect: {
        ...post,
        raw: "string",
        // The member can like this post, so the like entry is always there.
        // likeErroHandler.ts and topicDetailQuery.ts read id/acted/can_undo.
        "actions_summary[].id": "number",
        "?actions_summary[].count": "number",
        "?actions_summary[].acted": "boolean",
        "?actions_summary[].can_act": "boolean",
        "?actions_summary[].can_undo": "boolean",
      },
    },
    {
      // Discourse answers with the raw Markdown as text/plain (not JSON);
      // postRawQuery.ts uses the body as a string. Only the status can be checked.
      id: 47,
      name: "Post raw",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.firstPostId && `/posts/${ctx.firstPostId}/raw.json?include_raw=true`,
      status: 200,
      expect: {},
    },
    {
      id: 48,
      name: "Post cooked",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.firstPostId && `/posts/${ctx.firstPostId}/cooked.json`,
      status: 200,
      expect: { cooked: "string" },
    },
    {
      id: 49,
      name: "Replies to a post",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.firstPostId && `/posts/${ctx.firstPostId}/replies.json`,
      status: 200,
      expect: { "[].id": "number" },
    },
    {
      id: 50,
      name: "Post reply history (replyingTo)",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.replyPostId && `/posts/${ctx.replyPostId}/reply-history.json?max_replies=1`,
      status: 200,
      expect: { "[].id": "number" },
    },

    // ---- New topic, edit it, delete it ----
    {
      id: 46,
      name: "Create a topic (newTopic)",
      as: "member",
      write: true,
      method: "POST",
      path: (ctx) => ctx.categoryId && "/posts.json",
      json: (ctx) => ({
        title: `[contract check] Automated topic ${run}`,
        raw: `[contract check] ${note} Run ${run}.`,
        category: ctx.categoryId,
        archetype: "regular",
      }),
      status: 200,
      expect: post,
      capture: (data, ctx) => {
        ctx.newTopicId = data?.topic_id;
        ctx.newTopicPostId = data?.id;
      },
    },
    {
      id: 38,
      name: "Edit topic title",
      as: "member",
      write: true,
      method: "PUT",
      path: (ctx) => ctx.newTopicId && `/t/-/${ctx.newTopicId}.json`,
      json: () => ({ title: `[contract check] Edited automated topic ${run}` }),
      status: 200,
      // BasicTopic (typeSchemas/BasicTopic.ts), all non-null.
      expect: {
        "basic_topic.id": "number",
        "basic_topic.title": "string",
        "basic_topic.fancy_title": "string",
        "basic_topic.slug": "string",
        "basic_topic.posts_count": "number",
      },
    },
    {
      id: 45,
      name: "Edit post",
      as: "member",
      write: true,
      method: "PUT",
      path: (ctx) => ctx.newTopicPostId && `/posts/${ctx.newTopicPostId}.json`,
      json: () => ({
        post: { raw: `[contract check] ${note} Edited in run ${run}.`, edit_reason: "contract check" },
      }),
      status: 200,
      expect: prefixed("post.", post),
    },
    {
      id: 39,
      name: "Delete the topic created above",
      as: "member",
      write: true,
      method: "DELETE",
      path: (ctx) => ctx.newTopicId && `/t/${ctx.newTopicId}.json`,
      status: [200, 204],
      expect: {},
      // If the member's delete failed, the admin removes it so nothing is left behind.
      cleanup: adminDelete((ctx) => ctx.newTopicId && `/t/${ctx.newTopicId}.json`),
    },

    // ---- Reply ----
    {
      id: 46,
      name: "Reply to a topic",
      as: "member",
      write: true,
      method: "POST",
      path: (ctx) => ctx.topicId && "/posts.json",
      // replyMutation.ts sends this URL-encoded.
      form: (ctx) => ({
        raw: `[contract check] ${note} Reply in run ${run}.`,
        topic_id: ctx.topicId,
        reply_to_post_number: 1,
        archetype: "regular",
      }),
      status: 200,
      expect: post,
      capture: (data, ctx) => {
        ctx.newReplyId = data?.id;
      },
      cleanup: adminDelete((ctx) => ctx.newReplyId && `/posts/${ctx.newReplyId}.json`),
    },

    // ---- Post action (see the note at the top about flags) ----
    {
      id: 51,
      name: "Post action (like type, same response as a flag)",
      as: "member",
      write: true,
      method: "POST",
      path: (ctx) => ctx.replyPostId && "/post_actions.json",
      form: (ctx) => ({ id: ctx.replyPostId, post_action_type_id: 2 }),
      status: 200,
      expect: post,
      capture: (data, ctx) => {
        ctx.likedPostId = data?.id;
      },
      cleanup: async ({ member }, ctx) => {
        if (!ctx.likedPostId) return;
        await member.request("DELETE", `/post_actions/${ctx.likedPostId}.json?post_action_type_id=2`);
        ctx.likedPostId = undefined;
      },
    },

    // ---- Bookmarks ----
    {
      // bookmarkPostMutation.ts sends only `post_id`. Discourse has required
      // bookmarkable_id + bookmarkable_type since 2022, so production already
      // answers 400 here (existing Prose bug). 400 is accepted so the check
      // reports a change only if Discourse starts behaving differently.
      id: 52,
      name: "Bookmark a post the way Prose sends it (post_id only)",
      as: "member",
      write: true,
      method: "POST",
      path: (ctx) => ctx.replyPostId && "/bookmarks.json",
      form: (ctx) => ({ post_id: ctx.replyPostId }),
      status: [200, 400],
      expect: {},
      capture: (data, ctx) => {
        ctx.proseBookmarkId = data?.id;
      },
      cleanup: async ({ member }, ctx) => {
        if (!ctx.proseBookmarkId) return;
        await member.request("DELETE", `/bookmarks/${ctx.proseBookmarkId}.json`);
        ctx.proseBookmarkId = undefined;
      },
    },
    {
      // The working form (used by pinChatMessageMutation.ts for chat messages).
      id: 52,
      name: "Bookmark a post (bookmarkable_id + type)",
      as: "member",
      write: true,
      method: "POST",
      path: (ctx) => ctx.replyPostId && "/bookmarks.json",
      form: (ctx) => ({ bookmarkable_id: ctx.replyPostId, bookmarkable_type: "Post" }),
      status: 200,
      // BookmarkOutput: success (String!) and id (Int!).
      expect: { success: "string", id: "number" },
      capture: (data, ctx) => {
        ctx.bookmarkId = data?.id;
      },
    },
    {
      id: 53,
      name: "Delete the bookmark",
      as: "member",
      write: true,
      method: "DELETE",
      path: (ctx) => ctx.bookmarkId && `/bookmarks/${ctx.bookmarkId}.json`,
      status: 200,
      expect: {},
    },

    // ---- Private message, then the member leaves it ----
    {
      id: 46,
      name: "Create a private message (newPrivateMessage)",
      as: "member2",
      write: true,
      method: "POST",
      path: "/posts.json",
      // newPrivateMessageMutation.ts sends this URL-encoded.
      form: (ctx) => ({
        title: `[contract check] Automated message ${run}`,
        raw: `[contract check] ${note} Run ${run}.`,
        target_recipients: ctx.username,
        archetype: "private_message",
      }),
      status: 200,
      expect: post,
      capture: (data, ctx) => {
        ctx.newPmTopicId = data?.topic_id;
      },
    },
    {
      id: 40,
      name: "Leave a private message",
      as: "member",
      write: true,
      method: "PUT",
      path: (ctx) => ctx.newPmTopicId && `/t/${ctx.newPmTopicId}/remove-allowed-user.json`,
      json: (ctx) => ({ username: ctx.username }),
      status: 200,
      expect: {},
      cleanup: adminDelete((ctx) => ctx.newPmTopicId && `/t/${ctx.newPmTopicId}.json`),
    },
  ],
};
