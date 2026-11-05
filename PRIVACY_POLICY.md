# Privacy Policy for WhatsApp Direct & Mention Notifier

*Last updated: November 5, 2026*

**WhatsApp Direct & Mention Notifier** ("the Extension") is committed to protecting your privacy. This Privacy Policy explains our practices regarding user data.

---

### 1. Zero Data Collection
The Extension **does not collect, store, transmit, or share any personal information, browsing data, messages, or communications** with external servers or third parties.

### 2. Local Processing Only
- All message inspection and mention detection occurs **strictly locally** inside your own web browser on `https://web.whatsapp.com`.
- Message contents are analyzed in real-time within your active tab session only to determine if an incoming notification is a 1-on-1 direct message or a mention.
- Message content is never logged, never transmitted over the network, and never saved permanently.

### 3. Local Storage (`chrome.storage.local`)
The Extension uses your browser's local storage solely to store:
- User preferences (sound alert toggle, mute settings).
- Custom nicknames and identifiers that you specify.
- Local notification counters and recent notification preview history.

All stored data remains on your local machine and can be cleared at any time via the extension popup or by uninstalling the extension.

### 4. Permissions Used
- **`notifications`**: Required to display desktop notifications for direct messages and mentions.
- **`storage`**: Required to retain user settings locally.
- **`tabs`**: Required to bring the WhatsApp Web tab into focus when clicking a notification.
- **`scripting`**: Required to run the detection logic inside the WhatsApp Web tab.
- **Host Permissions (`https://web.whatsapp.com/*`)**: Required exclusively to interact with the WhatsApp Web interface. The extension cannot access any other website or domain.

### 5. Third-Party Services
The Extension does not use any third-party analytics, tracking scripts, tracking pixels, or external APIs.

### 6. Contact
If you have questions about this Privacy Policy, please open an issue on GitHub:
https://github.com/shahidimam19/whatsapp-notifier

