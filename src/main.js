const { app, BrowserWindow, WebContentsView, session, ipcMain, safeStorage, shell, Menu, powerSaveBlocker } = require('electron');
const path = require('node:path');
const { VoiceHost } = require('./voice-host');
const { SettingsStore } = require('./settings-store');
const { normalizeAddress, validateSettings } = require('./validation');
const fs = require('node:fs');

app.setName('Browser Radio');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Capture and playback must continue while the owner is using Discord.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const smoke = process.argv.includes('--smoke-test');
// A portable EXE extracts into a different temporary directory each run.
// Pin both Chromium's encryption key/session data and app settings to one profile.
const profile = smoke ? path.resolve(process.cwd(), 'artifacts', process.env.RADIO_TEST_PROFILE || 'smoke-profile') : path.join(app.getPath('appData'), 'Browser Radio');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow, browser, captureWindow, browserSession, store, settings, service, shutdownPromise;
let quitting = false, allowExit = false, restarting = false, restartAgain = false;
let captureReady = false, captureTimer, settingsOpen = false, blocker, cookieTimer;
let browserBounds = { x: 326, y: 116, width: 940, height: 628 };
const local = { captureStatus: 'starting', captureMessage: 'Opening browser audio…', monitor: false, browserHidden: false, volume: 100, browserUrl: 'https://www.youtube.com/', browserTitle: 'YouTube', browserLoading: true, canGoBack: false, canGoForward: false, browserError: '', error: '' };
const uiPath = path.join(__dirname, 'ui/index.html');

function state() {
  return { ...local, ...service.state, error: local.error || service.state.error, ownerId: settings?.ownerId || '', hasSettings: Boolean(settings), appVersion: app.getVersion() };
}
function liveContents(owner) {
  if (!owner || owner.isDestroyed?.()) return null;
  // WebContentsView also clears its webContents property when its owner closes.
  const wc = owner.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}
