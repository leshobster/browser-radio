const { Readable } = require('node:stream');

const FRAME_BYTES = 960 * 2 * 2;

/** A bounded, pull-driven live stream. Slow/disconnected consumers cannot build a backlog. */
class LiveAudioStream extends Readable {
  constructor({ maxFrames = 10, prebufferFrames = 4, encode } = {}) {
    super({ objectMode: Boolean(encode), highWaterMark: encode ? 1 : FRAME_BYTES });
    this.queue = [];
    this.maxFrames = maxFrames;
    this.waiting = false;
    this.dropped = 0;
    this.prebufferFrames = Math.min(prebufferFrames, maxFrames);
    this.primed = false;
    this.encode = encode;
  }
  _read() {
    this.waiting = true;
    this.drainFrame();
  }
  drainFrame() {
    if (!this.waiting || this.destroyed) return;
    if (!this.queue.length) this.primed = false;
    if (!this.primed && this.queue.length < this.prebufferFrames) return;
    this.primed = true; this.waiting = false;
    const frame = this.queue.shift();
    try { this.push(this.encode ? this.encode(frame) : frame); }
    catch (error) { this.destroy(error); }
  }
  writeFrame(frame) {
    if (this.destroyed || frame.length !== FRAME_BYTES) return;
    this.queue.push(frame);
    if (this.queue.length > this.maxFrames) { this.queue.shift(); this.dropped++; }
    this.drainFrame();
  }
  _destroy(error, callback) { this.queue.length = 0; callback(error); }
}

function applyVolume(frame, volume) {
  if (volume === 1) return frame;
  const result = Buffer.allocUnsafe(frame.length);
  for (let offset = 0; offset < frame.length; offset += 2) {
    result.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(frame.readInt16LE(offset) * volume))), offset);
  }
  return result;
}

module.exports = { LiveAudioStream, applyVolume, FRAME_BYTES };
