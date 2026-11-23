// Runs after `npx cap add android`: installs the Bluetooth plugin, the permissions and the app icon.
// Works with the flat repo layout (all files next to index.html) and with native/ or scripts/ sub-folders.
const fs = require('fs');
const path = require('path');
const root = __dirname;
const main = path.join(root, 'android', 'app', 'src', 'main');

function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }
function findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (e.name === name) return p;
  }
  return null;
}
// Look for one of our own source files next to this script or in native/ or scripts/.
function ownFile(name) {
  for (const d of [root, path.join(root, 'native'), path.join(root, 'scripts')]) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 1) Java plugin + MainActivity that registers it (the build must stop if these are missing,
//    otherwise the app installs fine but Bluetooth buttons silently do nothing)
const mainActivity = findFile(path.join(main, 'java'), 'MainActivity.java');
if (!mainActivity) fail('MainActivity.java not found - did "cap add android" run?');
const javaDir = path.dirname(mainActivity);
const pkgLine = fs.readFileSync(mainActivity, 'utf8').match(/^package\s+([^;]+);/m);
if (!pkgLine || pkgLine[1] !== 'com.workman.chat') fail('Unexpected package in MainActivity.java: ' + (pkgLine && pkgLine[1]));
for (const f of ['WorkmanBTPlugin.java', 'MainActivity.java']) {
  const src = ownFile(f);
  if (!src) fail(f + ' is missing from the repository. Upload it next to index.html.');
  fs.copyFileSync(src, path.join(javaDir, f));
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
    '    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />',
    '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />',
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
// The share-the-app-file feature needs a FileProvider. Capacitor's template has one; add it only if it is missing.
m = fs.readFileSync(manifestPath, 'utf8');
if (!m.includes('FileProvider') && m.includes('</application>')) {
  const prov = '    <provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.fileprovider" android:exported="false" android:grantUriPermissions="true">\n' +
    '        <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/wc_file_paths" />\n    </provider>\n';
  m = m.replace('</application>', prov + '</application>');
  fs.writeFileSync(manifestPath, m);
  const xmlDir = path.join(main, 'res', 'xml');
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.writeFileSync(path.join(xmlDir, 'wc_file_paths.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n    <cache-path name="wc_cache" path="." />\n</paths>\n');
  console.log('FileProvider added');
} else {
  console.log('FileProvider already present');
}
console.log('Manifest permissions added');

// 3) Launcher icon: your original Workman Chat logo, placed inside Android's adaptive-icon safe zone
//    (icon-foreground.png = the logo scaled to fit) on the same dark colour, so no phone shape can crop it.
const res = path.join(main, 'res');
const valuesDir = path.join(res, 'values');
const nodpiDir = path.join(res, 'drawable-nodpi');
const anydpiDir = path.join(res, 'mipmap-anydpi-v26');
[valuesDir, nodpiDir, anydpiDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));
const fgSrc = ownFile('icon-foreground.png');
if (!fgSrc) fail('icon-foreground.png is missing from the repository. Upload it next to index.html.');
fs.copyFileSync(fgSrc, path.join(nodpiDir, 'wc_icon_fg.png'));
const XML = '<?xml version="1.0" encoding="utf-8"?>\n';
fs.writeFileSync(path.join(valuesDir, 'wc_colors.xml'), XML + '<resources>\n  <color name="wc_bg">#0B141B</color>\n</resources>\n');
const adaptive = XML + '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '  <background android:drawable="@color/wc_bg"/>\n' +
  '  <foreground android:drawable="@drawable/wc_icon_fg"/>\n</adaptive-icon>\n';
fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptive);
fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptive);
console.log('Adaptive icon written');
