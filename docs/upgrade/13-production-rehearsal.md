# 13 - Production rehearsal on a clone

Started on 2026-10-22. A copy of production is upgraded exactly as production will be, to measure the time and prove nothing is lost. Production itself is not touched. This file records every command, in order, and is updated as the rehearsal goes on.

**Rules for this clone**

- Real people's data: we look at **numbers only** (counts, sizes, fingerprints). Nobody opens posts, messages or profiles, on the server or the website.
- Nothing may leave the clone: no email, no push, no webhooks.
- Only Mahmoud's IP can reach it. It is deleted, with its snapshot, at the end.

Each step is marked **clone only** or **production too**.

---

## 1. Make the clone (Lightsail console)

| Step | Done | Production too? |
|---|---|---|
| Snapshot of the production instance | yes | yes, as the way back on switch day |
| New instance from the snapshot, same region, **no static IP** | yes | no |
| Networking → IPv4 firewall: SSH (22) and HTTP (80) **restricted to `<our office IP>/32`**; Lightsail browser SSH kept (IPv4); HTTPS (443) rule deleted | yes | **no** (production stays public) |
| IPv6 firewall: all rules removed, so the clone is not reachable over IPv6 | yes | no |

What we learned: the instance **starts Discourse by itself when it boots**, with production's settings (email, push, webhooks on). That is why the next step comes first.

## 2. Stop Discourse straight away (clone only)

```
sudo -s
cd /var/discourse
ls containers
./launcher stop app
docker ps
```

Result:

- `containers/` holds `app.yml`, four backups from April 2024 (`app.yml.2024-04-29-104749.bak`, `…-30-040437.bak`, `…-30-041247.bak`, `…-30-043629.bak`) and `app.yml~`. The container is called `app`.
- `docker stop -t 600 app` finished and `docker ps` was empty.

## 3. Block Discourse from reaching the internet (clone only)

```
iptables -I DOCKER-USER -i docker0 -j DROP
iptables -I DOCKER-USER -i docker0 -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -L DOCKER-USER -n --line-numbers
```

- This stops any connection that the container **starts** going out (email, Expo push, webhooks), while replies to our own requests still work (rule 1).
- SSH to the server is not affected. Docker's own default rule (`RETURN`) is rule 3.
- These rules are lost when the server restarts. They are removed on purpose before the rebuilds, which need the internet, once email, push and webhooks are off inside Discourse.

## 4. Start Discourse with the internet blocked (clone only)

```
./launcher start app
docker exec app curl -s -m 8 -o /dev/null https://exp.host && echo "WARNING: internet open" || echo "internet blocked (good)"
```

Result: `internet blocked (good)`.

### Problem: Discourse did not start

`rails r …` inside the container failed with `Error connecting to Redis on localhost:6379 (Errno::ECONNREFUSED)`.

```
sv status redis postgres unicorn sidekiq
```

All said `runsv not running`: no service had started. The container logs showed why:

```
docker logs --tail 30 app
docker exec app ps -eo pid,etime,cmd | grep -v "\[" | head -20
```

- At boot, `/etc/runit/1.d/letsencrypt` renews the certificate for **`app.forwardtrust.org.uk`** with `acme.sh --issue --force`, and retries every 10 seconds when it cannot reach Let's Encrypt.
- The boot steps run with `run-parts --exit-on-error /etc/runit/1.d`, so Postgres, Redis and Discourse only start after that step ends. Killing it would count as an error and stop the boot, so we did not kill it.

### Fix: skip the certificate step on the clone

Nothing had started yet (no database, no jobs), so a quick stop was safe:

```
docker stop -t 5 app
printf '#!/bin/bash\n# clone: skip certificate renewal (no internet, domain is production)\nexit 0\n' > /tmp/letsencrypt-skip
chmod +x /tmp/letsencrypt-skip
docker cp /tmp/letsencrypt-skip app:/etc/runit/1.d/letsencrypt
./launcher start app
sleep 40
docker exec app sv status redis postgres unicorn
```

Result: `run:` for redis, postgres and unicorn (Sidekiq runs inside unicorn in this version). The change lives only in this container and the rebuild replaces it.

**For production:** do not do this. On production the renewal has internet and the right DNS. It does tell us that **every production restart waits for the certificate renewal**, so Let's Encrypt being slow makes the switch slower.

