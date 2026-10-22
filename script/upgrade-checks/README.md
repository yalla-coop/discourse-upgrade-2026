# Upgrade checks

Used in the production rehearsal (`docs/upgrade/13-production-rehearsal.md`) and on switch day (`docs/upgrade/14-production-switch.md`). They print **numbers, names and fingerprints only**, never member content.

| File | Runs | What it does |
|---|---|---|
| `numbers.rb` | inside the Discourse container: `rails r /shared/rehearsal/numbers.rb before` (or `after`) | Writes `/shared/rehearsal/<label>.txt`: row count of every table, upload files and bytes, every stored site setting as name + salted fingerprint (never the value), the plugin list. Prints a short summary with database size and free disk. |
| `compare.rb` | inside the container: `ruby /shared/rehearsal/compare.rb` | Compares `before.txt` and `after.txt`: version, tables with fewer rows, tables gone, key totals, upload files and bytes, setting names changed / gone / new, plugins gone / new. |
| `compare-prose.mjs` | on a Mac with Prose running | Runs the app's own read queries (from `frontend/src/graphql/server` on the app's `main`) through Prose and compares the answers by fingerprint. `pair` compares two Prose versions; `after` compares with fingerprints saved earlier. Lists are compared as sets. `HOST_ALIASES` makes host names equal. |
| `dns-override.cjs` | preload for Prose (`NODE_OPTIONS=--require …`) | Sends one host name to another IP for Prose only (used to reach a clone as the production host). |

`rails` runs as the `discourse` user: after creating `/shared/rehearsal` as root, run `chown -R discourse /shared/rehearsal`.
