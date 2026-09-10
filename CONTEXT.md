# Browser Audio Bot

The owner controls a browser audio broadcast into a Discord voice channel from a graphical interface.

## Language

**Owner**:
The person operating the controller and choosing the Discord voice channel for the broadcast.
_Avoid_: Bot user, listener

**Controller**:
The graphical interface through which the owner manages the bot and its broadcast.
_Avoid_: Discord commands, remote

**Audio source**:
The playback in the app's embedded browser selected for the broadcast.
_Avoid_: Download, extracted track

**Broadcast**:
The audio delivered by the bot to a Discord voice channel.
_Avoid_: Screen share, microphone

**Destination channel**:
The Discord voice channel receiving the broadcast.
_Avoid_: Music channel, source channel

**Join my channel**:
The controller action that connects the bot to the owner's current Discord voice channel.
_Avoid_: Follow me

**Local listening**:
Playback of the audio source through the owner's own speakers or headphones, separately from listening to the broadcast in Discord.
_Avoid_: Echo, preview
