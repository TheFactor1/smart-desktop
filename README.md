# Smart desktop

A desktop dashboard for a [Smart](https://github.com/TheFactor1/torbox-health-router) stream router, in Smart's Night Light design: a calm violet room after dark that turns to ember when TorBox is down.

- **Route attitude**: teal sky is today's share of searches that went through TorBox, orange ground is the share that fell to Usenet.
- **Ping tape** with the last 48 TorBox checks, **knobs** for routing, the search cache and Telegram alerts.
- **Households** with their TV, box, sound and Usenet quality (Auto or a saved profile), editable in a side drawer with a live capability check.
- **Alarms** follow one ladder: grey circle = note, amber triangle = caution, red diamond = warning. Colour only appears for a problem, and always with a shape.
- **Chart paper** draws the day's searches, with failures marked.
- A desktop notification when routing flips between TorBox and Usenet.

## Install

Download from [Releases](../../releases):

- **Windows**: `Smart_x.y.z_x64-setup.exe` (per-user, no admin) or the `.msi`.
- **Ubuntu / Debian**: `sudo apt install ./Smart_x.y.z_amd64.deb`
- **Any Linux**: the `.AppImage` (`chmod +x` and run).

## First run

Enter your Smart's web address and its admin token. The app checks them against the server before saving. The token goes into the OS keychain (Windows Credential Manager, or the Secret Service / GNOME Keyring on Linux) and is never shown again or handed to the page; only the Rust side reads it. **Connection → Sign out** removes it.

Setting up a brand-new Smart server from the app is planned but not built yet.

## How it talks to the server

It uses the same API as the Android app: `GET /app/api/summary` and `POST /app/api/action` with an `X-Admin-Token` header. All requests are made from Rust (reqwest). The Worker refuses POSTs carrying another site's `Origin`, and this also keeps the token out of the webview.

## Building

Releases are built by GitHub Actions (`.github/workflows/release.yml`) on every `v*` tag, for Ubuntu 22.04 (deb + AppImage) and Windows (NSIS + MSI).

Locally: install Rust, the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and `libdbus-1-dev`, then `npm ci && npx tauri build`.

To preview the screen in a browser with example data: `python3 -m http.server -d src` and open it. Outside the app it uses `src/mock.js` and never contacts a server.

## Credits

Fonts (SIL Open Font License): Outfit by Rodrigo Fuenzalida (the app's typeface), and for the older Atomic look kept for preview (`?theme=atomic`): Jost by Owen Earl (indestructible type*), Righteous by Astigmatic, B612 and B612 Mono by Intactile Design for Airbus, Courier Prime by Alan Dague-Greene for Quote-Unquote Apps. Packaged via Fontsource.

Built with [Tauri](https://tauri.app).
