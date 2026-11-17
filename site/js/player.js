// Plays audio that arrives piece by piece, without gaps, and can pause, seek
// and export it. One shared AudioContext also carries the sample clips, so the
// mascot can listen to whatever is playing.

export class Player extends EventTarget {
  constructor() {
    super();
    this.rate = 24000;
    this.reset();
  }

  // Must first be called from a click or key press (browsers block audio otherwise).
  context() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.6;
      this.analyser.connect(this.ctx.destination);
      this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  reset() {
    this.stopSources();
    this.parts = [];
    this.length = 0;
    this.complete = false;
    this.playing = false;
    this.offset = 0;          // samples: where playback (re)started
    this.startedAt = 0;       // context time of that moment
    this.merged = null;
  }

  stopSources() {
    for (const source of this.sources || []) {
      source.onended = null;
      try { source.stop(); } catch { /* not started */ }
    }
    this.sources = [];
  }

  get duration() { return this.length / this.rate; }

  get position() {
    if (!this.playing) return this.offset / this.rate;
    const now = this.offset + (this.ctx.currentTime - this.startedAt) * this.rate;
    return Math.min(this.length, Math.max(0, now)) / this.rate;
  }

  schedule(samples, when) {
    const buffer = this.ctx.createBuffer(1, samples.length, this.rate);
    buffer.copyToChannel(samples, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    source.start(when);
    this.sources.push(source);
  }

  append(samples) {
    const before = this.length;
    this.parts.push(samples);
    this.length += samples.length;
    this.merged = null;
    if (!this.playing) return;
    let when = this.startedAt + (before - this.offset) / this.rate;
    if (when < this.ctx.currentTime + 0.01) {
      // Playback caught up with generation: go on from now and keep the clock honest.
      when = this.ctx.currentTime + 0.03;
      this.startedAt = when - (before - this.offset) / this.rate;
    }
    this.schedule(samples, when);
  }

  finish() {
    this.complete = true;
  }

  all() {
    if (!this.merged) {
      this.merged = new Float32Array(this.length);
      let at = 0;
      for (const part of this.parts) { this.merged.set(part, at); at += part.length; }
    }
    return this.merged;
  }

  play(fromSeconds = this.offset / this.rate) {
    this.context();
    this.stopSources();
    let from = Math.round(fromSeconds * this.rate);
    if (this.complete && from >= this.length - 1) from = 0;
    this.offset = Math.max(0, Math.min(from, this.length));
    this.startedAt = this.ctx.currentTime + 0.03;
    this.playing = true;
    if (this.length > this.offset) this.schedule(this.all().subarray(this.offset), this.startedAt);
    this.dispatchEvent(new Event("state"));
  }

  pause() {
    if (!this.playing) return;
    this.offset = Math.round(this.position * this.rate);
    this.playing = false;
    this.stopSources();
    this.dispatchEvent(new Event("state"));
  }

  // Called every frame by the page: notices the end of the clip.
  tick() {
    if (this.playing && this.complete && this.position >= this.duration - 0.005) {
      this.playing = false;
      this.offset = this.length;
      this.stopSources();
      this.dispatchEvent(new Event("state"));
      this.dispatchEvent(new Event("ended"));
    }
  }

  // Loudness of what is playing now, 0..1 (speech band).
  level() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.spectrum);
    let sum = 0;
    for (let i = 1; i < 40; i++) sum += this.spectrum[i];
    return Math.min(1, sum / 39 / 150);
  }

  wav() {
    const samples = this.all();
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
    text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, this.rate, true); view.setUint32(28, this.rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([view], { type: "audio/wav" });
  }
}
