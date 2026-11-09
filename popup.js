/**
 * WhatsApp Direct & Mention Notifier - Popup Controller
 * Real-time live update for notifications while popup is open.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  const toggleAudio = document.getElementById('toggleAudio');

  const keywordInput = document.getElementById('keywordInput');
  const addKeywordBtn = document.getElementById('addKeywordBtn');
  const keywordsContainer = document.getElementById('keywordsContainer');

  const mutedContactInput = document.getElementById('mutedContactInput');
  const addMutedContactBtn = document.getElementById('addMutedContactBtn');
  const mutedContactsContainer = document.getElementById('mutedContactsContainer');

  const historyList = document.getElementById('historyList');
  const emptyHistory = document.getElementById('emptyHistory');
  const clearContainer = document.getElementById('clearContainer');

  const btnSettingsToggle = document.getElementById('btnSettingsToggle');
  const btnBackToActivity = document.getElementById('btnBackToActivity');
  const activityView = document.getElementById('activityView');
  const settingsView = document.getElementById('settingsView');

  // Toggle Settings View
  function showSettings() {
    if (activityView && settingsView) {
      activityView.style.display = 'none';
      settingsView.style.display = 'flex';
    }
  }

  function showActivity() {
    if (activityView && settingsView) {
      settingsView.style.display = 'none';
      activityView.style.display = 'block';
    }
  }

  if (btnSettingsToggle) {
    btnSettingsToggle.addEventListener('click', () => {
      if (settingsView.style.display === 'none') {
        showSettings();
      } else {
        showActivity();
      }
    });
  }

  if (btnBackToActivity) {
    btnBackToActivity.addEventListener('click', showActivity);
  }

  let currentKeywords = [];
  let currentMutedContacts = [];
  let cachedHistory = [];

  // Clear extension badge when popup opens
  chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });

  // Load saved preferences
  chrome.storage.local.get(
    [
      'playAudio',
      'customKeywords',
      'mutedDMContacts',
      'notificationHistory'
    ],
    (data) => {
      if (data.playAudio !== undefined && toggleAudio) {
        toggleAudio.checked = data.playAudio;
      }

      // Keywords
      currentKeywords = Array.isArray(data.customKeywords) ? data.customKeywords : [];
      renderKeywords();

      // Muted Contacts
      currentMutedContacts = Array.isArray(data.mutedDMContacts) ? data.mutedDMContacts : [];
      renderMutedContacts();

      // History
      cachedHistory = data.notificationHistory || [];
      renderHistory(cachedHistory);
    }
  );

  // Real-time live listener: update Recent Activity immediately when new message arrives
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.notificationHistory) {
      cachedHistory = changes.notificationHistory.newValue || [];
      renderHistory(cachedHistory);
      // Clear badge since user is actively viewing the open popup
      chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
    }
  });

  // Direct runtime message listener as secondary live stream
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'NEW_NOTIFICATION_RECEIVED') {
      chrome.storage.local.get(['notificationHistory'], (d) => {
        cachedHistory = d.notificationHistory || [];
        renderHistory(cachedHistory);
        chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
      });
    }
  });

  // Check WhatsApp Web Connection
  checkWhatsAppConnection();

  async function checkWhatsAppConnection() {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
      if (!tabs || tabs.length === 0) {
        if (statusDot) statusDot.className = 'status-dot status-offline';
        if (statusText) statusText.textContent = 'Not Open';
        return;
      }

      const activeTab = tabs[0];
      chrome.tabs.sendMessage(activeTab.id, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (statusDot) statusDot.className = 'status-dot status-online';
          if (statusText) statusText.textContent = 'Tab Open';
        } else {
          if (statusDot) statusDot.className = 'status-dot status-online';
          statusText.textContent = `Active (${response.monitoredChats || 0} chats)`;
        }
      });
    } catch (e) {
      if (statusDot) statusDot.className = 'status-dot status-offline';
      if (statusText) statusText.textContent = 'Offline';
    }
  }

  // Save Sound toggle changes
  if (toggleAudio) {
    toggleAudio.addEventListener('change', () => {
      chrome.storage.local.set({ playAudio: toggleAudio.checked });
      if (toggleAudio.checked && typeof window.playNotificationChime === 'function') {
        window.playNotificationChime('MENTION');
      }
    });
  }

  // Keywords management
  function renderKeywords() {
    if (!keywordsContainer) return;
    keywordsContainer.innerHTML = '';
    currentKeywords.forEach((kw, index) => {
      const tag = document.createElement('div');
      tag.className = 'keyword-tag';
      tag.innerHTML = `
        <span>${escapeHtml(kw)}</span>
        <span class="keyword-tag-remove" data-index="${index}">&times;</span>
      `;
      keywordsContainer.appendChild(tag);
    });

    keywordsContainer.querySelectorAll('.keyword-tag-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        currentKeywords.splice(idx, 1);
        chrome.storage.local.set({ customKeywords: currentKeywords });
        renderKeywords();
      });
    });
  }

  function addKeyword() {
    if (!keywordInput) return;
    const val = keywordInput.value.trim();
    if (!val) return;
    if (!currentKeywords.includes(val)) {
      currentKeywords.push(val);
      chrome.storage.local.set({ customKeywords: currentKeywords });
      renderKeywords();
    }
    keywordInput.value = '';
  }

  if (addKeywordBtn) {
    addKeywordBtn.addEventListener('click', addKeyword);
  }
  if (keywordInput) {
    keywordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addKeyword();
      }
    });
  }

  // Muted Contacts management (Direct Messages)
  function isContactMuted(contactName) {
    if (!contactName || !Array.isArray(currentMutedContacts) || currentMutedContacts.length === 0) {
      return false;
    }
    const cleanTarget = contactName.trim().toLowerCase();
    return currentMutedContacts.some((c) => {
      const term = (c || '').trim().toLowerCase();
      return term && (cleanTarget === term || cleanTarget.includes(term) || term.includes(cleanTarget));
    });
  }

  function renderMutedContacts() {
    if (!mutedContactsContainer) return;
    mutedContactsContainer.innerHTML = '';
    currentMutedContacts.forEach((contact, index) => {
      const tag = document.createElement('div');
      tag.className = 'keyword-tag muted-contact-tag';
      tag.innerHTML = `
        <span>🔇 ${escapeHtml(contact)}</span>
        <span class="keyword-tag-remove" data-index="${index}" title="Unmute contact">&times;</span>
      `;
      mutedContactsContainer.appendChild(tag);
    });

    mutedContactsContainer.querySelectorAll('.keyword-tag-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (!isNaN(idx) && idx >= 0 && idx < currentMutedContacts.length) {
          currentMutedContacts.splice(idx, 1);
          chrome.storage.local.set({ mutedDMContacts: currentMutedContacts });
          renderMutedContacts();
          renderHistory(cachedHistory);
        }
      });
    });
  }

  function addMutedContact() {
    if (!mutedContactInput) return;
    const val = mutedContactInput.value.trim();
    if (!val) return;
    const isAlreadyAdded = currentMutedContacts.some((c) => c.toLowerCase() === val.toLowerCase());
    if (!isAlreadyAdded) {
      currentMutedContacts.push(val);
      chrome.storage.local.set({ mutedDMContacts: currentMutedContacts });
      renderMutedContacts();
      renderHistory(cachedHistory);
    }
    mutedContactInput.value = '';
  }

  if (addMutedContactBtn) {
    addMutedContactBtn.addEventListener('click', addMutedContact);
  }
  if (mutedContactInput) {
    mutedContactInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addMutedContact();
      }
    });
  }

  // Render History List
  function renderHistory(items) {
    if (!historyList) return;
    cachedHistory = items || [];

    if (!items || items.length === 0) {
      if (emptyHistory) emptyHistory.style.display = 'block';
      historyList.querySelectorAll('.history-item').forEach((el) => el.remove());
      return;
    }

    if (emptyHistory) emptyHistory.style.display = 'none';
    historyList.querySelectorAll('.history-item').forEach((el) => el.remove());

    items.slice(0, 30).forEach((item, index) => {
      const row = document.createElement('div');
      const isMention = item.category === 'MENTION';
      const badgeClass = isMention ? 'history-badge-mention' : 'history-badge-dm';
      const badgeLabel = isMention ? 'Tagged' : 'Direct';
      const cardTypeClass = isMention ? 'history-item-tagged' : 'history-item-direct';

      row.className = `history-item ${cardTypeClass}`;
      row.setAttribute('title', 'Click to open this chat in WhatsApp Web');

      const isRead = item.isRead === true || item.unreadCount === 0;
      let statusBadge = '';
      if (isRead) {
        statusBadge = `<span class="history-read-pill">Read</span>`;
      } else {
        const count = item.unreadCount || 1;
        statusBadge = `<span class="history-unread-pill">${count} unread</span>`;
      }

      let tagPill = '';
      if (isMention) {
        const tagText = item.matchedTag ? escapeHtml(item.matchedTag) : 'Tagged';
        tagPill = `<span class="history-lock-pill" title="Locked to tagged message">🔒 ${tagText.startsWith('@') ? tagText : '@' + tagText}</span>`;
      }

      let senderHtml = '';
      if (isMention && item.sender) {
        senderHtml = `<div class="history-sender">Tagged by <strong>${escapeHtml(item.sender)}</strong>:</div>`;
      }

      const contactName = (!isMention ? (item.chatTitle || item.title) : (item.sender || item.chatTitle || item.title) || '').trim();
      const isMuted = isContactMuted(contactName);
      const muteTitle = isMuted
        ? `Unmute direct messages from ${escapeHtml(contactName)}`
        : `Mute direct messages from ${escapeHtml(contactName)}`;

      const muteIconSvg = isMuted
        ? `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="22" y1="9" x2="16" y2="15"></line>
            <line x1="16" y1="9" x2="22" y2="15"></line>
          </svg>`
        : `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="22" y1="9" x2="16" y2="15"></line>
            <line x1="16" y1="9" x2="22" y2="15"></line>
          </svg>`;

      row.innerHTML = `
        <div class="history-item-content">
          <div class="history-item-header">
            <div class="history-badges-wrapper">
              <span class="history-badge ${badgeClass}">${badgeLabel}</span>
              ${tagPill}
              ${statusBadge}
            </div>
            <span class="history-time">${escapeHtml(item.time || '')}</span>
          </div>
          <div class="history-title">${escapeHtml(item.chatTitle || item.title || '')}</div>
          ${senderHtml}
          <div class="history-body ${isMention ? 'history-body-mention' : ''}">${escapeHtml(item.body || '')}</div>
        </div>
        <div class="history-actions-wrapper">
          <button class="btn-card-mute ${isMuted ? 'is-muted' : ''}" title="${muteTitle}" data-index="${index}" aria-label="Mute contact">
            ${muteIconSvg}
          </button>
          <button class="btn-card-delete" title="Delete this card" data-index="${index}">&times;</button>
        </div>
      `;

      // Click card to open chat in WhatsApp Web
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-card-delete') || e.target.closest('.btn-card-mute')) return;
        const targetTitle = item.chatTitle || item.title;
        if (!targetTitle) return;

        // Immediately change unread to read in memory and storage
        item.isRead = true;
        item.unreadCount = 0;
        chrome.storage.local.set({ notificationHistory: cachedHistory });
        renderHistory(cachedHistory);

        chrome.runtime.sendMessage({
          type: 'NAVIGATE_TO_CHAT',
          chatTitle: targetTitle
        });

        // Close popup window smoothly so user is viewing their chat
        setTimeout(() => {
          window.close();
        }, 120);
      });

      historyList.appendChild(row);
    });

    // Individual card mute handler
    historyList.querySelectorAll('.btn-card-mute').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        if (isNaN(idx) || idx < 0 || idx >= cachedHistory.length) return;
        const item = cachedHistory[idx];
        const isMention = item.category === 'MENTION';
        const contactName = (!isMention ? (item.chatTitle || item.title) : (item.sender || item.chatTitle || item.title) || '').trim();
        if (!contactName) return;

        const cleanTarget = contactName.toLowerCase();
        const existingIndex = currentMutedContacts.findIndex((c) => {
          const term = (c || '').trim().toLowerCase();
          return term && (cleanTarget === term || cleanTarget.includes(term) || term.includes(cleanTarget));
        });

        if (existingIndex !== -1) {
          // Unmute
          currentMutedContacts.splice(existingIndex, 1);
        } else {
          // Mute and add to list
          currentMutedContacts.push(contactName);
        }

        chrome.storage.local.set({ mutedDMContacts: currentMutedContacts });
        renderMutedContacts();
        renderHistory(cachedHistory);
      });
    });

    // Individual card delete handler
    historyList.querySelectorAll('.btn-card-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        if (!isNaN(idx) && idx >= 0 && idx < cachedHistory.length) {
          cachedHistory.splice(idx, 1);
          chrome.storage.local.set({ notificationHistory: cachedHistory });
          renderHistory(cachedHistory);
        }
      });
    });
  }

  // Clear button with confirmation
  function setupClearButton() {
    if (!clearContainer) return;
    clearContainer.innerHTML = `<button id="btnClearHistory" class="btn-link">Clear</button>`;
    const btn = document.getElementById('btnClearHistory');
    if (btn) {
      btn.addEventListener('click', () => {
        clearContainer.innerHTML = `
          <div class="confirm-wrapper">
            <span class="confirm-prompt">Clear all?</span>
            <button id="btnConfirmClear" class="btn-link btn-danger">Yes</button>
            <button id="btnCancelClear" class="btn-link">No</button>
          </div>
        `;

        document.getElementById('btnConfirmClear')?.addEventListener('click', () => {
          chrome.storage.local.set({ notificationHistory: [] });
          cachedHistory = [];
          renderHistory([]);
          setupClearButton();
        });

        document.getElementById('btnCancelClear')?.addEventListener('click', () => {
          setupClearButton();
        });
      });
    }
  }

  setupClearButton();

  // Handle external links opening in new browser tabs
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[target="_blank"]');
    if (link && link.href) {
      e.preventDefault();
      chrome.tabs.create({ url: link.href });
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
