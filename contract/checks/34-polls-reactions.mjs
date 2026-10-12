// Inventory rows 54-58: polls (poll plugin) and reactions (discourse-reactions plugin).
// Source: forward-trust-community-mobile-app/api/src/
//   resolvers/topics/votePollMutation.ts, undoVotePollMutation.ts, togglePollStatusMutation.ts,
//   helpers/poll.ts, resolvers/topics/likeTopicOrPostMutation.ts, helpers/likeErroHandler.ts,
//   resolvers/topics/reactionsUsersQuery.ts
//   typeSchemas/Poll.ts, PollOption.ts, PollVoteOutput.ts, Post.ts, ReactionsUsers.ts
//
// Uses the poll on the seeded topic's first post (found by 30-topics.mjs, row 35)
// and member2's seeded reply. Every write is undone:
//   56 closes the poll, then 56 reopens it (only the OP or staff may, so this
//      runs as the member who wrote the seeded topic)
//   54 votes, then 55 removes the vote
//   57 adds the member's heart reaction, 58 lists reactions, 57 removes it again

import { prefixed, post, poll } from "./30-topics.mjs";

const pollPath = (target) => (ctx) => (ctx.pollPostId && ctx.pollName ? target : undefined);

const reactionPost = {
  ...post,
  "?reactions[].id": "string",
  "?reactions[].type": "string",
  "?reactions[].count": "number",
};

export default {
  area: "Polls & reactions",
  checks: [
    {
      id: 56,
      name: "Close a poll",
      as: "member",
      write: true,
      method: "PUT",
      path: pollPath("/polls/toggle_status.json"),
      json: (ctx) => ({ post_id: ctx.pollPostId, poll_name: ctx.pollName, status: "closed" }),
      status: 200,
      expect: prefixed("poll.", poll),
    },
    {
      id: 56,
      name: "Reopen the poll",
      as: "member",
      write: true,
      method: "PUT",
      path: pollPath("/polls/toggle_status.json"),
      json: (ctx) => ({ post_id: ctx.pollPostId, poll_name: ctx.pollName, status: "open" }),
      status: 200,
      expect: prefixed("poll.", poll),
    },
    {
      id: 54,
      name: "Vote in a poll",
      as: "member",
      write: true,
      method: "PUT",
      path: (ctx) => (ctx.pollOptionId ? pollPath("/polls/vote.json")(ctx) : undefined),
      json: (ctx) => ({ post_id: ctx.pollPostId, poll_name: ctx.pollName, options: [ctx.pollOptionId] }),
      status: 200,
      expect: {
        ...prefixed("poll.", poll),
        // PollVoteOutput.vote is [String]
        vote: "array",
        "vote[]": "string",
      },
    },
    {
      id: 55,
      name: "Remove the poll vote",
      as: "member",
      write: true,
      method: "DELETE",
      path: pollPath("/polls/vote.json"),
      json: (ctx) => ({ post_id: ctx.pollPostId, poll_name: ctx.pollName }),
      status: 200,
      expect: prefixed("poll.", poll),
    },
    {
      id: 57,
      name: "Toggle a reaction on (heart)",
      as: "member",
      write: true,
      method: "PUT",
      path: (ctx) =>
        ctx.replyPostId &&
        `/discourse-reactions/posts/${ctx.replyPostId}/custom-reactions/heart/toggle.json`,
      status: 200,
      // The post body is returned as Prose's Post type (LikeOutputUnion).
      expect: {
        ...reactionPost,
        "?current_user_reaction.id": "string",
        "?current_user_reaction.type": "string",
        "?current_user_reaction.can_undo": "boolean",
      },
      capture: (data, ctx) => {
        // If a previous run left a reaction behind, this toggle removed it and
        // there is nothing to undo below.
        ctx.reactionAdded = data?.current_user_reaction != null;
      },
    },
    {
      id: 58,
      name: "Users who reacted to a post",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.replyPostId && `/discourse-reactions/posts/${ctx.replyPostId}/reactions-users.json`,
      status: 200,
      // ReactionsUsers / ReactionUsers / ReactionUser, all non-null except name.
      // Without --writes the post may have no reactions, so items are "not verified".
      expect: {
        reaction_users: "array",
        "reaction_users[].id": "string",
        "reaction_users[].count": "number",
        "reaction_users[].users": "array",
        "reaction_users[].users[].username": "string",
        "?reaction_users[].users[].name": "string|null",
        "reaction_users[].users[].avatar_template": "string",
        "reaction_users[].users[].can_undo": "boolean",
        "reaction_users[].users[].created_at": "string",
      },
    },
    {
      id: 57,
      name: "Toggle the reaction off again",
      as: "member",
      write: true,
      method: "PUT",
      path: (ctx) =>
        ctx.reactionAdded && ctx.replyPostId
          ? `/discourse-reactions/posts/${ctx.replyPostId}/custom-reactions/heart/toggle.json`
          : undefined,
      status: 200,
      expect: reactionPost,
      capture: (_data, ctx) => {
        ctx.reactionAdded = false;
      },
    },
  ],
};
