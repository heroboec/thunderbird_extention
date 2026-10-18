import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  addToThreads,
  clientEmails,
  collectThreads,
  emailOf,
  knownThreads,
  makeSideOf,
  parseMessageIds,
  threadText,
} from "../src/lib/thread.js";
import { fakeStorage } from "./fake-storage.mjs";

// Fake mailbox: id, Message-ID, subject, parent Message-IDs, folder.
let mailbox;
const inbox = { specialUse: ["inbox"], accountId: "acc1" };
const sent = { specialUse: ["sent"], accountId: "acc1" };
const trash = { specialUse: ["trash"], accountId: "acc1" };

function msg(id, headerMessageId, subject, refs = [], folder = inbox, author = "client@gmail.com") {
  return { id, headerMessageId, subject, refs, folder, junk: false, date: `2026-10-${10 + id}T10:00:00Z`, author, recipients: [] };
}

const header = ({ refs, ...m }) => m;
const byId = (id) => header(mailbox.find((m) => m.id === id));

// Counts of expensive API calls and all queries, to check what the cache
// saves and how the search is scoped.
let calls;
let queries;

globalThis.browser = {
  messages: {
    continueList: async () => ({ id: null, messages: [] }),
    get: async (id) => {
      const m = mailbox.find((m) => m.id === id);
      if (!m) throw new Error("not found");
      return header(m);
    },
    getFull: async (id) => {
      calls.getFull++;
      const { refs } = mailbox.find((m) => m.id === id);
      return { headers: refs.length ? { references: [refs.map((r) => `<${r}>`).join(" ")] } : {} };
    },
    listInlineTextParts: async (id) => {
      calls.body++;
      return [{ contentType: "text/plain", content: `текст ${id} от user@company.ru` }];
    },
    query: async (queryInfo) => {
      calls.query++;
      queries.push(queryInfo);
      const { subject, headerMessageId } = queryInfo;
      return {
        id: null,
        messages: mailbox
          .filter((m) => subject === undefined || m.subject.includes(subject))
          .filter((m) => headerMessageId === undefined || m.headerMessageId === headerMessageId)
          .map(header),
      };
    },
  },
};

const resetCalls = () => {
  calls = { getFull: 0, body: 0, query: 0 };
  queries = [];
};

beforeEach(() => {
  browser.storage = { local: fakeStorage() };
  resetCalls();
  mailbox = [
    msg(1, "a@x", "Проект", []),
    msg(2, "b@x", "Проект", ["a@x"], sent, "me@company.ru"),
    msg(3, "c@x", "Проект", ["a@x", "b@x"]),
    msg(4, "d@x", "Проект", ["a@x", "b@x", "c@x"], sent, "me@company.ru"),
    msg(5, "z@x", "Проект", []), // another thread with the same subject
    msg(6, "c@x", "Проект", ["a@x", "b@x"], trash), // copy in trash
  ];
});

const mids = (records) => records.map((r) => r.mid).sort();

test("parseMessageIds extracts ids from a header", () => {
  assert.deepEqual(parseMessageIds("<a@x>  <b@y>\n <c@z>"), ["a@x", "b@y", "c@z"]);
  assert.deepEqual(parseMessageIds(undefined), []);
});

test("any message of a thread expands to the whole thread", async () => {
  for (const start of [1, 2, 3, 4]) {
    browser.storage = { local: fakeStorage() };
    const [thread] = await collectThreads([byId(start)]);
    assert.deepEqual(mids(thread), ["a@x", "b@x", "c@x", "d@x"], `start ${start}`);
  }
});

test("thread records are sorted oldest first", async () => {
  const [thread] = await collectThreads([byId(4)]);
  assert.deepEqual(
    thread.map((r) => r.mid),
    ["a@x", "b@x", "c@x", "d@x"],
  );
});

test("side branch is included", async () => {
  mailbox.push(msg(7, "e@x", "Проект", ["a@x", "b@x"]));
  const [thread] = await collectThreads([byId(1)]);
  assert.deepEqual(mids(thread), ["a@x", "b@x", "c@x", "d@x", "e@x"]);
});

test("chain referencing only direct parent is followed", async () => {
  mailbox = [msg(1, "a@x", "T"), msg(2, "b@x", "T", ["a@x"]), msg(3, "c@x", "T", ["b@x"])];
  const [thread] = await collectThreads([byId(1)]);
  assert.deepEqual(mids(thread), ["a@x", "b@x", "c@x"]);
});

test("ancestor with a changed subject is found by Message-ID", async () => {
  mailbox[0].subject = "Старая тема";
  const [thread] = await collectThreads([byId(4)]);
  assert.deepEqual(mids(thread), ["a@x", "b@x", "c@x", "d@x"]);
});

