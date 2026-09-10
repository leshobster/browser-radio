// Loaded only by the opt-in regression harness; no Discord credentials required.
const { createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const { LiveAudioStream } = require('./audio-stream');
const { createEncoder } = require('./opus-encoder');
const { Decoder } = require('@evan/opus');
function createProbe() {
  const stream = new LiveAudioStream({ encode: createEncoder() });
  const decoder = new Decoder({ channels: 2, sample_rate: 48000 });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play, maxMissedFrames: 50 } });
  const resource = createAudioResource(stream, { inputType: StreamType.Opus });
  const read = resource.read.bind(resource);
  const metrics = { received: 0, played: 0, audible: 0, maxGapMs: 0, gapsOver60ms: 0, native: Object.keys(require.cache).some(key => key.endsWith('x64-win32.node')), errors: [] };
  let last = 0;
  resource.read = () => {
    const packet = read();
    if (packet && packet.length > 3) {
      const now = performance.now();
      if (last) { const gap = now - last; metrics.maxGapMs = Math.max(metrics.maxGapMs, gap); if (gap > 60) metrics.gapsOver60ms++; }
      last = now; metrics.played++;
      const pcm = Buffer.from(decoder.decode(packet));
      let energy = 0;
      for (let i = 0; i < pcm.length; i += 2) energy += (pcm.readInt16LE(i) / 32768) ** 2;
      if (Math.sqrt(energy / (pcm.length / 2)) > 0.02) metrics.audible++;
    }
    return packet;
  };
  player.on('error', error => metrics.errors.push(error.message));
  player.play(resource);
  return {
    accept(bytes) { metrics.received++; stream.writeFrame(Buffer.from(bytes)); },
    stats() { return { ...metrics, dropped: stream.dropped, buffered: stream.queue.length, playerStatus: player.state.status }; },
    stop() { player.stop(true); stream.destroy(); },
  };
}
module.exports = { createProbe };