## 5. Switch off email, push and webhooks inside Discourse (clone only)

Inside the container (`./launcher enter app`):

```
rails r 'require "sidekiq/api"; SiteSetting.disable_emails = "yes"; SiteSetting.lexicon_push_notifications_enabled = false if SiteSetting.respond_to?(:lexicon_push_notifications_enabled); WebHook.update_all(active: false); Sidekiq::Queue.all.each(&:clear); Sidekiq::ScheduledSet.new.clear; Sidekiq::RetrySet.new.clear; puts({ disable_emails: SiteSetting.disable_emails, push: (SiteSetting.lexicon_push_notifications_enabled rescue "n/a"), active_webhooks: WebHook.where(active: true).count, queued: Sidekiq::Queue.all.sum(&:size) }.to_json)'
```

Expected: `"disable_emails":"yes"`, `"push":false`, `"active_webhooks":0`, `"queued":0`.

Result: `{"disable_emails":"yes","push":false,"active_webhooks":0,"queued":0}`. (The first try failed with `Couldn't connect to Redis` because the services had not started yet; see step 4.)

Note for the comparison: these two settings (`disable_emails`, `lexicon_push_notifications_enabled`) are changed by us before the "before" numbers, so they do not show up as upgrade changes.

## 6. "Before" numbers (production too, on switch day)

`/shared/rehearsal/numbers.rb` writes `/shared/rehearsal/before.txt` with, for every table, its row count; the number and total size of upload files; every changed site setting as **name + salted fingerprint** (never the value, some are secrets); and the plugin list. It prints a short summary.

```
mkdir -p /shared/rehearsal          # then paste numbers.rb into /shared/rehearsal/numbers.rb
chown -R discourse /shared/rehearsal # rails runs as the discourse user; without this: Permission denied
rails r /shared/rehearsal/numbers.rb before
```

Result:

| | Before |
|---|---|
| Discourse | `3.4.0.beta4-dev`, commit `eeb36c20` (the fork) |
| Tables | 292 |
| Users / topics / posts | 798 / 2,664 / 3,348 |
| Uploads (rows) / upload files | 1,708 / 6,969 files, 1,908 MB |
| Groups / categories | 59 / 84 |
| Site settings set / plugins | 138 / 16 |
| Database | 513 MB |
| Disk `/shared` | 78 GB, 24 GB free (the PostgreSQL upgrade needs about 1 GB: twice the database) |

Open check: the clone ran with production settings for a few minutes after it booted (before step 2). We will count, by number only, any email log rows created after the boot time, to confirm nothing was sent in that window.

## 7. Check that nothing was sent before step 2 (clone only)

The clone ran with production settings between booting and step 2. Numbers only:

```
uptime -s                      # on the server: when the clone booted (UTC)
rails r 'since = Time.parse("<uptime -s result> UTC"); puts({ emails_logged: EmailLog.where("created_at > ?", since).count, emails_skipped: SkippedEmailLog.where("created_at > ?", since).count })'
```

Expected: both `0`.

Result: the server booted at `2026-10-22 13:11:22` UTC; checked from 13:00 UTC: `emails_logged 0, emails_skipped 0`. Nothing was sent.

## 8. PR check on today's Discourse (clone only)

Goal: prove that merging Prose #659, #661 and #664 does not change what **today's** production app (build 115) receives from **today's** Discourse, apart from the image fixes.

1. **A temporary member and an admin key** on the clone (inside the container). The script `/shared/rehearsal/member.rb` creates `rehearsal_check` (email `rehearsal-check@example.com`, random password), adds it to every non-automatic group, creates an API key, and prints them as JSON. Both disappear with the clone.
   ```
   rails r /shared/rehearsal/member.rb
   ```
   Mahmoud copies the printed line into `contract/.local/clone-keys.json` on the Mac (`pbpaste > …`, git-ignored). It is not pasted in chat.
2. **Reaching the old Discourse from the Mac.** The old setup only answers on HTTPS as `app.forwardtrust.org.uk` (port 80 redirects to it). So:
   - Lightsail firewall: add HTTPS (443) **restricted to `<our office IP>/32`**.
   - Prose on the Mac is started with a small preload that sends `app.forwardtrust.org.uk` to the clone's IP **for Prose only**. The Mac's browser and real apps still go to the real production.
