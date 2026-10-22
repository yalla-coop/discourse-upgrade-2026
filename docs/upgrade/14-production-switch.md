# 14 - Production switch (option A: in place)

The plan for upgrading production (`app.forwardtrust.org.uk`) from the old fork (Discourse `3.4.0.beta4-dev`, PostgreSQL 13) to stock Discourse **2026.9.0** with PostgreSQL 18 and the `discourse-forward-trust` plugin. Every step was rehearsed on a copy of production on 22 Oct 2026 (`13-production-rehearsal.md`).

- **The app is down for about 15 minutes** (rehearsal: 4 min 6 s + 6 min 29 s of rebuilds, plus start-up and the certificate step). Book **1 to 1.5 hours** of our time.
- Chosen by Mahmoud on 22 Oct over a blue/green swap: simpler and fully rehearsed.
- Nobody looks at member content. The checks print numbers and names only (`script/upgrade-checks/`).

## Already done

| | |
|---|---|
| Prose #659, #661, #664 on production | live since 22 Oct, 14:29 (Heroku v293, `99e9aafd`); checked with the store app 1.0.48 (114) on iOS and Android. Prose works with the old and the new forum. |
| Rehearsal on a production copy | no content lost, settings kept, images load, app flows 27/29 (2 expected) |
| Staging | upgraded 21 Oct; new features switched off 22 Oct, same as production will be |

## Before the day

1. **QA sign-off** on staging (builds 1.0.49 (117)).
2. **Agree a quiet hour** with Forward Trust (for example early morning UK time).
3. **Tell members the day before**, in plain words: the app will be unavailable for about 15 minutes for maintenance, at <time>; nothing needs doing on their side.
4. **Lexicon PR #1**: merge `upgrade-2026` into `master` on the day, just before step 5, and note the merge commit. (Production used to clone `master` unpinned; from now on it is pinned.)

## On the day

Times in brackets are from the rehearsal. All commands as root on the production server.

### 0. Just before (site still up)

```
sudo -s
cd /var/discourse
df -h /var/discourse/shared       # need at least 2 GB free (database is ~0.5 GB; rehearsal had 24 GB)
git log -1 --oneline              # expect aa547bc
git status --short                # expect: M templates/web.ratelimited.template.yml, ?? DEADJOE
```

Check production Prose is healthy:
`curl -s -X POST -H 'content-type: application/json' -d '{"query":"{health{isDiscourseReachable}}"}' https://forward-trust-api-3a7731b99ae8.herokuapp.com/`

### 1. Snapshot (the way back)

Lightsail → the production instance → Snapshots → **Create snapshot**, name `forwardtrust-prod-pre-2026-9-<date>`. Wait until it says available.

### 2. "Before" numbers (site still up)

Copy `script/upgrade-checks/numbers.rb` and `compare.rb` into the container (paste with `cat > … <<'EOF'`), then:

```
./launcher enter app
mkdir -p /shared/rehearsal          # then paste numbers.rb and compare.rb into it
chown -R discourse /shared/rehearsal
rails r /shared/rehearsal/numbers.rb before
exit
```

Rehearsal values for comparison: 798 users, 2,664 topics, 3,348 posts, 1,708 uploads, 6,969 files (1.9 GB), 59 groups, 84 categories, 138 settings, 16 plugins, 513 MB database.

### 3. Downtime starts: stop Discourse

```
date -u
./launcher stop app
```

### 4. Launcher: keep production's change, move to the tested version

```
git diff > /root/launcher-local-changes-<date>.patch
git checkout -- templates/web.ratelimited.template.yml
git fetch origin
git checkout 1deba5f
git log -1 --oneline                # 1deba5f DEV: Build a Ruby 4.0 test image (#1139)
```

The rate-limit numbers from the patch (60/60/600/600, `conn_per_ip` 20) are in the new `app.yml` `params`.

### 5. New `app.yml`, secrets copied on the server

```
cp containers/app.yml containers/app.yml.old-fork
cat > containers/app.yml <<'EOF'
<paste deploy/app.production.yml.example>
EOF
sed -i 's/__LEXICON_MERGE_COMMIT__/<Lexicon PR #1 merge commit>/' containers/app.yml
python3 - <<'EOF'
import re
old = open("containers/app.yml.old-fork").read().splitlines()
new = open("containers/app.yml").read()
for key in ["DISCOURSE_DEVELOPER_EMAILS", "DISCOURSE_SMTP_ADDRESS", "DISCOURSE_SMTP_PORT", "DISCOURSE_SMTP_USER_NAME",
            "DISCOURSE_SMTP_PASSWORD", "DISCOURSE_SMTP_DOMAIN", "DISCOURSE_NOTIFICATION_EMAIL", "LETSENCRYPT_ACCOUNT_EMAIL"]:
    line = next((l for l in old if re.match(r"^\s+%s:" % key, l)), None)
    if line is None:
        print("MISSING", key)
        continue
    new = new.replace("  %s: __COPY__" % key, "  " + line.strip(), 1)
open("containers/app.yml", "w").write(new)
print("placeholders left:", new.count("__COPY__") + new.count("__LEXICON_MERGE_COMMIT__"))
EOF
grep -nE "postgres|version:|HOSTNAME|lexicon|forward-trust|web.ssl|letsencrypt" containers/app.yml
```

