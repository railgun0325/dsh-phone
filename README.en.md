# DSH Phone — DeepSeek Harness agent that operates your Android phone

> An AI that taps the screen for you: the agent (DeepSeek Harness) runs **on the phone**,
> drives the Android system natively through Magisk root (screenshot / tap / swipe / launch apps),
> wrapped in a WebView APK. **Not SSH — the phone works standalone.**

## What's here

- **Agent on-device**: DeepSeek Harness (MIT) running in Termux + Node.js
- **Hands for the agent**: the `dsh-android-control` plugin exposes 13 tools (`android_shell`, `android_screenshot`, `android_tap`, `android_swipe`, `android_text`, `android_keyevent`, `android_open_app`, `android_current_app`, `android_ui_dump`, `android_install_apk`, `android_list_packages`, `android_wake_unlock`, `android_clipboard`)
- **Phone UI**: DSH's official web GUI on port 3080 + a mobile layout patch (drawer sidebar, horizontal settings nav) + a WebView wrapper APK
- **Standalone**: optional DNS self-heal (DoH forwarder + iptables) and boot autostart

## Requirements

- Android 12+ (tested on 14), **rooted (Magisk / Kitsune)**
- A PC with adb + USB for the initial setup only
- A DeepSeek API key
- Tested on Xiaomi MIUI/HyperOS; other devices likely work but are untested

## Quick start

See [docs/INSTALL.md](docs/INSTALL.md) for step-by-step instructions. Outline: install Termux → run `setup-termux.sh` → `patch-dsh.mjs` → save your API key with `install-api-key.sh` → register the plugin profile → grant Magisk su to Termux → launch and open the APK (or `http://127.0.0.1:3080` in the phone browser).

## Risks

- An agent on a rooted phone has root power — use a spare device only, keep payment/banking accounts off it
- Interactive bash (PTY) is unavailable on Android (no node-pty build); use `android_shell` for commands
- Landlock sandbox unavailable on Android; related plugins are disabled
- A broken VPN app (e.g. v2rayNG with a dead node) will hijack all phone traffic — fix or disable it first

## License

MIT — see [LICENSE](LICENSE). DeepSeek Harness is [MIT](https://github.com/deepseek-ai/deepseek-harness) by DeepSeek.

