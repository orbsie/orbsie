# Android published-player renderer comparison

An existing signed-out publication, `https://orbsie.com/o/pub-accept-mtwcf5pk`,
loaded its wrapper and independent player on Android 15 emulator Chrome. The
player showed its controls and score, but the game world was blank. This
publication predates the Android SwiftShader fix and retains its own runtime.

For a read-only comparison, the same public `project.json` and `index.html`
were served locally with the current committed `public/player/runtime.js` and
supporting player files. That player reported ready, selected compatibility
graphics, and visibly rendered the island, objects, collectible, and mobile
controls. There were no page errors, blocked requests, or horizontal overflow.
The screenshots were visually inspected. No model calls, project edits, or
publication writes occurred.

This establishes that a fresh artifact using the current runtime renders this
project on the emulator. It does not update the older immutable publication or
complete a newly published live acceptance run, physical Android testing, or
iOS testing.
