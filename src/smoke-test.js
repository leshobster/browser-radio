/* Opt-in verification: isolated profile, synthetic credential, real close/restart. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ app, mainWindow, browser, captureWindow, service, state, store }) => {
  const phase = process.env.RADIO_TEST_PHASE || 'write';
  const out = process.env.RADIO_TEST_OUTPUT || path.resolve(process.cwd(), 'artifacts');
  const reportFile = path.join(out, `${process.env.RADIO_TEST_REPORT || 'regression'}-${phase}.json`);
  const report = { phase, checks: [], consoleErrors: [], profile: app.getPath('userData'), sessionData: app.getPath('sessionData'), executable: process.execPath };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, label, timeout = 25000) => {
    const start = Date.now();
    while (!(await predicate())) { if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`); await delay(100); }
  };
  const js = script => mainWindow.webContents.executeJavaScript(script, true);
  const fake = { ownerId: '123456789012345678', token: 'synthetic-test-only-secret-1234567890' };
  for (const wc of [mainWindow.webContents, captureWindow.webContents]) wc.on('console-message', details => { if (details.level === 'error') report.consoleErrors.push(details.message); });
  process.on('uncaughtException', error => { report.uncaught = error.stack; save(); app.exit(1); });
  process.on('unhandledRejection', error => { report.unhandled = String(error); save(); app.exit(1); });
  app.on('will-quit', () => { report.normalQuit = true; save(); });
  const duration = Number(process.env.RADIO_TEST_DURATION || 90000);
  save();
  const deadline = setTimeout(() => { report.error = 'Regression test timed out'; save(); app.exit(1); }, duration * 2 + 90000);
  try {
    await waitFor(() => state().captureStatus === 'ready', 'capture ready');
    assert.equal(report.profile, report.sessionData);
    if (phase === 'read') {
      assert.deepEqual(store.read(), fake);
      assert(state().hasSettings);
      const cookies = await browser.webContents.session.cookies.get({ url: 'https://example.com/', name: 'radio-regression' });
      assert.equal(cookies[0]?.value, 'retained');
      assert.equal(await browser.webContents.executeJavaScript('localStorage.getItem("radio-regression")'), 'retained');
      assert.equal(await js('document.getElementById("settings-dialog").open'), false);
      report.checks.push('Encrypted bot token, owner ID, browser cookie and localStorage survived a real process restart.');
    } else {
      assert.equal(state().hasSettings, false);
      await waitFor(() => js('document.getElementById("settings-dialog").open'), 'setup dialog');
      assert.equal(await js('document.getElementById("monitor").checked'), false);
      store.write(fake);
      assert(!fs.readFileSync(store.file, 'utf8').includes(fake.token));
      await browser.webContents.session.cookies.set({ url: 'https://example.com/', name: 'radio-regression', value: 'retained', expirationDate: Date.now() / 1000 + 86400, secure: true });
      await browser.webContents.executeJavaScript('localStorage.setItem("radio-regression", "retained")');
      report.checks.push('First-run setup and encrypted credential save.');
      await js('document.getElementById("settings-close").click()');
      assert.equal(await browser.webContents.executeJavaScript('typeof require + ":" + typeof window.radio'), 'undefined:undefined');
      assert.equal((await js('window.radio.navigate("file:///C:/Windows/win.ini")')).ok, false);
      await js('window.radio.dismissError()');
      assert.equal(await js('document.querySelectorAll("#meter-fill, .signal-card").length'), 0);
      report.checks.push('Remote page has no privileged bridge; file navigation blocked; visualizer removed.');
      assert.equal((await js('window.radio.volume(37)')).ok, true);
      assert.equal(state().volume, 37);
      await js('window.radio.monitor(true)'); assert.equal(state().monitor, true);
      await js('window.radio.monitor(false)'); assert.equal(state().monitor, false);
      const capture = await captureWindow.webContents.executeJavaScript('window.audioCapture.status()');
      assert.equal(capture.videoTracks, 0); assert.equal(capture.audioTracks, 1); assert.equal(capture.connected, true);
      report.checks.push('Capture retains only audio, with a direct connection to the voice process.');
      await browser.webContents.executeJavaScript(`window.probeContext=new AudioContext();const o=probeContext.createOscillator();const g=probeContext.createGain();g.gain.value=.1;o.connect(g).connect(probeContext.destination);o.start();probeContext.resume()`, true);
      mainWindow.show();
      await js('document.getElementById("hide-browser").click()');
      assert(state().browserHidden); assert.equal(browser.getVisible(), false);
      await delay(300);
      fs.writeFileSync(path.join(out, 'browser-hidden.png'), (await mainWindow.webContents.capturePage()).toPNG());
      await service.command('probeStart');
      await delay(duration);
      report.hidden = await service.command('probeStop');
      report.capture = await captureWindow.webContents.executeJavaScript('window.audioCapture.status()'); save();
      assert(report.hidden.audible > duration / 20 * .95, `Hidden audio stalled: ${JSON.stringify(report.hidden)}`);
      assert(report.hidden.native, 'Native Opus binding was not loaded');
      assert(report.hidden.maxGapMs < 100, 'Hidden playback gap exceeded 100 ms');
      report.checks.push('Hidden browser sustains native Opus playback.'); save();
      await js('document.getElementById("hide-browser").click()');
      mainWindow.minimize();
      assert.equal(browser.getVisible(), false);
      await service.command('probeStart');
      await delay(duration);
      const before = await service.command('probeStats');
      // Deliberately stall the entire main/UI event loop. Audio must keep moving.
      const end = performance.now() + 3000;
      while (performance.now() < end) { Math.sqrt(Math.random()); }
      report.minimized = await service.command('probeStop');
      assert(report.minimized.audible - before.audible > 130, 'UI stall interrupted voice processing');
      assert(report.minimized.audible > (duration + 3000) / 20 * .95);
      assert(report.minimized.maxGapMs < 100, 'Minimized playback gap exceeded 100 ms');
      assert.deepEqual(report.minimized.errors, []);
      report.checks.push('Minimized playback survives prolonged background operation and a 3-second UI stall.');
      mainWindow.restore();
      assert.equal(browser.getVisible(), true);
      await js('window.radio.hideBrowser(true)');
      await js('window.radio.showSettings(true)');
      await js('window.radio.showSettings(false)');
      assert.equal(browser.getVisible(), false);
      report.checks.push('Settings and minimize/restore preserve the explicit browser visibility choice.');
    }
    assert.deepEqual(report.consoleErrors, []);
    if (phase === 'read' && process.env.RADIO_TEST_YOUTUBE === '1') {
      mainWindow.show();
      await js('window.radio.hideBrowser(false)');
      for (const [button, hostname] of [['youtube', 'www.youtube.com'], ['youtube-music', 'music.youtube.com']]) {
        await js(`document.getElementById('${button}').click()`);
        let handledConsent = false;
        await waitFor(async () => {
          const currentHost = new URL(browser.webContents.getURL()).hostname;
          if (currentHost === 'consent.youtube.com' && !handledConsent && !browser.webContents.isLoading()) {
            // Only the opt-in harness chooses cookies, in its synthetic profile.
            handledConsent = await browser.webContents.executeJavaScript(`(() => { const button = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Reject all'); if (!button) return false; button.click(); return true; })()`, true);
          }
          return currentHost === hostname && !browser.webContents.isLoading();
        }, `${button} loaded`, 45000);
        await waitFor(() => state().captureStatus === 'ready', 'capture after navigation');
        report.checks.push(`${button} toolbar button opens ${hostname} and capture recovers.`);
      }
      await js('window.radio.hideBrowser(true)');
      mainWindow.setSize(1000, 720);
      await delay(500);
      fs.writeFileSync(path.join(out, 'toolbar-compact.png'), (await mainWindow.webContents.capturePage()).toPNG());
    }
    report.passed = true; save();
    clearTimeout(deadline);
    browser.webContents.reload();
    mainWindow.close();
  } catch (error) {
    report.failureBrowserUrl = browser.webContents.getURL();
    report.failureBrowserTitle = browser.webContents.getTitle();
    fs.writeFileSync(path.join(out, 'failed-browser.png'), (await browser.webContents.capturePage()).toPNG());
    report.error = error.stack; save(); console.error(error.stack); clearTimeout(deadline); app.exit(1);
  }
};
