# Workman Chat – get the Android app

## 1. Build the APK on GitHub (no computer tools needed)

1. In your Workman Chat repository, upload **all** the files from this folder (replace the old ones).
   The icons now sit next to `index.html` instead of in an `icons/` folder.
   Make sure the hidden folder `.github/workflows/` is included.
2. Open the repo's **Actions** tab. A run called **Build Android APK** starts by itself (about 6–10 minutes).
   If it doesn't, open it and press **Run workflow**.
3. When it turns green, open the repo's **Releases** page and download **WorkmanChat.apk**
   (the in-app “Download Android APK” button points to the same file).
4. Send the APK to both phones, open it, and allow **Install unknown apps** when Android asks.
5. First launch: allow **Nearby devices** (Bluetooth), then **Microphone / Camera** when you make a call.

If the build fails, open the failed run, copy the red error text and send it to me – I'll fix it.

> **Inside the app:** tap **⋮ → Help & user guide** for these instructions in plain steps.

## 2. Connect two phones over Bluetooth

1. Install the APK on **both** phones and turn Bluetooth on.
2. On the **first** phone: open the Bluetooth screen (top bar icon) -> **Pair a phone** -> allow *Nearby devices* -> **Let others find me** -> Allow.
3. On the **second** phone: **Pair a phone** -> allow *Nearby devices* -> tap the first phone in the list -> **Pair**. Confirm the code on both phones.
4. Open Workman Chat on both phones and tap **Connect** next to the other phone.

If searching fails, the app says why and opens Android's own Bluetooth screen. **Check Bluetooth** shows a plain-language self-test
(module present, Bluetooth on, permissions), and **Open Android Bluetooth settings instead** is always available.

## 3. Chat and call from far away (free Firebase, ~5 minutes, once – by the app owner only)

This lets friends keep chatting when they leave Bluetooth range, and it powers calls. **Your users never see any of this.**

1. Go to <https://console.firebase.google.com> -> **Add project** (any name, Analytics off).
2. **Build -> Authentication -> Get started -> Sign-in method -> Anonymous -> Enable -> Save.**
3. **Build -> Realtime Database -> Create database** -> pick a location -> **Start in locked mode**.
   Open the **Rules** tab, replace everything with the contents of `firebase-rules.json`, press **Publish**.
4. Copy two things:
   - **Database URL** - top of the Realtime Database *Data* tab (like `https://xxxx-default-rtdb.firebaseio.com`).
   - **Web API key** - Project settings (gear) -> General -> *Web API Key*
     (if it isn't shown: **Add app -> Web `</>`**, any name, copy the `apiKey`).
5. **Zero-setup for everyone (recommended):** open `config.js` in your repo, paste the values, commit. The next build works out of the box:

   ```js
   window.WC_CONFIG = {
     firebaseApiKey: 'AIza...',
     firebaseDatabaseUrl: 'https://xxxx-default-rtdb.firebaseio.com',
     turnServer: '',        // optional call relay: turn:host:3478|username|password
     setupCode: ''          // OR paste one "WK1-..." code here instead of the fields above
   };
   ```

6. **Already-installed phones:** open the app -> menu -> **Internet ID & contacts** -> **Share setup code** (on a phone that works) and send the code
   to friends. They paste it into **Quick Connect** and tap **Connect**. On the web version a shared link ending in `#setup=WK1-...` does it automatically.
7. Every phone has a **Workman ID** (like `WK-ABCD2345`). Friends add each other with **Add friend by ID**,
   or connect once over Bluetooth and the IDs are swapped automatically.

Values typed or pasted inside the app (Internet ID & contacts -> *Advanced / Custom Server*, or Quick Connect) override the defaults in `config.js` on that phone.

## How the automatic switching works

| Situation | What happens |
|---|---|
| Phones connected over Bluetooth | Messages go over Bluetooth, using no data |
| Friend walks out of range but has data | The next message goes over the internet in the same chat |
| Neither works | Messages wait in the chat (🕒) and send by themselves when Bluetooth or internet comes back |

## Good to know

- **Calls** (voice and video) need internet on **both** phones; Bluetooth cannot carry video calls.
  They use free Google STUN servers. On some mobile networks a call connects but stays silent;
  if that happens set `turnServer` in `config.js` (or add it under *Internet ID & contacts → Advanced / Custom Server*).
- **Files over the internet** are limited to about 700 KB (photos are shrunk automatically). Over Bluetooth the limit is 25 MB.
- The app has to be **open** (it can be in the background for a short while) to receive messages and calls.
  Notifications while the app is fully closed need Firebase push messaging, which is a separate step we can add next.
- The APK is signed with a debug key – fine for your own phones. Updating means installing the new APK over the old one.

## The app icon

The launcher icon is your original logo (`icon-512.png`). `icon-foreground.png` is the same logo scaled to fit Android's safe zone,
so phones never crop it. `patch-android.js` installs it during the build. To change the logo, replace `icon-512.png`,
`icon-192.png`, `icon-maskable-512.png` and `icon-foreground.png`.

## If the build says "WorkmanBTPlugin.java is missing"

Upload `WorkmanBTPlugin.java` and `MainActivity.java` next to `index.html`. The build now stops on purpose in that case,
because an app built without them installs fine but its Bluetooth buttons do nothing.
