# AIISeh — Identify the Target

A spy-themed team bonding game. A classified question drops on screen and your
team has 15 seconds to call out a name before the file burns.

**Play it:** https://ayuniazmi.github.io/aiiseh-identify-the-target/

Built to be projected on a screen while one person hosts.

## How it works

`index.html` at the repo root is a self-contained build — all CSS and JS
inlined, no backend. That is what GitHub Pages serves, and it also runs
offline if you just download and double-click it.

Questions are stored in each visitor's own browser, so every host has their
own set. To share a set: **Setup → Copy all questions**, send the text to a
co-host, and they paste it in and hit **Replace all**.

## Source

- `public/` — the unbundled source (`index.html`, `style.css`, `app.js`)
- `server.js` — optional local Express server with JSON file storage,
  used only when running `npm start`; the hosted version never needs it

The app detects at startup whether a backend is available and falls back to
browser storage, so the same code serves both.
