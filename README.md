# Browser Radio

A personal Windows app that sends its embedded browser's audio to a Discord voice channel. Choose music in the browser, control the broadcast in the sidebar, and use **Join my channel** to bring the bot into your current room.

## Get started

Browser Radio runs on **Windows x64**. Build the portable app from this repository using Node.js 24 and pnpm 11:

```powershell
git clone https://github.com/leshobster/browser-radio.git
cd browser-radio
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm dist
```

Open `dist/Browser-Radio-1.0.2-Windows.exe`. The generated executable includes its browser and runtime; running it does not require Node.js, a Chrome extension, a virtual audio cable, or FFmpeg. Build output is excluded from Git, so the executable is generated locally.

You will also need a Discord bot token, your Discord user ID, and permission to invite the bot to a server. Set those up in the app as described below.

## Connect a bot once

1. Open **Settings → Developer Portal**. Create an application at [Discord Developer Portal](https://discord.com/developers/applications), open **Bot**, and copy/reset its bot token.
2. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click yourself and choose **Copy User ID**.
3. Enter your user ID and bot token into Browser Radio's settings. Click **Save & connect**. The token stays in the app and is encrypted for your Windows account. Do not paste it into chat or source files.
4. Click **Invite bot** and add it to the server where you listen. You need permission to install a bot there. Grant **View Channel**, **Connect**, and **Speak**, including any channel overrides. Administrator, message-reading privileges, and slash commands are unnecessary.
5. Close Settings, join a normal server voice channel in Discord, then click **Join my channel** in Browser Radio.

The application uses a bot account, not your personal Discord token. It supports normal server voice channels; group calls, direct calls, and Stage channels are outside this version.

## Listen

- Use the separate **YouTube** and **YouTube Music** toolbar buttons to open either site in the embedded browser.
- Select and play something in the embedded browser, then click **Start broadcast**. The browser's own controls handle play/pause, seeking, playlists, and autoplay.
- Transmission targets 256 kbps Opus in music mode, with stereo and fullband encoding.
- **Broadcast volume** controls what Discord receives. **Listen locally** controls whether you also hear the source directly on this computer. Local listening starts off each time, avoiding double playback when you listen through Discord.
- **Stop broadcast** silences Discord while keeping the bot connected. Source playback continues unless you pause it in the browser.
- **Leave** disconnects the bot and stops the broadcast. If you move channels or leave Discord yourself, the bot keeps playing until you click Leave or quit. Click **Join my channel** again to move it explicitly.
- **Hide browser** hides the web view while its audio continues. Show it again to choose music. This reduces display work; the site still needs its browser process and may keep decoding video.
- **Minimize** hides the browser view automatically and keeps audio running. **Close** quits and disconnects. There is no tray mode.

Only the embedded browser is captured. Microphone audio, Discord audio, and other apps are excluded. Whatever the source page plays—including advertisements—is included. There is one browser source at a time.

This browser has its own persistent session. It does not import your normal Chrome profile. Google may decline sign-in inside an embedded browser; signed-out YouTube playback is supported, and successful site sessions are retained. Sites requiring DRM or special browser capabilities may not play.

## Audio quality and performance

Capture uses **48 kHz, stereo, 16-bit PCM** in 20 ms frames. Echo cancellation, noise suppression, and automatic gain control are disabled. Discord transmission uses native Opus encoding at a **256 kbps target**, constrained variable bitrate, two channels, fullband, and complexity 10. Actual bitrate varies with the audio; source quality and Discord playback also affect what you hear.

The audio engine sends frames directly to a separate voice process. An 80 ms starting buffer absorbs short scheduling gaps, and a bounded queue drops stale frames if playback falls behind. Hiding or minimizing the browser keeps playback alive and reduces display work, but does not unload the page or guarantee that a video site stops decoding video. There is no equalizer or visualizer.

## Saved data

Settings, browser sessions, and their encryption key live in `%APPDATA%\Browser Radio`, independent of where the portable EXE is stored or extracted. The bot token is encrypted with Electron's `safeStorage` for your Windows account. Closing the app flushes browser storage before shutdown.

Keep this profile folder private: it contains bot credentials and website sessions. **Forget saved bot** removes the app's saved bot credentials and disconnects it; it does not sign you out of websites. Use each website's own sign-out controls for that. Never put a real token in source files, issues, or commits.

## If something needs attention

- **Cannot find your channel:** join a server voice channel and ensure the bot is installed in that same server. If Discord reports multiple voice sessions, leave the extra one and retry.
- **Cannot join:** check View Channel, Connect, and Speak permissions, channel capacity, and network/firewall access to Discord voice.
- **No audio:** confirm that the browser page is playing, its player volume is up, the status says Browser audio ready, the bot is connected, and the broadcast is started. Server-muting the bot also prevents others hearing it.
- **Browser audio error:** reload the page. An audio engine crash requires restarting the app.
- **Connection interrupted:** the app discards stale sound instead of replaying a backlog. It attempts to recover the current voice connection; after unsuccessful recovery, click Join again.
- **Changed token or Windows account:** enter the token again in Settings. **Forget saved bot** disconnects it and removes its saved credentials from this app.

## Development

After installing dependencies as above, run from source or use the checks below:

```powershell
pnpm start
pnpm test
pnpm test:audio
pnpm test:smoke
pnpm dist
```

Electron 44 installs its binary with the explicit `install.js` command. The lockfile pins dependencies. The disabled `electron-winstaller` build script belongs to the unused Squirrel installer; this app uses a portable build.

`test:audio` runs a hidden stereo-tone capture test, checks capture while minimized, exercises the Opus encoder, and reports DAVE availability. `test:smoke` uses a fresh test profile and actually closes and reopens the app to check token, cookie, and localStorage persistence. It verifies 90 seconds hidden, 90 seconds minimized, and a 3-second UI stall through native Opus playback. Reports and a screenshot go in `artifacts/`. Set `BROWSER_RADIO_EXECUTABLE` to the portable EXE to repeat the same checks on the distributed app. Neither test connects to a real Discord server. A real voice-channel listening test requires a configured bot and a human listener.

## Design

- Electron hosts a sandboxed `WebContentsView` for web content and separate trusted controller/audio-engine pages. Web pages have no Node.js access, app bridge, or bot token.
- Electron's display-media handler selects that exact browser frame and suppresses its direct local audio. Web Audio provides the optional local-listening branch and 48 kHz stereo PCM.
- A direct audio message channel feeds a separate voice utility process, keeping Discord timing independent of the controller. Native Opus encoding uses `@evan/opus` at 256 kbps with explicit stereo/fullband and complexity 10. An 80 ms starting buffer absorbs short scheduling gaps; queues remain bounded. `@discordjs/voice` handles voice transport and DAVE encryption. `Guilds` and `GuildVoiceStates` gateway intents locate the configured owner in shared servers.

See [the agreed design](docs/design-discussion.md), [project terminology](CONTEXT.md), and [the browser architecture decision](docs/adr/0001-embed-the-audio-source-browser.md).

Recorded test results and the remaining live listening check are in [verification notes](docs/verification.md). Automated checks do not establish performance during every game or confirm audio quality over a live Discord connection.

## License

[MIT](LICENSE).
