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
  // Get real scroll dimensions from the DOM — more reliable than CDP metrics
  // for fixed-layout SPAs (like Claude, Notion, etc.) that report inflated contentSize.
  const [{ result: dims }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      viewW:   window.innerWidth,
      viewH:   window.innerHeight,
    }),
  });

  // Width: use viewport width. Horizontal scrolling is almost never intentional
  // for a screenshot, and contentSize/scrollWidth can be inflated on SPAs.
  const width  = dims.viewW;
  // Height: use actual scroll height (captures long pages), but cap at 16384px.
  const height = Math.min(dims.scrollH, 16384);

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (err) {
    if (err.message && err.message.includes('already attached')) {
      throw new Error('DevTools is open on this tab — close it and try again.');
    }
    throw err;
  }

  try {
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
