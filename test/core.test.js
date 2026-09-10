const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveAudioStream, applyVolume, FRAME_BYTES } = require('../src/audio-stream');
const { normalizeAddress, validateSettings, selectVoiceTarget } = require('../src/validation');
const { DiscordService } = require('../src/discord-service');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const { createEncoder } = require('../src/opus-encoder');
const { Decoder } = require('@evan/opus');

test('live audio buffers a short scheduling gap and preserves one Opus packet per read', async () => {
  const stream = new LiveAudioStream({ encode: createEncoder() });
  const decoder = new Decoder({ channels: 2, sample_rate: 48000 });
  stream.read(0);
  for (let i = 0; i < 3; i++) stream.writeFrame(Buffer.alloc(FRAME_BYTES));
  assert.equal(stream.read(), null, 'Playback starts only after the 80 ms buffer is available');
  stream.writeFrame(Buffer.alloc(FRAME_BYTES));
  const packet = stream.read();
  assert(packet && packet.length < FRAME_BYTES);
  assert.equal(decoder.decode(packet).byteLength, FRAME_BYTES);
  stream.destroy();
});

test('encoded stereo audio keeps its channels and applies volume before encoding', () => {
  const encode = createEncoder();
  const decoder = new Decoder({ channels: 2, sample_rate: 48000 });
  let left = 0, right = 0;
  for (let frame = 0; frame < 12; frame++) {
    const pcm = Buffer.alloc(FRAME_BYTES);
    for (let i = 0; i < 960; i++) pcm.writeInt16LE(Math.round(Math.sin((frame * 960 + i) * 2 * Math.PI * 440 / 48000) * 20000), i * 4);
    const decoded = Buffer.from(decoder.decode(encode(applyVolume(pcm, .5))));
    if (frame > 2) for (let i = 0; i < 960; i++) { left += decoded.readInt16LE(i * 4) ** 2; right += decoded.readInt16LE(i * 4 + 2) ** 2; }
  }
  assert(Math.sqrt(left / (9 * 960)) > 6000);
  assert(right < left * .02, 'Silent right channel should stay nearly silent');
});

test('a stalled audio consumer only receives the newest bounded frames', () => {
  const stream = new LiveAudioStream({ maxFrames: 3 });
  for (let i = 0; i < 100; i++) stream.writeFrame(Buffer.alloc(FRAME_BYTES, i));
  assert.equal(stream.queue.length, 3);
  assert.equal(stream.dropped, 97);
  assert.equal(stream.queue[0][0], 97);
  assert.equal(stream.queue[2][0], 99);
  stream.destroy();
  stream.writeFrame(Buffer.alloc(FRAME_BYTES));
  assert.equal(stream.queue.length, 0);
});

test('broadcast volume preserves stereo, leaves source intact, and makes exact silence at zero', () => {
  const frame = Buffer.from([0xff, 0x7f, 0x00, 0x80]);
  const quiet = applyVolume(frame, 0.5);
  assert.equal(quiet.readInt16LE(0), 16384);
  assert.equal(quiet.readInt16LE(2), -16384);
  assert.equal(frame.readInt16LE(0), 32767);
  assert.deepEqual(applyVolume(frame, 0), Buffer.alloc(4));
});

test('website input accepts web addresses and rejects privileged schemes and embedded credentials', () => {
  assert.equal(normalizeAddress('youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc');
  assert.equal(normalizeAddress('http://localhost:1234/'), 'http://localhost:1234/');
  for (const address of ['file:///C:/secret.txt', 'javascript:alert(1)', 'data:text/html,hi', 'https://me:token@example.com']) assert.throws(() => normalizeAddress(address));
});

test('saved bot tokens can be retained without exposing them to the settings form', () => {
  const saved = { ownerId: '123456789012345678', token: 'private-test-token-that-is-not-real-123' };
  assert.deepEqual(validateSettings({ ownerId: saved.ownerId, token: '' }, saved), saved);
  assert.throws(() => validateSettings({ ownerId: 'username', token: saved.token }));
  assert.throws(() => validateSettings({ ownerId: saved.ownerId, token: '' }));
});

test('join discovery chooses the owner in a shared server and rejects missing or ambiguous destinations', () => {
  const makeGuild = (id, channelId) => ({ id, voiceStates: { cache: new Map(channelId ? [['owner', { channelId }]] : []) } });
  const a = makeGuild('a', null), b = makeGuild('b', 'room-b');
  assert.deepEqual(selectVoiceTarget(new Map([['a', a], ['b', b]]), 'owner'), { guild: b, channelId: 'room-b' });
  assert.throws(() => selectVoiceTarget(new Map([['a', a]]), 'owner'), /Join a server/);
  assert.throws(() => selectVoiceTarget(new Map([['a', makeGuild('a', 'room-a')], ['b', b]]), 'owner'), /more than one/);
});

test('stop leaves the channel connected; leave cancels the session and releases it', async () => {
  const service = new DiscordService();
  let destroyed = false;
  service.connection = { state: { status: VoiceConnectionStatus.Ready }, destroy() { destroyed = true; } };
  service.update({ broadcasting: true, voiceStatus: 'ready' });
  service.stopBroadcast();
  assert.equal(destroyed, false);
  assert.equal(service.state.broadcasting, false);
  service.leave();
  assert.equal(destroyed, true);
  assert.equal(service.connection, null);
  assert.equal(service.state.voiceStatus, 'disconnected');
  await service.destroy();
});

test('an offline service discards incoming sound and refuses to start a broadcast', async () => {
  const service = new DiscordService();
  assert.throws(() => service.startBroadcast(), /Join my channel/);
  service.acceptPcm(new ArrayBuffer(FRAME_BYTES));
  assert.equal(service.input, null);
  await service.destroy();
});

test('same-server moves reuse the voice connection and Leave cancels both pending joins', async () => {
  const service = new DiscordService();
  const payloads = [];
  const channel = id => ({ id, name: id, type: 2, permissionsFor: () => ({ has: () => true }), userLimit: 0 });
  const guild = {
    id: '999999999999999999', name: 'Test server', members: { me: {} },
    channels: { cache: new Map([['first', channel('first')], ['second', channel('second')]]) },
    voiceStates: { cache: new Map([['owner', { channelId: 'first' }]]) },
    voiceAdapterCreator: () => ({ sendPayload: payload => { payloads.push(payload); return true; }, destroy() {} }),
  };
  service.client = { isReady: () => true, guilds: { cache: new Map([[guild.id, guild]]) }, user: { id: 'bot' }, destroy: async () => {} };
  service.ownerId = 'owner';
  const firstJoin = service.join();
  const connection = service.connection;
  guild.voiceStates.cache.set('owner', { channelId: 'second' });
  const secondJoin = service.join();
  try {
    assert.equal(service.connection, connection);
    assert.equal(service.connection.joinConfig.channelId, 'second');
    assert(!payloads.some(payload => payload.d.channel_id === null), 'Moving must not send an intermediate leave');
  } finally {
    service.leave();
    await Promise.all([firstJoin, secondJoin]);
  }
  assert.equal(service.connection, null);
  assert.equal(service.state.voiceStatus, 'disconnected');
  await service.destroy();
});
