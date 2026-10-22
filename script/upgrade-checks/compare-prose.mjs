// Runs the production app's read queries (frontend/src/graphql/server on main)
// through Prose and compares answers by fingerprint only. No content is printed
// or saved: only query names, field paths and short hashes.
//
//   node compare-prose.mjs pair  <keys.json> <proseA> <proseB> <out.json>
//       A = Prose as on production today, B = with the PRs. Saves B's fingerprints.
//   node compare-prose.mjs after <keys.json> <prose> <saved.json>
//       Compares the upgraded clone with the fingerprints saved before.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [mode, keysFile, ...rest] = process.argv.slice(2);
const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
const SRC = process.env.APP_QUERIES ||
  '../forward-trust-community-mobile-app/frontend/src/graphql/server';

// --- the app's queries, with ${FRAGMENT} interpolations resolved -------------
// Keyed by file and name: two files can export the same name (ABOUT).
const entries = [];
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
  const text = fs.readFileSync(path.join(SRC, file), 'utf8');
  for (const m of text.matchAll(/export const (\w+) = gql`([\s\S]*?)`;/g)) entries.push({ file, name: m[1], text: m[2] });
}
// Like Apollo's gql: an interpolated document is not pasted in place; its
// definitions are added once at the end. A fragment comes from the same file
// when defined there, else from the file it is imported from.
function collect(entry, out = new Map()) {
  const id = entry.file + ':' + entry.name;
  if (out.has(id)) return out;
  out.set(id, entry.text.replace(/\$\{\w+\}/g, ''));
  for (const [, ref] of entry.text.matchAll(/\$\{(\w+)\}/g)) {
    const target = entries.find((e) => e.name === ref && e.file === entry.file) || entries.find((e) => e.name === ref);
    if (target) collect(target, out);
  }
  return out;
}
const doc = (opName) => {
  const entry = entries.find((e) => new RegExp(`query ${opName}\\b`).test(e.text));
  if (!entry) throw new Error('query not found in app: ' + opName);
  const found = collect(entry);
  // Fragments used with ...Name but not interpolated: add their definitions,
  // as the generated documents do.
  for (let added = true; added; ) {
    added = false;
    const text = [...found.values()].join('\n');
    const defined = new Set([...text.matchAll(/fragment (\w+) on/g)].map((m) => m[1]));
    for (const [, used] of text.matchAll(/\.\.\.(\w+)/g)) {
      if (defined.has(used)) continue;
      const def = entries.find((e) => new RegExp(`fragment ${used} on`).test(e.text));
      if (def && !found.has(def.file + ':' + def.name)) { collect(def, found); added = true; }
    }
  }
  // Drop fragment definitions nothing spreads (the server rejects them).
  const all = [...found.values()];
  const parts = all.filter((t) => {
    const n = (t.match(/^\s*fragment (\w+) on/) || [])[1];
    return !n || all.some((u) => u !== t && new RegExp(`\\.\\.\\.${n}\\b`).test(u));
  });
  // Keep one definition per fragment name.
  const seen = new Set();
  return parts.filter((t) => {
    const n = (t.match(/fragment (\w+)/) || [])[1];
    if (!n || t.trim().startsWith('query')) return true;
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  }).join('\n');
};

// --- talking to one Prose ------------------------------------------------------
function client(url) {
  let token = null;
  return async (query, variables = {}) => {
    const res = await fetch(url + '/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    const latest = res.headers.get('x-prose-latest-token');
    if (latest) token = latest;
    const body = await res.json();
    if (body.data?.login?.token) token = body.data.login.token;
    return body;
  };
}
async function loginAs(gql) {
  const r = await gql(`mutation($e:String!,$p:String!){login(email:$e,password:$p){... on LoginOutput{token}}}`,
    { e: keys.member.email, p: keys.member.password });
  if (!r.data?.login?.token) throw new Error('member login failed: ' + JSON.stringify(r.errors?.[0]?.message));
}

// --- the requests the app makes ------------------------------------------------
async function plan(gql) {
  const steps = [
    ['About', {}], ['Site', {}], ['Health', {}], ['GetChannels', {}], ['GetChatEmojis', {}],
    ['GetUnreadMessagesCount', {}], ['GetDirectMessages', {}],
    ['GetGroups', { page: 0 }],
    ['Topics', { sort: 'LATEST', page: 0 }], ['Topics', { sort: 'LATEST', page: 1 }],
    ['Topics', { sort: 'TOP', topPeriod: 'ALL', page: 0 }],
    ['Search', { search: 'the', page: 1 }], ['SearchTags', { q: '' }],
    ['Notification', { page: 0 }], ['UnreadNotification', { page: 0 }],
    ['Profile', { username: keys.member.username }],
    ['UserActivity', { username: keys.member.username, offset: 0 }],
    ['Message', { username: keys.member.username, page: 0 }],
    ['SilenceInfo', { id: keys.member.id }],
  ];
  const latest = await gql(doc('Topics'), { sort: 'LATEST', page: 0 });
  const ids = (latest.data?.topics?.topicList?.topics || []).map((t) => t.id).slice(0, 15);
  for (const topicId of ids) steps.push(['GetTopicDetail', { topicId }]);
  const firstTopic = latest.data?.topics?.topicList?.topics?.[0];
  if (firstTopic?.categoryId) steps.push(['Topics', { sort: 'LATEST', page: 0, categoryId: firstTopic.categoryId }]);
  return steps;
}

// Fields that change just because we read (views, read state) or with time.
const NOISE = /(^|\.)(_id|liked|created_at|views|unseen|lastReadPostNumber|readCount|reads|lastViewed|unreadNotification|totalUnread|messageBusLastId|draftSequence|timelineLookup|token)$/;

// Host names that mean the same site (production's name vs the clone's
// nip.io address), made equal before hashing: HOST_ALIASES="a.org,b.nip.io".
const HOSTS = (process.env.HOST_ALIASES || '').split(',').filter(Boolean);
const sameHost = (v) =>
  typeof v === 'string' ? HOSTS.reduce((s, h) => s.split(h).join('HOST'), v.replace(/https?:\/\/HOST/g, 'HOST')) : v;

function fingerprint(value, prefix = '', out = {}) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) fingerprint(v, prefix ? `${prefix}.${k}` : k, out);
    if (!Object.keys(value).length) out[prefix] = Array.isArray(value) ? '[]' : '{}';
  } else {
    const v = typeof value === 'string' ? sameHost(value).replace(/https?:\/\/HOST/g, 'HOST') : value;
    out[prefix] = crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
  }
  return out;
}
const collapse = (p) => p.replace(/\.\d+(?=\.|$)/g, '[]');

