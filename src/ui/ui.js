const $ = id => document.getElementById(id);
let current = {}, joining = false, saving = false, firstState = true;
let layoutQueued = false;

function layout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    const rect = $('browser-slot').getBoundingClientRect();
    window.radio.layout({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  });
}
new ResizeObserver(layout).observe($('browser-slot'));
window.addEventListener('resize', layout);

async function call(promise) {
  try {
    const result = await promise;
    if (result.state) render(result.state);
    if (!result.ok) throw new Error(result.error || 'The action could not be completed.');
    return result;
  } catch (error) {
    $('error-text').textContent = error.message;
    $('error-banner').hidden = false;
    layout();
    throw error;
  }
}
function action(promise) { call(promise).catch(() => {}); }

function render(state) {
  current = state;
  const connected = state.voiceStatus === 'ready';
  const inChannel = !['disconnected', 'destroyed'].includes(state.voiceStatus);
  const online = state.botStatus === 'ready';
  const names = { unconfigured: 'Set up your bot', connecting: 'Connecting bot…', reconnecting: 'Reconnecting…', ready: state.botName || 'Bot online', error: 'Bot needs attention' };
  $('bot-status').textContent = names[state.botStatus] || state.botStatus;
  $('bot-dot').className = `dot ${online ? 'ready' : ['connecting', 'reconnecting'].includes(state.botStatus) ? 'connecting' : state.botStatus === 'error' ? 'error' : ''}`;
  $('guild-name').textContent = state.guildName || 'YOUR DISCORD SERVER';
  $('channel-name').textContent = state.channelName || 'Find your channel';
  $('channel-hint').textContent = connected ? 'Your bot is here. Move it any time with Join my channel.' : inChannel ? 'Connecting to Discord voice…' : 'Join a voice channel in Discord, then bring your bot along.';
  $('join').disabled = joining || !online;
  $('join').querySelector('span').textContent = joining ? 'Joining your channel…' : 'Join my channel';
  $('leave').disabled = !inChannel;
  $('broadcast').disabled = !state.broadcasting && (!connected || state.captureStatus !== 'ready');
  $('broadcast').classList.toggle('active', state.broadcasting);
  $('broadcast-label').textContent = state.broadcasting ? 'Stop broadcast' : 'Start broadcast';
  $('broadcast-icon').classList.toggle('stop', state.broadcasting);
  $('live-badge').textContent = state.broadcasting ? (connected ? 'ON AIR' : 'RECONNECTING') : 'OFF AIR';
  $('live-badge').classList.toggle('live', state.broadcasting && connected);
  $('broadcast-note').textContent = state.broadcasting ? 'Live browser audio is going to your channel.' : connected ? 'Ready when you are. Press Start broadcast.' : 'Connect to a channel to go on air.';
  $('volume').value = state.volume;
  $('volume-value').textContent = `${state.volume}%`;
  $('monitor').checked = state.monitor;
  $('capture-status').textContent = state.captureMessage;
  $('capture-dot').className = `dot ${state.captureStatus === 'ready' ? 'ready' : state.captureStatus === 'error' ? 'error' : 'connecting'}`;
  $('hide-browser').textContent = state.browserHidden ? 'Show browser' : 'Hide browser';
  $('hide-browser').setAttribute('aria-pressed', String(state.browserHidden));
  $('browser-placeholder-text').textContent = state.browserHidden ? 'Browser hidden. Audio keeps playing.' : 'Opening your music browser…';
  $('show-browser').hidden = !state.browserHidden;
  $('browser-title').textContent = state.browserLoading ? 'Loading…' : state.browserTitle;
  if (document.activeElement !== $('address')) $('address').value = state.browserUrl;
  $('back').disabled = !state.canGoBack;
  $('forward').disabled = !state.canGoForward;
  $('error-banner').hidden = !state.error;
  $('error-text').textContent = state.error || '';
  $('page-error').hidden = !state.browserError;
  $('page-error').textContent = state.browserError || '';
  $('invite').disabled = !state.botId;
  $('forget-settings').hidden = !state.hasSettings;
  $('token-saved').textContent = state.hasSettings ? 'Saved securely' : '';
  $('bot-token').placeholder = state.hasSettings ? 'Leave blank to keep your saved token' : 'Paste your bot token here';
  $('version').textContent = `v${state.appVersion}`;
  if (firstState) {
    firstState = false;
    $('owner-id').value = state.ownerId;
    if (!state.hasSettings) openSettings();
  }
  layout();
}

