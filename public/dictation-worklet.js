class DictationSamples extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(Math.round(sampleRate * 2.5));
    this.offset = 0;
    this.speechSamples = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      this.samples[this.offset++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
      if (Math.abs(value) >= 0.015) this.speechSamples++;
      if (this.offset === this.samples.length) {
        if (this.speechSamples >= sampleRate * 0.035) {
          const buffer = this.samples.buffer;
          this.port.postMessage(buffer, [buffer]);
          this.samples = new Int16Array(Math.round(sampleRate * 2.5));
        }
        this.offset = 0;
        this.speechSamples = 0;
      }
    }
    return true;
  }
}

registerProcessor('dictation-samples', DictationSamples);
