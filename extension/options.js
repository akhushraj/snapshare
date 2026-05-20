'use strict';

const extId      = document.getElementById('ext-id');
const copyIdBtn  = document.getElementById('copy-id-btn');
const clientInput = document.getElementById('client-id-input');
const saveBtn    = document.getElementById('save-clientid-btn');
const statusArea = document.getElementById('status-area');
const badgeId    = document.getElementById('badge-clientid');

const connectBtn    = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const accountRow    = document.getElementById('account-row');
const accountEmail  = document.getElementById('account-email');
const badgeAccount  = document.getElementById('badge-account');
const folderInfo    = document.getElementById('folder-info');

// ── Show extension ID ──────────────────────────────────────────────────────
extId.textContent = chrome.runtime.id;

copyIdBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(chrome.runtime.id);
  copyIdBtn.textContent = 'Copied!';
  setTimeout(() => { copyIdBtn.textContent = 'Copy ID'; }, 1500);
});

// ── Load saved client ID ───────────────────────────────────────────────────
(async () => {
  const stored = await chrome.storage.sync.get(['clientId', 'connectedEmail', 'driveFolderId']);
  if (stored.clientId) {
    clientInput.value = stored.clientId;
    badgeId.textContent = 'saved';
    badgeId.className   = 'badge ok';
  }
  if (stored.connectedEmail) {
    showConnected(stored.connectedEmail, stored.driveFolderId);
  }
})();

// ── Save client ID ─────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  const val = clientInput.value.trim();
  if (!val || !val.includes('.apps.googleusercontent.com')) {
    setStatus('Please enter a valid Client ID (ends with .apps.googleusercontent.com)', 'err');
    return;
  }
  await chrome.storage.sync.set({ clientId: val });
  badgeId.textContent = 'saved';
  badgeId.className   = 'badge ok';
  setStatus('Saved! Now reload the extension in chrome://extensions, then come back to sign in.', 'ok');
});

// ── Connect Google account ─────────────────────────────────────────────────
connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';

  try {
    const token = await getAuthToken(true);
    const email = await fetchEmail(token);
    const folderId = await getOrCreateFolder(token);
    await chrome.storage.sync.set({ connectedEmail: email, driveFolderId: folderId });
    showConnected(email, folderId);
  } catch (err) {
    console.error(err);
    setStatus(
      err.message.includes('client_id')
        ? 'OAuth not configured — save a valid Client ID above first, then reload the extension.'
        : `Connection failed: ${err.message}`,
      'err'
    );
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Sign in with Google';
  }
});

// ── Disconnect ─────────────────────────────────────────────────────────────
disconnectBtn.addEventListener('click', async () => {
  // Revoke token
  try {
    await new Promise(resolve => chrome.identity.getAuthToken({ interactive: false }, token => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, resolve);
      } else {
        resolve();
      }
    }));
  } catch { /* ignore */ }

  await chrome.storage.sync.remove(['connectedEmail', 'driveFolderId']);
  showDisconnected();
});

// ── UI helpers ─────────────────────────────────────────────────────────────
function showConnected(email, folderId) {
  accountEmail.textContent  = email;
  accountRow.style.display  = 'flex';
  connectBtn.style.display  = 'none';
  disconnectBtn.style.display = 'inline-flex';
  badgeAccount.textContent  = 'connected';
  badgeAccount.className    = 'badge ok';
  if (folderId) {
    folderInfo.textContent = `Screenshots folder: drive.google.com/drive/folders/${folderId}`;
  }
}

function showDisconnected() {
  accountRow.style.display    = 'none';
  connectBtn.style.display    = 'inline-flex';
  disconnectBtn.style.display = 'none';
  badgeAccount.textContent    = 'not connected';
  badgeAccount.className      = 'badge';
  folderInfo.textContent      = '';
}

function setStatus(msg, type = '') {
  statusArea.textContent  = msg;
  statusArea.className    = type;
}

// ── Drive helpers ──────────────────────────────────────────────────────────
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, token => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

async function fetchEmail(token) {
  const r = await fetch(
    'https://www.googleapis.com/oauth2/v3/userinfo?fields=email',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  return d.email || '(unknown)';
}

async function getOrCreateFolder(token) {
  // Check for existing folder named SnapShare
  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      "name='SnapShare' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    )}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const sd = await search.json();
  if (sd.files && sd.files.length > 0) return sd.files[0].id;

  // Create it
  const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'SnapShare', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await cr.json();
  return folder.id;
}
