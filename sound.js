/**
 * WhatsApp Notifier - Audio Chime Synthesizer
 * Generates standalone PCM WAV audio data URIs in-memory.
 * Zero external audio files required.
 * Completely eliminates Chrome's "The AudioContext was not allowed to start" warning.
 */
(() => {
  function generateToneWavUri(notes) {
    const sampleRate = 22050;
    let totalDuration = 0;
    notes.forEach((n) => {
      const end = n.start + n.duration;
      if (end > totalDuration) totalDuration = end;
    });

    const numSamples = Math.floor(sampleRate * totalDuration);
    const dataSize = numSamples * 2; // 16-bit mono PCM
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    // RIFF Header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true);  // AudioFormat = PCM (1)
    view.setUint16(22, 1, true);  // Mono (1)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true);  // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Synthesize audio samples with smooth exponential decay envelope
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;

      for (const note of notes) {
        if (t >= note.start && t < note.start + note.duration) {
          const localT = t - note.start;
          const envelope = Math.exp(-localT * (note.decay || 8));
          // Fundamental sine wave + soft harmonious overtone
          const s = Math.sin(2 * Math.PI * note.freq * localT) + 0.22 * Math.sin(4 * Math.PI * note.freq * localT);
          sample += s * envelope * (note.volume || 0.35);
        }
      }

      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(44 + i * 2, intSample, true);
    }

    // Convert to Base64 data URI
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return 'data:audio/wav;base64,' + btoa(binary);
  }

  // Pre-generate audio chimes in-memory once on script load
  let mentionWavUri = null;
  let dmWavUri = null;

  try {
    // High sparkle chime for Group Mentions: 3 ascending harmonious tones (E5 -> A5 -> E6)
    mentionWavUri = generateToneWavUri([
      { freq: 659.25, start: 0, duration: 0.18, decay: 9, volume: 0.35 },
      { freq: 880.00, start: 0.11, duration: 0.20, decay: 8, volume: 0.38 },
      { freq: 1318.51, start: 0.22, duration: 0.35, decay: 6, volume: 0.40 }
    ]);

    // Warm dual-bell chime for Direct Messages: (C5 -> E5)
    dmWavUri = generateToneWavUri([
      { freq: 523.25, start: 0, duration: 0.22, decay: 8, volume: 0.35 },
      { freq: 659.25, start: 0.12, duration: 0.35, decay: 6, volume: 0.40 }
    ]);
  } catch (e) {}

  window.playNotificationChime = function (notificationType = 'DM') {
    try {
      const uri = notificationType === 'MENTION' ? mentionWavUri : dmWavUri;
      if (!uri) return;

      const audio = new Audio(uri);
      audio.volume = 0.35;
      audio.play().catch(() => {});
    } catch (e) {}
  };
})();