3. **Two Prose versions side by side**, both pointed at the clone: `main` (as production today) on port 8931, and `main` + #659 + #661 + #664 on port 8932.
4. **The comparison** (`compare-prose.mjs pair`): logs in as the temporary member and runs the production app's own read queries (from `frontend/src/graphql/server` on `main`) through both: About, Site, groups, channels and chats, feed pages (latest, top, by category), 15 topic pages, search, tags, notifications, profile, activity, messages and the admin user lookup. Each answer is reduced to field paths and short hashes; **no content is printed or saved**.
   - Expected: identical, except `markdownContent` on posts with SVG/WebP images or images Prose could not match before.
   - The answers of the PR version are saved as fingerprints for step 11.

Result (10:50 -03): **32 of 35 requests identical; the other 3 are explained by our own reading, not by the PRs.**

- Run as `rehearsal_check` (user id 1151) against the clone at `13.40.42.171`, reached as `https://app.forwardtrust.org.uk` through the Prose-only DNS preload. Both Prose versions reported `isDiscourseReachable: true`.
- `GetDirectMessages`: a chat message time differs. Production's Prose compared with itself shows the same difference, so it is noise.
- `Topics` (latest, top): `liked` changed from `null` to `false` on topics. That is because the first Prose read the feed before the comparison opened 15 topics, and the second read it after: opening a topic creates the member's read record. Read again side by side, both versions give exactly the same pattern (15 `false`, 15 `null`).
- Errors in **both** versions, not caused by the PRs: `GetChatEmojis` (not found on this Discourse) and `Search` (`Cannot read properties of undefined (reading '0')`, an existing Prose bug, noted separately).
- No `markdownContent` differences in the 15 topics read: none of them had an SVG/WebP image or an image the old matching got wrong.

Conclusion: deploying Prose #659, #661 and #664 to production does not change what today's app receives from today's production Discourse.

## 9. Upgrade (production too, timed)

1. **Turn the internet back on for the rebuilds** (the build downloads code). Email, push and webhooks are already off inside Discourse (step 5), and the clone's new `app.yml` points email at a server that does not exist.
   ```
   iptables -D DOCKER-USER -i docker0 -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
   iptables -D DOCKER-USER -i docker0 -j DROP
   ```
2. **Launcher**: check its state, then move it to the commit staging used.
   ```
   git -C /var/discourse status --short | head
   git -C /var/discourse log -1 --oneline
   git -C /var/discourse fetch origin main
   git -C /var/discourse checkout 1deba5f
   ```
   (On staging the launcher was a detached May 2025 commit with `image/` and `shared/.gitkeep` deleted locally; those were restored with `git checkout -- image shared/.gitkeep` first.)

   **Production's launcher** (seen on the clone): `aa547bc` on `main`, with one local change, `templates/web.ratelimited.template.yml` raised from 12/12/200/100 to **60/60/600/600** (`reqs_per_second`, `burst_per_second`, `reqs_per_minute`, `burst_per_minute`; `conn_per_ip` 20 unchanged), plus a stray `DEADJOE` editor file. The change is saved as a patch, the template restored, and the numbers moved into `app.yml` `params`, so they survive launcher updates:
   ```
   git diff > /root/launcher-local-changes-2026-10-22.patch
   git checkout -- templates/web.ratelimited.template.yml
   ```
