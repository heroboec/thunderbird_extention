// Expanding selected messages to their whole conversations across all
// folders, using Message-ID / References / In-Reply-To headers.
//
// Every messages.query() scans all folders, so the thread is found with one
// query by subject (Thunderbird already strips "Re:" from it), plus a lookup
// by Message-ID only for ancestors whose subject was changed.

import { replaceDomain } from "./anonymize.js";
import { cached, getCached, setCached } from "./cache.js";
import { buildThreadText, collectList } from "./messages.js";

// Upper bound on same-subject candidates whose headers are read; protects
// against very common subjects.
const MAX_CANDIDATES = 300;

// How long a Message-ID not found in any folder is not searched again.
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;

// Message-IDs inside a header value like "<a@x> <b@y>".
export function parseMessageIds(value) {
  return [...(value ?? "").matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]);
}

function isTrashOrJunk(message) {
  const specialUse = message.folder?.specialUse ?? [];
  return message.junk || specialUse.includes("trash") || specialUse.includes("junk");
}

const key = (message) => message.headerMessageId || `id:${message.id}`;

// Message-IDs this message replies to (References and In-Reply-To).
function getParentIds(message) {
  return cached("refs", message.headerMessageId, async () => {
    const { headers } = await browser.messages.getFull(message.id, { decodeContent: false });
    return [...new Set([...(headers.references ?? []), ...(headers["in-reply-to"] ?? [])].flatMap(parseMessageIds))];
  });
}

async function findByMessageId(headerMessageId) {
  if (await getCached("missing", headerMessageId, MISSING_TTL_MS)) return undefined;
  const found = (await collectList(browser.messages.query({ headerMessageId }))).find((m) => !isTrashOrJunk(m));
  if (!found) await setCached("missing", headerMessageId, true);
  return found;
}

// The whole conversation of one message.
async function collectThread(message) {
  const thread = new Map([[key(message), message]]);
  const parents = new Map([[key(message), await getParentIds(message)]]);
  const threadIds = new Set([message.headerMessageId, ...parents.get(key(message))]);

  const candidates = message.subject
    ? (await collectList(browser.messages.query({ subject: message.subject })))
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
  for (const m of await Promise.all(missing.map(findByMessageId))) {
    if (m && !thread.has(key(m))) thread.set(key(m), m);
  }
  return [...thread.values()];
}

// Selected messages expanded to full threads, without duplicates (the same
// message may be stored in several folders).
export async function expandThreads(selected) {
  const result = new Map();
  for (const message of selected) {
    if (result.has(key(message))) continue;
    for (const m of await collectThread(message)) {
      if (!result.has(key(m))) result.set(key(m), m);
    }
  }
  return [...result.values()];
}

// Text of the whole threads of the selected messages, with the configured
// domain replaced.
export async function collectThreadText(selected, domain) {
  const messages = await expandThreads(selected);
  const text = messages.length ? replaceDomain(await buildThreadText(messages), domain) : "";
  return { messages, text };
}
