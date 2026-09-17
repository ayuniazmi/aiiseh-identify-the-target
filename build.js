#!/usr/bin/env node
/*
 * Inlines public/style.css and public/app.js into public/index.html to produce
 * a single self-contained page, written to both dist/index.html and the repo
 * root. The root copy is what GitHub Pages serves, so every source change has
 * to be rebuilt before it is pushed — run `npm run build`.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'public');
const read = f => fs.readFileSync(path.join(src, f), 'utf8');

const css = read('style.css');
const js = read('app.js');

let html = read('index.html');

const linkTag = '<link rel="stylesheet" href="style.css">';
const scriptTag = '<script src="app.js"></script>';

for (const [tag, name] of [[linkTag, 'style.css'], [scriptTag, 'app.js']]) {
  if (!html.includes(tag)) {
    console.error(`build failed: could not find the ${name} tag in public/index.html`);
    process.exit(1);
  }
}

// `$` is special in String.replace replacements — pass a function so CSS/JS
// containing "$&" or "$1" is inserted verbatim rather than being expanded.
html = html
  .replace(linkTag, () => `<style>\n${css}</style>`)
  .replace(scriptTag, () => `<script>\n${js}</script>`);

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
for (const out of [path.join(__dirname, 'dist', 'index.html'), path.join(__dirname, 'index.html')]) {
  fs.writeFileSync(out, html);
}

console.log(`built ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB -> dist/index.html and index.html`);
