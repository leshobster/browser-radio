const test = require('node:test');
const assert = require('node:assert/strict');
const { Decoder } = require('@evan/opus');
const { createEncoder } = require('../src/opus-encoder');

// Measure the decoded signal, not just the requested encoder settings.
test('music encoding retains bass, upper treble and independent stereo channels', () => {
  const encode = createEncoder();
  const decoder = new Decoder({ channels: 2, sample_rate: 48000 });
  const frequencies = [60, 1000, 8000, 16000, 18000];
  for (const frequency of frequencies) {
    let real = 0, imaginary = 0, oppositeEnergy = 0, samples = 0;
    let largestPacket = 0;
    for (let frame = 0; frame < 60; frame++) {
      const pcm = Buffer.alloc(3840);
      for (let i = 0; i < 960; i++) pcm.writeInt16LE(Math.round(Math.sin((frame * 960 + i) * 2 * Math.PI * frequency / 48000) * 12000), i * 4);
      const packet = encode(pcm);
      largestPacket = Math.max(largestPacket, packet.length);
      const decoded = Buffer.from(decoder.decode(packet));
      assert.equal(decoded.length, pcm.length);
      if (frame < 10) continue; // Discard the transition and encoder lookahead.
      for (let i = 0; i < 960; i++) {
        const angle = (frame * 960 + i) * 2 * Math.PI * frequency / 48000;
        const left = decoded.readInt16LE(i * 4);
        real += left * Math.cos(angle); imaginary += left * Math.sin(angle);
        oppositeEnergy += decoded.readInt16LE(i * 4 + 2) ** 2;
        samples++;
      }
    }
    const gainDb = 20 * Math.log10(2 * Math.hypot(real, imaginary) / samples / 12000);
    assert(Math.abs(gainDb) < 1, `${frequency} Hz changed by ${gainDb.toFixed(2)} dB`);
    assert(Math.sqrt(oppositeEnergy / samples) < 120, 'Audio leaked significantly into the silent channel');
    assert(largestPacket < 1276, 'Opus packet exceeds the codec packet limit');
  }
});
