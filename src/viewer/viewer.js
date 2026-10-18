// Analysis window for many selected messages: groups them into threads and
// shows the analysis of each. Follows the selection in the mail tab.
//
// Following the selection only uses remembered threads and analyses, so it
// never freezes Thunderbird or costs money; searching folders for new
// threads and asking the model happen on the "Проанализировать" button.
// Messages are never opened, so they are not marked as read.
import { getAnalysis } from "../lib/analyze.js";
import { getSelectedMessages } from "../lib/messages.js";
import { loadSettings } from "../lib/settings.js";
import { clientEmails, collectThreads, getOurEmails, knownThreads, makeSideOf, threadText } from "../lib/thread.js";

const { STYLE, badge, render } = globalThis.AnalysisView;

const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);

// How many threads are sent to the model at once.
const PARALLEL_REQUESTS = 3;

const summary = document.getElementById("summary");
const analyzeButton = document.getElementById("analyze");
const list = document.getElementById("threads");

let tabId;
// Selection can change while work is in progress; only the latest
// generation may write to the page.
let generation = 0;
let current = { selected: [], threads: [], unknown: [] };

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const lastDate = (records) => new Date(records.at(-1).date);
const formatDate = (date) => date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

// One thread card; returns it with a function to show analysis state.
function threadCard(thread) {
  const card = el("section", undefined, "card");
  const badgeSlot = el("span");
  const head = el("div", undefined, "card-head");
  head.append(
    badgeSlot,
    el("span", thread.records[0].subject || "(без темы)", "card-title"),
    el("span", `писем ${thread.records.length} · последнее ${formatDate(lastDate(thread.records))}`, "card-meta"),
  );
  const clients = el("div", undefined, "clients");
  for (const email of thread.clientEmails) {
    const item = el("span");
    const button = el("button", "Копировать");
    button.type = "button";
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(email);
      button.textContent = "Скопировано";
    });
    item.append("Клиент: ", el("span", email, "email"), " ", button);
    clients.append(item);
  }
  const body = el("div", undefined, "body");
  const raw = el("details", undefined, "raw");
  raw.append(el("summary", "Текст цепочки (отладка)"), el("pre", thread.text));
  card.append(head, clients, body, raw);

  function show(state) {
    if (state.analysis) {
      badgeSlot.replaceChildren(badge(state.analysis.state));
      body.replaceChildren(render(state.analysis));
    } else if (state.error) {
      body.replaceChildren(el("p", `Ошибка анализа: ${state.error}`, "error"));
    } else {
      body.replaceChildren(el("p", state.pending ? "Анализирую…" : "Анализа ещё нет", "placeholder"));
    }
  }
  return { card, show };
}

async function prepareThreads(threadRecords) {
  const settings = await loadSettings();
  const ourEmails = await getOurEmails();
  const sideOf = makeSideOf(settings.domain, ourEmails);
  const threads = await Promise.all(
    threadRecords.map(async (records) => {
      const text = await threadText(records, { domain: settings.domain, ourEmails });
      return {
        records,
        text,
        clientEmails: clientEmails(records, sideOf),
        analysis: await getAnalysis(settings, text, { cacheOnly: true }),
      };
    }),
  );
  return threads.sort((a, b) => lastDate(b.records) - lastDate(a.records));
}

function renderAll() {
  const { selected, threads, unknown } = current;
  const missing = threads.filter((t) => !t.analysis).length;
  const parts = [`Выделено писем: ${selected.length}`, `цепочек: ${threads.length}`];
  if (missing) parts.push(`без анализа: ${missing}`);
  if (unknown.length) parts.push(`ещё не собрано писем: ${unknown.length}`);
  summary.textContent = selected.length ? parts.join(" · ") : "Ничего не выделено";
  summary.className = "";
  analyzeButton.hidden = !(missing || unknown.length);

  list.replaceChildren();
  for (const thread of threads) {
    const { card, show } = threadCard(thread);
    thread.show = show;
    show(thread);
    list.append(card);
  }
}

function showError(e) {
  summary.textContent = `Ошибка: ${e.message}`;
  summary.className = "error";
}

// Cheap refresh on selection change: remembered threads and analyses only.
async function refresh() {
  const gen = ++generation;
  try {
    const selected = await getSelectedMessages(tabId);
    const { threads, unknown } = await knownThreads(selected);
    const prepared = await prepareThreads(threads);
    if (gen !== generation) return;
    current = { selected, threads: prepared, unknown };
    renderAll();
  } catch (e) {
    if (gen === generation) showError(e);
  }
}

// Runs fn over items with at most `limit` running at once.
async function runLimited(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

async function analyzeAll() {
  const gen = ++generation;
  analyzeButton.hidden = true;
  try {
    if (current.unknown.length) {
      summary.textContent = `Собираю цепочки для ${current.unknown.length} писем…`;
      const { searchDays } = await loadSettings();
      const found = await collectThreads(current.unknown, { searchDays });
      const knownMids = new Set(current.threads.flatMap((t) => t.records.map((r) => r.mid)));
      const extra = await prepareThreads(found.filter((records) => !records.some((r) => knownMids.has(r.mid))));
      if (gen !== generation) return;
      current = { ...current, threads: [...current.threads, ...extra], unknown: [] };
      renderAll();
      analyzeButton.hidden = true;
    }
    const settings = await loadSettings();
    const todo = current.threads.filter((t) => !t.analysis);
    let done = 0;
    summary.textContent = `Анализирую цепочки: 0 из ${todo.length}`;
    await runLimited(todo, PARALLEL_REQUESTS, async (thread) => {
      if (gen !== generation) return; // selection changed: don't pay for threads no longer shown
      thread.pending = true;
      thread.show(thread);
      try {
        thread.analysis = await getAnalysis(settings, thread.text);
      } catch (e) {
        thread.error = e.message;
      }
      thread.pending = false;
      if (gen !== generation) return;
      thread.show(thread);
      summary.textContent = `Анализирую цепочки: ${++done} из ${todo.length}`;
    });
    if (gen === generation) renderAll();
  } catch (e) {
    if (gen === generation) showError(e);
  }
}

analyzeButton.addEventListener("click", analyzeAll);
browser.mailTabs.onSelectedMessagesChanged.addListener((tab) => {
  tabId = tab.id;
  refresh();
});

const param = new URLSearchParams(location.search).get("tabId");
tabId = param ? Number(param) : (await browser.mailTabs.query({ active: true }))[0]?.id;
refresh();