async function openSettings() {
  $('owner-id').value = current.ownerId || '';
  $('bot-token').value = '';
  $('settings-feedback').hidden = true;
  await window.radio.showSettings(true);
  if (!$('settings-dialog').open) $('settings-dialog').showModal();
}
async function closeSettings() {
  $('settings-dialog').close();
  $('bot-token').value = '';
  await window.radio.showSettings(false);
  layout();
}
$('settings-open').addEventListener('click', () => openSettings());
$('settings-close').addEventListener('click', closeSettings);
$('settings-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  saving = true; $('save-settings').disabled = true; $('save-settings').textContent = 'Connecting…';
  $('settings-feedback').hidden = true;
  const input = { ownerId: $('owner-id').value, token: $('bot-token').value };
  $('bot-token').value = '';
  try {
    await call(window.radio.saveSettings(input));
    $('settings-feedback').textContent = 'Bot connected. Invite it to your server below, then close Settings to start.';
    $('settings-feedback').className = 'settings-feedback';
  } catch (error) {
    $('settings-feedback').textContent = error.message;
    $('settings-feedback').className = 'settings-feedback error';
  } finally {
    input.token = '';
    saving = false; $('save-settings').disabled = false; $('save-settings').textContent = 'Save & connect';
    $('settings-feedback').hidden = false;
  }
});
$('forget-settings').addEventListener('click', async () => {
  if (!confirm('Disconnect the bot and remove its saved token from this app?')) return;
  await call(window.radio.clearSettings()).catch(() => {});
  $('owner-id').value = ''; $('settings-feedback').hidden = true;
});
$('portal').addEventListener('click', () => action(window.radio.openHelp('portal')));
$('user-id-help').addEventListener('click', () => action(window.radio.openHelp('userId')));
$('invite').addEventListener('click', () => action(window.radio.openHelp('invite')));
$('join').addEventListener('click', async () => {
  if (joining) return;
  joining = true; render(current);
  try { await call(window.radio.join()); } catch { /* shown by call */ }
  finally { joining = false; render(current); }
});
$('leave').addEventListener('click', () => action(window.radio.leave()));
$('broadcast').addEventListener('click', () => action(current.broadcasting ? window.radio.stop() : window.radio.start()));
$('volume').addEventListener('input', () => action(window.radio.volume(Number($('volume').value))));
$('monitor').addEventListener('change', () => action(window.radio.monitor($('monitor').checked)));
$('address-form').addEventListener('submit', event => { event.preventDefault(); $('address').blur(); action(window.radio.navigate($('address').value)); });
$('back').addEventListener('click', () => action(window.radio.back()));
$('forward').addEventListener('click', () => action(window.radio.forward()));
$('reload').addEventListener('click', () => action(window.radio.reload()));
$('youtube').addEventListener('click', () => action(window.radio.navigate('https://www.youtube.com/')));
$('youtube-music').addEventListener('click', () => action(window.radio.navigate('https://music.youtube.com/')));
$('dismiss-error').addEventListener('click', () => action(window.radio.dismissError()));
$('hide-browser').addEventListener('click', () => action(window.radio.hideBrowser(!current.browserHidden)));
$('show-browser').addEventListener('click', () => action(window.radio.hideBrowser(false)));
window.radio.onState(render);
action(window.radio.getState());
