# 02 - Safety net (Layer A tests)

Phase 0, step 6. Written 2026-10-12.

## What it is

`spec/yalla/` holds tests that pin down how **production behaves today** for each Yalla custom change. They were written against `baseline/prod-3.4.0.beta4-dev` and **all pass there (26 examples)**.

The rule for every hop: these tests must pass **unchanged** before the hop counts as stable. If one fails, a behaviour the app relies on has changed. We fix the code, never the test, unless we deliberately decide to change that behaviour.

Each test was also checked by breaking the matching code on purpose and confirming the test fails. This rules out tests that would pass no matter what.

## How to run

The test environment is a Docker container built from Discourse's own dev image for the matching date. Nothing is installed on the Mac itself.

```bash
# one-time: start the baseline container (image from 2025-01-31, matches production)
docker run -d --name ft-baseline --hostname discourse \
  -v ~/yalla/discourse-upgrade-data/baseline:/shared/postgres_data:delegated \
  -v ~/yalla/discourse-upgrade:/src:delegated \
  -e SE_MANAGER_PATH=/usr/local/bin/selenium-manager \
  discourse/discourse_dev:20250131-0015-arm64 /sbin/boot

# one-time: dependencies and test database
docker exec -u discourse:discourse -w /src ft-baseline bash -lc \
  'bundle install && pnpm install --frozen-lockfile && RAILS_ENV=test LOAD_PLUGINS=1 bin/rake db:create db:migrate'

# every run (CI=1 turns on Rails eager loading, as in production)
docker exec -u discourse:discourse -w /src -e LOAD_PLUGINS=1 -e CI=1 ft-baseline bin/rspec spec/yalla
```

For each hop, start a new container from the `discourse_dev` image dated nearest to that version's release (tags look like `YYYYMMDD-HHMM-arm64`), with its own data folder, for example `~/yalla/discourse-upgrade-data/hop-3.4.7`.

## Checklist for every hop

1. Merge the new Discourse version into a `hop/<version>` branch. Check that core matches the official tag exactly, with only Yalla files different. If the version is on its own release line (for example 2025.12), set core to the tag file by file (see `docs/upgrade/08-hop-2025.12.md`). Keep `.github/dependabot.yml` deleted (#52).
2. Start a container from the `discourse_dev` image dated nearest the release. Install, and build the dev and test databases.
3. Run Layer A and Layer B: `CONTAINER=ft-hop-<v> HOP=<v> script/safety-net.sh`.
4. For every change Layer B reports, check what the **app** reads through Prose before deciding. Fix Prose when the app would break (as for the CSRF login fix and the tag search fix). Accept the change in the check only when the app is unaffected, and say why in a comment.
5. Run the full suite on the staging backup: `STAGING_BACKUP=<file> CONTAINER=ft-hop-<v> HOP=<v> script/safety-net.sh full`. Run the emulator headless.
6. If a Prose fix was needed, run Prose's own tests in the app repo:
   - `cd api && npx jest`. The 2 failures in `apiKeys` and `resolvers/utils` are old ones that also fail on `main`.
   - `node --test .maestro/scripts/__tests__/`
7. Write the hop notes (`docs/upgrade/NN-hop-<v>.md`), update the tracker, and open the PR.
8. Any Prose fix goes to staging first, then production, before the Discourse switch.

Layer C reference: `contract/reports/layer-c-baseline-staging.json`. Re-record it when the app's flows change, for example when a flow moves from `.maestro/pending/` into `.maestro/flows/`.

## What is covered

| Area | File | Tests |
|---|---|---|
| Chat: notification record + `created_chat_notification` event for Lexicon | `chat_notifications_spec.rb` | 2 |
| Chat: mobile level "never" gets nothing | `chat_notifications_spec.rb` | 1 |
| Chat: new memberships default to "always" | `chat_notifications_spec.rb` | 1 |
| Chat: messages before joining are not unread | `chat_notifications_spec.rb` | 2 |
| Chat: mentions in new messages give one `chat_message` notification, no `chat_mention`, one web alert; edits still create `chat_mention` | `chat_notifications_spec.rb` | 3 |
| Chat: thread replies before joining a thread are not unread (trigger, and the plugin's backfill) | `chat_notifications_spec.rb` | 2 |
| Chat serializers: `admin`, `ignored_usernames`, `can_chat_user` for self | `chat_notifications_spec.rb` | 3 |
| Category `group_permissions` (serializer + `/site.json`) | `core_changes_spec.rb` | 3 |
| Post previews: full HTML, links kept, video links | `core_changes_spec.rb` | 4 |
| `flagged_by_user` (lists, topic page, other users) | `core_changes_spec.rb` | 3 |
| Search: cooked on posts, `flagged_by_user` on topics | `core_changes_spec.rb` | 1 |
| Group owner email: holding wording, plain wording, not on password reset | `core_changes_spec.rb` | 3 |

## Not covered yet

- Chatable groups include their `users` (`chatables_serializer.rb`).
- `PostItemExcerpt` (user activity, drafts, group posts) returning cooked HTML.
- Search topics include `image_url` and `thumbnails`.
- Rate limits. These become `app.yml` settings and get checked in Layer B against the AWS practice copy.

## Things found while writing the tests

1. **Production bug (existing today, not caused by the upgrade).** If a group has an owner but no **full name**, a new member's email confirmation crashes with `NoMethodError: undefined method 'downcase' for nil` (`UserNotifications.notify_group_owner`, from commit `d66f43f15d`). The user can't activate their account. To check whether this can happen on production, someone with data access can run:
   ```ruby
   Group.joins(:group_users).where(group_users: { owner: true }).where(full_name: [nil, ""]).distinct.pluck(:name)
   ```
   The fix is one line (`group_name.to_s`). Decide whether to hotfix production now or fix it during the upgrade.
2. **The chat code on production is a merge of our patch and upstream's newer code.** It filters on the new `notification_level` column and the old `mobile_notification_level` column at the same time. Because of that, our "notify on mention" branch can never run. The tests pin down what really happens, so the rewrite has to match this behaviour and not the original intent.
3. **`flagged_by_user` is defined twice** (`ListableTopicSerializer` and `TopicListItemSerializer`). This is harmless, but it can be cleaned up during the move to the plugin.
4. **`spec/fixtures/images/fake.jpg`** is a Flash file disguised as a JPG, used by Discourse to test upload rejection. The Mac's antivirus deletes it. It only affects 3 upstream upload tests, not ours. Never commit its deletion.
