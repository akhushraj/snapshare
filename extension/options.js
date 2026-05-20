'use strict';

const connectBtn      = document.getElementById('connect-btn');
const disconnectBtn   = document.getElementById('disconnect-btn');
const disconnectSec   = document.getElementById('disconnect-section');
const statusTitle     = document.getElementById('status-title');
const statusSub       = document.getElementById('status-sub');
const statusDot       = document.getElementById('status-dot');
const avatarEl        = document.getElementById('avatar');
const errorMsg        = document.getElementById('error-msg');

// ── Load saved state ──────────────────────────────────────────────────────
(async () => {
  const { connectedEmail } = await chrome.storage.sync.get('connectedEmail');
  if (connectedEmail) showConnected(connectedEmail);
})();

// ── Connect ───────────────────────────────────────────────────────────────
connectBtn.addEventListener('click', async () => {
  setError('');
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';

  try {
    const token = await getAuthToken(true);
    const email = await fetchEmail(token);
    await getOrCreateFolder(token);                   // ensures folder exists
    await chrome.storage.sync.set({ connectedEmail: email });
    showConnected(email);
  } catch (err) {
    setError(friendlyError(err.message));
  } finally {
    connectBtn.disabled = false;
    connectBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Sign in with Google`;
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────
disconnectBtn.addEventListener('click', async () => {
  try {
    const token = await getAuthToken(false);
    if (token) await new Promise(r => chrome.identity.removeCachedAuthToken({ token }, r));
  } catch { /* ignore */ }
  await chrome.storage.sync.remove(['connectedEmail', 'driveFolderId']);
  showDisconnected();
});

// ── UI helpers ─────────────────────────────────────────────────────────────
function showConnected(email) {
  statusTitle.textContent = email;
  statusSub.innerHTML = `<span class="dot green" id="status-dot"></span>Connected to Google Drive`;
  avatarEl.textContent = email[0].toUpperCase();
  connectBtn.style.display    = 'none';
  disconnectSec.style.display = 'block';
}

function showDisconnected() {
  statusTitle.textContent = 'Not connected';
  statusSub.innerHTML     = `<span class="dot grey"></span>Google Drive not linked`;
  avatarEl.textContent    = '👤';
  connectBtn.style.display    = 'flex';
  disconnectSec.style.display = 'none';
}

function setError(msg) {
  errorMsg.textContent    = msg;
  errorMsg.style.display  = msg ? 'block' : 'none';
}

function friendlyError(msg) {
  if (!msg) return 'Something went wrong. Please try again.';
  if (msg.includes('client_id') || msg.includes('OAuth'))
    return 'OAuth not configured — the developer needs to add a Client ID to the extension.';
  if (msg.includes('cancelled') || msg.includes('denied'))
    return 'Sign-in was cancelled.';
  return msg;
}

// ── Auth / Drive helpers ──────────────────────────────────────────────────
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

  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      "name='Screenshot' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    )}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const sd = await search.json();
  if (sd.files && sd.files.length > 0) {
    await chrome.storage.sync.set({ driveFolderId: sd.files[0].id });
    return sd.files[0].id;
  }

  const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Screenshot', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await cr.json();
  await chrome.storage.sync.set({ driveFolderId: folder.id });
  return folder.id;
}
