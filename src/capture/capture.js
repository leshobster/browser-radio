/* This page is trusted, hidden, and separate from all web content. */
(() => {
  let stream, context, source, processor, monitor;
  let localListening = false;
  let generation = 0;
  let audioPort;
  let frames = 0;
  window.addEventListener('message', event => {
    if (event.source !== window || event.data !== 'capture:port' || !event.ports[0]) return;
    audioPort?.close(); audioPort = event.ports[0];
  });

  async function stop() {
    generation++;
    if (processor) processor.port.onmessage = null;
    for (const track of stream?.getTracks() || []) track.stop();
    stream = undefined;
    if (context && context.state !== 'closed') await context.close();
    context = source = processor = monitor = undefined;
  }

  async function start() {
    await stop();
    const current = generation;
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 1, max: 1 }, width: { ideal: 16 }, height: { ideal: 16 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 },
      });
      if (current !== generation) { captured.getTracks().forEach(track => track.stop()); return; }
      stream = captured;
      if (!stream.getAudioTracks().length) throw new Error('The browser did not provide an audio track.');
      // Display capture requires video at grant time, but broadcasting does not.
      for (const track of stream.getVideoTracks()) { track.stop(); stream.removeTrack(track); }
      context = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      await context.audioWorklet.addModule('pcm-worklet.js');
      if (current !== generation) return;
      source = context.createMediaStreamSource(stream);
      processor = new AudioWorkletNode(context, 'pcm-capture', { channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2] });
      // Chromium utility ports preserve cloned typed arrays; transferring an
      // ArrayBuffer directly loses its contents in Electron's native port bridge.
      processor.port.onmessage = ({ data }) => { frames++; audioPort?.postMessage(new Uint8Array(data.bytes)); };
      source.connect(processor).connect(context.destination);
      monitor = context.createGain();
      monitor.gain.value = localListening ? 1 : 0;
      source.connect(monitor).connect(context.destination);
      await context.resume();
      for (const track of stream.getAudioTracks()) track.onended = () => {
        if (current === generation) window.captureBridge.status('ended', 'Browser audio capture ended.');
      };
      window.captureBridge.status('ready', 'Browser audio ready');
    } catch (error) {
      if (current === generation) {
        await stop();
        window.captureBridge.status('error', error.message || String(error));
      }
    }
  }

  window.captureBridge.onMonitor(enabled => {
    localListening = Boolean(enabled);
    if (monitor) monitor.gain.setTargetAtTime(localListening ? 1 : 0, context.currentTime, 0.015);
  });
  window.audioCapture = { start, stop, status: () => ({ context: context?.state, frames, audioState: stream?.getAudioTracks()[0]?.readyState, videoTracks: stream?.getVideoTracks().length, audioTracks: stream?.getAudioTracks().length, connected: Boolean(audioPort) }) };
})();
