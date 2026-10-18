import { buildThreadText, collectList } from "./lib/messages.js";
import { expandThreads } from "./lib/thread.js";

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

// Thread text for the message shown in the tab the request came from.
async function threadTextForTab(tabId) {
  const displayed = await collectList(browser.messageDisplay.getDisplayedMessages(tabId));
  const messages = await expandThreads(displayed);
  return { count: messages.length, text: messages.length ? await buildThreadText(messages) : "" };
}

browser.runtime.onMessage.addListener((request, sender) => {
  if (request?.type === "getThreadText") return threadTextForTab(sender.tab.id);
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
