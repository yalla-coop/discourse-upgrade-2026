// Inventory rows 59-66: search, tag search, categories, site, site settings, about, root.
// Source: forward-trust-community-mobile-app/api/src/
//   resolvers/topics/searchQuery.ts, searchTagsQuery.ts, categoryQuery.ts, showCategoryQuery.ts
//   resolvers/site/siteQuery.ts, aboutQuery.ts, health/healthQuery.ts, server/validate.ts
//   typeSchemas/SearchOutput.ts, SearchTopic.ts, SearchPost.ts, GroupedSearchResult.ts,
//   Tag.ts, CategoryList.ts, Categories.ts, SiteSetting.ts, TopicFlagTypes.ts, About.ts
//
// All read-only.

import { prefixed } from "./30-topics.mjs";

// SearchTopic (typeSchemas/SearchTopic.ts). flaggedByUser is NON-NULL here,
// so search errors outright if the Yalla patch (group D) is lost.
const searchTopic = {
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
  unseen: "boolean",
  pinned: "boolean",
  flagged_by_user: "boolean",
  "?excerpt": "string|null",
  visible: "boolean",
  closed: "boolean",
  archived: "boolean",
  "?tags": "array",
  category_id: "number|null",
};

// SearchPost (typeSchemas/SearchPost.ts). blurb comes from the Yalla excerpt
// patches (group C) and is non-null in Prose.
const searchPost = {
  id: "number",
  avatar_template: "string",
  blurb: "string",
  created_at: "string",
  "?name": "string|null",
  username: "string",
  like_count: "number",
  post_number: "number",
  topic_id: "number",
};

// Category (typeSchemas/Categories.ts). Fields Discourse can legitimately
// send as null are typed "|null" even where Prose says non-null; those are
// listed in the upgrade notes as existing Prose schema problems.
const category = {
  id: "number",
  name: "string",
  slug: "string",
  color: "string",
  text_color: "string",
  description: "string|null", // Prose: non-null. null for categories with no description.
  description_excerpt: "string|null", // Prose: non-null. Same.
  "?description_text": "string|null",
  topic_url: "string|null", // Prose: non-null. null for Uncategorized.
  topic_count: "number",
  post_count: "number",
  position: "number",
  read_restricted: "boolean",
  permission: "number|null", // Prose: non-null. null where the user can't create topics.
  has_children: "boolean|null", // Prose: non-null. Discourse sends null when a category has no subcategories.
  show_subcategory_list: "boolean",
  num_featured_topics: "number",
  default_view: "string|null",
  subcategory_list_style: "string",
  default_top_period: "string",
  default_list_filter: "string",
  navigate_to_first_post_after_read: "boolean",
  "?topic_template": "string|null",
};

// Yalla patch (group B): group_permissions on BasicCategorySerializer.
const groupPermissions = {
  group_permissions: "array",
  "group_permissions[].group_name": "string",
  "group_permissions[].permission_type": "number",
};

// TopicFlagTypes (typeSchemas/TopicFlagTypes.ts). siteQuery.ts filters out
// entries whose id or name_key is null, then camelCases the rest.
const flagType = {
  id: "number",
  name_key: "string|null",
  name: "string",
  description: "string",
  "?short_description": "string",
  "?is_flag": "boolean",
};

