// Expanding selected messages to their whole conversations across folders,
// using Message-ID / References / In-Reply-To headers.
//
// messages.query() walks every message of the searched folders on
// Thunderbird's main thread and freezes the UI while it runs. So a thread
// is searched once (one query by subject, scoped to the message's account
// and the last searchDays days) and then remembered as a snapshot: its
// message records plus an index Message-ID -> thread. New incoming mail and
// sent replies are added to snapshots by addToThreads(), called from
// background events, so reopening a thread needs no query at all.

import { replaceDomain } from "./anonymize.js";
import { cached, getCached, setCached } from "./cache.js";
import { buildThreadText, collectList, getMessageText } from "./messages.js";

// Upper bound on same-subject candidates whose headers are read; protects
// against very common subjects.
const MAX_CANDIDATES = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

// How long a Message-ID not found in any folder is not searched again.
const MISSING_TTL_MS = DAY_MS;

// Message-IDs inside a header value like "<a@x> <b@y>".
export function parseMessageIds(value) {
  return [...(value ?? "").matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]);
}

function isTrashOrJunk(message) {
  const specialUse = message.folder?.specialUse ?? [];
  return message.junk || specialUse.includes("trash") || specialUse.includes("junk");
}

const key = (message) => message.headerMessageId || `id:${message.id}`;

// What a thread keeps about a message. `id` is Thunderbird's message id,
// which may point to another message after a restart; it is checked before
// use (see loadSnapshot).
function toRecord(message) {
  return {
    mid: message.headerMessageId,
    id: message.id,
    date: new Date(message.date).toISOString(),
    author: message.author,
    recipients: message.recipients,
    subject: message.subject,
    headersOnly: !!message.headersOnly,
  };
}

// Message-IDs this message replies to (References and In-Reply-To).
function getParentIds(message) {
  return cached("refs", message.headerMessageId, async () => {
    const { headers } = await browser.messages.getFull(message.id, { decodeContent: false });
    return [...new Set([...(headers.references ?? []), ...(headers["in-reply-to"] ?? [])].flatMap(parseMessageIds))];
  });
}

const accountScope = (message) => (message.folder?.accountId ? { accountId: message.folder.accountId } : {});

async function findByMessageId(headerMessageId, scope) {
  if (await getCached("missing", headerMessageId, MISSING_TTL_MS)) return undefined;
  const found = (await collectList(browser.messages.query({ headerMessageId, ...scope }))).find(
    (m) => !isTrashOrJunk(m),
  );
  if (!found) await setCached("missing", headerMessageId, true);
  return found;
}

// Searches folders for the whole conversation of one message, looking
// searchDays back from it.
async function searchThread(message, searchDays) {
  const thread = new Map([[key(message), message]]);
  const parents = new Map([[key(message), await getParentIds(message)]]);
  const threadIds = new Set([message.headerMessageId, ...parents.get(key(message))]);
  const scope = accountScope(message);

  const candidates = message.subject
    ? (
        await collectList(
          browser.messages.query({
            subject: message.subject,
            fromDate: new Date(new Date(message.date).getTime() - searchDays * DAY_MS),
            ...scope,
          }),
        )
      )
        .filter((m) => !isTrashOrJunk(m) && !thread.has(key(m)))
        .slice(0, MAX_CANDIDATES)
    : [];
  await Promise.all(candidates.map(async (m) => parents.set(key(m), await getParentIds(m))));

  // A candidate belongs to the thread if it is referenced by a thread
  // message or references one. Repeat until nothing new joins, so chains
  // that reference only their direct parent are followed too.
  let grown = true;
  while (grown) {
    grown = false;
    for (const m of candidates) {
      if (thread.has(key(m))) continue;
      if (threadIds.has(m.headerMessageId) || parents.get(key(m)).some((id) => threadIds.has(id))) {
        thread.set(key(m), m);
        threadIds.add(m.headerMessageId);
        parents.get(key(m)).forEach((id) => threadIds.add(id));
        grown = true;
      }
    }
  }

  // Ancestors with a different subject were not among candidates.
  const missing = [...threadIds].filter((id) => !thread.has(id));
  for (const m of await Promise.all(missing.map((id) => findByMessageId(id, scope)))) {
    if (m && !thread.has(key(m))) thread.set(key(m), m);
  }
  return [...thread.values()];
}

const byDate = (a, b) => new Date(a.date) - new Date(b.date);

async function saveSnapshot(records) {
  if (records.some((r) => !r.mid)) return;
  const threadKey = [...records].sort(byDate)[0].mid;
  await setCached("thread", threadKey, records);
  await Promise.all(records.map((r) => setCached("tidx", r.mid, threadKey)));
}

