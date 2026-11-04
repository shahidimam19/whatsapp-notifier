# WhatsApp Direct & Mention Notifier - Chrome Extension

A lightweight, distraction-free Chrome Extension (Manifest V3) for WhatsApp Web that **only notifies you when:**
1. Someone sends you a **Direct Message (1-on-1 private chat)**.
2. Someone **tags or mentions you (@you)** in any WhatsApp group.

It intelligently **filters out all normal group banter, spam, and non-urgent chatter** so you never miss what matters while staying focused.

---

## 🚀 Key Features

- 💬 **Direct Message Alerts:** Instant notification when a contact messages you privately.
- 🏷️ **Group Tag/Mention Alerts:** Notifies you immediately when your name or `@` mention appears in a group chat.
- 🚫 **Group Chatter Filter:** Blocks unnecessary notifications from noisy groups where you aren't tagged.
- 🔊 **Built-in Audio Chime:** Pleasant Web Audio chime (distinct tones for DMs vs. Mentions, no external sound files required).
- 🎯 **One-Click Tab Focus:** Clicking any notification instantly brings WhatsApp Web to the front and focuses the chat.
- 🏷️ **Custom Nicknames & Numbers:** Add custom names, nicknames, or your phone number to catch text mentions even if WhatsApp doesn't render an official mention pill.
- 📊 **Daily Activity Tracker:** Keeps count of DMs and Mentions received each day with a recent history feed.
- 🔒 **100% Private & Local:** Runs entirely within your browser. No external servers, no tracking, no data collection.

---

## 📦 How to Install in Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in the address bar.
3. In the top right corner, toggle on **"Developer mode"**.
4. Click the **"Load unpacked"** button in the top left.
5. Select the repository root folder (e.g. `whatsapp-notifier`).
6. The extension **"WhatsApp Direct & Mention Notifier"** will now appear in your extensions list.
7. Click the Chrome Puzzle icon (Extensions menu) at the top right of your browser and **Pin** the extension for quick access.

---

## 🛠️ Setup & Usage Guide

### 1. Open WhatsApp Web
- Open [https://web.whatsapp.com](https://web.whatsapp.com) and log in with your phone QR code as usual.
- Keep the WhatsApp Web tab open in Chrome (it can be pinned, backgrounded, or minimized).

### 2. Verify Windows / OS Notifications
Make sure Chrome has permission to show notifications on your operating system:
- **Windows:** Go to **Windows Settings > System > Notifications** and ensure Google Chrome is set to **On**.
- **Chrome Settings:** Ensure notifications are enabled for Chrome.

### 3. Open Extension Popup & Test
Click the extension icon in Chrome's toolbar:
- You will see the **Connection Status** (turns green when WhatsApp Web is active).
- Click **"🧪 Test DM"** to test a 1-on-1 direct message notification.
- Click **"🧪 Test Mention"** to test a group @mention alert.
- Click **"🔊 Test Sound"** to test the synthesized chime sound.

### 4. Set Custom Mention Keywords (Optional)
In the popup under **"Custom Mention Names / Numbers"**:
- Type your first name (e.g. `Shahid`), nickname, or your phone number (e.g. `+91987...`).
- Click **Add**.
- Whenever someone writes `@Shahid` or mentions that keyword in a group message, you will immediately receive an alert.

---

## 📂 Project Structure

```
Whatsapp Crm extension/
├── manifest.json       # Manifest V3 extension configuration
├── background.js       # Background service worker (system notifications, badge, tab focus)
├── content.js          # DOM observer for WhatsApp Web chat list & active chat
├── content.css         # Styling for DOM indicators
├── sound.js            # Web Audio API alert sound synthesizer
├── injected.js         # Page-level hook for native notification intercept
├── popup.html          # Clean WhatsApp dark-mode popup UI
├── popup.css           # Modern WhatsApp-themed styles
├── popup.js            # Settings controller, keyword manager, test actions
├── icons/              # Extension icons (16px, 48px, 128px)
└── README.md           # Documentation
```

---

## ❓ Troubleshooting

- **No notifications appearing?**
  1. Click **"🧪 Test DM"** in the extension popup. If you don't see a Windows/Chrome notification, check your Windows "Focus assist" or Windows Notification settings for Google Chrome.
  2. Reload WhatsApp Web (`Ctrl + F5`) after installing the extension for the first time.
- **Want notifications even when looking at WhatsApp?**
  - In the popup, enable the **"Notify Even When Focused"** toggle.

