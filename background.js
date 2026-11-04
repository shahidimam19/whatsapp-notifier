/**
 * WhatsApp Direct & Mention Notifier - Background Service Worker
 * Handles desktop notifications, badge counts, tab switching, and history.
 */

const DEFAULT_SETTINGS = {
  notifyDM: true,
  notifyMention: true,
  playAudio: true,
  notifyWhenFocused: true,
  focusTabOnClick: true,
  customKeywords: [],
  notificationHistory: [],
  stats: {
    dmCount: 0,
    mentionCount: 0,
    date: new Date().toDateString()
  }
};

// Initialize settings on install & auto-reinject into open WhatsApp Web tabs
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  const toSet = {};
  for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      toSet[key] = val;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  chrome.action.setBadgeBackgroundColor({ color: '#25D366' });
  console.log('[WhatsApp Notifier] Installed & settings initialized.');

  // Automatically re-inject content scripts into any already open WhatsApp Web tabs
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['sound.js', 'content.js']
        }).catch(() => {});
      }
    }
  } catch (e) {}
});

// Store notification metadata for click actions
const activeNotificationTabs = new Map(); // notificationId -> { tabId, chatTitle }

// Background-level deduplication cache to block repeated triggers
const recentBackgroundNotifications = new Map(); // key -> timestamp

function isDuplicate(category, chatTitle, body) {
  const normTitle = (chatTitle || '').trim().toLowerCase();
  const cleanBody = (body || '')
    .replace(/^[^:]+:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const key = `${category}:::${normTitle}:::${cleanBody}`;
  const now = Date.now();
  const lastTime = recentBackgroundNotifications.get(key);

  // Suppress rapid repeat duplicates within cooldown
  const cooldown = category === 'MENTION' ? 15000 : 30000;
  if (lastTime && now - lastTime < cooldown) {
    console.log('[WhatsApp Notifier BG] Suppressed duplicate notification:', key);
    return true;
  }

  recentBackgroundNotifications.set(key, now);

  // Clean old entries
  if (recentBackgroundNotifications.size > 200) {
    for (const [k, t] of recentBackgroundNotifications.entries()) {
      if (now - t > 60000) recentBackgroundNotifications.delete(k);
    }
  }
  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRIGGER_NOTIFICATION') {
    handleTriggerNotification(message.payload, sender.tab?.id);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'TEST_NOTIFICATION') {
    handleTestNotification(message.category);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CLEAR_BADGE') {
    unreadBadgeCounter = 0;
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'NAVIGATE_TO_CHAT') {
    openWhatsAppChat(message.chatTitle);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'MARK_CHAT_READ') {
    markChatAsRead(message.chatTitle);
    sendResponse({ success: true });
    return true;
  }
});

async function handleTriggerNotification(payload, senderTabId) {
  const { category, title, body, chatTitle, sender, matchedTag } = payload;

  // Reject any unread badge text
  if (!body || /^\d*\s*unread\s*(message|msg|chat)s?$/i.test(body.trim()) || /^\d+$/.test(body.trim())) {
    return;
  }

  // Deduplication check
  if (isDuplicate(category, chatTitle, body)) {
    return;
  }

  const settings = await chrome.storage.local.get(['notifyDM', 'notifyMention']);
  if (category === 'DM' && settings.notifyDM === false) return;
  if (category === 'MENTION' && settings.notifyMention === false) return;

  const notifId = `wa_${category}_${Date.now()}`;
  if (senderTabId) {
    activeNotificationTabs.set(notifId, { tabId: senderTabId, chatTitle });
  }

  const notifTitle = category === 'MENTION'
    ? `🏷️ [Tagged] ${sender ? `Tagged by ${sender} in ` : 'Tagged in '}${chatTitle}`
    : `💬 [Direct] ${title || chatTitle}`;

  const notifMessage = category === 'MENTION' && sender
    ? `${sender}: ${body}`
    : (body || 'New message on WhatsApp');

  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: notifTitle,
    message: notifMessage,
    priority: 2,
    requireInteraction: false
  });

  // Update extension badge
  updateBadge(category);

  // Update history & stats
  await recordNotificationHistory({
    id: notifId,
    category,
    title,
    body,
    sender: sender || '',
    chatTitle,
    matchedTag: matchedTag || '',
    isLocked: category === 'MENTION',
    unreadCount: payload.unreadCount || 1,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: new Date().toLocaleDateString()
  });
}