test("selected messages of the same thread give one group", async () => {
  const threads = await collectThreads([byId(2), byId(4), byId(5), byId(1)]);
  assert.deepEqual(threads.map(mids), [["a@x", "b@x", "c@x", "d@x"], ["z@x"]]);
});

test("search is scoped to the account and searchDays back from the message", async () => {
  await collectThreads([byId(4)], { searchDays: 30 });
  const bySubject = queries.find((q) => q.subject);
  assert.equal(bySubject.accountId, "acc1");
  assert.equal(bySubject.fromDate.toISOString(), "2026-09-14T10:00:00.000Z");
});

test("remembered thread is reused without any search or reading", async () => {
  const [first] = await collectThreads([byId(1)]);
  resetCalls();
  const [second] = await collectThreads([byId(3)]);
  assert.deepEqual(mids(second), mids(first));
  assert.deepEqual(calls, { getFull: 0, body: 0, query: 0 });
});

test("new reply is added to the remembered thread without searching", async () => {
  await collectThreads([byId(1)]);
  mailbox.push(msg(8, "f@x", "Проект", ["a@x", "d@x"], sent, "me@company.ru"));
  await addToThreads(byId(8));
  resetCalls();
  const [thread] = await collectThreads([byId(1)]);
  assert.deepEqual(mids(thread), ["a@x", "b@x", "c@x", "d@x", "f@x"]);
  assert.equal(calls.query, 0);
});

test("message of an unknown thread is not added anywhere", async () => {
  await addToThreads(byId(5));
  assert.deepEqual(
    (await knownThreads([byId(5)])).unknown.map((m) => m.id),
    [5],
  );
});

test("force searches again", async () => {
  await collectThreads([byId(1)]);
  resetCalls();
  await collectThreads([byId(1)], { force: true });
  assert.ok(calls.query > 0);
});

test("knownThreads uses only remembered threads", async () => {
  let known = await knownThreads([byId(1), byId(5)]);
  assert.deepEqual([known.threads.length, known.unknown.length], [0, 2]);
  await collectThreads([byId(1)]);
  resetCalls();
  known = await knownThreads([byId(3), byId(5)]);
  assert.deepEqual(known.threads.map(mids), [["a@x", "b@x", "c@x", "d@x"]]);
  assert.deepEqual(
    known.unknown.map((m) => m.id),
    [5],
  );
  assert.equal(calls.query, 0);
});

test("missing ancestor is not searched again", async () => {
  mailbox = [msg(1, "b@x", "T", ["gone@x"])];
  await collectThreads([byId(1)]);
  const before = calls.query;
  await collectThreads([byId(1)], { force: true });
  assert.equal(calls.query - before, 1); // only the subject query
});

test("thread text marks sides and replaces the domain", async () => {
  const [thread] = await collectThreads([byId(1)]);
  const text = await threadText(thread, { domain: "company.ru", ourEmails: new Set() });
  assert.doesNotMatch(text, /company\.ru/);
  assert.match(text, /От: me@example\.com \[мы\]/);
  assert.match(text, /От: client@gmail\.com \[клиент\]/);
  assert.match(text, /текст 1 от user@example\.com/);
});

test("clientEmails lists client addresses, latest first, unchanged", async () => {
  mailbox[2].author = "Boss <boss@client.org>";
  const [thread] = await collectThreads([byId(1)]);
  const sideOf = makeSideOf("company.ru", new Set());
  assert.deepEqual(clientEmails(thread, sideOf), ["boss@client.org", "client@gmail.com"]);
});

test("emailOf extracts address", () => {
  assert.equal(emailOf("Иван <Ivan@Company.ru>"), "ivan@company.ru");
  assert.equal(emailOf("a@b.ru"), "a@b.ru");
});

test("sideOf marks our identities and domain as us", () => {
  const sideOf = makeSideOf("company.ru", new Set(["me@gmail.com"]));
  assert.equal(sideOf("Me <me@gmail.com>"), "мы");
  assert.equal(sideOf("support@company.ru"), "мы");
  assert.equal(sideOf("x@mail.company.ru"), "мы");
  assert.equal(sideOf("client@mycompany.ru"), "клиент");
  assert.equal(makeSideOf("", new Set())("a@company.ru"), "клиент");
});

test("thread is searched again when a remembered message id is stale", async () => {
  await collectThreads([byId(1)]);
  mailbox.find((m) => m.id === 3).headerMessageId = "other@x"; // id 3 now points to another message
  resetCalls();
  await collectThreads([byId(1)]);
  assert.ok(calls.query > 0);
});
