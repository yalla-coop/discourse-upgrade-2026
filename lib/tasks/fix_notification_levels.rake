# frozen_string_literal: true

# Fixes "hyperactive" push notifications introduced by the group-category
# migration that set group members' category notification level to Watching (3).
#
# Watching a category means "notify me of every reply in every topic in it" —
# so members were pinged for replies to other people's posts. This task lowers
# the affected categories to Watching First Post (4): members still get a push
# for new topics and for direct replies to their own posts, but not for replies
# to posts they never participated in.
#
# Lowering the CategoryUser level also makes CategoryUser.auto_watch self-heal
# the topics the migration auto-watched (reason = auto_watch_category): they are
# reset back to Tracking once the category is no longer Watched.
#
# Usage (inside the Discourse container / app dir):
#   DRY_RUN=1 bin/rake notifications:fix_watching      # report only, no writes
#   bin/rake notifications:fix_watching                # fix the group categories
#   FIX_RESOURCE=1 bin/rake notifications:fix_watching # also fix non-group ("resource") categories at Watching
#
# Idempotent: a second run reports 0 changes.

namespace :notifications do
  desc "Lower over-watched categories from Watching to Watching First Post (fixes hyperactive reply notifications)"
  task fix_watching: :environment do
    watching = NotificationLevels.all[:watching] # 3
    watching_first_post = NotificationLevels.all[:watching_first_post] # 4
    auto_watch_reason = TopicUser.notification_reasons[:auto_watch_category]

    dry_run = %w[1 true yes].include?(ENV["DRY_RUN"].to_s.downcase)
    fix_resource = %w[1 true yes].include?(ENV["FIX_RESOURCE"].to_s.downcase)

    log = ->(msg) { puts msg }
    name_for = ->(ids) { Category.where(id: ids).pluck(:id, :name).to_h }

    log.call "=" * 72
    log.call "notifications:fix_watching  (#{dry_run ? "DRY RUN — no writes" : "APPLYING CHANGES"})"
    log.call "=" * 72

    # ---------------------------------------------------------------------
    # Phase 0 — Diagnostic
    # ---------------------------------------------------------------------
    log.call "\n[Phase 0] Current state\n"

    log.call "Site setting default_categories_watching:            #{SiteSetting.default_categories_watching.inspect}"
    log.call "Site setting default_categories_watching_first_post: #{SiteSetting.default_categories_watching_first_post.inspect}"

    group_defaults = GroupCategoryNotificationDefault.where(notification_level: watching).to_a
    group_category_ids = group_defaults.map(&:category_id).uniq

    log.call "\nGroup category defaults at Watching (#{group_defaults.size} rows, #{group_category_ids.size} categories):"
    if group_defaults.any?
      group_names = Group.where(id: group_defaults.map(&:group_id).uniq).pluck(:id, :name).to_h
      cat_names = name_for.call(group_category_ids)
      group_defaults.each do |gcd|
        log.call "  - group #{group_names[gcd.group_id] || gcd.group_id} -> category #{cat_names[gcd.category_id] || gcd.category_id} (##{gcd.category_id})"
      end
    else
      log.call "  (none — already migrated, or never set)"
    end

    watching_by_cat = CategoryUser.where(notification_level: watching).group(:category_id).count
    cat_names = name_for.call(watching_by_cat.keys)
    resource_category_ids = watching_by_cat.keys - group_category_ids

    log.call "\nCategoryUser rows at Watching, per category:"
    watching_by_cat
      .sort_by { |_, c| -c }
      .each do |cat_id, count|
        kind = group_category_ids.include?(cat_id) ? "group" : "RESOURCE"
        log.call "  - [#{kind}] ##{cat_id} #{cat_names[cat_id] || "?"}: #{count} users"
      end
    log.call "  (none)" if watching_by_cat.empty?

    auto_watched =
      TopicUser.where(
        notification_level: watching,
        notifications_reason_id: auto_watch_reason,
      ).count
    log.call "\nTopicUser rows auto-watched by the migration (reason auto_watch_category): #{auto_watched}"
    log.call "  -> these are reset to Tracking when their category drops below Watching"

    log.call "\nResource (non-group) categories at Watching: #{resource_category_ids.sort.inspect}"
    log.call "  -> #{fix_resource ? "WILL be fixed (FIX_RESOURCE set)" : "left as-is (pass FIX_RESOURCE=1 to fix)"}"

    if dry_run
      log.call "\nDRY RUN complete — no changes made. Re-run without DRY_RUN to apply."
      next
    end

    # ---------------------------------------------------------------------
    # Helper — downgrade a set of categories to Watching First Post
    # ---------------------------------------------------------------------
    downgrade_categories = ->(category_ids, label) do
      next if category_ids.blank?
      names = name_for.call(category_ids)
      category_ids.each do |cat_id|
        ActiveRecord::Base.transaction do
          changed =
            CategoryUser.where(category_id: cat_id, notification_level: watching).update_all(
              notification_level: watching_first_post,
            )

          # Reset topics the migration auto-watched (now that the category is no
          # longer Watched, auto_watch's should_track branch pulls them back to
          # Tracking). auto_track keeps regular->tracking consistency.
          CategoryUser.auto_watch(category_id: cat_id)
          CategoryUser.auto_track(category_id: cat_id)

          log.call "  [#{label}] ##{cat_id} #{names[cat_id] || "?"}: #{changed} CategoryUser rows Watching -> Watching First Post"
        end
      end
    end

    # ---------------------------------------------------------------------
    # Phase 1 — Group categories
    # ---------------------------------------------------------------------
    log.call "\n[Phase 1] Fixing group categories\n"

    # 1a. Group defaults (so future members get Watching First Post)
    group_defaults
      .group_by(&:group_id)
      .each do |group_id, rows|
        group = Group.find(group_id)
        GroupCategoryNotificationDefault.batch_set(
          group,
          :watching_first_post,
          rows.map(&:category_id),
        )
      end
    log.call "  group defaults updated for #{group_defaults.map(&:group_id).uniq.size} groups (#{group_category_ids.size} categories)"

    # 1b. Existing members (per-category bulk; bypasses the no-downgrade guard
    #     in GroupUser.set_category_notifications)
    downgrade_categories.call(group_category_ids, "group")

    # ---------------------------------------------------------------------
    # Phase 2 — Resource categories (gated by FIX_RESOURCE)
    # ---------------------------------------------------------------------
    if fix_resource && resource_category_ids.present?
      log.call "\n[Phase 2] Fixing resource (non-group) categories\n"
      downgrade_categories.call(resource_category_ids, "resource")

      # Move leftover global default (the March "everyone watches everything")
      # from watching -> watching_first_post so new signups aren't re-flooded.
      watching_default = SiteSetting.default_categories_watching.split("|").reject(&:blank?)
      to_move = watching_default & resource_category_ids.map(&:to_s)
      if to_move.present?
        wfp_default = SiteSetting.default_categories_watching_first_post.split("|").reject(&:blank?)
        new_watching = (watching_default - to_move)
        new_wfp = (wfp_default + to_move).uniq
        log.call "\n  site setting default_categories_watching: #{watching_default.inspect} -> #{new_watching.inspect}"
        log.call "  site setting default_categories_watching_first_post: #{wfp_default.inspect} -> #{new_wfp.inspect}"
        SiteSetting.default_categories_watching = new_watching.join("|")
        SiteSetting.default_categories_watching_first_post = new_wfp.join("|")
      end
    elsif resource_category_ids.present?
      log.call "\n[Phase 2] Skipped #{resource_category_ids.size} resource categories at Watching (pass FIX_RESOURCE=1 to fix)."
    end

    log.call "\nDone. Re-run with DRY_RUN=1 to verify 0 remaining rows at Watching."
  end
end
