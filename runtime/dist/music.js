'use strict';
// One audio clock for the whole session, independent of simulation speed/restarts.
class Por2Music {
  constructor(volume) {
    this.volume = volume;
    document.addEventListener('visibilitychange', () => document.hidden ? this.sync() : this.unlock());
    window.addEventListener('pagehide', () => this.context?.suspend().catch(() => {}));
    window.addEventListener('pageshow', () => this.unlock());
  }
  unlock() {
    if (document.hidden || !this.volume) return;
    try {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        this.context = new Context();
        this.gain = this.context.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(this.context.destination);
      }
      this.sync();
      if (!this.loading && !this.source) {
        this.loading = fetch('audio/between-two-doors.opus')
          .then(response => {
            if (!response.ok) throw Error('Music unavailable');
            return response.arrayBuffer();
          })
          .then(data => this.context.decodeAudioData(data))
          .then(buffer => {
            this.source = this.context.createBufferSource();
            this.source.buffer = buffer;
            this.source.loop = true;
            this.source.connect(this.gain);
            this.source.start();
            this.sync();
          })
          .catch(() => { /* A later gesture can retry; music never blocks play. */ })
          .finally(() => { this.loading = null; });
      }
    } catch (_) { /* Audio support is optional. */ }
  }
  sync() {
    if (!this.context) return;
    if (document.hidden || !this.volume) {
      // Suspend immediately: background timers can be throttled before a fade ends.
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(0, this.context.currentTime);
      this.context.suspend().catch(() => {});
    } else {
      this.context.resume().then(() => {
        if (document.hidden || !this.volume) return;
        const now = this.context.currentTime;
        this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.setTargetAtTime(this.volume, now, .15);
      }).catch(() => {});
    }
  }
  setVolume(volume) {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    if (this.volume) this.unlock();
    else this.sync();
  }
}
