/* A Discord frame is 20 ms of 48 kHz stereo signed 16-bit PCM. */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(960 * 2);
    this.offset = 0;
  }
  process(inputs, outputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const left = channels[0];
    const right = channels[1] || left;
    for (let i = 0; i < left.length; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      this.frame[this.offset++] = Math.round(l < 0 ? l * 32768 : l * 32767);
      this.frame[this.offset++] = Math.round(r < 0 ? r * 32768 : r * 32767);
      if (this.offset === this.frame.length) {
        this.port.postMessage({ bytes: this.frame.buffer }, [this.frame.buffer]);
        this.frame = new Int16Array(960 * 2);
        this.offset = 0;
      }
    }
    // The processor must be connected to an output to keep running; emit silence.
    for (const channel of outputs[0] || []) channel.fill(0);
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
