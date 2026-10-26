# 14 - Production switch (option B: new server, then move the IP)

The plan for upgrading production (`app.forwardtrust.org.uk`) from the old fork (Discourse `3.4.0.beta4-dev`, PostgreSQL 13) to stock Discourse **2026.9.0** with PostgreSQL 18 and the `discourse-forward-trust` plugin.

This is Untapped's plan, agreed with Alex: build a new server from a production snapshot, upgrade it there, check it, then switch over. The upgrade steps themselves were rehearsed on a copy of production on 22 Oct 2026 (`13-production-rehearsal.md`).

- **Members can keep reading the whole time.** Posting is paused (read-only) from the snapshot until the switch, about **60 to 90 minutes**. Ask Forward Trust for a **1 to 2 hour window** at a quiet time.
- **The switch is moving a Lightsail static IP** (`StaticIp-1`, 51.24.109.181) from the old server to the new one: seconds, no DNS change, nothing needed from Forward Trust. (Their DNS for the domain caches for 6 hours, so we never touch it.)
- **Way back: move the IP back.** The old server is not changed.
- Nobody looks at member content. Checks print numbers and names only (`script/upgrade-checks/`).

Names used below: **OLD** = `forwardtrust-prod-4gb` (today's production), **NEW** = the server made from the snapshot.

## Already done

| | |
|---|---|
| Prose #659, #661, #664 on production | live since 22 Oct 14:29 (Heroku v293, `99e9aafd`); checked with the store app 1.0.48 (114) on iOS and Android. Prose works with the old and the new forum. |
| Rehearsal on a production copy | about 11 minutes of rebuilds, no content lost, settings kept, images load, app flows 27/29 (2 expected) |
| Staging | upgraded 21 Oct; new features switched off 22 Oct |

## Before the day

1. **QA sign-off** on staging (builds 1.0.49 (117)).
2. **Practice the switch on staging** (no production data): a new staging server from a staging snapshot, upgraded the same way, kept silent, then staging's static IP moved to it and back. It proves the two steps the production rehearsal did not cover: the HTTPS certificate step while the domain still points at the old server, and the IP move. Staging's IP (18.175.133.201) must be a Lightsail static IP for this.
3. **Agree the window** with Forward Trust, and tell members the day before, in plain words: on <day> from <time> the app works as normal for reading, but posting and replying are paused for about an hour while we upgrade; nothing to do on their side, nothing is lost.
4. **On the day, just before step 6**: merge Lexicon PR #1 (`upgrade-2026` → `master`) and note the merge commit.
5. Decide `newuser_max_embedded_media`: keep 1 image per post for new members as today, or the new default 5.

## On the day

Times in brackets are from the rehearsal. Commands as root, `cd /var/discourse`.

### 1. OLD: checks (site up, normal)

```
df -h /var/discourse/shared       # need at least 2 GB free
git log -1 --oneline              # expect aa547bc
git status --short                # expect: M templates/web.ratelimited.template.yml, ?? DEADJOE
```

Production Prose healthy:
`curl -s -X POST -H 'content-type: application/json' -d '{"query":"{health{isDiscourseReachable}}"}' https://forward-trust-api-3a7731b99ae8.herokuapp.com/`

### 2. OLD: pause posting (read-only). Window starts.

```
./launcher enter app
rails r 'Discourse.enable_readonly_mode(Discourse::USER_READONLY_MODE_KEY); puts "read-only: #{Discourse.readonly_mode?}"'
```

Check in the app: posts open, replying is refused. Note the time.

### 3. OLD: what to switch back on later, and the "before" numbers

Still inside the container:

```
rails r 'puts({ disable_emails: SiteSetting.disable_emails, push: SiteSetting.lexicon_push_notifications_enabled, active_webhooks: WebHook.where(active: true).pluck(:id) }.to_json)'
```

Write the result down: on NEW, email, push and exactly these webhooks are switched back on at the switch.

Then paste `script/upgrade-checks/numbers.rb` and `compare.rb` into `/shared/rehearsal/` and:

```
chown -R discourse /shared/rehearsal
rails r /shared/rehearsal/numbers.rb before
exit
```

Rehearsal values: 798 users, 2,664 topics, 3,348 posts, 1,708 uploads, 6,969 files (1.9 GB), 59 groups, 84 categories, 138 settings, 16 plugins, 513 MB database.

### 4. OLD: snapshot (the rollback point)

So that NEW does **not** start Discourse by itself at boot (with production's email and push on), tell Docker on OLD not to auto-start the container on boot while the snapshot is taken. OLD keeps running as normal; this only matters after a reboot.

```
docker update --restart=no app
```

Lightsail → `forwardtrust-prod-4gb` → Snapshots → **Create snapshot**, `forwardtrust-prod-pre-2026-9-<date>`. Wait until available (10 to 20 minutes). Then put OLD back to normal:

```
docker update --restart=always app
```

Untapped also asked for a database export as a second copy: Admin → Backups → **Backup** on OLD (stays on OLD's disk, which is not changed).

### 5. NEW: create it, lock it down, make it silent

1. Snapshot → **Create new instance**, same region (London) and plan. Name `forwardtrust-prod-2026-9`. Note its temporary IP.
2. Networking: IPv4 firewall **SSH, HTTP, HTTPS restricted to our office IP** (and Lightsail browser SSH); IPv6 off.
3. SSH in. Discourse should **not** be running (step 4 turned off auto-start); check, and stop it if it is:

```
cd /var/discourse
docker ps --format '{{.Names}} {{.Status}}'   # expect nothing; if "app" is listed: ./launcher stop app
iptables -I DOCKER-USER -i docker0 -j DROP
iptables -I DOCKER-USER -i docker0 -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
docker stop -t 5 app 2>/dev/null
printf '#!/bin/bash\n# skip certificate renewal while the internet is blocked\nexit 0\n' > /tmp/letsencrypt-skip && chmod +x /tmp/letsencrypt-skip
docker cp /tmp/letsencrypt-skip app:/etc/runit/1.d/letsencrypt
./launcher start app
sleep 40
./launcher enter app
rails r 'require "sidekiq/api"; SiteSetting.disable_emails = "yes"; SiteSetting.lexicon_push_notifications_enabled = false; WebHook.update_all(active: false); Sidekiq::Queue.all.each(&:clear); Sidekiq::ScheduledSet.new.clear; Sidekiq::RetrySet.new.clear; puts({ disable_emails: SiteSetting.disable_emails, push: SiteSetting.lexicon_push_notifications_enabled, active_webhooks: WebHook.where(active: true).count, queued: Sidekiq::Queue.all.sum(&:size), read_only: Discourse.readonly_mode? }.to_json)'
exit
./launcher stop app
```

Expected: `{"disable_emails":"yes","push":false,"active_webhooks":0,"queued":0,"read_only":true}`. (Read-only came over with the snapshot, which is what we want until the switch.) If `rails r` says it cannot connect to Redis, the services have not started yet: see `13-production-rehearsal.md` step 4.

### 6. NEW: launcher and `app.yml`

```
git diff > /root/launcher-local-changes-<date>.patch
git checkout -- templates/web.ratelimited.template.yml
git fetch origin
git checkout 1deba5f
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

Expected: `placeholders left: 0`; postgres.18, `v2026.9.0`, `app.forwardtrust.org.uk`, both SSL templates, plugin `264cbd2`, Lexicon at the merge commit. No secret printed.

### 7. NEW: open the internet, two rebuilds (4 min + 6.5 min)

The rebuild needs to download code. Nothing can be sent: email, push and webhooks are off inside Discourse and the queues are empty.

```
iptables -D DOCKER-USER -i docker0 -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -D DOCKER-USER -i docker0 -j DROP
date -u; time ./launcher rebuild app 2>&1 | tee /root/rebuild1.log | tail -40; date -u
date -u; time ./launcher rebuild app 2>&1 | tee /root/rebuild2.log | tail -40; date -u
```

Rebuild 1 ends with `UPGRADE OF POSTGRES COMPLETE` (old data in `/shared/postgres_data_old`; the `role "postgres" already exists` lines are normal). At the start after rebuild 2 the certificate step runs: the domain still points at OLD, so a renewal attempt fails and start-up carries on with the certificate copied in the snapshot (the staging practice confirms this).

### 8. NEW: health, version, features, "after" numbers

```
sleep 30
docker exec app sh -c 'sv status /etc/service/*'
./launcher enter app
rails r 'puts({ version: Discourse::VERSION::STRING, git: Discourse.git_version[0, 8], migrations_pending: ActiveRecord::Base.connection_pool.migration_context.needs_migration?, disable_emails: SiteSetting.disable_emails, push: SiteSetting.lexicon_push_notifications_enabled, read_only: Discourse.readonly_mode? }.to_json)'
rails r 'off = %w[ai_embeddings_enabled discourse_ai_enabled cakeday_birthday_enabled cakeday_enabled enable_discourse_github_plugin policy_enabled solved_enabled discourse_templates_enabled topic_voting_enabled enable_discourse_workflows allow_user_locale]; off.each { |n| SiteSetting.public_send("#{n}=", false) if SiteSetting.respond_to?("#{n}=") }; puts off.map { |n| "#{n}=#{SiteSetting.public_send(n)}" }.join(", "); puts "plugins ON: #{Discourse.plugins.select(&:enabled?).map(&:name).sort.join(", ")}"'
rails r /shared/rehearsal/numbers.rb after
ruby /shared/rehearsal/compare.rb
exit
```

Expected:
- `2026.9.0`, `343b20f9`, no migrations pending, still silent and read-only.
- Plugins ON: automation, chat, checklist, discourse-data-explorer, discourse-details, discourse-forward-trust, discourse-lazy-videos, discourse-lexicon-plugin, discourse-local-dates, discourse-presence, discourse-reactions, docker_manager, footnote, poll, spoiler-alert. (`allow_user_locale` is on by default in 2026.9; switched off to keep things as today. If keeping 1 image per post for new members: also `SiteSetting.newuser_max_embedded_media = 1`.)
- The comparison as in the rehearsal: topics, posts, categories unchanged; nothing fewer except log tables. Anything else: stop here. Nothing has changed for members yet.

**Optional check before the switch:** the app on an emulator through a local Prose pointed at NEW (as in the rehearsal, `13-production-rehearsal.md` 11b).

### 9. THE SWITCH (seconds)

1. NEW firewall: open **HTTP and HTTPS to everyone** (as OLD has), keep SSH as on OLD.
2. Lightsail → Networking → Static IPs → `StaticIp-1` → **Detach** from `forwardtrust-prod-4gb` → **Attach** to `forwardtrust-prod-2026-9`.
3. OLD gets a new temporary IP. Stop its Discourse so it cannot send anything twice (use the new IP to SSH, or the Lightsail browser SSH): `cd /var/discourse && ./launcher stop app`.
4. NEW: switch everything back on, using the values written down in step 3:

```
./launcher enter app
rails r 'SiteSetting.disable_emails = "no"; SiteSetting.lexicon_push_notifications_enabled = true; WebHook.where(id: [<ids from step 3>]).update_all(active: true); Discourse.disable_readonly_mode(Discourse::USER_READONLY_MODE_KEY); puts({ disable_emails: SiteSetting.disable_emails, push: SiteSetting.lexicon_push_notifications_enabled, active_webhooks: WebHook.where(active: true).pluck(:id), read_only: Discourse.readonly_mode? }.to_json)'
exit
```

Posting works again. **Window ends** when the checks below pass.

### 10. NEW: checks on the live address (real phones, store app 1.0.48)

1. `curl -sI https://app.forwardtrust.org.uk/srv/status` → `200`; certificate valid: `echo | openssl s_client -connect app.forwardtrust.org.uk:443 -servername app.forwardtrust.org.uk 2>/dev/null | openssl x509 -noout -enddate`.
2. Log in; feed; a tagged post shows tags; filter by tag; a post with images.
3. Reply in the internal test category (`Yalla-Internal-Testing-2`).
4. Push: reply to your test post from the website with another account; the phone gets it.
5. Email: Admin → Emails → Send test email.
6. Open a member's profile in the app (it uses Prose's admin user lookup).
7. Logs for a few minutes: `docker exec app tail -f /var/www/discourse/log/production.log`, and Prose on Heroku.

Then tell members it is done.

## If something goes wrong

- **Before step 9:** nothing has changed for members. Delete NEW if needed, and on OLD: `rails r 'Discourse.disable_readonly_mode(Discourse::USER_READONLY_MODE_KEY)'`.
- **After step 9:** move `StaticIp-1` back to `forwardtrust-prod-4gb`, then on OLD `./launcher start app`, and switch read-only off there. Seconds plus about a minute for Discourse to start. Posts made on NEW after the switch are not on OLD, so decide quickly: QA right after the switch is part of the window.

## After the day

| When | What |
|---|---|
| Same day | Update the tracker and these docs with the real times. |
| 1 week of normal running | Delete OLD (`forwardtrust-prod-4gb`). On NEW: `rm -rf /var/discourse/shared/standalone/postgres_data_old`. |
| 2 weeks | Delete the pre-upgrade snapshot. |
| 1 month | Archive (do not delete) `yalla-coop/discourse`, the old fork. |
| Next store release | App fixes from #664 (link cards, checklists, SVG): build **118 or higher**. |
| Every 6 months | Upgrade again with the same safety net. |
