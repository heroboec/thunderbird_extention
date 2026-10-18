import { getAnalysis } from "./lib/analyze.js";
import { pruneCache } from "./lib/cache.js";
import { collectList } from "./lib/messages.js";
import { loadSettings } from "./lib/settings.js";
import { addToThreads, clientEmails, collectThreads, getOurEmails, makeSideOf, threadText } from "./lib/thread.js";

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
    title: "Анализ выделенных писем",
    contexts: ["message_list"],
  });
});

// Registered message display scripts don't survive a restart, so register
// on every background start unless still registered.
async function registerThreadBlock() {
  const registered = await browser.scripting.messageDisplay.getRegisteredScripts({ ids: [THREAD_BLOCK_SCRIPT_ID] });
  if (registered.length) return;
  await browser.scripting.messageDisplay.registerScripts([
    { id: THREAD_BLOCK_SCRIPT_ID, js: ["display/render.js", "display/thread-block.js"] },
  ]);
}
registerThreadBlock();
pruneCache();

// Keep remembered threads current: new mail in any folder and our own sent
// replies join the threads they answer.
async function addAllToThreads(messages) {
  for (const message of messages) {
    await addToThreads(message).catch((e) => console.error("addToThreads failed", e));
  }
}
browser.messages.onNewMailReceived.addListener(
  async (folder, messageList) => addAllToThreads(await collectList(messageList)),
  true,
);
browser.compose.onAfterSend.addListener((tab, sendInfo) => addAllToThreads(sendInfo.messages ?? []));

// Thread of the message shown in the tab the request came from.
async function threadForTab(tabId, force) {
  const displayed = await collectList(browser.messageDisplay.getDisplayedMessages(tabId));
  const settings = await loadSettings();
  const ourEmails = await getOurEmails();
  const [records = []] = await collectThreads(displayed.slice(0, 1), { force, searchDays: settings.searchDays });
  return {
    count: records.length,
    text: records.length ? await threadText(records, { domain: settings.domain, ourEmails }) : "",
    clientEmails: clientEmails(records, makeSideOf(settings.domain, ourEmails)),
    autoAnalyze: settings.autoAnalyze,
  };
}

browser.runtime.onMessage.addListener(async (request, sender) => {
  if (request?.type === "getThread") return threadForTab(sender.tab.id, request.force);
  if (request?.type === "analyzeThread") return getAnalysis(await loadSettings(), request.text, { force: request.force });
});

// Opens the analysis window for selected messages, or focuses it if
// already open.
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
    width: 900,
    height: 800,
  });
  await browser.storage.session.set({ viewerWindowId: window.id });
}

browser.action.onClicked.addListener((tab) => openViewer(tab.id));
browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === VIEWER_MENU_ID) openViewer(tab.id);
});

console.log(`Extension started, version ${browser.runtime.getManifest().version}`);