3. **Keep the old settings file**: `cp containers/app.yml containers/app.yml.old-fork`.
4. **New `app.yml`** (production's old one, seen with secrets masked: postgres.13, redis, web, **web.ratelimited**, web.ssl, web.letsencrypt.ssl; `db_shared_buffers 256MB`, `upload_size 100m`, `UNICORN_WORKERS 4`; a second volume for `/var/log`; SendGrid SMTP; the fork reset block; Lexicon from `master` **unpinned**, Reactions and Data Explorer clones): the same as staging's (`templates/postgres.18.template.yml`, redis, web; `version: v2026.9.0`; plugin `discourse-forward-trust` at `264cbd2`; Lexicon `upgrade-2026` at `83a747c`; `docker_manager`; the 8 rate-limit settings; no `SKIP_POST_DEPLOYMENT_MIGRATIONS`), with production's own `params` and `env` copied from the old file. **Clone only**: host `<ip>.nip.io`, no SSL templates, SMTP server `invalid.invalid`. **Production**: its real host, SSL and SMTP.
5. **Rebuild 1, timed** (PostgreSQL 13 → 18): `time ./launcher rebuild app`. It checks free disk, dumps 13, restores into 18, keeps the old data in `/shared/postgres_data_old`, then asks for a second rebuild.
6. **Rebuild 2, timed** (Discourse 2026.9 and the plugins, all migrations): `time ./launcher rebuild app`.
7. **Clone only**: block the internet again (step 3) and make sure `force_https` is off so the clone answers on plain HTTP.

Result: **rebuild 1 (PostgreSQL 13 → 18) 13:57:04 → 14:01:10 UTC, 4 min 6 s; rebuild 2 (Discourse 2026.9) 14:01:41 → 14:08:10 UTC, 6 min 29 s. About 11 minutes in total.**

- Rebuild 1 ended with `UPGRADE OF POSTGRES COMPLETE`, old data in `/shared/postgres_data_old`. The `role "postgres" already exists` / `current user cannot be dropped` lines are the usual harmless ones.
- Rebuild 2 started the new container with the clone's settings.
- After it: internet blocked again; all services `run:`; the site answered `200`; `{"version":"2026.9.0","git":"343b20f9","migrations_pending":false,"disable_emails":"yes","push":false,"active_webhooks":0,"force_https":true}`.
- Production: use separate logs (`rebuild1.log`, `rebuild2.log`); the second `tee` here overwrote the first. Plan **30 to 45 minutes** read-only: 11 minutes of rebuilds, the certificate step at start, and the checks.

## 10. "After" numbers and comparison (production too)

```
rails r /shared/rehearsal/numbers.rb after
ruby /shared/rehearsal/compare.rb
```

`compare.rb` prints, by name and number only:
- the version before and after,
- any table with **fewer** rows after (expected: none, apart from tables Discourse empties on purpose, each one checked),
- tables gone, and the totals for users, topics, posts, uploads, groups, categories, emails and upload links,
- upload files and bytes before and after (expected: equal),
- settings whose value changed, settings gone (renamed by Discourse, or back to default) and new settings, by name only, each one checked,
- plugins gone or new.

Result:

| | Before | After | Why |
|---|---|---|---|
| Version | 3.4.0.beta4-dev `eeb36c20` | 2026.9.0 `343b20f9` | |
| Topics / posts / categories | 2,664 / 3,348 / 84 | **same** | |
| Users / user emails | 798 / 799 | 799 / 800 | +1 the temporary member |
| Uploads / files / bytes / upload links | 1,708 / 6,969 / 2,000,957,872 / 2,260 | 1,712 / 6,973 / 2,001,952,398 / 2,264 | +4 added by the upgrade; nothing missing |
| Groups | 59 | 61 | +2 added by the new version |
| Tables / settings stored / plugins | 292 / 138 / 16 | 388 / 144 / 49 | new version; 33 plugins now come with Discourse |
| Database | 513 MB | 428 MB | dump and restore packs the data |

Fewer rows after (all logs or clone-only): `email_logs` 120→117, `search_logs` 636→633, `web_hook_events` 21,742→21,644, `scheduler_stats` 366,154→314,185, `topic_hot_scores` 1,124→1,121 (Discourse's clean-up jobs); `push_subscriptions` 1→0 (**clone only**: Discourse regenerates the browser-push keys, `vapid_*`, when the site address changes, and drops old browser subscriptions; production keeps its address. App push goes through Lexicon and is not affected).

Tables gone: `discourse_voting_*` (0 rows, now `topic_voting_*`), `imap_sync_logs` (0), `theme_color_schemes` (0), `ai_document_fragment_embeddings_*` (0), `ai_personas` (9, now `ai_agents`, 44 with Discourse's defaults), `ai_post_embeddings_4_1` (36) and `ai_topic_embeddings_4_1` (99): AI embeddings, numbers computed from posts, not member content; left over from an earlier time when the AI plugin was installed. Colour palettes kept (7 → 19 with the new built-in ones).

Settings: `vapid_*` (clone only, above); `allowed_iframes` (list of embeddable addresses, harmless); removed by Discourse: `admin_sidebar_enabled_groups`, `bootstrap_mode_enabled`, `bootstrap_mode_min_users`, `default_dark_mode_color_scheme_id` (moved to the theme: the default theme keeps light palette 7 and dark palette 1). Welcome banner off on the default theme. `default_other_enable_markdown_monospace_font` kept as before.

### Features that would switch on by themselves

Plugins that **were not installed** in the old fork but come with Discourse 2026.9 become active when their setting is on, either their default or a value left in the database from an earlier installation:

| Plugin | Setting | Stored | Default |
|---|---|---|---|
| Discourse AI | `discourse_ai_enabled` (and `ai_embeddings_enabled` true) | true | false |
| Cakeday | `cakeday_enabled`, `cakeday_birthday_enabled` | true | false |
| GitHub | `enable_discourse_github_plugin` | true | false |
| Policy | `policy_enabled` | true | false |
| Solved | `solved_enabled` | not set | true |
| Templates | `discourse_templates_enabled` | not set | true |
| Topic voting | `topic_voting_enabled` | not set | true |
| Workflows | `enable_discourse_workflows` | not set | false |

AI was **not** running in production (the plugin was not loaded) and on 2026.9 no AI service is set up (`ai_embeddings_selected_model` empty, 0 embeddings), so no post was or could be sent anywhere.

**Decision (Mahmoud, 22 Oct): no new features.** Anything that was not running before is switched off right after the upgrade, on production too:

```
rails r 'off = %w[ai_embeddings_enabled discourse_ai_enabled cakeday_birthday_enabled cakeday_enabled enable_discourse_github_plugin policy_enabled solved_enabled discourse_templates_enabled topic_voting_enabled enable_discourse_workflows]; off.each { |n| SiteSetting.public_send("#{n}=", false) if SiteSetting.respond_to?("#{n}=") }; puts off.map { |n| "#{n}=#{SiteSetting.public_send(n)}" }.join(", ")'
```

Stay on (running before): chat, poll, reactions, data explorer, automation, checklist, details, lazy videos, local dates, presence, footnotes, spoilers, Lexicon, and `discourse-forward-trust` (replaces the fork's changes).

## 11. The app's view after the upgrade (clone only)

`compare-prose.mjs after`: the same queries through Prose with the PRs, now against the upgraded clone, compared with the fingerprints saved in step 8. Host names are made equal first (`app.forwardtrust.org.uk` vs the clone's `nip.io` address). Lists are compared as sets, so a list that only changed order or gained an item shows just the real additions and removals.

Before it (clone only): the switch-off command from step 10 was run, and `force_https` set to false so the clone answers on plain HTTP. Prose with the PRs ran against `http://rehearsal.13.40.42.171.nip.io`.

Result (11:23 -03): 8 of 35 requests identical; every difference checked and explained:

- **Avatars and topic images**: new link formats (`letter_avatar_proxy/v4`, `user_avatar/<host>`, protocol-relative upload links). Loaded from the clone: **16 / 16 avatars and 36 / 36 topic images return 200** (31 resized, 5 originals).
- **Latest feed**: the same 30 topics on both pages; one name in one topic's posters row (2026.9 picks those faces slightly differently).
- **Top feed**: one topic swapped at the edge of the top 50 (Discourse recalculates top scores).
- **Excerpts**: the preview text is formatted slightly differently by the new version.
- **Groups**: two new built-in groups, `anonymous_users` and `logged_in_users` (automatic, no members, no category access), so page 1 of the group list shifts.
- **Categories**: one extra permission row in the app's category list, but **no category permission changed** (`CategoryGroup` rows updated today: none). Who can see what is unchanged.
- **Notifications**: the temporary member received one badge notification from the new version.
- **Chat channel list**: new fields from the new version (style, icon, pins).
- Same two Prose errors as before the upgrade (`GetChatEmojis`, `Search`).

Conclusion: the app sees the same topics, posts, categories and permissions after the upgrade; images and avatars load.

### 11b. The real app on the upgraded clone (clone only)

- Branch [`test/production-candidate`](https://github.com/yalla-coop/forward-trust-community-mobile-app/tree/test/production-candidate) = `main` + #659 + #661 + #664 (nothing merged into `main`). Android release build from it (2 min, GraphQL types regenerated), Prose from it on the Mac pointed at `http://rehearsal.13.40.42.171.nip.io`.
- Login limit raised on the clone only (`max_logins_per_ip_per_hour 500`, `per_minute 60`).
- Maestro, all flows in `flows/` except TC042 (publishes into the staging-only "Cat 1"), as `rehearsal_check`. 12:40 to 13:10 (-03).

Result: **27 of 29 passed.** Both failures are expected on this copy:
- **TC100** stops on purpose: its script refuses to run unless the forum's address contains `staging`.
- **TC083** needs at least one notification the app shows. The temporary member's only notification is a badge (type 12), which the app does not show (`SupportedNotificationTypes` in `Notifications.tsx` leaves it out), so the list is empty.

Afterwards all Maestro output (`~/.maestro/tests/2026-10-22_*`, screenshots and screen text with real content) and the run log were deleted, and the app's data on the emulator cleared. Only the pass/fail list was kept.

Mahmoud also looked at the forum website on the clone with his own Yalla account (one-time login link, no password over HTTP), seeing only what that account sees on production today.

### 11c. Manual check on the emulator (clone only)

- Emulator restarted with a window; the `test/production-candidate` app built and installed (release, Prose URL `http://localhost:8929`). The scratch build's network rule also allows plain HTTP to `rehearsal.13.40.42.171.nip.io` (test only, not committed).
- Test images (generated, no real content) added to the emulator's gallery: landscape, portrait, square JPGs, a PNG with transparency, a 4000×3000 3.8 MB JPG; an SVG and a WebP for uploads from the website.
- Test topic "Upgrade test: formatting" with a reply, covering headings, bold/italic/strikethrough, labelled and bare links, quotes, nested and numbered lists, a checklist, a table, code, emoji, a mention, YouTube, details, spoiler, a local date, a footnote, a poll and uploaded images.
- **Clone-only problem found:** uploaded images did not show in the app. The image was stored correctly and loads over HTTP, but Prose turns Discourse's protocol-relative image links (`//host/...`) into `https://host/...`, and the clone has no HTTPS. Production has HTTPS, so this does not affect it. For the test, a relay on the Mac (`https-to-http-relay.mjs`, app → :8929 → Prose :8933) rewrote `https://rehearsal…` to `http://`; images then showed.
- **Result: Mahmoud checked the app on the emulator, "it looks good from our side".**

## 12. Delete everything (clone only)

1. Lightsail: delete the clone instance.
2. Lightsail: delete the snapshot made for the rehearsal (keep production's normal backups).
3. On the Mac: delete `contract/.local/clone-keys.json` and the saved fingerprints.
4. Remove the HTTPS rule for our IP if the instance is kept for any reason.

Result (22 Oct): clone instance deleted by Mahmoud. On the Mac: the clone keys file, the saved fingerprints, the Prose and relay logs and the test settings file deleted; all Maestro output from the clone runs deleted earlier. Kept: the scripts and the pass/fail summary (no member data). Rehearsal snapshot: _to confirm deleted_.

## What the rehearsal gives production

- The time for rebuild 1 and rebuild 2: the read-only window on switch day.
- Proof that no rows, files or settings are lost, and the list of settings Discourse itself changes.
- Proof that the Prose PRs are safe to deploy before the switch.

## Facts found so far

- Production host name: `app.forwardtrust.org.uk`.
- The old Discourse runs Ruby 3.3, Rails 7.2.2.1.
- Container name `app`, data in `/var/discourse/shared/standalone` (`/shared` inside the container).

## Decision: how production is switched (22 Oct)

Two ways were weighed:

- **A. In place** (what this rehearsal did): two rebuilds on production itself. The app is down for about 15 minutes (11 minutes of rebuilds plus start-up and the certificate step), at a quiet hour with a notice beforehand. Way back: the old PostgreSQL 13 data in `/shared/postgres_data_old` with `app.yml.old-fork`, or the snapshot.
- **B. Blue/green**: upgrade a copy on a new server while production is read-only (30 to 45 minutes, app stays up), then move the static IP. Instant way back, but more steps and one more rehearsal (the certificate step at start-up while the IP still points at the old server).

**Mahmoud chose A**: simpler and fully rehearsed.
