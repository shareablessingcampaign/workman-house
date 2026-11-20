# Workman Chat

<img src="docs/icons/store-512.png" width="96" align="right" alt="Workman Chat logo">

Chat that works **nearby with no internet and no mobile data**, and **online** when you have internet. The app picks the route automatically and queues messages when neither is available.

| Part | Folder | What it is |
|------|--------|-----------|
| **Android app** | `android/` | The real app. Google **Nearby Connections** (Bluetooth / Wi-Fi Direct, ~100 m, no data) + optional **Firebase** (internet). |
| **Web preview** | `docs/` | Installable demo page on GitHub Pages. Bluetooth is **simulated** – browsers cannot do phone-to-phone Bluetooth chat. |

## How messages travel

| Situation | What happens |
|-----------|--------------|
| Phones close together, no internet | Sent directly phone-to-phone (Nearby). Free, no data. |
| Phones far apart, internet on | Sent through Firebase. |
| Both available | Both are used; duplicates are dropped automatically. |
| Neither available | Message shows "waiting…" and is sent the moment a link appears. |
| A phone with internet near a phone without | It acts as a **gateway**: relays messages between Nearby and the internet. Nearby phones also relay for each other (mesh). |

Everything leaving the phone is **AES-256 encrypted** with a key made from your secret room code. Only phones with the same code can read it.

## Deploy on GitHub (about 5 minutes)

1. Create a new **empty** repository on GitHub. Upload everything in this folder keeping the structure (`.github`, `android`, `docs`, `README.md`). The `.github` folder is hidden on some systems – make sure it is included.
2. **Web preview:** *Settings → Pages → Source: GitHub Actions*, then *Actions → Deploy web preview → Run workflow*.
3. **Android app:** *Actions → Build Android APK → Run workflow* (also runs on every push to `main`). After ~5 minutes the APK is at
   `https://github.com/<you>/<repo>/releases/latest/download/WorkmanChat.apk`
4. Open that link on each phone and install (allow *Install unknown apps* for your browser).

> This version was written without being compiled. If the Actions build fails, open the failed run, copy the red error lines and send them over – it is normally a one-line fix.

## Use it

1. Install on **every** phone. First launch: enter your name and a **secret room code** – the same on all phones (at least 4 characters).
2. Allow the permissions (Nearby devices / Location on older Android). Turn **Bluetooth and Wi-Fi ON** (they do not need to be connected to anything; Wi-Fi can have no internet).
3. Chat. The two chips at the top show **Nearby** (how many phones are linked) and **Internet** (status).

## Optional: set up internet chat (free Firebase, ~3 minutes)

1. Go to <https://console.firebase.google.com> → **Add project** (turn Analytics off).
2. **Build → Realtime Database → Create database** (any location) → start in **locked mode**.
3. Open the **Rules** tab, replace everything with the rules below, **Publish**:

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        ".write": true,
        "msgs": {
          "$msg": {
            ".validate": "newData.hasChildren(['d','t']) && newData.child('d').isString() && newData.child('d').val().length < 8000"
          }
        }
      }
    }
  }
}
```

4. On the **Data** tab copy the URL at the top, like `https://your-project-default-rtdb.firebaseio.com`.
5. In the app: **Settings → Internet database URL** → paste it on every phone.

Why open rules are acceptable here: the room folder name is a hash of your secret code, the list of rooms cannot be read, and every message is encrypted. Use a long, hard-to-guess room code. Old messages stay in the database until you delete them in the Firebase console.

## Good to know / limits

- **Text only** for now (photos, voice, calls are in the web preview, not yet in the Android app).
- Works while the app is **open** (it pauses when the phone is locked or the app is closed; no notifications yet).
- Needs **Google Play Services** (almost all phones outside China/Huawei). Phones must be Android 7+.
- Nearby range is about 100 m in the open, less through walls.
- Messages are stored on each phone (last 300). The APK is a debug build – fine for your own phones.
- Truly no Bluetooth/Wi-Fi/internet (e.g. SMS or satellite) is not included.

## Build it yourself

Open `android/` in Android Studio, or `cd android && gradle assembleDebug` (JDK 17, Android SDK 35). Web preview locally: `cd docs && python3 -m http.server 8000`.
