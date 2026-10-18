import { analyzeThread, PROMPT_VERSION } from "./lib/analyze.js";
import { getCached, pruneCache, setCached } from "./lib/cache.js";
import { collectList } from "./lib/messages.js";
import { loadSettings, originPattern } from "./lib/settings.js";
import { collectThreadText, getOurEmails } from "./lib/thread.js";

// Thunderbird found a newer version via update_url. By default it would wait
// for a restart; reloading applies the update right away.
browser.runtime.onUpdateAvailable.addListener((details) => {
  console.log(`Update available: ${details.version}, applying`);
  browser.runtime.reload();
});

const VIEWER_MENU_ID = "show-text";
const THREAD_BLOCK_SCRIPT_ID = "thread-block";

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: VIEWER_MENU_ID,
    title: "Показать текст писем",
    contexts: ["message_list"],
  });
});

// Registered message display scripts don't survive a restart, so register
// on every background start unless still registered.
async function registerThreadBlock() {
  const registered = await browser.scripting.messageDisplay.getRegisteredScripts({ ids: [THREAD_BLOCK_SCRIPT_ID] });
  if (registered.length) return;
  await browser.scripting.messageDisplay.registerScripts([
    { id: THREAD_BLOCK_SCRIPT_ID, js: ["display/thread-block.js"] },
  ]);
}
registerThreadBlock();
pruneCache();

// Thread text for the message shown in the tab the request came from.
async function threadTextForTab(tabId) {
  const displayed = await collectList(browser.messageDisplay.getDisplayedMessages(tabId));
  const { domain, autoAnalyze } = await loadSettings();
  const { messages, text } = await collectThreadText(displayed, { domain, ourEmails: await getOurEmails() });
  return { count: messages.length, text, autoAnalyze };
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Model analysis of a thread text. The same text with the same model and
// prompt is answered from the cache unless force is set, so reopening an
// unchanged thread costs nothing.
async function analysisFor(text, force) {
  const settings = await loadSettings();
  if (!settings.apiKey || !settings.model) {
    throw new Error("Не заданы API-ключ или модель — откройте настройки расширения");
  }
  if (!(await browser.permissions.contains({ origins: [originPattern(settings.baseUrl)] }))) {
    throw new Error("Нет доступа к серверу API — откройте настройки расширения и нажмите «Сохранить»");
  }
  const key = await sha256(`${PROMPT_VERSION}\n${settings.baseUrl}\n${settings.model}\n${text}`);
  if (!force) {
    const hit = await getCached("analysis", key);
    if (hit) return { ...hit, fromCache: true };
  }
  const analysis = await analyzeThread(settings, text);
  await setCached("analysis", key, analysis);
  return analysis;
}

browser.runtime.onMessage.addListener((request, sender) => {
  if (request?.type === "getThreadText") return threadTextForTab(sender.tab.id);
  if (request?.type === "analyzeThread") return analysisFor(request.text, request.force);
});

// Opens the debug window with the text of selected messages, or focuses it
// if already open.
async function openViewer(tabId) {
  const { viewerWindowId } = await browser.storage.session.get("viewerWindowId");
  if (viewerWindowId) {
    try {
      await browser.windows.update(viewerWindowId, { focused: true });
      return;
    } catch {
      // Window was closed.
    }
  }
  const window = await browser.windows.create({
    url: `viewer/viewer.html?tabId=${tabId}`,
    type: "popup",
    width: 800,
    height: 700,
  });
  await browser.storage.session.set({ viewerWindowId: window.id });
}

browser.action.onClicked.addListener((tab) => openViewer(tab.id));
browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === VIEWER_MENU_ID) openViewer(tab.id);
});

console.log(`Extension started, version ${browser.runtime.getManifest().version}`);
