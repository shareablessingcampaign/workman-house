// Copies the web app into www/ (what Capacitor packages into the Android app).
const fs = require('fs');
const path = require('path');
const root = __dirname;
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = ['index.html', 'config.js', 'transport.js', 'sw.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png'];
for (const f of files) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) { console.error('Missing file: ' + f); process.exit(1); }
  fs.copyFileSync(src, path.join(out, f));
}
console.log('www/ ready (' + files.length + ' files)');
