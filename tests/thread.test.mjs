import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { expandThreads, parseMessageIds } from "../src/lib/thread.js";

// Fake mailbox: id, Message-ID, subject, parent Message-IDs, folder.
let mailbox;
const inbox = { specialUse: ["inbox"] };
const sent = { specialUse: ["sent"] };
const trash = { specialUse: ["trash"] };

function msg(id, headerMessageId, subject, refs = [], folder = inbox) {
  return { id, headerMessageId, subject, refs, folder, junk: false };
}

const header = ({ refs, ...m }) => m;

globalThis.browser = {
  messages: {
    continueList: async () => ({ id: null, messages: [] }),
    getFull: async (id) => {
      const { refs } = mailbox.find((m) => m.id === id);
      return { headers: refs.length ? { references: [refs.map((r) => `<${r}>`).join(" ")] } : {} };
    },
    query: async ({ subject, headerMessageId }) => ({
      id: null,
      messages: mailbox
        .filter((m) => (subject === undefined || m.subject.includes(subject)))
        .filter((m) => (headerMessageId === undefined || m.headerMessageId === headerMessageId))
        .map(header),
    }),
  },
};

beforeEach(() => {
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
