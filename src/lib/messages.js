// Collecting text of the messages selected in a mail tab.

import { cached } from "./cache.js";

// All messages of a paginated MessageList.
export async function collectList(listPromise) {
  let page = await listPromise;
  const messages = [...page.messages];
  while (page.id) {
    page = await browser.messages.continueList(page.id);
    messages.push(...page.messages);
  }
  return messages;
}

// Selected messages of a mail tab; a selected collapsed thread includes all
// of its messages.
export function getSelectedMessages(tabId) {
  return collectList(browser.mailTabs.getSelectedMessages(tabId));
}

// Plain text body of a message. Prefers text/plain parts, falls back to
// converting text/html.
export async function getMessageText(messageId) {
  const parts = await browser.messages.listInlineTextParts(messageId);
  const plain = parts.filter((p) => p.contentType === "text/plain");
  if (plain.length) {
    return plain.map((p) => p.content).join("\n\n");
  }
  const html = parts.filter((p) => p.contentType === "text/html");
  const texts = await Promise.all(html.map((p) => browser.messengerUtilities.convertToPlainText(p.content)));
  return texts.join("\n\n");
}

function formatDate(date) {
  return new Date(date).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

// All messages as one text, oldest first, each with a short header.
// sideOf(author) returns "мы", "клиент" or null to mark who wrote a message.
export async function buildThreadText(messages, sideOf = () => null) {
  const sorted = [...messages].sort((a, b) => new Date(a.date) - new Date(b.date));
  // A headers-only message has no full body to cache yet.
  const bodies = await Promise.all(
    sorted.map((m) => cached("body", m.headersOnly ? null : m.headerMessageId, () => getMessageText(m.id))),
  );
  return sorted
    .map((m, i) =>
      [
        `=== Письмо ${i + 1}/${sorted.length} ===`,
        `Дата: ${formatDate(m.date)}`,
        `От: ${m.author}${sideOf(m.author) ? ` [${sideOf(m.author)}]` : ""}`,
        `Кому: ${m.recipients.join(", ")}`,
        `Тема: ${m.subject}`,
        "",
        bodies[i].trim(),
      ].join("\n"),
    )
    .join("\n\n");
}
