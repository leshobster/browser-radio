const { EventEmitter } = require('node:events');
const { utilityProcess, MessageChannelMain } = require('electron');
const path = require('node:path');

// Voice timing and encoding never share the controller's event loop.
class VoiceHost extends EventEmitter {
  constructor({ diagnostics = false } = {}) {
    super();
    this.state = { botStatus: 'unconfigured', botName: '', botId: '', voiceStatus: 'disconnected', channelName: '', guildName: '', broadcasting: false, playing: false, error: '' };
    this.pending = new Map(); this.sequence = 0; this.secret = ''; this.closed = false;
    this.child = utilityProcess.fork(path.join(__dirname, 'voice-worker.js'), diagnostics ? ['--diagnostics'] : [], { serviceName: 'Browser Radio voice', stdio: 'pipe' });
    this.child.stdout.on('data', () => {});
    this.child.stderr.on('data', () => {});
    this.child.on('message', message => {
      if (message.state) { this.state = message.state; this.emit('state'); }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
      }
    });
    this.child.on('exit', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('The voice engine stopped. Restart Browser Radio.')); }
      this.pending.clear();
      if (!this.closed) { this.state = { ...this.state, botStatus: 'error', broadcasting: false, playing: false, voiceStatus: 'disconnected', error: 'The voice engine stopped. Restart Browser Radio.' }; this.emit('state'); }
      this.closed = true;
    });
  }
  sanitize(error) { return (this.secret ? String(error?.message || error).split(this.secret).join('[redacted]') : String(error?.message || error)).slice(0, 500); }
  command(action, payload) {
    if (this.closed) return Promise.reject(new Error('The voice engine is closed.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The voice engine did not respond. Please retry.')); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.postMessage({ id, action, payload });
    });
  }
  attachCapture(contents) {
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ action: 'audio-port' }, [port1]);
    contents.postMessage('capture:port', null, [port2]);
  }
  connect(settings) { this.secret = settings.token; return this.command('connect', settings); }
  join() { return this.command('join'); }
  leave() { return this.command('leave'); }
  startBroadcast() { return this.command('startBroadcast'); }
  stopBroadcast() { return this.command('stopBroadcast'); }
  setVolume(value) { return this.command('setVolume', value); }
  update(patch) { return this.command('update', patch); }
  destroy() { return this.command('destroy').finally(() => { this.secret = ''; }); }
  async shutdown() {
    if (this.closed) return;
    this.closed = true;
    // Keep a finite shutdown deadline if a network operation is stuck.
    const timeout = setTimeout(() => this.child.kill(), 4000);
    try { this.closed = false; await this.destroy(); } finally { this.closed = true; clearTimeout(timeout); this.child.kill(); }
  }
}
module.exports = { VoiceHost };
