# DSH Phone — an AI that taps its own screen, on your Android phone

> Puts [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) on an Android phone: the agent takes screenshots, taps, swipes, opens apps and runs commands by itself. **Install one APK → paste your API key → one tap. Everything deploys automatically.** Runs entirely on the phone; no PC required beyond optional Shizuku activation.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/railgun0325/dsh-phone?label=Release)](https://github.com/railgun0325/dsh-phone/releases)
[![Android](https://img.shields.io/badge/Android-11%2B-green.svg)](#choose-a-variant)

## What it does

- **Two one-tap variants**: Root edition (rooted phones) and Shizuku edition (unrooted phones) — install APK → paste key → tap deploy; Termux / Node / DSH / plugins are installed automatically
- **The agent operates Android natively**: 13 android_* tools — screenshot, tap, swipe, text input, key events, app launch, UI hierarchy dumps, APK install, arbitrary shell
- **Runs fully on-device**: DSH lives in Termux + Node.js on the phone; the UI is the local Web GUI on port 3080 (bundled WebView shell)
- **Your API key stays on the phone**: the APK ships with no key; the key you paste is written only to the local Termux environment (chmod 600) — never embedded, uploaded or committed

## Choose a variant

| | Root edition | Shizuku edition |
|---|---|---|
| For | Rooted phones (Magisk / Kitsune / KernelSU…) | Any unrooted phone |
| Requires | Just the phone | Phone + one-time wireless-debugging authorization (Shizuku, ~30 s) |
| Install | APK → key → deploy | APK → activate Shizuku → key → deploy |
| Privilege | Agent holds root (spare phone advised) | adb-shell level, bounded by the OS |
| After reboot | Termux:Boot auto-start | Shizuku auto-start + Termux:Boot |
| Network self-heal | Built-in DNS fix (root) | None (needs working network) |

## Quick start

### Root edition (3 steps)

1. Download and install [dsh-phone-root-v0.2.0.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.0/dsh-phone-root-v0.2.0.apk)
2. Open the app and paste a DeepSeek API key ([platform.deepseek.com](https://platform.deepseek.com))
3. Tap **deploy** → allow the superuser prompt → wait for “deploy complete” → tap **Open DSH**

Deployment is fully automatic: install Termux (bootstrap is embedded in the APK, no download needed) → configure mirrors → install Node/DSH → inject plugin & key → start the server.

### Shizuku edition (4 steps)

1. Download and install [dsh-phone-shizuku-v0.2.0.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.0/dsh-phone-shizuku-v0.2.0.apk)
2. Open the app → tap deploy → follow the guide to **install Shizuku** and pair via wireless debugging (Developer options → Wireless debugging → pair code; a one-time OS security requirement)
3. Return to the app and paste your API key
4. Tap **deploy** → wait for completion → tap **Open DSH**

> After a reboot: open Shizuku once to confirm auto-start (most devices resume automatically); DSH itself is restarted by Termux:Boot.

## Usage

Open the app (or browse http://127.0.0.1:3080 on the phone) and talk to the agent:

- “Take a screenshot”
- “Open WeChat and search for …”
- “Tap screen at (540, 1200)”
- “Run pm list packages via android_shell”
- “Install /sdcard/Download/xxx.apk”

To operate from a PC: adb forward tcp:3081 tcp:3080, then browse http://127.0.0.1:3081.

## Architecture

```
┌─────────────────────────────── Phone ───────────────────────────────┐
│  DSH Phone APK — deployment wizard (key → one-tap deploy → log)      │
│        └── WebView ── http://127.0.0.1:3080                          │
│                                                                       │
│  Termux + Node.js                                                     │
│     └── DSH web (web profile)                                         │
│           ├── dsh-android-control plugin (13 android_* tools)         │
│           │      ├─ Root: su ── input/screencap/am/pm/...            │
│           │      └─ Shizuku: local bridge 127.0.0.1:36527 ── Shizuku  │
│           │            (adb-shell level execution)                    │
│           ├── bash-local (plain subprocess shell)                     │
│           └── mobile CSS (drawer sidebar / horizontal settings nav)   │
│                                                                       │
│  Auto-start: Termux:Boot → (Root: DNS self-heal) → start-dsh.sh       │
└───────────────────────────────────────────────────────────────────────┘
```

## API key

- The repository and APKs contain **no keys**; a repo-wide scan runs before every release
- The key you paste is written only to ~/.dsh-api-key on the phone (mode 600) and injected as an env var
- Get one at https://platform.deepseek.com → API Keys
- Prefer not to use the app? Edit ~/.dsh-api-key manually and restart DSH

## FAQ

| Issue | Fix |
|---|---|
| Shizuku pairing fails | Wireless debugging may need re-authorization after reboots; see docs/TROUBLESHOOTING.md |
| Deploy fails midway | Check the app log and tail -50 ~/setup-dsh.log inside Termux |
| UI unreachable after reboot | Wait ~30 s for auto-start; on MIUI allow Termux:Boot autostart |
| Taps/screenshots do nothing | Built-in MIUI screencap fallback; see the troubleshooting doc |
| Phone loses all networking | Kill dead VPN tunnels; the Root edition bundles a DNS fix |
| Play Protect warning | Expected for sideloaded APKs that bundle installer assets |

Full docs: **docs/TROUBLESHOOTING.md**, **docs/INSTALL.md**, **docs/ARCHITECTURE.md** (Chinese).

## Building from source

```powershell
# Requires: JDK 17, Android SDK (platform-34 + build-tools 34.0.0), PowerShell, curl
powershell -File tools/fetch-assets.ps1          # fetch pinned Termux/Shizuku APKs (SHA256 verified)
powershell -File app/root/build-apk.ps1          # → app/root/out/dsh-phone-root.apk
powershell -File app/shizuku/build-apk.ps1       # → app/shizuku/out/dsh-phone-shizuku.apk
```

Zero-Gradle pipeline: javac → d8 → aapt2 → zipalign → apksigner. Toolchain paths come from ANDROID_JDK / ANDROID_SDK_ROOT or jdk17/ and android-sdk/ next to the repo.

## Security & responsibility

- **On rooted phones the agent equals root**: use a spare phone, keep payment/banking accounts off it
- The Shizuku edition is bounded at adb-shell level but can still drive the UI and install apps — spare phone advised
- During deployment the app installs Termux / Termux:Boot / Termux:API (Root) or Shizuku + the Termux family (Shizuku), all unmodified official GitHub Release builds, SHA256-verified at build time
- Auto-start requires an unlocked boot (no PIN) or a first unlock after reboot

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
