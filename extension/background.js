'use strict';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;

  if (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('about:')
  ) {
    return;
  }

  try {
    // Capture exactly what's visible in the viewport.
    // captureVisibleTab is simpler and avoids the debugger-based approach that
    // caused the 4× tiling bug on fixed-layout SPAs (Claude, Notion, etc.).
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const base64  = dataUrl.slice('data:image/png;base64,'.length);

    const captureId = crypto.randomUUID();
    await chrome.storage.local.set({ [`capture_${captureId}`]: base64 });
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`editor.html?id=${captureId}`),
      index: tab.index + 1,
      active: true,
    });
  } catch (err) {
    console.error('[Screenshot] Capture failed:', err);
  }
});
