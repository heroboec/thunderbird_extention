// Thunderbird found a newer version via update_url. By default it would wait
// for a restart; reloading applies the update right away.
browser.runtime.onUpdateAvailable.addListener((details) => {
  console.log(`Update available: ${details.version}, applying`);
  browser.runtime.reload();
});

const VIEWER_MENU_ID = "show-text";

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: VIEWER_MENU_ID,
    title: "Показать текст писем",
    contexts: ["message_list"],
  });
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
