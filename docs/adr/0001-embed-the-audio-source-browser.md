# Embed the audio source browser

The owner chose an embedded browser in a personal Windows desktop app so music playback and the bot controller live in one interface. Existing Chrome login reuse is optional, and Google sign-in inside the embedded browser is not a requirement. Use an isolated browser session and capture the source frame's audio; system audio is not the source.

An extension in the owner's normal Chrome would preserve an existing YouTube login but introduce separate installation and an extension invocation when selecting a source tab. A dedicated Chrome profile would also split the browsing experience from the controller. The owner preferred integration over those authentication benefits. This choice determines the app's browser host, capture path, and packaging.
