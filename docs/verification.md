# Verification

## Version 1.0.2: Discord audio quality (2026-09-08)

The owner reports that local listening sounds clear but Discord sounds radio-like. Transmission now uses 256 kbps Opus, complexity 10, explicit two-channel/fullband encoding, and constrained VBR. Browser capture and the separate voice process remain the same.

Eleven logic tests pass. The new fidelity test decodes the actual produced packets and checks 60 Hz, 1 kHz, 8 kHz, 16 kHz and 18 kHz tones: gain stays within 1 dB, the silent opposite channel remains quiet, and packets stay within the codec size limit. A 300-second stereo-tone benchmark took about 1.55 seconds to encode with the new settings, versus 0.68 seconds with the previous settings; this is encoder-only work on synthetic audio, not a total app or gaming CPU measurement. Report: `artifacts/quality-benchmark.json`.

The previous 128 kbps encoder also retained the full frequency band in the diagnostic tones. That means a simple codec bandpass cut was not reproduced, and the higher bitrate is a quality improvement, not proof of the cause of the owner's live Discord symptom. End-to-end listening remains necessary.

The toolbar has separate YouTube and YouTube Music buttons. Both navigation paths and capture recovery pass against the actual sites; the test-only profile rejects optional cookies when Google redirects to consent. The buttons also fit the minimum 1000-pixel window width (visually inspected in `artifacts/toolbar-compact.png`). The web view uses the standard white base canvas so transparent pages such as Google's consent screen remain readable.

Before the toolbar-only changes, the same 256 kbps encoder passed 90 seconds hidden and 90 seconds minimized plus a 3-second UI stall in the portable EXE, with zero dropped queued frames and no playback gap over 60 ms. Reports: `artifacts/regression-1788888680000-write.json` and `artifacts/regression-1788888680000-read.json`.

The final portable EXE with both toolbar buttons passes its post-packaging smoke run: short hidden/minimized playback, the 3-second main-process stall, both actual site buttons (including first-run consent), and token/cookie/localStorage recovery after normal shutdown. Reports: `artifacts/regression-1788889265379-write.json` and `artifacts/regression-1788889265379-read.json`. Final artifact: `dist/Browser-Radio-1.0.2-Windows.exe`, SHA-256 `4594F72E4D3CAB01C22E152C0EC2C01B2D72FEBECE37C41001721F16A8B810D1`.

## Version 1.0.1: background playback and persistence

Target: Browser Radio 1.0.1, Windows x64, Electron 44.2.0 / Chromium 152, Discord voice library 0.19.2. Verification date: 2026-09-07.

## Changes under test

- Closing runs one ordered shutdown: mute source, stop audio and Discord, flush browser cookies/storage, then destroy windows. Late callbacks check whether their window and web contents still exist.
- Both userData and sessionData use `%APPDATA%\Browser Radio`, preserving the existing profile and encryption key independently of the portable EXE extraction directory. Cookie changes also receive a debounced disk flush.
- Discord transport and native Opus encoding run in a utility process. The capture renderer sends typed audio frames directly to it. No per-frame audio passes through the controller process.
- Capture stops its unused video track. Opus uses 48 kHz stereo, 128 kbps, complexity 5, and an 80 ms starting buffer with bounded queues.
- Hide browser and minimize hide the native web view without destroying its session or stopping audio. The explicit hide choice survives Settings and minimize/restore. The audio meter and its timer/IPC updates are removed.

## Completed checks

- Ten automated logic tests pass, including bounded buffers, prebuffering, Opus packet boundaries and decoded stereo, volume, navigation security, settings validation, channel discovery, Stop/Leave, and cancelled channel moves.
- Actual stereo capture passes: independent 440 Hz left / 660 Hz right tones remain separate and continue minimized. The native encoder and DAVE dependency load.
- The integrated development app passes normal shutdown and restart with an encrypted synthetic token, owner ID, persistent cookie, and localStorage. No renderer errors or uncaught shutdown exceptions.
- A copied instance of the owner's existing encrypted token is recoverable under the owner's Windows account. No token was displayed or sent to Discord, the originals were left unchanged, and the copied sensitive files were removed afterward.
- Visual inspection confirms the meter is gone and Hide/Show browser works. Screenshot: `artifacts/browser-hidden.png`.
- A same-input, same-settings encoder microbenchmark encoded 30 seconds of stereo audio in about 85 ms native versus 155 ms in the old WASM encoder. This measures encoding only, not total application or game performance.

The final portable EXE passed both launches with normal shutdown and no renderer or uncaught exceptions. Hidden playback delivered 4,498 audible frames over 90 seconds; minimized playback delivered 4,648 over 93 seconds including the deliberate UI stall. Neither phase dropped queued frames or had a playback gap over 60 ms (maximum observed: 33.84 ms). The second launch recovered the token, owner ID, cookie and localStorage, then loaded YouTube and re-established capture.

Exact reports: `artifacts/regression-1788802153274-write.json` and `artifacts/regression-1788802153274-read.json`. Artifact: `dist/Browser-Radio-1.0.1-Windows.exe`, SHA-256 `E524FE6BF3C19D74BD227E6696C4E0540E07998206027D2180148242CE60FB27`.

Portable executable regression results are recorded separately under `artifacts/regression-*-write.json` and `artifacts/regression-*-read.json`. The runner launches the actual portable EXE twice, checks its normal process exit, and requires the second process to recover the first process's saved data. The write phase tests 90 seconds hidden, 90 seconds minimized, and a 3-second deliberate main/UI event-loop stall.

## Remaining live check

Automated playback uses the real Chromium capture path, native Opus encoder/decoder and Discord audio-player scheduler, without authenticating a bot or sending to a server. Listening through an actual Discord voice connection during a game still requires the owner's bot/session. Successful Google login retention also depends on Google accepting and retaining that session; persistent browser cookie storage is verified with a synthetic cookie.

Suggested check: launch the new EXE, join a voice channel, click Join my channel, play music, and Start broadcast with Listen locally off. Hide the browser or minimize while gaming. Close and relaunch to confirm the saved bot and site session remain available.
