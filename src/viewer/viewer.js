// Debug window: shows the collected text of the messages selected in a mail
// tab and follows selection changes.
import { buildThreadText, getSelectedMessages } from "../lib/messages.js";

const summary = document.getElementById("summary");
const output = document.getElementById("text");

// Selection can change faster than text is collected; only the latest
// render may write to the page.
let renderId = 0;

async function render(tabId) {
  const id = ++renderId;
  summary.textContent = "Загрузка…";
  summary.className = "";
  try {
    const messages = await getSelectedMessages(tabId);
    const text = messages.length ? await buildThreadText(messages) : "";
    if (id !== renderId) return;
    output.textContent = text;
    summary.textContent = messages.length
      ? `Писем: ${messages.length}, символов: ${text.length}`
      : "Ничего не выделено";
  } catch (e) {
    if (id !== renderId) return;
    output.textContent = "";
    summary.textContent = `Ошибка: ${e.message}`;
    summary.className = "error";
  }
}

async function initialTabId() {
  const param = new URLSearchParams(location.search).get("tabId");
  if (param) return Number(param);
  const [tab] = await browser.mailTabs.query({ active: true });
  return tab?.id;
}

document.getElementById("copy").addEventListener("click", () => {
  navigator.clipboard.writeText(output.textContent);
});

browser.mailTabs.onSelectedMessagesChanged.addListener((tab) => render(tab.id));

render(await initialTabId());