export default {
  area: "Search, categories & site",
  checks: [
    {
      id: 59,
      name: "Search",
      as: "member",
      method: "GET",
      path: `/search.json?q=${encodeURIComponent("recovery circle")}&page=1`,
      status: 200,
      expect: {
        topics: "array",
        ...prefixed("topics[].", searchTopic),
        posts: "array",
        ...prefixed("posts[].", searchPost),
        // GroupedSearchResult: all non-null except the more_* flags.
        "grouped_search_result.can_create_topic": "boolean",
        "grouped_search_result.term": "string",
        "grouped_search_result.post_ids": "array",
        "grouped_search_result.user_ids": "array",
        "grouped_search_result.category_ids": "array",
        "grouped_search_result.tag_ids": "array",
        "grouped_search_result.group_ids": "array",
        // Only sent when Discourse logged the search (page 1 of a new term).
        "grouped_search_result.search_log_id": "number",
        "?grouped_search_result.more_posts": "boolean|null",
        "?grouped_search_result.more_full_page_results": "boolean|null",
      },
    },
    {
      id: 60,
      name: "Tag search",
      as: "member",
      method: "GET",
      path: (ctx) =>
        `/tags/filter/search.json?q=${encodeURIComponent((ctx.tag ?? "wellbeing").slice(0, 4))}&limit=5`,
      status: 200,
      // Tag (typeSchemas/Tag.ts): count, id, pmCount, text are non-null.
      // pm_count is only sent to staff (see notes), so it is optional here.
      expect: {
        results: "array",
        // A number from Discourse 2025.12 (it was the tag name). Prose hands the
        // app the name instead (fix/tag-search-ids), so `text` must stay a string.
        "results[].id": "string|number",
        "results[].text": "string",
        "results[].count": "number",
        "?results[].pm_count": "number",
        "?results[].target_tag": "string|null",
      },
    },
    {
      id: 61,
      name: "Category list with subcategories",
      as: "member",
      method: "GET",
      path: "/categories.json?include_subcategories=true",
      status: 200,
      expect: {
        "category_list.can_create_category": "boolean",
        "category_list.can_create_topic": "boolean",
        "category_list.categories": "array",
        ...prefixed("category_list.categories[].", category),
        // From CategoryDetailedSerializer, not sent by /c/{id}/show.json.
        "category_list.categories[].topics_day": "number",
        "category_list.categories[].topics_week": "number",
        "category_list.categories[].topics_month": "number",
        "category_list.categories[].topics_year": "number",
        "category_list.categories[].topics_all_time": "number",
        "category_list.categories[].notification_level": "number",
        "?category_list.categories[].subcategory_list": "array",
        ...prefixed("category_list.categories[].", groupPermissions),
      },
      capture: (data, ctx) => {
        const categories = data?.category_list?.categories ?? [];
        ctx.privateCategoryId = (
          categories.find((c) => c?.name === "Contract Mentors") ?? categories.find((c) => c?.read_restricted)
        )?.id;
        ctx.categoryId ??= categories[0]?.id;
      },
    },
    {
      // As a member, stock CategorySerializer only includes group_permissions
      // for users who can edit the category, so it is optional here (Prose's
      // field is nullable). The admin check below confirms the field itself.
      id: 62,
      name: "Show category (member)",
      as: "member",
      method: "GET",
      path: (ctx) => ctx.categoryId && `/c/${ctx.categoryId}/show.json`,
      status: 200,
      expect: {
        ...prefixed("category.", category),
        "category.notification_level": "number",
        "?category.group_permissions": "array",
      },
    },
    {
      id: 62,
      name: "Show private category (admin, group_permissions)",
      as: "admin",
      method: "GET",
      path: (ctx) => {
        const id = ctx.privateCategoryId ?? ctx.categoryId;
        return id && `/c/${id}/show.json`;
      },
      status: 200,
      expect: {
        "category.id": "number",
        "category.name": "string",
        ...prefixed("category.", groupPermissions),
      },
    },
    {
      id: 63,
      name: "Site",
      as: "member",
      method: "GET",
      path: "/site.json",
      status: 200,
      expect: {
        // siteQuery.ts falls back to false / 1 if these are missing, so a
        // rename would silently change app behaviour rather than error.
        can_create_tag: "boolean",
        can_tag_topics: "boolean",
        uncategorized_category_id: "number",
        topic_flag_types: "array",
        ...prefixed("topic_flag_types[].", flagType),
        post_action_types: "array",
        ...prefixed("post_action_types[].", flagType),
        // SiteSetting.groups -> GroupSiteSetting { id, name }, both non-null.
        groups: "array",
        "groups[].id": "number",
        "groups[].name": "string",
      },
    },
    {
      // siteQuery.ts reads 19 named client settings and falls back to a
      // default for each one that is missing, so a renamed setting does not
      // error, it silently changes what the app allows. enable_sso and
      // full_name_required are already gone today (renamed to
      // enable_discourse_connect / full_name_requirement), so they are optional.
      id: 64,
      name: "Site settings (client)",
      as: "member",
      method: "GET",
      path: "/site/settings.json",
      status: 200,
      expect: {
        invite_only: "boolean",
        allow_new_registrations: "boolean",
        "?enable_sso": "boolean",
        authorized_extensions: "string",
        min_search_term_length: "number",
        tagging_enabled: "boolean",
        max_tags_per_topic: "number",
        max_tag_length: "number",
        max_username_length: "number",
        min_username_length: "number",
        min_password_length: "number",
        "?full_name_required": "boolean",
        default_composer_category: "string|number|null",
        allow_uncategorized_topics: "boolean",
        enable_user_status: "boolean",
        external_emoji_url: "string",
        emoji_set: "string",
        poll_enabled: "boolean",
        // Hidden and deprecated upstream in favour of poll_create_allowed_groups.
        poll_minimum_trust_level_to_create: "number",
      },
    },
    {
      id: 65,
      name: "About stats",
      as: "member",
      method: "GET",
      path: "/about.json",
      status: 200,
      // aboutQuery.ts destructures about.stats with no guard, so a missing
      // `stats` object throws.
      expect: {
        "about.stats": "object",
        // Prose reads topic_count/post_count, but Discourse sends topics_count/
        // posts_count, so the app's About screen shows 0 today (existing Prose
        // bug). Pin the keys Discourse really sends.
        "about.stats.topics_count": "number",
        "about.stats.posts_count": "number",
      },
    },
    {
      // server/validate.ts: GET the Discourse root at Prose start-up and look
      // for any x-discourse* response header.
      id: 66,
      name: "Root URL answers with x-discourse headers",
      as: "anon",
      run: async ({ anon }) => {
        const response = await anon.send("GET", "/", {
          headers: { Accept: "application/json, text/plain, */*" },
        });
        const names = [...response.headers.keys()];
        if (!names.some((name) => name.toLowerCase().startsWith("x-discourse"))) {
          response.problems = ["no x-discourse* response header"];
        }
        return { ...response, data: null };
      },
      status: 200,
      expect: {},
    },
  ],
};
