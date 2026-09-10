const { app, BrowserWindow, session, ipcMain, MessageChannelMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, 'artifacts', 'audio-probe-profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const samples = [];
let source, capture, frames = 0, finished = false;
const report = { runtime: process.versions, phases: [] };
const timeout = setTimeout(() => finish(new Error('Audio probe timed out')), 30000);

function energy(pcm, hz, channel) {
  let real = 0, imaginary = 0;
  const count = Math.floor(pcm.length / 4);
  for (let i = 0; i < count; i++) {
    const sample = pcm.readInt16LE(i * 4 + channel * 2) / 32768;
    const theta = 2 * Math.PI * hz * i / 48000;
    real += sample * Math.cos(theta); imaginary += sample * Math.sin(theta);
  }
  return 2 * Math.hypot(real, imaginary) / count;
}
function frameEnergy(pcm, hz, channel) {
  // Browser/device clocks drift slightly. Measure short windows so long-term
  // phase drift isn't mistaken for missing audio.
  let sum = 0, count = 0;
  for (let offset = 0; offset + 3840 <= pcm.length; offset += 3840) {
    sum += energy(pcm.subarray(offset, offset + 3840), hz, channel); count++;
  }
  return sum / count;
}
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.ok = !error;
  if (error) report.error = error.stack;
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'audio-probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(error ? 1 : 0);
}

app.whenReady().then(async () => {
  const captureSession = session.fromPartition('probe-capture');
  source = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, partition: 'probe-source' } });
  source.webContents.setAudioMuted(true);
  capture = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, session: captureSession, preload: path.join(root, 'src/capture/preload.js') } });
  captureSession.setDisplayMediaRequestHandler((request, callback) => {
    assert.equal(request.frame, capture.webContents.mainFrame);
    callback({ video: source.webContents.mainFrame, audio: source.webContents.mainFrame, enableLocalEcho: false });
  });
  ipcMain.on('capture:status', async (event, state, message) => {
    if (event.sender !== capture.webContents) return;
    report.phases.push({ state, message });
    if (state === 'error') return finish(new Error(message));
    if (state === 'ready') {
      source.webContents.setAudioMuted(false);
      await source.webContents.executeJavaScript(`
        window.toneContext = new AudioContext({sampleRate:48000});
        const merger = toneContext.createChannelMerger(2);
        [440,660].forEach((frequency,i) => {
          const oscillator = toneContext.createOscillator(); oscillator.frequency.value=frequency;
          const gain = toneContext.createGain(); gain.gain.value=0.15;
          oscillator.connect(gain).connect(merger,0,i); oscillator.start();
        });
        merger.connect(toneContext.destination); toneContext.resume();
      `, true);
    }
  });
  const { port1, port2 } = new MessageChannelMain();
  port1.on('message', ({ data: bytes }) => {
    const pcm = Buffer.from(bytes);
    try { assert.equal(pcm.length, 3840); } catch (error) { return finish(error); }
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)) / 32768);
    if (peak < 0.01) return;
    frames++;
    if (frames > 10) samples.push(pcm);
    if (frames === 30) source.minimize();
    if (frames === 100) {
      const pcm = Buffer.concat(samples);
      fs.writeFileSync(path.join(root, 'artifacts', 'audio-probe.pcm'), pcm);
      report.signal = { frames, bytes: pcm.length, left440: frameEnergy(pcm, 440, 0), right660: frameEnergy(pcm, 660, 1), left660: frameEnergy(pcm, 660, 0), right440: frameEnergy(pcm, 440, 1) };
      try {
        assert(report.signal.left440 > 0.1, 'Left tone not captured');
        assert(report.signal.right660 > 0.1, 'Right tone not captured');
        assert(report.signal.left660 < 0.015, 'Channels were mixed');
        assert(report.signal.right440 < 0.015, 'Channels were mixed');
        report.voiceDependencies = require('@discordjs/voice').generateDependencyReport();
        const encode = require('../src/opus-encoder').createEncoder();
        report.opusPacketBytes = encode(pcm.subarray(0, 3840)).length;
        assert(report.opusPacketBytes > 0);
        finish();
      } catch (error) { finish(error); }
    }
  });
  await source.loadURL('data:text/html,<title>Audio test source</title>');
  await capture.loadFile(path.join(root, 'src/capture/index.html'));
  port1.start();
  capture.webContents.postMessage('capture:port', null, [port2]);
  await capture.webContents.executeJavaScript('window.audioCapture.start()', true);
}).catch(finish);
