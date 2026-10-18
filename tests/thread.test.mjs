import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { collectThreadText, expandThreads, parseMessageIds } from "../src/lib/thread.js";
import { fakeStorage } from "./fake-storage.mjs";

// Fake mailbox: id, Message-ID, subject, parent Message-IDs, folder.
let mailbox;
const inbox = { specialUse: ["inbox"] };
const sent = { specialUse: ["sent"] };
const trash = { specialUse: ["trash"] };

function msg(id, headerMessageId, subject, refs = [], folder = inbox) {
  return { id, headerMessageId, subject, refs, folder, junk: false };
}

const header = ({ refs, ...m }) => m;

// Counts of expensive API calls, to check what the cache saves.
let calls;

globalThis.browser = {
  messages: {
    continueList: async () => ({ id: null, messages: [] }),
    getFull: async (id) => {
      calls.getFull++;
      const { refs } = mailbox.find((m) => m.id === id);
      return { headers: refs.length ? { references: [refs.map((r) => `<${r}>`).join(" ")] } : {} };
    },
    listInlineTextParts: async (id) => {
      calls.body++;
      return [{ contentType: "text/plain", content: `текст ${id} от user@company.ru` }];
    },
    query: async ({ subject, headerMessageId }) => {
      calls.query++;
      return {
      id: null,
      messages: mailbox
        .filter((m) => (subject === undefined || m.subject.includes(subject)))
        .filter((m) => (headerMessageId === undefined || m.headerMessageId === headerMessageId))
        .map(header),
      };
    },
  },
};

beforeEach(() => {
  browser.storage = { local: fakeStorage() };
  calls = { getFull: 0, body: 0, query: 0 };
  mailbox = [
    msg(1, "a@x", "Проект", []),
    msg(2, "b@x", "Проект", ["a@x"], sent),
    msg(3, "c@x", "Проект", ["a@x", "b@x"]),
    msg(4, "d@x", "Проект", ["a@x", "b@x", "c@x"], sent),
    msg(5, "z@x", "Проект", []), // another thread with the same subject
    msg(6, "c@x", "Проект", ["a@x", "b@x"], trash), // copy in trash
  ];
});

const ids = (messages) => messages.map((m) => m.id).sort();

test("parseMessageIds extracts ids from a header", () => {
  assert.deepEqual(parseMessageIds("<a@x>  <b@y>\n <c@z>"), ["a@x", "b@y", "c@z"]);
  assert.deepEqual(parseMessageIds(undefined), []);
});

test("any message of a thread expands to the whole thread", async () => {
  for (const start of [1, 2, 3, 4]) {
    const selected = [header(mailbox.find((m) => m.id === start))];
    assert.deepEqual(ids(await expandThreads(selected)), [1, 2, 3, 4], `start ${start}`);
  }
});

test("side branch is included", async () => {
  mailbox.push(msg(7, "e@x", "Проект", ["a@x", "b@x"]));
  assert.deepEqual(ids(await expandThreads([header(mailbox[0])])), [1, 2, 3, 4, 7]);
});

test("chain referencing only direct parent is followed", async () => {
  mailbox = [msg(1, "a@x", "T"), msg(2, "b@x", "T", ["a@x"]), msg(3, "c@x", "T", ["b@x"])];
  assert.deepEqual(ids(await expandThreads([header(mailbox[0])])), [1, 2, 3]);
});

test("ancestor with a changed subject is found by Message-ID", async () => {
  mailbox[0].subject = "Старая тема";
  assert.deepEqual(ids(await expandThreads([header(mailbox[3])])), [1, 2, 3, 4]);
});

test("several selected messages of one thread give no duplicates", async () => {
  const selected = [header(mailbox[1]), header(mailbox[3]), header(mailbox[4])];
  assert.deepEqual(ids(await expandThreads(selected)), [1, 2, 3, 4, 5]);
});

const withDates = () => mailbox.forEach((m) => Object.assign(m, { date: `2026-10-0${m.id}T10:00:00Z`, author: "a@company.ru", recipients: [] }));

test("second collection reuses cached headers and bodies", async () => {
  withDates();
  const selected = [header(mailbox[0])];
  const first = await collectThreadText(selected, "");
  assert.equal(calls.getFull, 5); // selected + 4 same-subject candidates
  assert.equal(calls.body, 4);
  calls = { getFull: 0, body: 0, query: 0 };
  const second = await collectThreadText(selected, "");
  assert.equal(second.text, first.text);
  assert.deepEqual([calls.getFull, calls.body], [0, 0]);
});

test("new reply joins the thread and only it is read", async () => {
  withDates();
  await collectThreadText([header(mailbox[0])], "");
  mailbox.push(Object.assign(msg(8, "f@x", "Проект", ["a@x", "d@x"], sent), { date: "2026-10-09T10:00:00Z", author: "me@company.ru", recipients: [] }));
  calls = { getFull: 0, body: 0, query: 0 };
  const { messages } = await collectThreadText([header(mailbox[0])], "");
  assert.deepEqual(ids(messages), [1, 2, 3, 4, 8]);
  assert.deepEqual([calls.getFull, calls.body], [1, 1]);
});

test("missing ancestor is not searched again", async () => {
  mailbox = [msg(1, "b@x", "T", ["gone@x"])];
  await expandThreads([header(mailbox[0])]);
  const queries = calls.query;
  await expandThreads([header(mailbox[0])]);
  assert.equal(calls.query - queries, 1); // only the subject query
});

test("configured domain is replaced in collected text", async () => {
  withDates();
  const { text } = await collectThreadText([header(mailbox[0])], "company.ru");
  assert.doesNotMatch(text, /company\.ru/);
  assert.match(text, /От: a@example\.com/);
  assert.match(text, /текст 1 от user@example\.com/);
});
