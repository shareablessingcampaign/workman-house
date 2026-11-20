// Runs after `npx cap add android`: adds the Bluetooth plugin, permissions, and icon.
const fs = require('fs');
const path = require('path');
const root = __dirname;
const main = path.join(root, 'android', 'app', 'src', 'main');

function findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name === name) {
      return p;
    }
  }
  return null;
}

// 1) Java plugin + MainActivity that registers it
const mainActivity = findFile(path.join(main, 'java'), 'MainActivity.java');
if (!mainActivity) {
  console.error('MainActivity.java not found - did cap add android run?');
  process.exit(1);
}
const javaDir = path.dirname(mainActivity);
const pkgLine = fs.readFileSync(mainActivity, 'utf8').match(/^package\s+([^;]+);/m);
if (!pkgLine || pkgLine[1] !== 'com.workman.chat') {
  console.error('Unexpected package in MainActivity.java:', pkgLine && pkgLine[1]);
}
for (const f of ['WorkmanBTPlugin.java', 'MainActivity.java']) {
  const srcFile = path.join(root, 'native', f);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, path.join(javaDir, f));
  }
}
console.log('Java files installed in ' + javaDir);

// 2) Manifest permissions
const manifestPath = path.join(main, 'AndroidManifest.xml');
let m = fs.readFileSync(manifestPath, 'utf8');
if (!m.includes('BLUETOOTH_CONNECT')) {
  const perms = [
    '    <uses-permission android:name="android.permission.BLUETOOTH" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />',
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
const valuesDir = path.join(res, 'values');
const anydpiDir = path.join(res, 'mipmap-anydpi-v26');
fs.mkdirSync(valuesDir, { recursive: true });
fs.mkdirSync(anydpiDir, { recursive: true });

const wcBg = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="wc_bg">#0b0f17</color>\n</resources>\n';
fs.writeFileSync(path.join(valuesDir, 'wc_colors.xml'), wcBg);

const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/wc_bg"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptive);
fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptive);
console.log('Adaptive icon XML written');
