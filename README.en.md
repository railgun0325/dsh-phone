# DSH Phone — an AI that taps its own screen, on your Android phone

> Puts [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) on an Android phone: the agent takes screenshots, taps, swipes, opens apps and runs commands by itself. **Install one APK → paste your API key → one tap. Everything deploys automatically.** Runs entirely on the phone; no PC required beyond optional Shizuku activation.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/railgun0325/dsh-phone/releases/latest"><img src="https://img.shields.io/github/v/release/railgun0325/dsh-phone?label=Latest%20Release" alt="Latest release"></a>
  <a href="#choose-a-variant"><img src="https://img.shields.io/badge/Android-11%2B-green.svg" alt="Android 11+"></a>
  <a href="#tool-matrix"><img src="https://img.shields.io/badge/Android%20Tools-28-4d6bfe.svg" alt="28 android tools"></a>
  <a href="#building-from-source"><img src="https://img.shields.io/badge/Build-Zero%20Gradle-orange.svg" alt="Zero Gradle"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-compatible-4d6bfe.svg" alt="DeepSeek Harness compatible"></a>
</p>

## Contents

- [What it does](#what-it-does)
- [Download & choose a variant](#download--choose-a-variant)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Tool matrix](#tool-matrix)
- [Architecture](#architecture)
- [Permissions & privacy](#permissions--privacy)
- [Tested devices & status](#tested-devices--status)
- [Known issues (v0.2.5)](#known-issues-v025)
- [FAQ](#faq)
- [Building from source](#building-from-source)
- [Repository layout](#repository-layout)
- [Security & responsibility](#security--responsibility)
- [Third-party components](#third-party-components)

## What it does

- **Two one-tap variants**: Root edition (rooted phones) and Shizuku edition (unrooted phones) — install APK → paste key → tap deploy; Termux / Node / DSH / plugins are installed automatically.
- **The agent operates Android natively**: 28 `android_*` tools — screen/UI tools (screenshot, tap, swipe, text input, key events, app launch, UI hierarchy dumps, APK install, arbitrary shell) plus hardware tools (status, sensors, camera, mic, TTS, media playback, volume, brightness, location, notifications, vibration, screen-off, wakelock, confirm dialog).
- **Runs fully on-device**: DSH lives in Termux + Node.js on the phone; the UI is the local Web GUI on port `3080` (bundled WebView shell). A PC is only needed for optional Shizuku activation or debugging.
- **Your API key stays on the phone**: the APK ships with no key; the key you paste is written only to the local Termux environment (`~/.dsh-api-key`, chmod 600) — never embedded, uploaded or committed.

## Download & choose a variant

| | Root edition | Shizuku edition |
|---|---|---|
| For | Rooted phones (Magisk / Kitsune / KernelSU…) | Any unrooted phone |
| Requires | Just the phone | Phone + one-time wireless-debugging authorization (Shizuku, ~30 s) |
| Install | APK → key → deploy | APK → activate Shizuku → key → deploy |
| Privilege | Agent holds root (spare phone advised) | adb-shell level, bounded by the OS |
| After reboot | Termux:Boot auto-start | Shizuku auto-start + Termux:Boot |
| Network self-heal | Built-in DNS fix (root) | None (needs working network) |

| Version | APK | Size | Checksums |
|---|---|---|---|
| v0.2.5 Root | [dsh-phone-root-v0.2.5.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.5/dsh-phone-root-v0.2.5.apk) | ~40.8 MB | [SHA256SUMS-v0.2.5.txt](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.5/SHA256SUMS-v0.2.5.txt) |
| v0.2.5 Shizuku | [dsh-phone-shizuku-v0.2.5.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.5/dsh-phone-shizuku-v0.2.5.apk) | ~42.5 MB | same file |

> All historical releases: [Releases](https://github.com/railgun0325/dsh-phone/releases). v0.2.x users can install over the existing app (data is preserved); v0.1.0 users must uninstall first (the signing key changed in v0.2.0).

## Quick start

<details open>
<summary><b>Root edition (3 steps)</b></summary>

1. Download and install [dsh-phone-root-v0.2.5.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.5/dsh-phone-root-v0.2.5.apk) (allow “unknown sources”).
2. Open the app and paste a DeepSeek API key ([platform.deepseek.com](https://platform.deepseek.com)).
3. Tap **deploy** → allow the superuser prompt → wait; the shell opens automatically.

Deployment is fully automatic: install Termux (bootstrap is embedded in the APK, no download needed) → configure mirrors → install Node/DSH → inject plugin & key → grant Termux:API hardware permissions → start the server.

</details>

<details>
<summary><b>Shizuku edition (4 steps)</b></summary>

1. Download and install [dsh-phone-shizuku-v0.2.5.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.5/dsh-phone-shizuku-v0.2.5.apk).
2. Open the app → tap deploy → follow the guide to **install Shizuku** and pair via wireless debugging (Developer options → Wireless debugging → pair code; a one-time OS security requirement).
3. Return to the app and paste your API key.
4. Tap **deploy** → wait; the shell opens automatically.

> After a reboot: open Shizuku once to confirm auto-start (most devices resume automatically); DSH itself is restarted by Termux:Boot.

</details>

> Upgrading from the v0.1.0 shell: uninstall the old shell first (v0.2.0 uses a new signature, so it cannot install over v0.1.0; your Termux/DSH environment is not affected and the new APK reuses it).

## Usage

Open the app (or browse http://127.0.0.1:3080 on the phone) and talk to the agent:

| Goal | Example prompt |
|---|---|
| See the screen | “Take a screenshot” |
| Open an app | “Open WeChat and search for …” |
| Tap | “Tap screen at (540, 1200)” |
| Run a command | “Run `pm list packages` via android_shell” |
| Install an APK | “Install /sdcard/Download/xxx.apk” |
| Device status | “Check the phone with android_status” |
| Media | “Take a photo for me” / “Record 5 seconds of audio” |
| Controls | “Set volume to 8” / “Set brightness to 50%” |
| Sensors & location | “Read the accelerometer” / “Where is the phone now?” |

To operate from a PC: `adb forward tcp:3081 tcp:3080`, then browse http://127.0.0.1:3081.

## Tool matrix

| Category | Tools |
|---|---|
| Screen & input | `android_screenshot` `android_tap` `android_swipe` `android_text` `android_keyevent` `android_wake_unlock` `android_screen_off` |
| Apps & system | `android_shell` `android_open_app` `android_current_app` `android_ui_dump` `android_install_apk` `android_list_packages` |
| Status & sensors | `android_status` `android_sensor_list` `android_sensor_read` |
| Camera & microphone | `android_camera_photo` `android_mic_record` |
| Audio & media | `android_speak` `android_play_media` `android_volume` |
| Device controls | `android_brightness` `android_wakelock` `android_vibrate` |
| Location & notifications | `android_location` `android_notify` |
| Human confirmation | `android_confirm_dialog` |
| Clipboard | `android_clipboard` |

> Tools are provided by the `dsh-android-control` plugin. Root edition executes through Magisk su; the Shizuku edition uses the local bridge at `127.0.0.1:36527` (adb-shell level); hardware tools go through termux-api as the Termux uid (root is not involved).

## Architecture

```
┌─────────────────────────────── Phone ───────────────────────────────┐
│  DSH Phone APK — deployment wizard (key → one-tap deploy → log)      │
│        └── WebView ── http://127.0.0.1:3080                          │
│                                                                       │
│  Termux + Node.js                                                     │
│     └── DSH web (web profile)                                         │
│           ├── dsh-android-control plugin (28 android_* tools)         │
│           │      ├─ Root: su ── input/screencap/am/pm/...            │
│           │      └─ Shizuku: local bridge 127.0.0.1:36527 ── Shizuku  │
│           │            (adb-shell level execution)                    │
│           ├── Hardware tools: termux-* straight to Termux:API         │
│           │      (Termux uid); photos/recordings land in ~/dsh-shots/ │
│           ├── bash-local (plain subprocess shell)                     │
│           └── mobile CSS (drawer sidebar / horizontal settings nav)   │
│                                                                       │
│  Auto-start: Termux:Boot → (Root: DNS self-heal) → start-dsh.sh       │
└───────────────────────────────────────────────────────────────────────┘
```

## Permissions & privacy

### API key

- The repository and APKs contain **no keys**; a repo-wide scan runs before every release.
- The key you paste is written only to `~/.dsh-api-key` on the phone (mode 600) and injected as an environment variable.
- Get one at https://platform.deepseek.com → API Keys.
- Prefer not to use the app? Edit `~/.dsh-api-key` manually and restart DSH.

### Hardware permissions (v0.2.5)

To let the agent use the camera / microphone / location, one-tap deployment grants **Termux:API** its four declared runtime permissions (CAMERA, RECORD_AUDIO, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION) and exempts it from battery optimization; the app's deploy log prints every grant result and Android's privacy indicators remain visible:

- **Notifications**: Termux:API targets SDK 28, so POST_NOTIFICATIONS is not required — the system allows them by default.
- **Wakelock**: held by **the Termux app's own TermuxService**; WAKE_LOCK ships with the Termux APK (the old termux-wake-lock script no longer exists in current Termux packages).
- **Vibration**: VIBRATE is a normal permission of Termux:API, granted at install time.
- **Root edition**: granted via su; **Shizuku edition**: shell-level pm grant → cmd appops fallback → on failure the deploy log asks you to enable it once in the Termux:API app details.

> Model limits: the DeepSeek text model **cannot see photos or hear recordings** — they are for you to view/play; an agent vision loop is deferred to an optional vision model.

## Tested devices & status

| Device | OS | Variant | v0.2.5 result |
|---|---|---|---|
| Xiaomi 17 Pro | Android 16 | Shizuku | One-tap deployment + hardware tools verified |
| Xiaomi 13 Pro | Android 14 / MIUI 14 | Root | Deployment, resume, auto-start and 20/28 tools pass; remaining issues listed below, planned for v0.2.6 |

## Known issues (v0.2.5)

1. **Root edition `android_list_packages` / `android_install_apk` can fail**: the DSH process PATH can make the root shell pick up Termux's `pm` wrapper, which breaks PackageManager calls. Workaround: ask the agent to run `/system/bin/pm ...` or `cmd package ...` via `android_shell`.
2. **Android 14 background restrictions**: `android_camera_photo` / `android_confirm_dialog` / `android_clipboard` may report success while doing nothing when DSH runs in the background (0-byte photo, empty clipboard, no dialog). Workaround: bring `com.termux.api/.activities.TermuxAPILauncherActivity` to the foreground before calling them.
3. **Async recording**: `android_mic_record` may return before the file is fully written; wait 1–3 seconds before handing it to `android_play_media`.
4. **In-place upgrade**: when upgrading from v0.2.4 while the old DSH is still running, the app may open the shell directly and not refresh the Termux-side payload. v0.2.6 will force a redeploy after a version change.

## FAQ

| Issue | Fix |
|---|---|
| Shizuku pairing fails | Wireless debugging may need re-authorization after reboots; see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| Deploy fails midway | Check the app log and `tail -50 ~/setup-dsh.log` inside Termux |
| UI unreachable after reboot | Wait ~30 s for auto-start; on MIUI allow Termux:Boot autostart |
| Taps/screenshots do nothing | Built-in MIUI screencap fallback; see the troubleshooting doc |
| Phone loses all networking | Kill dead VPN tunnels; the Root edition bundles a DNS fix |
| Play Protect warning | Expected for sideloaded APKs that bundle installer assets |

Full docs: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md), [docs/INSTALL.md](docs/INSTALL.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (Chinese).

## Building from source

```powershell
# Requires: JDK 17, Android SDK (platform-34 + build-tools 34.0.0), PowerShell, curl
powershell -File tools/fetch-assets.ps1          # fetch pinned Termux/Shizuku APKs (SHA256 verified)
powershell -File app/root/build-apk.ps1          # → app/root/out/dsh-phone-root.apk
powershell -File app/shizuku/build-apk.ps1       # → app/shizuku/out/dsh-phone-shizuku.apk
```

Zero-Gradle pipeline: javac → d8 → aapt2 → zipalign → apksigner. Toolchain paths come from `ANDROID_JDK` / `ANDROID_SDK_ROOT` or the `jdk17/` and `android-sdk/` directories next to the repo.

> ⚠️ Signing uses the repo-local `apk/debug.keystore` (gitignored — **back it up**; losing the v0.1.0 keystore is why v0.2.0 could not install over v0.1.0).

## Repository layout

```
app/          Two Android variants (common UI/icons; root & shizuku implementations)
tools/        Asset fetch, icon generation, resource compilation
scripts/      Termux-side scripts (install/start/boot/DNS fix/compat patches)
plugin/       dsh-android-control plugin (28 tools + mobile CSS + su/Shizuku dual executor)
docs/         Install, architecture and troubleshooting guides
apk/          Historic v0.1.0 shell project (kept for reference)
```

## Security & responsibility

- **On rooted phones the agent equals root**: use a spare phone and keep payment/banking accounts off it.
- The Shizuku edition is bounded at adb-shell level but can still drive the UI and install apps — spare phone advised.
- During deployment the app installs Termux / Termux:Boot / Termux:API (Root) or Shizuku + the Termux family (Shizuku), all unmodified official GitHub Release builds, SHA256-verified at build time.
- Auto-start requires an unlocked boot (no PIN) or a first unlock after reboot.

## Third-party components

| Component | License | Role |
|---|---|---|
| Termux / Termux:Boot / Termux:API | GPL-3.0 | Runtime environment (official APKs redistributed) |
| Shizuku / shizuku-api | Apache-2.0 | adb-level capability channel for unrooted phones |
| DeepSeek Harness | MIT | The agent framework |

This project is **MIT** — see [LICENSE](LICENSE). Thanks to the DeepSeek team for open-sourcing DSH.

## Credits

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the agent framework that makes this possible
- The Termux and Shizuku communities — the most reliable infrastructure in the Android ecosystem