// Whether the text of a record can be built: its body is cached, or its id
// still points to the same message.
async function isReadable(record) {
  if ((await getCached("body", record.mid)) !== undefined) return true;
  if (record.id === undefined) return false;
  const message = await browser.messages.get(record.id).catch(() => null);
  return message?.headerMessageId === record.mid;
}

// Remembered thread of a message, or null if unknown or some message of it
// can't be read any more (then the thread is searched again).
async function loadSnapshot(headerMessageId) {
  if (!headerMessageId) return null;
  const threadKey = await getCached("tidx", headerMessageId);
  const records = threadKey && (await getCached("thread", threadKey));
  if (!records) return null;
  return (await Promise.all(records.map(isReadable))).every(Boolean) ? records : null;
}

// Records of the whole thread of a message: from the snapshot when known,
// otherwise searched and remembered. force always searches again.
async function collectThread(message, { force = false, searchDays = 90 } = {}) {
  if (!force) {
    const snapshot = await loadSnapshot(message.headerMessageId);
    if (snapshot) return snapshot;
  }
  const records = (await searchThread(message, searchDays)).map(toRecord);
  await saveSnapshot(records);
  return records;
}

// Groups selected messages into threads using collect(message), which
// returns thread records or null. Messages of one thread give one group;
// the same message stored in several folders appears once. Messages for
// which collect gave null and that are in no found thread are "unknown".
async function groupThreads(selected, collect) {
  const threads = [];
  const unknown = [];
  const seen = new Set();
  for (const message of selected) {
    if (seen.has(key(message))) continue;
    const thread = await collect(message);
    if (!thread) {
      unknown.push(message);
      continue;
    }
    const records = [];
    for (const r of thread) {
      const k = r.mid || `id:${r.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      records.push(r);
    }
    seen.add(key(message));
    if (records.length) threads.push(records.sort(byDate));
  }
  return { threads, unknown: unknown.filter((m) => !seen.has(key(m))) };
}

// Whole threads of the selected messages, searching folders for threads
// not remembered yet (this may freeze Thunderbird for a moment).
export async function collectThreads(selected, options) {
  return (await groupThreads(selected, (m) => collectThread(m, options))).threads;
}

// Remembered threads of the selected messages, without searching folders;
// messages of not yet searched threads are returned as unknown.
export function knownThreads(selected) {
  return groupThreads(selected, (m) => loadSnapshot(m.headerMessageId));
}

// Adds a new message (incoming or a sent reply) to the remembered threads
// it replies to, so they don't have to be searched again.
export async function addToThreads(message) {
  if (!message.headerMessageId || isTrashOrJunk(message)) return;
  const threadKeys = new Set(
    (await Promise.all((await getParentIds(message)).map((id) => getCached("tidx", id)))).filter(Boolean),
  );
  if (!threadKeys.size) return;
  const record = toRecord(message);
  if (!record.headersOnly) {
    await cached("body", record.mid, () => getMessageText(message.id));
  }
  for (const threadKey of threadKeys) {
    const records = (await getCached("thread", threadKey)) ?? [];
    if (records.some((r) => r.mid === record.mid)) continue;
    await setCached("thread", threadKey, [...records, record]);
  }
  await setCached("tidx", record.mid, [...threadKeys][0]);
}

// Email address from an author like "Name <a@x.ru>".
export function emailOf(author) {
  return (author.match(/<([^<>]+)>/)?.[1] ?? author).trim().toLowerCase();
}

// Who wrote a message: "мы" for our own addresses and the configured domain
// (with subdomains), "клиент" for everyone else.
export function makeSideOf(domain, ourEmails) {
  return (author) => {
    const email = emailOf(author);
    const ours = ourEmails.has(email) || (domain && (email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`)));
    return ours ? "мы" : "клиент";
  };
}

// Client addresses of a thread, most recent writer first.
export function clientEmails(records, sideOf) {
  const emails = [...records]
    .sort(byDate)
    .reverse()
    .filter((r) => sideOf(r.author) === "клиент")
    .map((r) => emailOf(r.author));
  return [...new Set(emails)];
}

// Text of one thread with authors marked as us or the client, and the
// configured domain replaced.
export async function threadText(records, { domain, ourEmails }) {
  return replaceDomain(await buildThreadText(records, makeSideOf(domain, ourEmails)), domain);
}

// Email addresses of all identities of the configured mail accounts.
export async function getOurEmails() {
  const accounts = await browser.accounts.list(false);
  return new Set(accounts.flatMap((a) => a.identities ?? []).map((i) => i.email.toLowerCase()));
}
