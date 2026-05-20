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
    const imageData = await captureFullPage(tab.id);
    const captureId = crypto.randomUUID();
    await chrome.storage.local.set({ [`capture_${captureId}`]: imageData });
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`editor.html?id=${captureId}`),
      index: tab.index + 1,
      active: true,
    });
  } catch (err) {
    console.error('[Screenshot] Capture failed:', err);
  }
});

async function captureFullPage(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (err) {
    if (err.message && err.message.includes('already attached')) {
      throw new Error('DevTools is open on this tab — close it and try again.');
    }
    throw err;
  }

  try {
    const metrics = await chrome.debugger.sendCommand(
      { tabId },
      'Page.getLayoutMetrics'
    );

    const width = Math.ceil(metrics.contentSize.width);
    // Cap at 16384px to avoid memory issues on extremely long pages
    const height = Math.min(Math.ceil(metrics.contentSize.height), 16384);

    const { data } = await chrome.debugger.sendCommand(
      { tabId },
      'Page.captureScreenshot',
      {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      }
    );

    return data;
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Already detached
    }
  }
}