async function recordNotificationHistory(entry) {
  const data = await chrome.storage.local.get(['notificationHistory', 'stats']);
  const history = data.notificationHistory || [];
  const normChatKey = (entry.chatTitle || entry.title || '').trim().toLowerCase();

  if (entry.category === 'MENTION') {
    // In group chat: update the existing group card with the latest message containing the added tag!
    const existingGroupIndex = history.findIndex((item) =>
      item.category === 'MENTION' &&
      (item.chatTitle || item.title || '').trim().toLowerCase() === normChatKey
    );

    if (existingGroupIndex !== -1) {
      const existing = history[existingGroupIndex];
      existing.id = entry.id;
      existing.title = entry.title;
      existing.body = entry.body; // Always updated with the last message containing the added tag
      existing.sender = entry.sender || existing.sender;
      existing.matchedTag = entry.matchedTag || existing.matchedTag;
      existing.time = entry.time;
      existing.date = entry.date;
      existing.isRead = false;
      existing.isLocked = true;
      existing.unreadCount = (existing.unreadCount || 0) + 1;

      // Bump this updated group card to the top
      history.splice(existingGroupIndex, 1);
      history.unshift(existing);
    } else {
      // First tagged message for this group: create the locked card
      entry.isLocked = true;
      entry.unreadCount = 1;
      entry.isRead = false;
      history.unshift(entry);
    }
  } else {
    // 1-on-1 Direct Message: update contact card with latest message
    const existingIndex = history.findIndex(
      (item) => item.category === 'DM' && (item.chatTitle || item.title || '').trim().toLowerCase() === normChatKey
    );

    if (existingIndex !== -1) {
      const existing = history[existingIndex];
      existing.id = entry.id;
      existing.title = entry.title;
      existing.body = entry.body;
      existing.time = entry.time;
      existing.date = entry.date;
      existing.isRead = false;
      existing.unreadCount = (existing.unreadCount || 0) + 1;
      history.splice(existingIndex, 1);
      history.unshift(existing);
    } else {
      entry.unreadCount = 1;
      entry.isRead = false;
      history.unshift(entry);
    }
  }

  if (history.length > 50) history.pop();

  const today = new Date().toDateString();
  let stats = data.stats || { dmCount: 0, mentionCount: 0, date: today };
  if (stats.date !== today) {
    stats = { dmCount: 0, mentionCount: 0, date: today };
  }

  if (entry.category === 'MENTION') {
    stats.mentionCount += 1;
  } else {
    stats.dmCount += 1;
  }

  await chrome.storage.local.set({ notificationHistory: history, stats });

  // Broadcast to popup if open for instant live update
  chrome.runtime.sendMessage({ type: 'NEW_NOTIFICATION_RECEIVED', payload: entry }).catch(() => {});
}

let unreadBadgeCounter = 0;
function updateBadge(category) {
  unreadBadgeCounter += 1;
  chrome.action.setBadgeText({ text: String(unreadBadgeCounter) });
  chrome.action.setBadgeBackgroundColor({
    color: category === 'MENTION' ? '#FF6B00' : '#25D366'
  });
}

// Mark a chat as read in notification history
async function markChatAsRead(chatTitle) {
  if (!chatTitle) return;
  const normKey = chatTitle.trim().toLowerCase();
  const data = await chrome.storage.local.get(['notificationHistory']);
  const history = data.notificationHistory || [];
  let updated = false;

  for (const item of history) {
    const itemKey = (item.chatTitle || item.title || '').trim().toLowerCase();
    if (itemKey === normKey || (itemKey && (normKey.includes(itemKey) || itemKey.includes(normKey)))) {
      item.isRead = true;
      item.unreadCount = 0;
      updated = true;
    }
  }

  if (updated) {
    await chrome.storage.local.set({ notificationHistory: history });
    chrome.runtime.sendMessage({ type: 'CHAT_MARKED_READ', chatTitle }).catch(() => {});
  }
}

// Open & focus WhatsApp Web tab, then command it to open the specific chat
async function openWhatsAppChat(chatTitle) {
  try {
    if (chatTitle) {
      await markChatAsRead(chatTitle);
    }

    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    let targetTab = null;

    if (tabs.length > 0) {
      targetTab = tabs[0];
      await chrome.windows.update(targetTab.windowId, { focused: true });
      await chrome.tabs.update(targetTab.id, { active: true });
    } else {
      targetTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
      return;
    }

    if (targetTab?.id && chatTitle) {
      // Send OPEN_CHAT with retry in case tab is waking up from idle
      const sendOpen = () => {
        chrome.tabs.sendMessage(targetTab.id, {
          type: 'OPEN_CHAT',
          chatTitle: chatTitle
        }).catch(() => {});
      };

      sendOpen();
      setTimeout(sendOpen, 300);
    }
  } catch (err) {
    console.error('[WhatsApp Notifier BG] Failed to open chat:', err);
  }
}

// Notification Click Handler: Focus WhatsApp tab and open the chat
chrome.notifications.onClicked.addListener(async (notifId) => {
  chrome.notifications.clear(notifId);
  unreadBadgeCounter = 0;
  chrome.action.setBadgeText({ text: '' });

  const settings = await chrome.storage.local.get(['focusTabOnClick']);
  if (settings.focusTabOnClick === false) return;

  const meta = activeNotificationTabs.get(notifId);
  activeNotificationTabs.delete(notifId);

  await openWhatsAppChat(meta?.chatTitle);
});

chrome.notifications.onClosed.addListener((notifId) => {
  activeNotificationTabs.delete(notifId);
});

// Test Notification Generator
function handleTestNotification(category = 'DM') {
  if (category === 'MENTION') {
    handleTriggerNotification(
      {
        category: 'MENTION',
        title: 'Tagged in "Project Alpha Group"',
        body: 'Alice: @you Can you please review the latest sprint updates?',
        chatTitle: 'Project Alpha Group'
      },
      null
    );
  } else {
    handleTriggerNotification(
      {
        category: 'DM',
        title: 'Direct Message from Sarah Connor',
        body: 'Hey! Are you available for a quick call right now?',
        chatTitle: 'Sarah Connor'
      },
      null
    );
  }
}
