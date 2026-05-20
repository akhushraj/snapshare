# SnapShare

Chrome extension to capture full-page screenshots, annotate them, and share via a Google Drive link — no server required.

**Flow:** Click icon → full page captured → annotate in editor → click Share → link auto-copied to clipboard.

---

## Features

- **Full-page capture** using Chrome DevTools Protocol (captures below the fold)
- **Region select** — drag to crop before saving; skip to use the full page
- **Annotation tools** — arrows, rectangles, circles, text, 7 colors, 3 stroke sizes
- **Undo** (Cmd/Ctrl+Z), **Escape** to cancel
- **Google Drive storage** — no server, files live in your Drive in a `SnapShare` folder
- **Shareable links** — anyone with the link can view, no login needed; revoke by deleting in Drive

---

## Setup (one time)

### 1. Generate icons

Open `extension/icons/generate-icons.html` in Chrome, download the three files, and save them as:
```
extension/icons/icon16.png
extension/icons/icon48.png
extension/icons/icon128.png
```

### 2. Create a Google Cloud OAuth Client ID

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create/select a project.
2. **APIs & Services → Enable APIs** → search **Google Drive API** → Enable.
3. **APIs & Services → OAuth consent screen** → External → fill in App name (e.g. "SnapShare"), your email, save.
4. **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
   - Application type: **Chrome Extension**
   - Extension ID: you'll get this in step 3 below — come back and fill it in
5. Copy the generated **Client ID** (looks like `123456789.apps.googleusercontent.com`)

### 3. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Note the **Extension ID** shown on the card (e.g. `abcdefghijklmnopabcdefghijklmnop`)
5. Go back to Google Cloud Console → edit the OAuth Client ID you created → paste the Extension ID → save

### 4. Configure in the Options page

1. Right-click the SnapShare icon → **Options** (or go to `chrome://extensions` → SnapShare → Details → Extension options)
2. Paste your **Client ID** and click **Save**
3. Reload the extension (`chrome://extensions` → click the refresh icon on SnapShare)
4. Come back to Options → click **Sign in with Google** → authorize SnapShare

Done! Click the toolbar icon on any page to take a screenshot.

---

## Usage

| Action | How |
|--------|-----|
| Capture | Click the SnapShare toolbar icon |
| Select region | Choose the **Select Region** tool (default), drag on the image |
| Annotate | Pick Arrow / Rect / Circle / Text, draw on the image |
| Undo | Cmd+Z / Ctrl+Z, or the ↩ button |
| Clear region | Click the × button |
| Share | Click the ↑ (upload) button — link auto-copied to clipboard |
| Revoke link | Delete the file from your **SnapShare** folder in Google Drive |

---

## File structure

```
extension/
├── manifest.json        Chrome extension manifest (MV3)
├── background.js        Service worker: full-page capture via CDP
├── editor.html          Annotation editor UI
├── editor.js            Editor logic + Drive upload
├── options.html         Setup / OAuth page
├── options.js           Options logic
└── icons/
    ├── generate-icons.html   Open in browser to generate PNG icons
    ├── icon16.png            (you generate these)
    ├── icon48.png
    └── icon128.png
```

---

## Notes

- **DevTools conflict** — if Chrome DevTools is open on the tab you're capturing, the capture will fail (DevTools already holds the debugger). Close DevTools first.
- **Page height cap** — pages taller than 16,384px are capped at that height to avoid memory issues.
- **Drive scope** — the extension only requests `drive.file` scope, meaning it can only see files *it* created. It cannot read your other Drive files.
- **Token caching** — Chrome caches the OAuth token; `chrome.identity.getAuthToken` handles refresh automatically.
