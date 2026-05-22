# Privacy Policy — Screenshot Extension

**Last updated: May 2026**

## Summary

Screenshot is a Chrome extension that captures webpage screenshots, lets you annotate them, and copies them to your clipboard or uploads them to your own Google Drive. **No data is collected by the developer. No external servers are involved.**

---

## What data is accessed

| Data | Purpose | Stored where |
|------|---------|--------------|
| Screenshot of the current tab | Core feature — lets you annotate and share it | In-browser memory only, cleared after use |
| Google account email address | Displayed in the UI so you know which Google account is connected | `chrome.storage.sync` on your device |
| Google Drive folder ID | Remembers where to save screenshots in your Drive | `chrome.storage.sync` on your device |

## What data is NOT collected

- No browsing history
- No page content beyond the screenshot you explicitly trigger
- No personal identifiable information beyond the email shown in the UI
- No analytics, crash reports, or telemetry of any kind
- No data is ever sent to the developer or any third-party server

## Google Drive (optional)

If you choose to connect Google Drive:

- Screenshots are uploaded **directly from your browser to your own Google Drive** using Google's API.
- The extension only requests the `drive.file` scope, which limits access to files it creates — it cannot read any other files in your Drive.
- You can disconnect at any time via the extension's options page, which removes the stored email and folder ID.

## Permissions explained

| Permission | Why it's needed |
|------------|----------------|
| `activeTab` | Capture the visible content of the current tab |
| `tabs` | Open the annotation editor in a new tab |
| `identity` | Authenticate with Google OAuth for Drive uploads |
| `storage` | Store the screenshot temporarily and save your preferences |
| `unlimitedStorage` | Prevent large screenshot files from being dropped by the browser's default quota |
| `clipboardWrite` | Copy the annotated image to your clipboard |
| `https://www.googleapis.com/*` | Call the Google Drive API and retrieve your account email for display |

## Third-party services

The only external service this extension communicates with is **Google APIs** (`googleapis.com`), and only when you have connected a Google account and explicitly click the Share button. No other third-party services are used.

## Changes to this policy

Any changes will be reflected in this document with an updated date. Significant changes will be noted in the extension's release notes.

## Contact

Questions? Open an issue at [github.com/akhushraj/screenshot](https://github.com/akhushraj/screenshot/issues).
