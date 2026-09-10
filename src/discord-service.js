const { EventEmitter } = require('node:events');
const { Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, VoiceConnectionStatus, AudioPlayerStatus, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const { LiveAudioStream, applyVolume, FRAME_BYTES } = require('./audio-stream');
const { selectVoiceTarget } = require('./validation');
const { createEncoder } = require('./opus-encoder');

class DiscordService extends EventEmitter {
  constructor() {
    super();
    this.client = null; this.connection = null; this.input = null;
    this.botGeneration = 0; this.joinGeneration = 0; this.volume = 1; this.secret = '';
    this.state = { botStatus: 'unconfigured', botName: '', botId: '', voiceStatus: 'disconnected', channelName: '', guildName: '', broadcasting: false, playing: false, error: '' };
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop, maxMissedFrames: 50 } });
    this.player.on('stateChange', (_old, next) => {
      this.update({ playing: next.status === AudioPlayerStatus.Playing });
      if (!this.disposing && next.status === AudioPlayerStatus.Idle && this.state.broadcasting && this.isReady()) {
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => { if (this.state.broadcasting && this.isReady()) this.createInput(); }, 100);
      }
    });
    this.player.on('error', error => {
      this.stopBroadcast(); this.update({ error: `Audio playback stopped: ${this.sanitize(error)}` });
    });
  }
  sanitize(error) {
    let message = error?.message || String(error);
    if (this.secret) message = message.split(this.secret).join('[redacted]');
    return message.slice(0, 500);
  }
  update(patch) { Object.assign(this.state, patch); this.emit('state', { ...this.state }); }
  async connect(settings) {
    const generation = ++this.botGeneration;
    this.leave();
    const previous = this.client; this.client = null;
    if (previous) await previous.destroy();
    if (generation !== this.botGeneration) return;
    this.secret = settings.token; this.ownerId = settings.ownerId;
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    this.client = client;
    this.update({ botStatus: 'connecting', botName: '', botId: '', error: '' });
    client.on(Events.Error, error => { if (generation === this.botGeneration) this.update({ error: this.sanitize(error) }); });
    client.on(Events.ShardReconnecting, () => { if (generation === this.botGeneration) this.update({ botStatus: 'reconnecting' }); });
    client.on(Events.ShardResume, () => { if (generation === this.botGeneration) this.update({ botStatus: 'ready' }); });
    client.on(Events.ClientReady, () => { if (generation === this.botGeneration) this.update({ botStatus: 'ready', botName: client.user.username, botId: client.user.id, error: '' }); });
    client.on(Events.VoiceStateUpdate, (_old, next) => {
      if (generation !== this.botGeneration || next.id !== client.user?.id || !this.connection) return;
      if (next.guild.id !== this.connection.joinConfig.guildId) return;
      // Owner departure deliberately has no handler: the stream keeps playing.
      if (!next.channelId && this.state.voiceStatus === 'ready') { this.leave(); this.update({ error: 'The bot was disconnected from the voice channel. Click Join my channel to reconnect.' }); }
      else this.update({ channelName: next.channel?.name || this.state.channelName });
    });
    try {
      await client.login(settings.token);
      if (generation !== this.botGeneration) await client.destroy();
    } catch (error) {
      if (generation === this.botGeneration) { this.update({ botStatus: 'error', error: 'Could not sign in to Discord. Check the bot token and your internet connection.' }); await client.destroy(); this.client = null; }
      throw new Error('Could not sign in to Discord. Check the bot token and your internet connection.');
    }
  }
  isReady() { return this.connection?.state.status === VoiceConnectionStatus.Ready; }
  async join() {
    if (!this.client?.isReady()) throw new Error('Connect your bot in Settings first, then wait for it to be online.');
    const generation = ++this.joinGeneration;
    this.joinAbort?.abort();
    const { guild, channelId } = selectVoiceTarget(this.client.guilds.cache, this.ownerId);
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    if (generation !== this.joinGeneration) return;
    if (channel?.type !== ChannelType.GuildVoice) throw new Error('Choose a normal server voice channel. Stage channels and private calls are not supported.');
    const permissions = channel.permissionsFor(guild.members.me);
    const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
    if (!permissions?.has(required)) throw new Error('The bot needs View Channel, Connect, and Speak permissions in that voice channel.');
    if (channel.userLimit && channel.members.size >= channel.userLimit && !channel.members.has(this.client.user.id) && !permissions.has(PermissionFlagsBits.MoveMembers)) throw new Error('That voice channel is full. Free a slot or choose another channel.');
    if (this.isReady() && this.connection.joinConfig.channelId === channelId && this.connection.joinConfig.guildId === guild.id) return;
    const resume = this.state.broadcasting;
    this.disposeInput();
    const previous = this.connection;
    // Reuse a same-server connection: disconnecting first can deliver a late
    // "left channel" event that tears down the new join.
    if (previous && previous.joinConfig.guildId !== guild.id) {
      this.connection = null;
      if (previous.state.status !== VoiceConnectionStatus.Destroyed) previous.destroy();
    }
    this.update({ voiceStatus: 'connecting', channelName: channel.name, guildName: guild.name, error: '' });
    let connection;
    if (previous && previous.joinConfig.guildId === guild.id && previous.state.status !== VoiceConnectionStatus.Destroyed) {
      connection = previous;
      if (!connection.rejoin({ channelId, selfDeaf: true, selfMute: false })) {
        this.leave(); throw new Error('Discord could not move the bot. Wait for it to reconnect, then try Join my channel again.');
      }
    } else {
      connection = joinVoiceChannel({ guildId: guild.id, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
    }
    this.connection = connection;
    if (previous !== connection) {
    connection.on('error', error => { if (this.connection === connection) this.update({ error: `Voice connection: ${this.sanitize(error)}` }); });
    connection.on('stateChange', (_old, next) => {
      if (this.connection !== connection) return;
      this.update({ voiceStatus: next.status });
      if (next.status !== VoiceConnectionStatus.Ready) this.disposeInput();
      if (next.status === VoiceConnectionStatus.Ready && this.state.broadcasting && !this.input) this.createInput();
      if (next.status === VoiceConnectionStatus.Disconnected) this.recover(connection, this.joinGeneration);
      if (next.status === VoiceConnectionStatus.Destroyed) { this.connection = null; this.stopBroadcast(); this.update({ voiceStatus: 'disconnected', channelName: '', guildName: '' }); }
    });
    }
    connection.subscribe(this.player);
    const joinAbort = new AbortController();
    this.joinAbort = joinAbort;
    const joinTimeout = setTimeout(() => joinAbort.abort(), 20000);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, joinAbort.signal);
      if (generation !== this.joinGeneration || this.connection !== connection) return;
      this.update({ voiceStatus: 'ready', error: '' });
      if (resume && !this.input) this.createInput();
    } catch (error) {
      if (generation === this.joinGeneration && this.connection === connection) {
        this.leave(); throw new Error('Could not join voice. Check channel permissions and that your firewall allows Discord voice traffic.');
      }
    } finally {
      clearTimeout(joinTimeout);
      if (this.joinAbort === joinAbort) this.joinAbort = null;
    }
  }
  async recover(connection, generation) {
    try { await entersState(connection, VoiceConnectionStatus.Ready, 15000); }
    catch {
      if (this.connection !== connection || this.joinGeneration !== generation) return;
      if (!connection.rejoin()) { this.leave(); this.update({ error: 'Voice connection lost. Click Join my channel to reconnect.' }); return; }
      try { await entersState(connection, VoiceConnectionStatus.Ready, 15000); }
      catch { if (this.connection === connection) { this.leave(); this.update({ error: 'Voice connection lost. Click Join my channel to reconnect.' }); } }
    }
  }
  createInput() {
    this.disposeInput();
    if (!this.state.broadcasting || !this.isReady()) return;
    const encode = createEncoder();
    this.input = new LiveAudioStream({ encode: frame => encode(applyVolume(frame, this.volume)) });
    this.player.play(createAudioResource(this.input, { inputType: StreamType.Opus }));
  }
  disposeInput() {
    clearTimeout(this.restartTimer);
    this.disposing = true;
    if (this.input) { this.input.destroy(); this.input = null; }
    this.player.stop(true);
    this.disposing = false;
  }
  startBroadcast() {
    if (!this.isReady()) throw new Error('Click Join my channel before starting the broadcast.');
    this.update({ broadcasting: true, error: '' }); this.createInput();
  }
  stopBroadcast() { this.update({ broadcasting: false, playing: false }); this.disposeInput(); }
  acceptPcm(bytes) {
    if (!this.state.broadcasting || !this.isReady() || !this.input || bytes.byteLength !== FRAME_BYTES) return;
    this.input.writeFrame(Buffer.from(bytes));
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, value / 100)); }
  leave() {
    ++this.joinGeneration;
    this.joinAbort?.abort(); this.joinAbort = null;
    this.stopBroadcast();
    const connection = this.connection; this.connection = null;
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    this.update({ voiceStatus: 'disconnected', channelName: '', guildName: '' });
  }
  async destroy() {
    ++this.botGeneration; this.leave();
    const client = this.client; this.client = null;
    if (client) await client.destroy();
    this.secret = ''; this.update({ botStatus: 'unconfigured', botName: '', botId: '', error: '' });
  }
}
module.exports = { DiscordService };
