const { DiscordService } = require('./discord-service');
const { FRAME_BYTES } = require('./audio-stream');
const service = new DiscordService();
service.on('state', state => process.parentPort.postMessage({ state }));
let port;
const diagnostics = process.argv.includes('--diagnostics');
let probe;
let received = 0, lastType;
process.parentPort.on('message', async ({ data, ports }) => {
  if (data.action === 'audio-port') {
    port?.close(); port = ports[0];
    port.on('message', ({ data: bytes }) => {
      if (diagnostics) { received++; lastType = { type: bytes?.constructor?.name, length: bytes?.byteLength }; }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== FRAME_BYTES) return;
      service.acceptPcm(bytes);
      if (probe) probe.accept(bytes);
    });
    port.start(); return;
  }
  try {
    let result;
    if (diagnostics && data.action === 'probeStart') {
      probe?.stop(); probe = require('./voice-probe').createProbe();
    } else if (diagnostics && data.action === 'probeStats') result = probe?.stats();
    else if (diagnostics && data.action === 'probeStop') { result = { ...probe?.stats(), transport: { received, lastType } }; probe?.stop(); probe = undefined; }
    else {
      if (!['connect', 'join', 'leave', 'startBroadcast', 'stopBroadcast', 'setVolume', 'update', 'destroy'].includes(data.action)) throw new Error('Unknown voice action.');
      result = await service[data.action](data.payload);
    }
    process.parentPort.postMessage({ id: data.id, result, state: service.state });
  } catch (error) { process.parentPort.postMessage({ id: data.id, error: service.sanitize(error), state: service.state }); }
});
