# Contract checks (Layer B)

These checks answer one question for every upgrade hop: **does Discourse still return every field Prose reads, with the same type?**

Each check copies one real call Prose makes (inventory: `docs/upgrade/03-prose-api-inventory.md`). It sends the request the way Prose does, and compares field names and types. It never compares values, so reports contain no one's data.

## Safety

- **Production is refused.** The runner stops if the host is `*.forwardtrust.org.uk`.
- **Checks that create or change data are off by default.** Turn them on with `--writes`. They use obvious test content (`[contract check] ...`) and clean up after themselves where they can.
- **The seed script** (`seed/docker_seed.rb`) refuses to run outside the local Docker dev database.
- **Credentials** live in `contract/.local/NAME.json`, which is git-ignored.

## Run on a hop container (Docker on the Mac)

```bash
# once per container: seed data, then start the server
docker exec -u discourse:discourse -w /src -e LOAD_PLUGINS=1 ft-baseline \
  bin/rails runner contract/seed/docker_seed.rb
docker exec -d -u discourse:discourse -w /src -e LOAD_PLUGINS=1 -e UNICORN_PORT=3000 ft-baseline \
  bash -lc 'bin/unicorn > log/contract-server.log 2>&1'

# every run
docker exec -u discourse:discourse -w /src ft-baseline \
  node contract/run.mjs --env docker --writes --label baseline
```

On the next hop's container, compare with the baseline:

```bash
node contract/run.mjs --env docker --writes --label hop-3.4.7 --compare baseline
```

## Run on the AWS practice copy

Create `contract/.local/practice.json` with the practice copy's URL, two member test accounts and an admin API key. Then run from the Mac (Node 20+):

```bash
node contract/run.mjs --env practice --writes --label practice-hop-3.4.7 --compare practice-baseline
```

## Results

| Mark | Meaning |
|---|---|
| ✓ PASS | Status and all expected fields match |
| ✗ FAIL | A field is missing, has a different type, or the HTTP status changed |
| ? NOT VERIFIED | Could not check: an array was empty, an id was not found, or Discourse rate-limited the call |
| SKIPPED | A write check, run without `--writes` |

Always run with `--writes` on Docker, so results compare like with like: some lists (reactions, for example) only have data after the write checks run. `contract/docker-run.sh` also clears Discourse's rate limits first, because on the local copy they only reflect our own repeated runs.

A hop is stable only when there are **no FAIL results**, and any "not verified" result has a known reason.

## Writing checks

One file per area in `checks/`, run in file-name order. See `checks/10-auth.mjs` for the format and `lib/shape.mjs` for the field path syntax (`topic_list.topics[].flagged_by_user`).

**Rule:** a check records how production behaves today. If a baseline run fails, fix the check to match reality and write down why in a comment. Never change it to make a later hop pass.
