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

1. On **both** phones: Workman Chat → Bluetooth screen → **Pair a phone**, and pair the two phones in Android settings.
2. Open Workman Chat on **both** phones.
3. On either phone tap **Connect** next to the other phone.
   (After pairing in Android, come back to the app – the list refreshes by itself. **Refresh** also asks again for the Bluetooth permission if you refused it.) Done – chat, photos, videos and files now go over Bluetooth.
   The two phones also swap their Workman IDs automatically.

## 3. Chat and call from far away (free Firebase, ~5 minutes, once)

This is what lets you keep chatting when a friend leaves Bluetooth range, and it powers calls.

1. Go to <https://console.firebase.google.com> → **Add project** (any name, you can turn Analytics off).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**
3. **Build → Realtime Database → Create database** → pick a location → **Start in locked mode**.
   Open the **Rules** tab, replace everything with the contents of `firebase-rules.json`, press **Publish**.
4. Copy two things:
   - **Database URL** – shown at the top of the Realtime Database *Data* tab (like `https://xxxx-default-rtdb.firebaseio.com`).
   - **Web API key** – Project settings (gear icon) → General → *Web API Key*.
     (If it isn't shown, click **Add app → Web `</>`**, register any name, and copy the `apiKey`.)
5. Paste them into `config.js` in your repo **before** building, so every phone is ready on first launch.
   Or type them in the app on each phone: ⋮ menu → **Internet ID & contacts**.
6. Every phone has a **Workman ID** (like `WK-ABCD2345`). Friends can add each other with **Add friend by ID**,
   or just connect once over Bluetooth and the IDs are swapped automatically.

## How the automatic switching works

| Situation | What happens |
|---|---|
| Phones connected over Bluetooth | Messages go over Bluetooth, using no data |
| Friend walks out of range but has data | The next message goes over the internet in the same chat |
| Neither works | Messages wait in the chat (🕒) and send by themselves when Bluetooth or internet comes back |

## Good to know

- **Calls** (voice and video) need internet on **both** phones; Bluetooth cannot carry video calls.
  They use free Google STUN servers. On some mobile networks a call connects but stays silent;
  if that happens add a TURN relay in *Internet ID & contacts → Call relay*.
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
