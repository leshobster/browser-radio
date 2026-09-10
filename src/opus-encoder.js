const { Encoder } = require('@evan/opus');

function createEncoder() {
  const encoder = new Encoder({ channels: 2, sample_rate: 48000, application: 'audio' });
  encoder.bitrate = 256000;
  encoder.complexity = 10;
  encoder.signal = 'music';
  encoder.force_channels = 2;
  encoder.bandwidth = 'fullband';
  encoder.vbr = true;
  encoder.vbr_constraint = true;
  // Copy the packet: native bindings may reuse their output allocation.
  return frame => Buffer.from(encoder.encode(frame));
}
module.exports = { createEncoder };
