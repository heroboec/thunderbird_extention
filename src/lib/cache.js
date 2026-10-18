// Persistent per-message cache in browser.storage.local, keyed by
// Message-ID. Message bodies and headers never change for a given
// Message-ID, so most entries need no invalidation.

const PREFIX = "cache:";
const PRUNED_AT_KEY = "cachePrunedAt";
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const storageKey = (kind, messageId) => `${PREFIX}${kind}:${messageId}`;

// Returns the cached value, or undefined if missing or older than maxAgeMs.
export async function getCached(kind, messageId, maxAgeMs = Infinity) {
  const key = storageKey(kind, messageId);
  const entry = (await browser.storage.local.get(key))[key];
  if (!entry || Date.now() - entry.t > maxAgeMs) return undefined;
  return entry.v;
}

export async function setCached(kind, messageId, value) {
  await browser.storage.local.set({ [storageKey(kind, messageId)]: { v: value, t: Date.now() } });
}

// Cached value for a message, computed and stored on a miss. Messages
// without a Message-ID and empty results are never cached, so a body that
// was not downloaded yet is fetched again next time.
export async function cached(kind, messageId, compute) {
  if (!messageId) return compute();
  const value = await getCached(kind, messageId);
  if (value !== undefined) return value;
  const computed = await compute();
  if (computed !== "") await setCached(kind, messageId, computed);
  return computed;
}

// Drops entries older than MAX_AGE_MS; does the work at most once a day.
export async function pruneCache() {
  const all = await browser.storage.local.get(null);
  if (Date.now() - (all[PRUNED_AT_KEY] ?? 0) < PRUNE_INTERVAL_MS) return;
  const stale = Object.keys(all).filter((key) => key.startsWith(PREFIX) && Date.now() - all[key].t > MAX_AGE_MS);
  await browser.storage.local.remove(stale);
  await browser.storage.local.set({ [PRUNED_AT_KEY]: Date.now() });
}