Expected: `placeholders left: 0`, and the grep shows postgres.18, `v2026.9.0`, `app.forwardtrust.org.uk`, both SSL templates, the plugin at `264cbd2` and Lexicon at the merge commit. No secret is printed.

### 6. Rebuild 1, timed: PostgreSQL 13 → 18 (4 min 6 s)

```
date -u; time ./launcher rebuild app 2>&1 | tee /root/rebuild1.log | tail -40; date -u
```

Expected at the end: `UPGRADE OF POSTGRES COMPLETE`, old data in `/shared/postgres_data_old`. The `role "postgres" already exists` and `current user cannot be dropped` lines are normal.

### 7. Rebuild 2, timed: Discourse 2026.9 (6 min 29 s)

```
date -u; time ./launcher rebuild app 2>&1 | tee /root/rebuild2.log | tail -40; date -u
```

At start-up the container renews the Let's Encrypt certificate before anything else starts; on production (internet, correct DNS) this takes seconds.

### 8. Health and version

```
sleep 30
docker exec app sh -c 'sv status /etc/service/*'
curl -s -o /dev/null -w "%{http_code}\n" https://app.forwardtrust.org.uk/srv/status
./launcher enter app
rails r 'puts({ version: Discourse::VERSION::STRING, git: Discourse.git_version[0, 8], migrations_pending: ActiveRecord::Base.connection_pool.migration_context.needs_migration?, disable_emails: SiteSetting.disable_emails, push: SiteSetting.lexicon_push_notifications_enabled }.to_json)'
```

Expected: all services `run:`, `200`, `{"version":"2026.9.0","git":"343b20f9","migrations_pending":false,"disable_emails":"no",…,"push":true}`. (On production email and push stay **on**.)

### 9. Switch off features that were not running before

Decision (Mahmoud, 22 Oct): no new features. These plugins come with Discourse 2026.9 and would switch on by themselves:

```
rails r 'off = %w[ai_embeddings_enabled discourse_ai_enabled cakeday_birthday_enabled cakeday_enabled enable_discourse_github_plugin policy_enabled solved_enabled discourse_templates_enabled topic_voting_enabled enable_discourse_workflows]; off.each { |n| SiteSetting.public_send("#{n}=", false) if SiteSetting.respond_to?("#{n}=") }; puts off.map { |n| "#{n}=#{SiteSetting.public_send(n)}" }.join(", "); puts "plugins ON: #{Discourse.plugins.select(&:enabled?).map(&:name).sort.join(", ")}"'
```

Expected "plugins ON": automation, chat, checklist, discourse-data-explorer, discourse-details, discourse-forward-trust, discourse-lazy-videos, discourse-lexicon-plugin, discourse-local-dates, discourse-presence, discourse-reactions, docker_manager, footnote, poll, spoiler-alert.

**Downtime ends here** (the app works again). Note the time.

### 10. "After" numbers

```
rails r /shared/rehearsal/numbers.rb after
ruby /shared/rehearsal/compare.rb
exit
```

Expected, as in the rehearsal: topics, posts, categories unchanged; users, uploads, files, groups the same or more; fewer rows only in log tables (`email_logs`, `search_logs`, `web_hook_events`, `scheduler_stats`, `topic_hot_scores`); tables gone only the empty or renamed ones listed in `13-production-rehearsal.md` (plus `ai_*_embeddings_4_1`); `push_subscriptions` should **not** drop on production (same address). Anything else: stop and look before going on.

### 11. Check through the app (real phones, store app 1.0.48)

1. Log in; the feed loads; a tagged post shows its tags; filter by tag.
2. Open a post with images; images and avatars show.
3. Reply in the internal test category (`Yalla-Internal-Testing-2`).
4. **Push**: from the website, reply to your own test post with another account; the phone gets the notification.
5. **Email**: Admin → Emails → Send test email.
6. Open a member's profile in the app: it uses Prose's admin user lookup (the call that failed on staging when its key was revoked).
7. Watch `docker exec app tail -f /var/www/discourse/log/production.log` and Heroku's Prose logs for a few minutes.

Then tell members it is done.

## If something goes wrong

**Primary way back: the snapshot from step 1.**
1. Lightsail → Snapshots → the pre-upgrade snapshot → **Create new instance** (same plan).
2. Networking → move the **static IP** from the broken instance to the new one (seconds).
3. Check the site, then stop the broken instance (keep it for investigation).
This takes about 20 to 30 minutes and gives back production exactly as it was at step 1. Posts made after step 1 are lost, but the site was down from step 3, so that is only a few minutes.

**Quicker if rebuild 2 fails but rebuild 1 succeeded:** read the log (`/root/rebuild2.log`), fix `app.yml`, run rebuild 2 again; the data is already safe in PostgreSQL 18, with 13's copy in `/shared/postgres_data_old`.

Do not try to rebuild the old fork in place with `app.yml.old-fork` under the new launcher: the `postgres.13` template no longer builds with launcher `1deba5f` (found on the staging clone). Going back means the snapshot.

## After the day

| When | What |
|---|---|
| Same day | Update the tracker and these docs with the real times. |
| 1 week of normal running | `rm -rf /var/discourse/shared/standalone/postgres_data_old` |
| 2 weeks | Delete the pre-upgrade snapshot. |
| 1 month | Archive (do not delete) `yalla-coop/discourse`, the old fork: read-only, history kept. |
| Next store release | App fixes from #664 (link cards, checklists, SVG): build **118 or higher**. |
| Every 6 months | Upgrade again with the same safety net. |