// One login per Prose: the clone keeps production's login limits.
async function loggedIn(url) {
  const gql = client(url);
  await loginAs(gql);
  return gql;
}

async function runAll(gql, steps) {
  const out = {};
  for (const [op, vars] of steps) {
    const r = await gql(doc(op), vars);
    out[`${op} ${JSON.stringify(vars)}`] = {
      errors: (r.errors || []).map((e) => (e.message || '').slice(0, 120)),
      fp: fingerprint(r.data ?? null),
    };
  }
  return out;
}

function compare(a, b) {
  let same = 0;
  const report = [];
  for (const key of Object.keys(b)) {
    const x = a[key], y = b[key];
    if (!x) { report.push(`  ${key}: only in the second run`); continue; }
    // Order-insensitive: for each field path (list positions removed), compare
    // the set of value fingerprints, so a reordered or longer list only shows
    // the values that really appeared or disappeared.
    const bag = (fp) => {
      const m = new Map();
      for (const [p, h] of Object.entries(fp)) {
        if (NOISE.test(p)) continue;
        const k = collapse(p);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(h);
      }
      return m;
    };
    const bx = bag(x.fp), by = bag(y.fp);
    const diff = new Map();
    for (const k of new Set([...bx.keys(), ...by.keys()])) {
      const left = [...(bx.get(k) || [])], right = [...(by.get(k) || [])];
      const count = (arr) => arr.reduce((m, h) => m.set(h, (m.get(h) || 0) + 1), new Map());
      const cl = count(left), cr = count(right);
      let gone = 0, added = 0;
      for (const [h, n] of cl) gone += Math.max(0, n - (cr.get(h) || 0));
      for (const [h, n] of cr) added += Math.max(0, n - (cl.get(h) || 0));
      if (gone || added) diff.set(k, `${gone} gone, ${added} new (of ${left.length} -> ${right.length})`);
    }
    const errs = JSON.stringify(x.errors) === JSON.stringify(y.errors) ? '' : ` errors: ${JSON.stringify(x.errors)} -> ${JSON.stringify(y.errors)}`;
    if (!diff.size && !errs) { same += 1; continue; }
    report.push(`  ${key}${errs}`);
    for (const [k, n] of diff) report.push(`      ${k}: ${n}`);
  }
  console.log(`same: ${same} of ${Object.keys(b).length} requests`);
  if (report.length) console.log('different:\n' + report.join('\n'));
  const errored = Object.entries(b).filter(([, v]) => v.errors.length).map(([k, v]) => `  ${k}: ${v.errors[0]}`);
  console.log(`requests with errors in the second run: ${errored.length}`);
  if (errored.length) console.log(errored.join('\n'));
}

if (mode === 'pair') {
  const [urlA, urlB, outFile] = rest;
  const gqlA = await loggedIn(urlA);
  const steps = await plan(gqlA);
  const a = await runAll(gqlA, steps);
  const b = await runAll(await loggedIn(urlB), steps);
  fs.writeFileSync(outFile, JSON.stringify({ steps, results: b }, null, 1));
  console.log(`A = ${urlA}  B = ${urlB}`);
  compare(a, b);
} else if (mode === 'after') {
  const [url, savedFile] = rest;
  const saved = JSON.parse(fs.readFileSync(savedFile, 'utf8'));
  const now = await runAll(await loggedIn(url), saved.steps);
  console.log(`before (saved) vs now: ${url}`);
  compare(saved.results, now);
} else {
  console.log('usage: pair <keys.json> <proseA> <proseB> <out.json> | after <keys.json> <prose> <saved.json>');
}
