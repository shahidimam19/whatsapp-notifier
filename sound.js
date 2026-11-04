/**
 * Web Audio API synthesizer for WhatsApp notifications.
 * Offline, standalone, zero external audio assets required.
 * Fully compliant with Chrome Autoplay Policy & zero console warnings.
 */
(() => {
  let audioCtx = null;

  function initOrResumeContext() {
    try {
      if (!audioCtx || audioCtx.state === 'closed') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
        }
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
    } catch (e) {}
  }

  // Pre-unlock and resume AudioContext strictly inside user gestures
  function setupUserGestureListeners() {
    const gestureEvents = ['click', 'keydown', 'pointerdown', 'touchstart'];
    const onUserGesture = () => {
      initOrResumeContext();
    };

    gestureEvents.forEach((evt) => {
      window.addEventListener(evt, onUserGesture, { passive: true, capture: true });
    });
  }

  if (typeof window !== 'undefined') {
    setupUserGestureListeners();
  }

  function playTone(ctx, freq, startTime, duration, type = 'sine', peakGain = 0.2) {
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      const t0 = Math.max(startTime, ctx.currentTime);
      const t1 = t0 + duration;

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);

      // Attack: smooth fade in to peakGain
      gainNode.gain.setValueAtTime(0.0001, t0);
      gainNode.gain.linearRampToValueAtTime(peakGain, t0 + 0.02);

      // Decay: smooth linear ramp to zero
      gainNode.gain.setValueAtTime(peakGain, t0 + Math.max(0.03, duration * 0.4));
      gainNode.gain.linearRampToValueAtTime(0.0001, t1);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(t0);
      osc.stop(t1 + 0.05);

      osc.onended = () => {
        try {
          osc.disconnect();
          gainNode.disconnect();
        } catch (e) {}
      };
    } catch (err) {}
  }

  window.playNotificationChime = function (notificationType = 'DM') {
    // Only attempt sound synthesis if AudioContext exists and is actively running
    // This completely prevents Chrome's "The AudioContext was not allowed to start" autoplay warning.
    if (!audioCtx || audioCtx.state !== 'running') {
      return;
    }

    try {
      const now = audioCtx.currentTime + 0.02;

      if (notificationType === 'MENTION') {
        // High sparkle alert for Group Mentions: 3 ascending harmonious tones
        playTone(audioCtx, 659.25, now, 0.15, 'sine', 0.22);          // E5
        playTone(audioCtx, 880.00, now + 0.11, 0.18, 'triangle', 0.25); // A5
        playTone(audioCtx, 1318.51, now + 0.24, 0.35, 'sine', 0.28);    // E6
      } else {
        // Warm dual-bell chime for Direct Messages
        playTone(audioCtx, 523.25, now, 0.20, 'sine', 0.24);         // C5
        playTone(audioCtx, 659.25, now + 0.14, 0.35, 'sine', 0.28);   // E5
      }
    } catch (err) {}
  };
})();
