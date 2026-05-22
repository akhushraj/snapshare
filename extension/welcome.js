'use strict';

const connectBtn    = document.getElementById('connect-btn');
const connectStatus = document.getElementById('connect-status');
const doneBtn       = document.getElementById('done-btn');

// ── Check if already connected ────────────────────────────────────────────
(async () => {
  const { connectedEmail } = await chrome.storage.sync.get('connectedEmail');
  if (connectedEmail) showConnected(connectedEmail);
})();

// ── Connect ───────────────────────────────────────────────────────────────
connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  setStatus('', '');

  try {
    const token  = await getAuthToken(true);
    const email  = await fetchEmail(token);
    await getOrCreateFolder(token);
    await chrome.storage.sync.set({ connectedEmail: email });
    showConnected(email);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('cancelled') || msg.includes('denied')) {
      setStatus('Sign-in cancelled.', 'err');
    } else {
      setStatus('Could not connect — try again.', 'err');
    }
    connectBtn.disabled = false;
  }
});

// ── Done / close ──────────────────────────────────────────────────────────
doneBtn.addEventListener('click', () => {
  chrome.tabs.getCurrent(tab => chrome.tabs.remove(tab.id));
});

// ── Helpers ───────────────────────────────────────────────────────────────
function showConnected(email) {
  connectBtn.style.display = 'none';
  setStatus(`✓ Connected as ${email}`, 'ok');
}

function setStatus(msg, cls) {
  connectStatus.textContent = msg;
  connectStatus.className   = cls;
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, token => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

async function fetchEmail(token) {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  return d.email || 'your account';
}

async function getOrCreateFolder(token) {
  const stored = await chrome.storage.sync.get('driveFolderId');
  if (stored.driveFolderId) return stored.driveFolderId;

  const r = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Screenshot', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await r.json();
  await chrome.storage.sync.set({ driveFolderId: folder.id });
  return folder.id;
}
