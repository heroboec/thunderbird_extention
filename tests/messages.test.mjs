import assert from "node:assert/strict";
import { test } from "node:test";
import { buildThreadText, getMessageText, getSelectedMessages } from "../src/lib/messages.js";
import { fakeStorage } from "./fake-storage.mjs";

const parts = {
  1: [{ contentType: "text/plain", content: "  Привет  " }],
  2: [{ contentType: "text/html", content: "<p>Ответ</p>" }],
};

globalThis.browser = {
  storage: { local: fakeStorage() },
  mailTabs: {
    getSelectedMessages: async () => ({ id: "page2", messages: [{ id: 1 }] }),
  },
  messages: {
    continueList: async () => ({ id: null, messages: [{ id: 2 }] }),
    listInlineTextParts: async (id) => parts[id] ?? [],
  },
  messengerUtilities: {
    convertToPlainText: async (html) => html.replace(/<[^>]+>/g, ""),
  },
};

test("getSelectedMessages follows pagination", async () => {
  assert.deepEqual(await getSelectedMessages(5), [{ id: 1 }, { id: 2 }]);
});

test("getMessageText prefers plain, falls back to html, empty without parts", async () => {
  assert.equal(await getMessageText(1), "  Привет  ");
  assert.equal(await getMessageText(2), "Ответ");
  assert.equal(await getMessageText(3), "");
});

test("buildThreadText sorts oldest first and adds headers", async () => {
  const msg = (id, date, subject) => ({ id, date, subject, author: "a@x.ru", recipients: ["b@x.ru"] });
  const text = await buildThreadText([
    msg(2, "2026-10-18T12:00:00Z", "Re: Тема"),
    msg(1, "2026-10-17T12:00:00Z", "Тема"),
  ]);
  const blocks = text.split("\n\n=== ");
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /^=== Письмо 1\/2 ===\n/);
  assert.match(blocks[0], /Тема: Тема\n\nПривет$/);
  assert.match(blocks[1], /^Письмо 2\/2 ===\n/);
  assert.match(blocks[1], /Кому: b@x\.ru\nТема: Re: Тема\n\nОтвет$/);
});
