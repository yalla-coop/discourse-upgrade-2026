// Checks that a JSON body has the fields Prose reads, with the right types.
// Only names and types are compared, never values, so reports never contain
// anyone's data.
//
// Paths use dots for objects and [] for "every item of this array":
//   "topic_list.topics[].flagged_by_user": "boolean"
// Types: string, number, boolean, object, array, null, any. Combine with |.
// A path that starts with "?" is optional: it is only checked when present.

export function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function resolve(value, segments, trail, results) {
  if (segments.length === 0) {
    results.push({ trail, value, present: true });
    return;
  }
  const [segment, ...rest] = segments;
  const isArray = segment.endsWith("[]");
  const key = isArray ? segment.slice(0, -2) : segment;
  const here = key === "" ? trail : trail ? `${trail}.${key}` : key;

  if (key !== "" && (value === null || typeof value !== "object" || !(key in value))) {
    results.push({ trail: here, present: false });
    return;
  }
  const next = key === "" ? value : value[key];
  if (!isArray) {
    resolve(next, rest, here, results);
    return;
  }
  if (!Array.isArray(next)) {
    results.push({ trail: `${here}[]`, value: next, present: true, notArray: true });
    return;
  }
  if (next.length === 0) {
    results.push({ trail: `${here}[]`, present: true, empty: true });
    return;
  }
  next.forEach((item, i) => resolve(item, rest, `${here}[${i}]`, results));
}

export function checkShape(body, expectations) {
  const problems = [];
  const unverified = [];

  for (const [rawPath, expected] of Object.entries(expectations)) {
    const optional = rawPath.startsWith("?");
    const path = optional ? rawPath.slice(1) : rawPath;
    const allowed = expected.split("|");
    const results = [];
    resolve(body, path.split("."), "", results);

    for (const result of results) {
      if (result.empty) {
        // An optional path inside an empty array simply has nothing to check.
        if (!optional) unverified.push(`${path} (array was empty)`);
      } else if (result.notArray) {
        problems.push(`${path}: expected an array, got ${typeOf(result.value)}`);
      } else if (!result.present) {
        if (!optional) problems.push(`${path}: missing`);
      } else if (!allowed.includes("any") && !allowed.includes(typeOf(result.value))) {
        problems.push(`${path}: expected ${expected}, got ${typeOf(result.value)}`);
      }
    }
  }

  return { problems: [...new Set(problems)], unverified: [...new Set(unverified)] };
}
