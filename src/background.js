// Thunderbird found a newer version via update_url. By default it would wait
// for a restart; reloading applies the update right away.
browser.runtime.onUpdateAvailable.addListener((details) => {
  console.log(`Update available: ${details.version}, applying`);
  browser.runtime.reload();
});

console.log(`Extension started, version ${browser.runtime.getManifest().version}`);
