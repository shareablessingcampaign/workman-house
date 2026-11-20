// Runs after `npx cap add android`: adds the Bluetooth plugin, permissions and launcher icon.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const main = path.join(root, 'android', 'app', 'src', 'main');

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (e.name === name) return p;
  }
  return null;
}

// 1) Java: plugin + MainActivity that registers it
const mainActivity = findFile(path.join(main, 'java'), 'MainActivity.java');
if (!mainActivity) { console.error('MainActivity.java not found - did "cap add android" run?'); process.exit(1); }
const javaDir = path.dirname(mainActivity);
const pkgLine = fs.readFileSync(mainActivity, 'utf8').match(/^package\s+([\w.]+);/m);
if (!pkgLine || pkgLine[1] !== 'com.workman.chat') { console.error('Unexpected package: ' + (pkgLine && pkgLine[1])); process.exit(1); }
for (const f of ['WorkmanBTPlugin.java', 'MainActivity.java']) {
  fs.copyFileSync(path.join(root, 'native', f), path.join(javaDir, f));
}
console.log('Java files installed in ' + javaDir);

// 2) Manifest permissions
const manifestPath = path.join(main, 'AndroidManifest.xml');
let m = fs.readFileSync(manifestPath, 'utf8');
if (!m.includes('BLUETOOTH_CONNECT')) {
  const perms = [
    '    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '    <uses-permission android:name="android.permission.CAMERA" />',
    '    <uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '    <uses-feature android:name="android.hardware.bluetooth" android:required="false" />',
    '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
    '    <uses-feature android:name="android.hardware.microphone" android:required="false" />'
  ].join('\n');
  m = m.replace('</manifest>', perms + '\n</manifest>');
  fs.writeFileSync(manifestPath, m);
}
console.log('Manifest permissions added');

// 3) Launcher icon (adaptive, uses the Workman Chat logo)
const res = path.join(main, 'res');
const wcBg = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="wc_bg">#0B141B</color>\n</resources>\n';
fs.writeFileSync(path.join(res, 'values', 'wc_colors.xml'), wcBg);
const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <background android:drawable="@color/wc_bg"/>\n    <foreground android:drawable="@mipmap/wc_foreground"/>\n</adaptive-icon>\n';
fs.mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);
console.log('Adaptive icon XML written (PNG sizes are made by scripts/make-icons.sh)');