function sendState() {
  if (quitting) return;
  liveContents(mainWindow)?.send('controller:state', state());
  const active = service?.state.broadcasting || local.monitor;
  if (active && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!active && blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
}
function trusted(event) {
  const wc = liveContents(mainWindow);
  return !quitting && wc && event.sender === wc && event.senderFrame === wc.mainFrame;
}
function fromCapture(event) {
  const wc = liveContents(captureWindow);
  return !quitting && wc && event.sender === wc && event.senderFrame === wc.mainFrame;
}
function muteSource() { liveContents(browser)?.setAudioMuted(true); }
function updateBrowserVisibility() {
  if (!quitting && liveContents(browser) && mainWindow && !mainWindow.isDestroyed()) browser.setVisible(!settingsOpen && !local.browserHidden && !mainWindow.isMinimized());
}
function browserState() {
  if (quitting || !liveContents(browser)) return;
  const wc = browser.webContents;
  Object.assign(local, { browserUrl: wc.getURL(), browserTitle: wc.getTitle() || 'Browser', browserLoading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });
  sendState();
}
function scheduleCapture(delay = 100) {
  if (quitting) return;
  clearTimeout(captureTimer);
  captureReady = false; muteSource();
  local.captureStatus = 'starting'; local.captureMessage = 'Connecting browser audio…'; sendState();
  captureTimer = setTimeout(restartCapture, delay);
}
async function restartCapture() {
  if (quitting || !liveContents(captureWindow) || !liveContents(browser)) return;
  if (restarting) { restartAgain = true; return; }
  restarting = true;
  try {
    captureWindow.webContents.send('capture:monitor', local.monitor);
    await captureWindow.webContents.executeJavaScript('window.audioCapture.start()', true);
  } catch (error) {
    local.captureStatus = 'error'; local.captureMessage = 'Could not capture browser audio. Reload the page to retry.';
    muteSource(); sendState();
  } finally {
    restarting = false;
    if (restartAgain) { restartAgain = false; scheduleCapture(); }
  }
}
function validateRemoteNavigation(event, url) {
  try { normalizeAddress(url); } catch { event.preventDefault(); }
}

async function setupWindows() {
  const controllerSession = session.fromPartition('controller');
  browserSession = session.fromPartition('persist:music-browser');
  browserSession.cookies.on('changed', () => {
    if (quitting || cookieTimer) return;
    cookieTimer = setTimeout(() => { cookieTimer = undefined; browserSession.cookies.flushStore().catch(() => {}); }, 15000);
  });
  const captureSession = session.fromPartition('audio-engine');
  // Only the trusted audio engine receives a display-capture grant.
  for (const restricted of [controllerSession, browserSession]) {
    restricted.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    restricted.setPermissionCheckHandler(() => false);
    restricted.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  }
  browserSession.on('will-download', event => event.preventDefault());
  mainWindow = new BrowserWindow({
    width: 1320, height: 870, minWidth: 1000, minHeight: 720, show: false,
    title: 'Browser Radio', backgroundColor: '#101218', autoHideMenuBar: true,
    icon: path.join(__dirname, 'ui/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), session: controllerSession, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  browser = new WebContentsView({ webPreferences: { session: browserSession, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, safeDialogs: true, spellcheck: false } });
  // Pages without an explicit background (including Google's consent page)
  // expect the browser's normal white canvas behind their text.
  browser.setBackgroundColor('#ffffff');
  mainWindow.contentView.addChildView(browser);
  browser.setBounds(browserBounds);
  muteSource();
  captureWindow = new BrowserWindow({ show: false, width: 200, height: 120, webPreferences: { session: captureSession, preload: path.join(__dirname, 'capture/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const capturePermission = (wc, permission) => !quitting && wc === liveContents(captureWindow) && ['display-capture', 'media'].includes(permission);
  captureSession.setPermissionCheckHandler(capturePermission);
  captureSession.setPermissionRequestHandler((wc, permission, callback) => callback(capturePermission(wc, permission)));
  captureSession.setDisplayMediaRequestHandler((request, callback) => {
    if (quitting || !liveContents(captureWindow) || !liveContents(browser) || request.frame !== captureWindow.webContents.mainFrame) return callback({});
    callback({ video: browser.webContents.mainFrame, audio: browser.webContents.mainFrame, enableLocalEcho: false });
  });
  const wc = browser.webContents;
  wc.on('will-navigate', event => validateRemoteNavigation(event, event.url));
  wc.on('will-frame-navigate', event => { if (event.isMainFrame) validateRemoteNavigation(event, event.url); });
  wc.setWindowOpenHandler(({ url }) => {
    try { wc.loadURL(normalizeAddress(url)).catch(() => {}); } catch { /* non-web popups stay blocked */ }
    return { action: 'deny' };
  });
  wc.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) { captureReady = false; muteSource(); local.browserError = ''; } });
  wc.on('did-start-loading', browserState);
  wc.on('did-stop-loading', browserState);
  wc.on('page-title-updated', browserState);
  wc.on('did-navigate-in-page', browserState);
  wc.on('did-finish-load', () => { browserState(); scheduleCapture(); });
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { local.browserError = 'This page could not load. Check the address or your connection, then reload.'; local.browserLoading = false; sendState(); }
  });
  wc.on('render-process-gone', () => { if (quitting) return; captureReady = false; muteSource(); service.stopBroadcast().catch(() => {}); local.captureStatus = 'error'; local.captureMessage = 'The browser stopped. Reload to recover.'; sendState(); });
  captureWindow.webContents.on('render-process-gone', () => { if (quitting) return; captureReady = false; muteSource(); service.stopBroadcast().catch(() => {}); local.error = 'The audio engine stopped. Restart Browser Radio to recover.'; sendState(); });
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  captureWindow.webContents.on('will-navigate', event => event.preventDefault());
  captureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('close', event => { if (!allowExit) { event.preventDefault(); shutdown(); } });
  mainWindow.on('minimize', updateBrowserVisibility);
  mainWindow.on('restore', updateBrowserVisibility);
  Menu.setApplicationMenu(null);
  await mainWindow.loadFile(uiPath);
  await captureWindow.loadFile(path.join(__dirname, 'capture/index.html'));
  service.attachCapture(captureWindow.webContents);
  if (!smoke) mainWindow.show();
  wc.loadURL(smoke ? 'https://example.com/' : local.browserUrl).catch(() => {});
}

ipcMain.on('capture:status', (event, status, message) => {
  if (!fromCapture(event) || quitting) return;
  if (!['ready', 'error', 'ended'].includes(status)) return;
  captureReady = status === 'ready';
  local.captureStatus = status; local.captureMessage = String(message).slice(0, 300);
  if (captureReady) liveContents(browser)?.setAudioMuted(false);
  else { muteSource(); if (status === 'error') service.stopBroadcast().catch(() => {}); }
  sendState();
  if (status === 'ended') scheduleCapture(500);
});
ipcMain.on('controller:layout', (event, rect) => {
  if (!trusted(event) || !rect || !browser) return;
  const [width, height] = mainWindow.getContentSize();
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return;
  const x = Math.max(300, Math.min(width, Math.round(rect.x)));
  const y = Math.max(96, Math.min(height, Math.round(rect.y)));
  browserBounds = { x, y, width: Math.max(0, Math.min(width - x, Math.round(rect.width))), height: Math.max(0, Math.min(height - y, Math.round(rect.height))) };
  browser.setBounds(browserBounds);
  updateBrowserVisibility();
});

ipcMain.handle('controller:action', async (event, action, payload) => {
  if (!trusted(event)) return { ok: false, error: 'Untrusted request.' };
  try {
    switch (action) {
      case 'state': return { ok: true, state: state() };
      case 'join': local.error = ''; await service.join(); break;
      case 'leave': await service.leave(); break;
      case 'start': if (!captureReady) throw new Error('Wait for browser audio to be ready, or reload the page.'); await service.startBroadcast(); break;
      case 'stop': await service.stopBroadcast(); break;
      case 'volume': if (!Number.isFinite(payload)) throw new Error('Invalid volume.'); local.volume = Math.max(0, Math.min(100, Math.round(payload))); await service.setVolume(local.volume); break;
      case 'monitor': local.monitor = payload === true; captureWindow.webContents.send('capture:monitor', local.monitor); break;
      case 'navigate': local.browserError = ''; browser.webContents.loadURL(normalizeAddress(payload)).catch(() => {}); break;
      case 'back': if (browser.webContents.navigationHistory.canGoBack()) browser.webContents.navigationHistory.goBack(); break;
      case 'forward': if (browser.webContents.navigationHistory.canGoForward()) browser.webContents.navigationHistory.goForward(); break;
      case 'reload': local.browserError = ''; browser.webContents.reload(); break;
      case 'hideBrowser': local.browserHidden = payload === true; updateBrowserVisibility(); break;
      case 'showSettings': settingsOpen = payload === true; updateBrowserVisibility(); break;
      case 'settings': {
        const next = validateSettings(payload, settings);
        store.write(next); settings = next; local.error = '';
        sendState(); await service.connect(settings); break;
      }
      case 'clearSettings': await service.destroy(); settings = null; store.clear(); local.error = ''; break;
      case 'dismissError': local.error = ''; await service.update({ error: '' }); break;
      case 'help': {
        const urls = {
          portal: 'https://discord.com/developers/applications',
          userId: 'https://support.discord.com/hc/en-us/articles/206346498',
          invite: service.state.botId ? `https://discord.com/oauth2/authorize?client_id=${service.state.botId}&permissions=3146752&scope=bot` : 'https://discord.com/developers/applications',
        };
        if (!Object.hasOwn(urls, payload)) throw new Error('Unknown help page.');
        await shell.openExternal(urls[payload]); break;
      }
      default: throw new Error('Unknown action.');
    }
    sendState(); return { ok: true, state: state() };
  } catch (error) {
    const message = service.sanitize(error);
    local.error = message; sendState(); return { ok: false, error: message, state: state() };
  }
});

app.on('second-instance', () => { if (!quitting && mainWindow && !mainWindow.isDestroyed()) { mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
// One ordered shutdown also handles close during navigation or capture restart.
function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  quitting = true; clearTimeout(captureTimer); clearTimeout(cookieTimer); muteSource();
  shutdownPromise = (async () => {
    const stopping = service?.shutdown();
    try { await liveContents(captureWindow)?.executeJavaScript('window.audioCapture.stop()'); } catch { /* renderer may already have exited */ }
    try {
      browserSession?.flushStorageData();
      await browserSession?.cookies.flushStore();
      session.defaultSession.flushStorageData();
      await session.defaultSession.cookies.flushStore();
    } catch { console.error('Could not flush browser storage during shutdown.'); }
    await stopping;
    if (blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
  })().catch(() => { console.error('Voice shutdown did not complete normally.'); }).finally(() => {
    allowExit = true;
    liveContents(browser)?.close();
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
    app.quit();
  });
  return shutdownPromise;
}
app.on('before-quit', event => {
  if (allowExit || !service) return;
  event.preventDefault(); shutdown();
});
app.whenReady().then(async () => {
  store = new SettingsStore(app.getPath('userData'), safeStorage);
  service = new VoiceHost({ diagnostics: smoke });
  service.on('state', sendState);
  try { settings = store.read(); }
  catch { local.error = 'Saved settings could not be opened on this Windows account. Enter the bot token again in Settings.'; }
  await setupWindows();
  sendState();
  if (settings && !smoke) service.connect(settings).catch(() => {});
  if (smoke) require('./smoke-test')({ app, mainWindow, browser, captureWindow, service, state, sendState, store });
}).catch(error => { console.error('Browser Radio startup failed:', error.message); app.exit(1); });
