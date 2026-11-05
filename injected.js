/**
 * Injected into WhatsApp Web page context (window).
 * Hooks native Notification API to catch real-time background notification dispatches
 * with intelligent Group (@g.us) vs DM (@c.us) JID identification.
 */
(() => {
  if (window.__waNotifierHooked) return;
  window.__waNotifierHooked = true;

  const OriginalNotification = window.Notification;
  if (!OriginalNotification) return;

  function HookedNotification(title, options = {}) {
    try {
      const body = options.body || '';
      const tag = String(options.tag || '');

      let isGroupHint = null;
      if (tag.includes('@g.us') || tag.toLowerCase().includes('group')) {
        isGroupHint = true;
      } else if (tag.includes('@c.us') || tag.includes('@s.whatsapp.net')) {
        isGroupHint = false;
      }

      if (isGroupHint === null && options.data) {
        try {
          const str = typeof options.data === 'string' ? options.data : JSON.stringify(options.data);
          if (str.includes('@g.us')) isGroupHint = true;
          else if (str.includes('@c.us') || str.includes('@s.whatsapp.net')) isGroupHint = false;
        } catch (_) {}
      }

      window.postMessage(
        {
          source: 'WA_NOTIFIER_PAGE_HOOK',
          type: 'NOTIFICATION_ATTEMPT',
          title: String(title || ''),
          body: String(body || ''),
          icon: options.icon || '',
          tag: tag,
          isGroupHint: isGroupHint,
          timestamp: Date.now()
        },
        '*'
      );
    } catch (e) {
      // Ignore errors
    }

    // Call original constructor
    return new OriginalNotification(title, options);
  }

  // Preserve static methods and prototype properties
  HookedNotification.prototype = OriginalNotification.prototype;
  HookedNotification.permission = OriginalNotification.permission;
  HookedNotification.requestPermission = OriginalNotification.requestPermission.bind(OriginalNotification);
  HookedNotification.maxActions = OriginalNotification.maxActions;

  window.Notification = HookedNotification;
  console.log('[WhatsApp Notifier] Enhanced page notification interceptor initialized.');
})();
