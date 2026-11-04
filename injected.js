/**
 * Injected into WhatsApp Web page context (window).
 * Hooks native Notification API to catch real-time background notification dispatches.
 */
(() => {
  if (window.__waNotifierHooked) return;
  window.__waNotifierHooked = true;

  const OriginalNotification = window.Notification;
  if (!OriginalNotification) return;

  function HookedNotification(title, options = {}) {
    try {
      const body = options.body || '';
      window.postMessage(
        {
          source: 'WA_NOTIFIER_PAGE_HOOK',
          type: 'NOTIFICATION_ATTEMPT',
          title: String(title || ''),
          body: String(body || ''),
          icon: options.icon || '',
          tag: options.tag || '',
          timestamp: Date.now()
        },
        '*'
      );
    } catch (e) {
      // Ignore
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
  console.log('[WhatsApp Notifier] Page notification interceptor initialized.');
})();

