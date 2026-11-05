/**
 * WhatsApp Direct & Mention Notifier - Content Script
 * Robust DOM observer for WhatsApp Web with strict Group vs DM classification,
 * strict user-defined mention targeting (ONLY triggers if matching names added in popup),
 * and zero false alerts on chat visits.
 */

(() => {
  // If an older instance was injected in this page, clean it up first
  if (typeof window.__WA_NOTIFIER_CLEANUP__ === 'function') {
    try {
      window.__WA_NOTIFIER_CLEANUP__();
    } catch (e) {}
  }

  console.log('[WhatsApp Notifier] Content script loaded on', window.location.href);

  // Configuration state
  let config = {
    notifyDM: true,
    notifyMention: true,
    playAudio: true,
    notifyWhenFocused: true,
    customKeywords: []
  };

  // State tracking
  const chatStateMap = new Map();       // chatTitle -> { unreadCount, lastSnippet, lastNotifiedSnippet, isGroup }
  const seenBubbleIds = new Set();      // data-id of processed message bubbles
  const notifiedSignatures = new Map(); // signature -> timestamp
  const knownGroupTitles = new Set();   // Confirmed group chat titles (one-way dynamic promotion)

  let isTabFocused = document.hasFocus();
  let isInitialBaselineDone = false;
  let currentActiveChatTitle = '';
  let chatSwitchTimestamp = 0;

  window.addEventListener('focus', () => { isTabFocused = true; });
  window.addEventListener('blur', () => { isTabFocused = false; });

  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  // Load initial settings
  if (isExtensionValid()) {
    try {
      chrome.storage.local.get(['notifyDM', 'notifyMention', 'playAudio', 'notifyWhenFocused', 'customKeywords'], (res) => {
        if (!res) return;
        if (res.notifyDM !== undefined) config.notifyDM = res.notifyDM;
        if (res.notifyMention !== undefined) config.notifyMention = res.notifyMention;
        if (res.playAudio !== undefined) config.playAudio = res.playAudio;
        if (res.notifyWhenFocused !== undefined) config.notifyWhenFocused = res.notifyWhenFocused;
        if (Array.isArray(res.customKeywords)) config.customKeywords = res.customKeywords;
        console.log('[WhatsApp Notifier] Initial keywords loaded:', config.customKeywords);
      });
    } catch (e) {}
  }

  // Listen for configuration updates from popup
  function handleStorageChange(changes, area) {
    if (area !== 'local') return;
    if (!isExtensionValid()) {
      stopAllObservation();
      return;
    }

    if (changes.notifyDM) config.notifyDM = changes.notifyDM.newValue;
    if (changes.notifyMention) config.notifyMention = changes.notifyMention.newValue;
    if (changes.playAudio) config.playAudio = changes.playAudio.newValue;
    if (changes.notifyWhenFocused) config.notifyWhenFocused = changes.notifyWhenFocused.newValue;
    if (changes.customKeywords) {
      config.customKeywords = changes.customKeywords.newValue || [];
      console.log('[WhatsApp Notifier] Updated custom keywords list:', config.customKeywords);
      // Immediately clear deduplication cache so newly saved tags detect right away!
      notifiedSignatures.clear();
      seenBubbleIds.clear();
      for (const [title, state] of chatStateMap.entries()) {
        state.lastNotifiedSnippet = '';
      }
      scheduleScan();
    }
  }

  if (isExtensionValid() && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }

  // Inject in-page notification interceptor hook
  function injectPageHook() {
    if (!isExtensionValid()) return;
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
      console.log('[WhatsApp Notifier] Injected native notification hook.');
    } catch (e) {
      console.warn('[WhatsApp Notifier] Failed injecting page hook:', e);
    }
  }

  injectPageHook();

  // Listen to hooked native notifications from injected.js
  function handleWindowMessage(event) {
    if (event.data && event.data.source === 'WA_NOTIFIER_PAGE_HOOK') {
      const { title, body, tag, isGroupHint } = event.data;
      if (!body) return;
      const cleanBody = cleanUnicode(body);
      const cleanTitle = cleanUnicode(title);
      if (!isValidMessageSnippet(cleanBody)) return;

      const parsed = splitSenderAndMessage(cleanBody);

      // Determine if it is a group:
      // 1. Explicit JID hint from injected page hook (e.g. tag contains @g.us)
      // 2. Already confirmed in knownGroupTitles
      // 3. Sender prefix parsed ("Sender: Message")
      // 4. Characteristic group metadata phrases
      let isGrp = false;
      if (isGroupHint === true) {
        isGrp = true;
      } else if (isGroupHint === false) {
        isGrp = false;
      } else {
        isGrp =
          knownGroupTitles.has(cleanTitle) ||
          parsed.hasPrefix ||
          /is also in this group|in this group|\b\d+\s+members\b|group\s+notification/i.test(cleanBody) ||
          (tag && String(tag).includes('@g.us'));
      }

      if (isGrp) {
        knownGroupTitles.add(cleanTitle);
        // Only trigger if message specifically matches a saved tag in user's list
        const msgToCheck = parsed.hasPrefix ? parsed.message : cleanBody;
        const matchedTag = findMatchingTag(msgToCheck) || findMatchingTag(cleanBody);
        if (matchedTag) {
          dispatchNotification({
            category: 'MENTION',
            title: `Tagged in ${cleanTitle}`,
            sender: parsed.hasPrefix ? parsed.sender : '',
            body: msgToCheck,
            chatTitle: cleanTitle,
            matchedTag
          });
        }
      } else {
        // Direct message
        // Verify with existing chat state to avoid misfiring if sidebar marked it group
        const existingState = chatStateMap.get(cleanTitle);
        if (existingState && existingState.isGroup) {
          return;
        }

        if (config.notifyDM) {
          dispatchNotification({
            category: 'DM',
            title: `Direct Message from ${cleanTitle}`,
            sender: cleanTitle,
            body: cleanBody,
            chatTitle: cleanTitle
          });
        }
      }
    }
  }

  window.addEventListener('message', handleWindowMessage);

  if (isExtensionValid() && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'PING') {
        sendResponse({
          status: 'ACTIVE',
          monitoredChats: chatStateMap.size,
          groupsCount: knownGroupTitles.size,
          url: window.location.href,
          isFocused: isTabFocused
        });
        return true;
      }

      if (message.type === 'OPEN_CHAT') {
        const opened = openChat(message.chatTitle);
        sendResponse({ success: opened });
        return true;
      }
    });
  }

  /**
   * Cleans text: removes invisible directional marks and normalizes all Unicode spaces
   */
  function cleanUnicode(raw) {
    if (!raw) return '';
    return raw
      .replace(/[\u200B-\u200D\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')
      .trim();
  }

  function escapeRegex(str) {
    return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Finds the exact saved tag/keyword from the user's list that matches the message.
   * Returns the matched keyword string if found, or null if no match.
   * ZERO heuristics: only returns non-null if strictly matching an item in config.customKeywords!
   */
  function findMatchingTag(text, bubbleElement) {
    const userKeywords = Array.isArray(config.customKeywords)
      ? config.customKeywords.map((k) => (k || '').trim()).filter(Boolean)
      : [];

    if (userKeywords.length === 0 || (!text && !bubbleElement)) {
      return null;
    }

    const cleanMsg = cleanUnicode(text || '').toLowerCase();

    for (const rawKw of userKeywords) {
      const kw = cleanUnicode(rawKw).toLowerCase().trim();
      if (!kw) continue;

      const rawTerm = kw.replace(/^@/, '').trim();
      if (!rawTerm) continue;

      // 1. Tag match with '@': e.g. "@Shahid" or "@Shahid Imam"
      if (cleanMsg.includes(`@${rawTerm}`)) {
        return rawKw;
      }

      // 2. Direct name or phone phrase match
      if (rawTerm.includes(' ') || /^\+?\d+$/.test(rawTerm)) {
        if (cleanMsg.includes(rawTerm)) {
          return rawKw;
        }
      } else {
        const regex = new RegExp(`(^|[\\s@.,!?:;()\\[\\]{}"'\\/\\-])${escapeRegex(rawTerm)}([\\s.,!?:;()\\[\\]{}"'\\/\\-]|$)`, 'i');
        if (regex.test(cleanMsg)) {
          return rawKw;
        }
      }

      // 3. Check inside mention DOM nodes in active chat bubble if present
      if (bubbleElement) {
        const mentionNodes = bubbleElement.querySelectorAll(
          'span.matched-mention, span[data-testid="mentioned-jid"], a[data-mention-jid], span[class*="matched-mention"]'
        );
        for (const node of mentionNodes) {
          const nodeText = cleanUnicode(node.textContent || '').toLowerCase().replace(/^@/, '').trim();
          if (nodeText === rawTerm || (rawTerm.length >= 3 && (nodeText.includes(rawTerm) || rawTerm.includes(nodeText)))) {
            return rawKw;
          }
        }
      }
    }

    return null;
  }

  /**
   * Validates that a string is a real message snippet, NOT an unread count badge or timestamp.
   */
  function isValidMessageSnippet(text) {
    if (!text) return false;
    const clean = cleanUnicode(text).trim().toLowerCase();
    if (!clean) return false;

    // Reject unread count / badge accessibility text like "3 unread messages", "unread message"
    if (/^\d*\s*unread\s*(message|msg|chat)s?$/i.test(clean)) return false;
    if (/^unread\s*(message|msg|chat)s?$/i.test(clean)) return false;
    if (/^\d+$/.test(clean)) return false; // Just a standalone number like "3"
    if (/^\d{1,2}:\d{2}(\s*[ap]m)?$/i.test(clean)) return false; // Just a timestamp like "00:11"

    return true;
  }

  function normalizeSnippet(raw) {
    return cleanUnicode(raw)
      .replace(/^[^:：\n]+[:：]\s*/, '') // Remove sender prefix if present
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  /**
   * Parses sender and message from snippet
   */
  function splitSenderAndMessage(raw) {
    const clean = cleanUnicode(raw);
    const match = clean.match(/^([^:：\n]{1,40})\s*[:：]\s*(.+)$/s);
    if (match) {
      return {
        hasPrefix: true,
        sender: match[1].trim(),
        message: match[2].trim()
      };
    }
    return {
      hasPrefix: false,
      sender: '',
      message: clean
    };
  }

  /**
   * Extracts sender and message by inspecting DOM card lines (colon separator)
   * or falling back to text snippet parsing.
   */
  function extractSenderAndMessage(rawSnippet, rowElement) {
    if (rowElement) {
      const cardText = rowElement.innerText || '';
      const lines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);
      const colonIndex = lines.indexOf(':') !== -1 ? lines.indexOf(':') : lines.indexOf('：');
      if (colonIndex > 0 && colonIndex < lines.length - 1) {
        const sender = lines[colonIndex - 1];
        const message = lines.slice(colonIndex + 1).join(' ').trim();
        if (sender && !sender.toLowerCase().includes('draft') && sender.length <= 50) {
          return {
            hasPrefix: true,
            sender: cleanUnicode(sender),
            message: cleanUnicode(message)
          };
        }
      }
    }

    return splitSenderAndMessage(rawSnippet);
  }

  /**
   * Determines if a chat is a Group.
   * Multi-layered heuristic detection:
   * 1. Confirmed cache (knownGroupTitles)
   * 2. Group SVG / Status icons
   * 3. Group metadata phrases in card text ("in this group", "members")
   * 4. Multi-line structure (Sender -> Colon ':' -> Message)
   * 5. Secondary container preview spans with colon
   * 6. Fallback snippet prefix parsing ("Sender: Message")
   */
  function detectIsGroup(chatTitle, rowElement, rawSnippet) {
    const normTitle = (chatTitle || '').trim();
    if (knownGroupTitles.has(normTitle)) return true;

    if (rowElement) {
      // 1. Group / Community / Channel / Mention SVG icons anywhere in chat row
      const groupIcon =
        rowElement.querySelector('[data-icon="default-group"]') ||
        rowElement.querySelector('[data-icon="community"]') ||
        rowElement.querySelector('[data-icon="community-group"]') ||
        rowElement.querySelector('[data-icon="avatar-group"]') ||
        rowElement.querySelector('[data-icon="newsletter"]') ||
        rowElement.querySelector('[data-icon="channel"]') ||
        rowElement.querySelector('[data-icon*="group"]') ||
        rowElement.querySelector('[data-icon*="community"]') ||
        rowElement.querySelector('[data-icon="status-mention"]') ||
        rowElement.querySelector('[data-icon*="mention"]');

      if (groupIcon) {
        knownGroupTitles.add(normTitle);
        return true;
      }

      const cardText = rowElement.innerText || rowElement.textContent || '';

      // 2. Metadata text phrases strictly found only in groups
      if (/is also in this group|in this group|\b\d+\s+members\b|group\s+notification/i.test(cardText)) {
        knownGroupTitles.add(normTitle);
        return true;
      }

      // 3. Line-based sender prefix inspection
      // WhatsApp Web renders sender name, colon ':', and preview text as separate lines
      const lines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);
      const colonIndex = lines.indexOf(':') !== -1 ? lines.indexOf(':') : lines.indexOf('：');
      if (colonIndex > 0) {
        const potentialSender = lines[colonIndex - 1];
        if (potentialSender && !potentialSender.toLowerCase().includes('draft') && potentialSender.length <= 50) {
          knownGroupTitles.add(normTitle);
          return true;
        }
      }

      // 4. Secondary preview container inspection (colon span)
      const secondary =
        rowElement.querySelector('div[data-testid="cell-frame-secondary"]') ||
        rowElement.querySelector('div[role="gridcell"]:last-child') ||
        rowElement.querySelector('div._ak8l') ||
        rowElement;

      if (secondary) {
        const spans = Array.from(secondary.querySelectorAll('span'));
        const hasColonSpan = spans.some((s) => s.textContent.trim() === ':' || s.textContent.trim() === '：');
        if (hasColonSpan) {
          knownGroupTitles.add(normTitle);
          return true;
        }
      }
    }

    // 5. Snippet text prefix check ("Sender: Message")
    if (rawSnippet) {
      const parsed = splitSenderAndMessage(rawSnippet);
      if (parsed.hasPrefix && parsed.sender.toLowerCase() !== 'draft') {
        knownGroupTitles.add(normTitle);
        return true;
      }
    }

    return false;
  }

  /**
   * Deduplication check:
   * Returns true if this exact message has already been notified within cooldown.
   */
  function isAlreadyNotified(chatTitle, snippet) {
    const normTitle = (chatTitle || '').trim().toLowerCase();
    const normSnippet = normalizeSnippet(snippet);
    if (!normSnippet) return true;

    const key = `${normTitle}:::${normSnippet}`;
    const now = Date.now();
    const lastTime = notifiedSignatures.get(key);

    if (lastTime && now - lastTime < 15000) {
      return true;
    }

    notifiedSignatures.set(key, now);

    if (notifiedSignatures.size > 200) {
      for (const [k, t] of notifiedSignatures.entries()) {
        if (now - t > 30000) notifiedSignatures.delete(k);
      }
    }
    return false;
  }

  function dispatchNotification({ category, title, body, chatTitle, unreadCount, sender, matchedTag }) {
    if (!isExtensionValid()) {
      stopAllObservation();
      return;
    }

    if (isTabFocused && !config.notifyWhenFocused && category !== 'MENTION') {
      return;
    }

    if (isAlreadyNotified(chatTitle, body)) {
      return;
    }

    console.log(`[WhatsApp Notifier] >>> DISPATCHING ${category} ALERT:`, title, '->', body, `(Tag: ${matchedTag})`);

    if (config.playAudio && typeof window.playNotificationChime === 'function') {
      try {
        window.playNotificationChime(category);
      } catch (e) {}
    }

    try {
      chrome.runtime.sendMessage({
        type: 'TRIGGER_NOTIFICATION',
        payload: {
          category,
          title,
          body,
          sender: sender || '',
          chatTitle,
          unreadCount: unreadCount || 1,
          matchedTag: matchedTag || '',
          timestamp: Date.now()
        }
      }).catch((err) => {
        if (err && err.message && err.message.includes('Extension context invalidated')) {
          stopAllObservation();
        }
      });
    } catch (err) {
      if (err && err.message && err.message.includes('Extension context invalidated')) {
        stopAllObservation();
      }
    }
  }

  // ==========================================
  // Direct Chat Navigation
  // ==========================================

  function openChat(chatTitle) {
    if (!chatTitle) return false;
    const target = cleanUnicode(chatTitle).trim().toLowerCase();
    console.log(`[WhatsApp Notifier] Attempting to open chat: "${chatTitle}" (target: "${target}")`);

    const pane =
      document.querySelector('#pane-side') ||
      document.querySelector('div[aria-label="Chat list"]') ||
      document.querySelector('div[role="grid"]');

    if (!pane) {
      console.warn('[WhatsApp Notifier] Chat list pane not found');
      return false;
    }

    function clickTarget(el) {
      if (!el) return;
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {}

      const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      events.forEach((name) => {
        try {
          el.dispatchEvent(
            new MouseEvent(name, {
              bubbles: true,
              cancelable: true,
              view: window,
              buttons: 1
            })
          );
        } catch (e) {}
      });

      if (typeof el.click === 'function') {
        try {
          el.click();
        } catch (e) {}
      }
    }

    // 1. Search by title attribute in pane (exact or substring match)
    const titleElements = Array.from(pane.querySelectorAll('span[title], div[title]'));
    for (const el of titleElements) {
      const rawTitle = cleanUnicode(el.getAttribute('title') || '').trim().toLowerCase();
      if (rawTitle === target || (target.length >= 3 && rawTitle.includes(target))) {
        const row =
          el.closest('div[role="listitem"], div[role="row"], div[data-testid^="list-item-"], div[tabindex="-1"]') ||
          el.closest('div._ak72') ||
          el;
        console.log('[WhatsApp Notifier] Matched chat title attribute:', rawTitle);
        clickTarget(el);
        clickTarget(row);
        return true;
      }
    }

    // 2. Search inside row items by text content
    const rows = Array.from(
      pane.querySelectorAll('div[role="listitem"], div[role="row"], div[data-testid^="list-item-"], div[tabindex="-1"]')
    );

    for (const row of rows) {
      const titleEl =
        row.querySelector('span[title]') ||
        row.querySelector('div._ak8q span') ||
        row.querySelector('span[dir="auto"]');

      if (titleEl) {
        const text = cleanUnicode(titleEl.getAttribute('title') || titleEl.textContent || '').trim().toLowerCase();
        if (text === target || (target.length >= 3 && text.includes(target))) {
          console.log('[WhatsApp Notifier] Matched chat row text:', text);
          clickTarget(titleEl);
          clickTarget(row);
          return true;
        }
      }
    }

    // 3. Fallback: Search box in WhatsApp Web if chat is scrolled out of virtualized DOM
    const searchInput =
      document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
      document.querySelector('div[data-testid="chat-list-search"] input') ||
      document.querySelector('input[data-tab="3"]') ||
      document.querySelector('input[type="text"]');

    if (searchInput) {
      console.log('[WhatsApp Notifier] Triggering search bar for:', chatTitle);
      searchInput.focus();
      if (searchInput.tagName === 'INPUT') {
        searchInput.value = chatTitle;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        searchInput.textContent = chatTitle;
        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: chatTitle }));
      }

      setTimeout(() => {
        const firstResult =
          pane.querySelector('div[role="listitem"]') ||
          pane.querySelector('div[role="row"]') ||
          pane.querySelector('div[data-testid^="list-item-"]');
        if (firstResult) {
          clickTarget(firstResult);
        }
      }, 350);
      return true;
    }

    return false;
  }

  // ==========================================
  // DOM Observer for WhatsApp Web Chat List
  // ==========================================

  function parseChatRow(row) {
    // 1. Extract Chat Title
    let title = '';
    const titleEl =
      row.querySelector('span[title]') ||
      row.querySelector('div[role="gridcell"] span[title]') ||
      row.querySelector('div._ak8q span[dir="auto"]') ||
      row.querySelector('span[dir="auto"]');

    if (titleEl) {
      title = titleEl.getAttribute('title') || titleEl.textContent || '';
    }
    title = title.trim();
    if (!title || title.toLowerCase().includes('click here')) return null;

    // 2. Extract Unread Badge & Count
    let unreadCount = 0;
    const unreadEl =
      row.querySelector('span[aria-label*="unread" i]') ||
      row.querySelector('span[aria-label*="unread message" i]') ||
      row.querySelector('[data-testid="icon-unread-count"]');

    if (unreadEl) {
      const label = unreadEl.getAttribute('aria-label') || '';
      const text = unreadEl.textContent.trim();
      const match = label.match(/\d+/) || text.match(/\d+/);
      unreadCount = match ? parseInt(match[0], 10) : 1;
    }

    // 3. Extract Message Snippet (Strictly excluding badges, counts, and timestamps)
    let snippet = '';
    const secondaryContainer =
      row.querySelector('div[data-testid="cell-frame-secondary"]') ||
      row.querySelector('div._ak8l') ||
      row.querySelector('div[role="gridcell"]:last-child') ||
      row;

    const textEl =
      secondaryContainer.querySelector('span[data-testid="last-msg-text"]') ||
      secondaryContainer.querySelector('span._ao3e') ||
      secondaryContainer.querySelector('span[dir="ltr"]') ||
      secondaryContainer.querySelector('span[dir="auto"]') ||
      secondaryContainer;

    if (textEl) {
      const clone = textEl.cloneNode(true);
      clone.querySelectorAll('span[aria-label*="unread" i], [data-testid="icon-unread-count"], svg, [data-icon]').forEach((n) => n.remove());
      const rawText = cleanUnicode(clone.textContent || '');
      if (isValidMessageSnippet(rawText)) {
        snippet = rawText;
      }
    }

    if (!isValidMessageSnippet(snippet)) {
      snippet = '';
    }

    // 4. Classify Group vs 1-on-1 (Direct)
    const isGroup = detectIsGroup(title, row, snippet);

    // 5. Detect Mention: ONLY AND EXCLUSIVELY when the message text matches a keyword in user's list!
    // Never auto-detect or guess from icons.
    let hasMentionForMe = false;
    let matchedSavedTag = '';
    if (isGroup && snippet) {
      const isOutbound = !!row.querySelector('[data-icon^="status-vcheck"], [data-icon^="status-dblcheck"], [data-icon="status-time"]');
      if (!isOutbound) {
        const parsed = extractSenderAndMessage(snippet, row);
        // Test message body, full snippet, and card text against user's saved list
        const textToTest = parsed.hasPrefix ? parsed.message : snippet;
        const matched = findMatchingTag(textToTest) || findMatchingTag(snippet) || findMatchingTag(row.innerText || '');
        if (matched) {
          hasMentionForMe = true;
          matchedSavedTag = matched;
        }
      }
    }

    return {
      title,
      unreadCount,
      hasMention: hasMentionForMe,
      matchedTag: matchedSavedTag,
      snippet,
      isGroup
    };
  }

  function scanChatList() {
    const pane =
      document.querySelector('#pane-side') ||
      document.querySelector('div[aria-label="Chat list"]') ||
      document.querySelector('div[role="grid"]');

    if (!pane) return;

    const rows = pane.querySelectorAll('div[role="listitem"], div[role="row"], div[data-testid^="list-item-"], div[tabindex="-1"]');
    if (!rows.length) return;

    // First scan creates baseline without alerting
    if (!isInitialBaselineDone) {
      for (const row of rows) {
        const data = parseChatRow(row);
        if (!data) continue;
        // If an unread chat already contains an explicit mention of user's saved tag, allow it to notify!
        const shouldAlertOnStartup = data.unreadCount > 0 && data.hasMention;
        chatStateMap.set(data.title, {
          unreadCount: data.unreadCount,
          lastSnippet: data.snippet,
          lastNotifiedSnippet: shouldAlertOnStartup ? '' : data.snippet,
          isGroup: data.isGroup
        });
      }
      isInitialBaselineDone = true;
      console.log(`[WhatsApp Notifier] Baseline established for ${chatStateMap.size} visible chats.`);
      return;
    }

    // Subsequent scans check for genuinely new unread messages
    for (const row of rows) {
      const data = parseChatRow(row);
      if (!data) continue;

      const previous = chatStateMap.get(data.title);
      const prevNotified = previous ? previous.lastNotifiedSnippet : '';
      const prevUnread = previous ? previous.unreadCount : 0;

      // Only check unread messages
      if (data.unreadCount > 0 && data.snippet) {
        if (data.isGroup) {
          // Group chat: ONLY notify if it is a MENTION / TAG strictly matching user's list
          if (data.hasMention && config.notifyMention) {
            const isSnippetNew = normalizeSnippet(data.snippet) !== normalizeSnippet(prevNotified);
            if (isSnippetNew) {
              const parsed = extractSenderAndMessage(data.snippet, row);
              dispatchNotification({
                category: 'MENTION',
                title: `Tagged in ${data.title}`,
                sender: parsed.hasPrefix ? parsed.sender : '',
                body: parsed.hasPrefix ? parsed.message : data.snippet,
                chatTitle: data.title,
                unreadCount: data.unreadCount,
                matchedTag: data.matchedTag || ''
              });

              chatStateMap.set(data.title, {
                unreadCount: data.unreadCount,
                lastSnippet: data.snippet,
                lastNotifiedSnippet: data.snippet,
                isGroup: true
              });
              continue;
            }
          }
        } else {
          // 1-on-1 Direct Message
          // Re-verify the row element to catch any newly rendered group markers before alerting
          const recheckedIsGroup = detectIsGroup(data.title, row, data.snippet);
          if (recheckedIsGroup) {
            // Promoted to group: do not dispatch false DM alert!
            chatStateMap.set(data.title, {
              unreadCount: data.unreadCount,
              lastSnippet: data.snippet,
              lastNotifiedSnippet: data.snippet,
              isGroup: true
            });
            continue;
          }

          const isContentNew = normalizeSnippet(data.snippet) !== normalizeSnippet(prevNotified);
          const isCountIncremented = data.unreadCount > prevUnread;

          if (isContentNew && (isCountIncremented || !previous || data.snippet !== previous.lastSnippet)) {
            if (config.notifyDM) {
              dispatchNotification({
                category: 'DM',
                title: `Direct Message from ${data.title}`,
                sender: data.title,
                body: data.snippet,
                chatTitle: data.title,
                unreadCount: data.unreadCount
              });
            }

            chatStateMap.set(data.title, {
              unreadCount: data.unreadCount,
              lastSnippet: data.snippet,
              lastNotifiedSnippet: data.snippet,
              isGroup: false
            });
            continue;
          }
        }
      }

      // If unread count became 0, sync read status to extension
      if (previous && data.unreadCount === 0 && previous.unreadCount > 0) {
        if (isExtensionValid()) {
          try {
            chrome.runtime.sendMessage({ type: 'MARK_CHAT_READ', chatTitle: data.title }).catch(() => {});
          } catch (e) {}
        }
      }

      chatStateMap.set(data.title, {
        unreadCount: data.unreadCount,
        lastSnippet: data.snippet,
        lastNotifiedSnippet: prevNotified,
        isGroup: data.isGroup
      });
    }
  }

  // ==========================================
  // Monitor Active Conversation Window (#main)
  // ==========================================

  function extractActiveChatHeaderTitle(header) {
    if (!header) return '';
    const titleCandidates = header.querySelectorAll('span[dir="auto"], span[title]');
    for (const el of titleCandidates) {
      const text = (el.getAttribute('title') || el.textContent || '').trim();
      const lower = text.toLowerCase();
      if (text && !lower.includes('click here') && !lower.includes('contact info') && !lower.includes('group info') && !lower.includes('online')) {
        return text;
      }
    }
    return '';
  }

  function scanActiveChatPanel() {
    const main = document.querySelector('#main');
    if (!main) return;

    const header = main.querySelector('header');
    if (!header) return;

    const chatTitle = extractActiveChatHeaderTitle(header);
    if (!chatTitle) return;

    // Detect group
    const subtitleEl = header.querySelector('span[title*=","]') || header.querySelector('div[role="button"] ~ div span');
    const subtitleText = subtitleEl ? subtitleEl.textContent : '';
    const hasGroupSubtitle = subtitleText.includes(',') || subtitleText.toLowerCase().includes('group') || subtitleText.toLowerCase().includes('click here');
    const hasGroupIcon = main.querySelector('[data-icon="default-group"]') !== null;
    const hasAuthorHeaderInChat = main.querySelector('div[data-testid="author"], span[aria-label][dir="auto"], span.color-1, span.color-2, span.color-3, span.color-4') !== null;

    if (hasGroupSubtitle || hasGroupIcon || hasAuthorHeaderInChat) {
      knownGroupTitles.add(chatTitle);
    }

    // 1. When switching / visiting a chat: absorb existing messages without alerting and mark read
    if (chatTitle !== currentActiveChatTitle) {
      currentActiveChatTitle = chatTitle;
      chatSwitchTimestamp = Date.now();
      if (isExtensionValid()) {
        try {
          chrome.runtime.sendMessage({ type: 'MARK_CHAT_READ', chatTitle }).catch(() => {});
        } catch (e) {}
      }
      const existing = main.querySelectorAll('div.message-in, div[data-testid="msg-container"]');
      existing.forEach((b) => {
        const id = b.getAttribute('data-id') || b.textContent.trim().slice(0, 50);
        if (id) seenBubbleIds.add(id);
      });
      return;
    }

    // 2. Suppress historical messages during chat load
    if (Date.now() - chatSwitchTimestamp < 1500) {
      const existing = main.querySelectorAll('div.message-in, div[data-testid="msg-container"]');
      existing.forEach((b) => {
        const id = b.getAttribute('data-id') || b.textContent.trim().slice(0, 50);
        if (id) seenBubbleIds.add(id);
      });
      return;
    }

    // 3. Active window only monitors for groups
    if (!knownGroupTitles.has(chatTitle)) {
      return;
    }

    // 4. In a group: Monitor ONLY for incoming messages specifically matching user-added identifiers
    const incomingBubbles = main.querySelectorAll('div.message-in, div[data-testid="msg-container"]');
    if (!incomingBubbles.length) return;

    const latestBubble = incomingBubbles[incomingBubbles.length - 1];
    if (!latestBubble) return;

    const bubbleId = latestBubble.getAttribute('data-id') || `${chatTitle}_${latestBubble.textContent.trim().slice(0, 50)}`;
    if (seenBubbleIds.has(bubbleId)) {
      return;
    }
    seenBubbleIds.add(bubbleId);

    // Keep seen set bounded
    if (seenBubbleIds.size > 500) {
      const arr = Array.from(seenBubbleIds);
      arr.slice(0, 100).forEach((id) => seenBubbleIds.delete(id));
    }

    // Outbound message sent by this user
    if (latestBubble.classList.contains('message-out')) {
      return;
    }

    // Extract text
    const textContainer =
      latestBubble.querySelector('div.copyable-text') ||
      latestBubble.querySelector('span.selectable-text') ||
      latestBubble;

    let messageText = cleanUnicode(textContainer.textContent || latestBubble.textContent || '');
    messageText = messageText.replace(/\s*\d{1,2}:\d{2}(\s*[ap]m)?\s*$/i, '').trim();
    if (!messageText) return;

    // Check if this new incoming bubble specifically matches one of the user's explicit keywords
    const matchedTag = findMatchingTag(messageText, latestBubble);

    if (matchedTag && config.notifyMention) {
      let senderName = 'Someone';
      let cur = latestBubble;
      while (cur && cur.classList && (cur.classList.contains('message-in') || cur.getAttribute('data-testid') === 'msg-container')) {
        const authorEl =
          cur.querySelector('div[data-testid="author"]') ||
          cur.querySelector('span[aria-label][dir="auto"]') ||
          cur.querySelector('span[class*="color-"]');
        if (authorEl && authorEl.textContent.trim()) {
          senderName = authorEl.textContent.trim();
          break;
        }
        cur = cur.previousElementSibling;
      }

      dispatchNotification({
        category: 'MENTION',
        title: `Tagged in ${chatTitle}`,
        sender: senderName,
        body: messageText,
        chatTitle: chatTitle,
        matchedTag
      });
    }
  }

  // ==========================================
  // Throttled Observer
  // ==========================================

  let scanTimer = null;
  let periodicTimer = null;

  function stopAllObservation() {
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    try {
      if (observer) observer.disconnect();
    } catch (e) {}
    try {
      window.removeEventListener('message', handleWindowMessage);
    } catch (e) {}
  }

  // Register cleanup function on window so any subsequent script injection cleans up this one
  window.__WA_NOTIFIER_CLEANUP__ = stopAllObservation;

  function scheduleScan() {
    if (!isExtensionValid()) {
      stopAllObservation();
      return;
    }

    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!isExtensionValid()) {
        stopAllObservation();
        return;
      }
      try {
        scanChatList();
        scanActiveChatPanel();
      } catch (err) {
        if (err && err.message && err.message.includes('Extension context invalidated')) {
          stopAllObservation();
          return;
        }
        console.error('[WhatsApp Notifier] Scan error:', err);
      }
    }, 350);
  }

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  function startObserving() {
    if (!isExtensionValid()) return;
    const root = document.querySelector('#app') || document.body;
    if (root) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-label', 'data-icon', 'class', 'title']
      });
      console.log('[WhatsApp Notifier] Observer attached to DOM.');
      scheduleScan();
    } else {
      setTimeout(startObserving, 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }

  periodicTimer = setInterval(() => {
    if (!isExtensionValid()) {
      stopAllObservation();
      return;
    }
    scheduleScan();
  }, 2500);
})();
