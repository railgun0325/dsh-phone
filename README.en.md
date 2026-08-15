<div align="center">

# DSH Phone

**Put DeepSeek Harness on your Android phone: the AI takes screenshots, taps, swipes, opens apps and runs commands by itself.**

Install one APK → paste your API key → tap once. Everything deploys automatically and runs on-device.

[License](LICENSE) ·
[Latest Release](https://github.com/railgun0325/dsh-phone/releases/latest) ·
[Install guide](docs/INSTALL.md) ·
[Troubleshooting](docs/TROUBLESHOOTING.md) ·
[中文](README.md)

<img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
<img src="https://img.shields.io/github/v/release/railgun0325/dsh-phone?label=Latest%20Release" alt="Latest release">
<img src="https://img.shields.io/badge/Android-11%2B-green.svg" alt="Android 11+">
<img src="https://img.shields.io/badge/Android%20Tools-28-4d6bfe.svg" alt="28 android tools">
<img src="https://img.shields.io/badge/DeepSeek%20Harness-compatible-4d6bfe.svg" alt="DeepSeek Harness compatible">

</div>

## What it does

- **Two one-tap editions**: Root (for rooted phones) and Shizuku (for unrooted phones) — install APK → paste key → deploy; Termux, Node.js, DSH and the Android control plugin are installed automatically.
- **Native Android control**: the agent can screenshot, tap, swipe, type, send keys, launch apps, read the UI hierarchy, install APKs and run shell commands.
- **Hardware awareness**: battery / brightness / volume / sensors, camera, microphone, TTS, media playback, notifications, vibration, location, and a manual confirm dialog before risky actions.
- **Runs fully on-device**: DSH lives in Termux + Node.js; the UI is the local web GUI at port `3080` (bundled WebView shell).
- **Your API key stays on the phone**: the APK ships with no key; your key is written only to `~/.dsh-api-key` (chmod 600) — never embedded, uploaded or committed.

## Choose an edition

| | Root edition | Shizuku edition |
|---|---|---|
| For | Rooted phones (Magisk / Kitsune / KernelSU…) | Any unrooted phone |
| Requires | Just the phone | Phone + one-time wireless-debugging authorization (Shizuku, ~30 s) |
| Privilege | Agent holds root (spare phone advised) | adb-shell level, bounded by the OS |
| After reboot | Termux:Boot auto-start | Shizuku auto-start + Termux:Boot |
| Network self-heal | Built-in DNS fix | None (needs working network) |

## Quick start

> Download: open [Latest Release](https://github.com/railgun0325/dsh-phone/releases/latest) and choose `dsh-phone-root-*.apk` or `dsh-phone-shizuku-*.apk`. Checksums ship with each release.

<details open>
<summary><b>Root edition (3 steps)</b></summary>

1. Install the Root APK (allow “unknown sources”).
2. Open the app and paste a DeepSeek API key ([platform.deepseek.com](https://platform.deepseek.com)).
3. Tap **deploy** → allow the superuser prompt → wait; the shell opens automatically.

Deployment is automatic: install Termux (bootstrap embedded) → configure mirrors → install Node/DSH → inject plugin & key → grant hardware permissions → start the server.

</details>

<details>
<summary><b>Shizuku edition (4 steps)</b></summary>

1. Install the Shizuku APK.
2. Open the app → tap deploy → follow the guide to install and activate Shizuku (Developer options → Wireless debugging → pair code, one time only).
3. Return to the app and paste your API key.
4. Tap **deploy** → wait; the shell opens automatically.

> After a reboot, open Shizuku once to confirm auto-start; DSH is restarted by Termux:Boot.

</details>

> Upgrading from the v0.1.0 shell: uninstall it first (v0.2.0 uses a new signature; your Termux/DSH environment is not affected and is reused automatically).

## Usage

Open the app (or browse http://127.0.0.1:3080 on the phone) and talk to the agent:

| Goal | Example prompt |
|---|---|
| See the screen | “Take a screenshot” |
| Open an app | “Open WeChat and search for …” |
| Tap | “Tap screen at (540, 1200)” |
| Run a command | “Run `pm list packages` via android_shell” |
| Device status | “Check the phone with android_status” |
| Media & controls | “Take a photo for me” / “Set volume to 8” |

From a PC: `adb forward tcp:3081 tcp:3080`, then browse http://127.0.0.1:3081.

## Tool overview

| Category | Capabilities |
|---|---|
| Screen & input | screenshot, tap, swipe, text, keys, wake/unlock, screen-off |
| Apps & system | shell, launch app, foreground app, UI dump, APK install, package list |
| Status & sensors | battery / brightness / volume / network, sensor list & sampling |
| Media | camera photo, mic recording, TTS, media playback |
| Device controls | volume, brightness, wakelock, vibration |
| Location & notifications | location, notifications, clipboard |
| Human confirmation | confirm dialog before risky actions |

All 28 tools are documented in [`plugin/README.md`](plugin/README.md) (Chinese).

## Security & privacy

- **On rooted phones the agent equals root**: use a spare phone and keep payment / banking accounts off it; the Shizuku edition is also best used on a spare phone.
- Deployment automatically grants Termux:API camera / microphone / location permissions and a battery exemption; every result is printed in the deploy log and system privacy indicators stay visible.
- The APK and repository contain **no keys**; your key lives only in `~/.dsh-api-key` (chmod 600). The DeepSeek text model cannot see photos or hear recordings — they are for the user or a future vision model.

## More docs

| Doc | Contents |
|---|---|
| [Releases](https://github.com/railgun0325/dsh-phone/releases) | Per-version features, verification status, known issues and upgrade notes |
| [docs/INSTALL.md](docs/INSTALL.md) | Manual install, plugin mounting, API key and auto-start |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Execution chains, Root/Shizuku bridge, plugin and DNS self-heal |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common deploy/runtime/reboot issues |
| [plugin/README.md](plugin/README.md) | Full `android_*` tool list and permissions |

Deep guides are currently in Chinese; the README itself is maintained in both languages.

## Building from source

```powershell
# Requires: JDK 17, Android SDK (platform-34 + build-tools 34.0.0), PowerShell, curl
powershell -File tools/fetch-assets.ps1          # fetch pinned Termux/Shizuku APKs (SHA256 verified)
powershell -File app/root/build-apk.ps1          # → app/root/out/dsh-phone-root.apk
powershell -File app/shizuku/build-apk.ps1       # → app/shizuku/out/dsh-phone-shizuku.apk
```

Zero-Gradle pipeline: javac → d8 → aapt2 → zipalign → apksigner. Toolchain paths come from `ANDROID_JDK` / `ANDROID_SDK_ROOT` or the `jdk17/` and `android-sdk/` directories next to the repo.

> ⚠️ Signing uses the repo-local `apk/debug.keystore` (gitignored — back it up; losing the v0.1.0 keystore is why v0.2.0 could not install over v0.1.0).

## Repository layout

```
app/          Two Android variants (common UI/icons; root & shizuku implementations)
tools/        Asset fetch, icon generation, resource compilation, release notes
scripts/      Termux-side scripts (install/start/boot/DNS fix/compat patches)
plugin/       dsh-android-control plugin (28 tools + mobile CSS + su/Shizuku dual executor)
docs/         Install, architecture and troubleshooting guides
apk/          Historic v0.1.0 shell project (kept for reference)
```

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
