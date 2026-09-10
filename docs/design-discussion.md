# Browser audio bot design discussion

Status: design confirmed by the owner on 2026-09-05; implementation, local verification, and Windows packaging verification complete. A live Discord listening check awaits the owner's bot setup.

## Requested behavior

- Provide a graphical interface controlled by the owner.
- Pipe actual browser audio into a Discord voice channel.
- Chrome, a controlled Chrome/Chromium instance, or a packaged browser are acceptable candidates.
- Reusing an existing YouTube login is desirable, not a stated requirement.
- Provide a button to join the Discord voice channel the owner is currently in.
- Discord text or slash commands are not needed.

## Facts established locally

- The project is an empty Git repository with no application or existing domain documents.
- The current environment is Windows, with Google Chrome installed.

## Open decisions

- None. The owner confirmed: "Yes—build this design."

Questions are being resolved in dependency order. Architectural decisions will be recorded once agreed.

## Agreed behavior

- Q1: Personal application running on the owner's Windows PC.
- Q2: Provide a local listening toggle, initially off.
- Q3: Join or move to the owner's current voice channel only when the owner clicks **Join my channel**. Do not automatically follow channel changes.
- Q4: Embed the browser in the app. YouTube login is optional; reuse of the existing Chrome login is not required.
- Q5: Keep broadcasting if the owner leaves the destination channel. Disconnect only on **Leave**, application quit, or a connection failure requiring it.
- Q6: Provide Join my channel, Leave, Start/Stop broadcast, broadcast volume, local listening, and connection/audio status. Use the embedded browser for song selection, seeking, and playlists.

## Proposed first-version design

The owner confirmed the following details together with the choices above.

- Deliver a personal Windows desktop app with an integrated browser and bot controller in one window.
- Provide one browser audio source at a time, initially opening YouTube, with address bar, back, forward, and reload. Persist browser session data locally; do not depend on Google sign-in succeeding.
- Capture only the embedded browser's audio. Discord, microphone input, and other applications are outside the audio source. Anything audibly played by the source page, including ads, is part of that source.
- First-time settings accept the bot token privately inside the app and the owner's Discord user ID. Guide the owner through inviting the bot to a server. Protect the saved bot token using Windows-backed storage; never request it in chat or commit it.
- Support normal Discord server voice channels where the bot is installed and has View Channel, Connect, and Speak permissions. Personal/group calls and Stage channels are outside the first version.
- Normal flow: open/play audio in the embedded browser, click **Join my channel**, then **Start broadcast**. Local listening starts off and can be toggled independently.
- **Stop broadcast** silences the outgoing stream while leaving the bot connected. The owner pauses actual source playback using the browser page.
- **Leave** disconnects the bot and stops broadcasting. Moving to another channel requires **Join my channel**; the bot stays in its destination when the owner moves or leaves.
- Minimize keeps the app and broadcast running. Closing the main window quits the app and disconnects; there is no background tray mode in the first version.
- Source or connection failures show a useful status. Discard old audio rather than replaying a backlog; attempt recovery of an interrupted connection only while the current session is still wanted. Explicit Leave/quit cancels recovery.
- Show the destination channel, connection state, broadcast state, and audio connection status. Broadcast volume is independent of local listening.

## Proposed implementation and verification

- Electron with an isolated embedded browser and a trusted local controller/capture page. Remote page content receives no bot token, Node.js access, or privileged app IPC.
- A frame-specific audio capture stream feeding normalized stereo PCM into a current DAVE-compatible Discord voice library. Use bounded live buffers and keep audio processing independent of visible UI rendering.
- Verify frame-only capture and local-listening behavior in a small technical prototype before building the complete interface. If the prototype contradicts the planned behavior, revisit the affected design instead of switching to system-audio capture silently.
- Verify owner-channel discovery, explicit movement, continued broadcast after owner departure, disconnect/rejoin, muted local playback, volume, minimization, and clean quit. Finish with a real Discord voice test once the owner provides bot setup inside the app.

## Feasibility findings

Research date: 2026-09-05. These findings describe candidate mechanisms, not a completed or tested implementation.

- Chrome's `tabCapture` can capture a chosen tab without capturing Discord or other applications. Capture requires an explicit extension invocation. An offscreen extension document can keep capture alive while the extension popup is closed. Existing Chrome uses its existing site login; a separate local audio branch can provide the agreed listening toggle. [Chrome tab capture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture), [Chrome capture guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture).
- An embedded Chromium browser can target a particular frame's audio through Electron's display media handler. Google sign-in may reject embedded or automated browsers, making a packaged browser a tradeoff against the desired existing YouTube login. [Electron session API](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts).
- A normal Discord bot can locate a configured owner's voice channel in shared servers with the standard `Guilds` and `GuildVoiceStates` gateway intents. This does not require reading messages or a personal Discord account token. [Discord gateway](https://docs.discord.com/developers/events/gateway), [Discord voice states](https://docs.discord.com/developers/resources/voice).
- The owner will need a bot token, their Discord user ID, and the bot installed in the intended server with View Channel, Connect, and Speak permissions. The intended initial destination is a normal server voice channel. [Discord setup](https://docs.discord.com/developers/quick-start/getting-started), [Discord permissions](https://docs.discord.com/developers/topics/permissions).
- Current Discord voice requires DAVE encryption. A compatible voice library must be used, with native dependencies verified in the packaged Windows app. [Discord voice connections](https://docs.discord.com/developers/topics/voice-connections), [Discord voice library release manifest](https://github.com/discordjs/discord.js/blob/%40discordjs%2Fvoice%400.19.2/packages/voice/package.json).
- A live audio bridge should use a bounded buffer, discard stale audio on disconnect, and resume from current playback. A local build and a real Discord voice session are still needed to verify sound, latency, and reconnection behavior.

## Follow-up fixes requested on 2026-09-07

The owner reported a close-time `isDestroyed` exception, stuttering after minimizing, and forgotten credentials/site sessions when running the portable EXE. Remove the audio visualization, retain broadcast volume, and add Hide/Show browser without interrupting playback. Preserve a stable Windows profile and flush it during orderly shutdown. Keep voice scheduling outside the UI process and avoid capturing unused video frames. Minimize also hides the browser view; restore respects the explicit Hide choice.
