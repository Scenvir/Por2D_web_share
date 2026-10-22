'use strict';
// Balanced A/B portal-shot samples, shared with audition D.
class Por2ShotAudio {
  constructor(volume) {
    this.volume = volume;
    this.voices = new Set();
    this.samples = ['blue','orange'].map(color => fetch(`audio/shot-${color}.flac`)
      .then(response => { if (!response.ok) throw Error('Audio unavailable'); return response.arrayBuffer(); })
      .catch(() => null));
  }
  unlock() {
    try {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(this.context.destination);
        this.buffers = [];
        this.samples.forEach((sample, index) => sample.then(data => data && this.context.decodeAudioData(data))
          .then(buffer => { this.buffers[index] = buffer; }).catch(() => {}));
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch (_) { /* Audio is optional; unavailable devices must not block play. */ }
  }
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) this.gain.gain.setValueAtTime(this.volume, this.context.currentTime);
    if (!this.volume) this.stop();
  }
  play(portal) {
    if (!this.volume || document.hidden || this.context?.state !== 'running' || !this.buffers?.[portal]) return;
    if (this.voices.size >= 8) {
      const oldest = this.voices.values().next().value;
      oldest.stop(); this.voices.delete(oldest);
    }
    const voice = this.context.createBufferSource();
    voice.buffer = this.buffers[portal]; voice.connect(this.gain);
    voice.onended = () => { this.voices.delete(voice); voice.disconnect(); };
    this.voices.add(voice); voice.start();
  }
  stop() {
    for (const voice of this.voices) voice.stop();
    this.voices.clear();
  }
}
