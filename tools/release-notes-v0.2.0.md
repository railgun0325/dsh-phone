# DSH Phone v0.2.0

**双版本一键部署**：装 APK → 粘贴 API Key → 点一下，全自动部署 DeepSeek Harness 手机 agent。

## 下载

- [dsh-phone-root-v0.2.0.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.0/dsh-phone-root-v0.2.0.apk) — 已 root 手机（Magisk/Kitsune/KernelSU）
- [dsh-phone-shizuku-v0.2.0.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.0/dsh-phone-shizuku-v0.2.0.apk) — 未 root 手机（经 Shizuku，adb shell 级权限）

## 变化

- **Root 版**：一键 APK 内嵌 Termux（bootstrap 内置 APK，全程无需联网下载环境）+ 全套脚本；su 授权一次后自动装 Termux → Node/DSH → 插件 → Key → 开机自启 + DNS 自愈
- **Shizuku 版**：内置 Shizuku 引导 + 本地 HTTP 桥（127.0.0.1:36527，token 认证），插件无 su 时自动走桥执行 input/screencap/am/pm 等 adb 级命令
- 全新部署向导 App（状态卡 + 滚动日志 + WebView 壳）+ 新图标（自适应图标全套）
- README/docs 全部重写（选版本决策表、快速开始、FAQ、第三方许可）
- 插件升级：su/Shizuku 桥双执行器，工具集不变（13 个 android_*）

## API Key

安装包与仓库不含任何 Key；你粘贴的 Key 只写进手机本机 Termux 环境（chmod 600）。

## 从 v0.1.0 升级
v0.2.0 换用了新签名（旧签名库已遗失）：请先卸载 v0.1.0 纯壳（adb uninstall com.dsh.phone 或长按卸载），再安装新版。Termux / DSH 环境不受影响，新 APK 会检测并复用。

## 注意事项

- Root 版 agent 等于 root，Shizuku 版为 adb shell 级：都建议跑在备用机上
- Shizuku 首次需无线调试配对一次（系统级安全要求，无法省略）
- 安装包内 Termux/Shizuku 均为官方 GitHub Release 原版，构建时 SHA256 校验

---

**Two one-tap variants**: install → paste key → tap deploy. Root edition for rooted phones (Magisk/Kitsune/KernelSU); Shizuku edition for unrooted phones via Shizuku (adb-shell level). No API keys are shipped or committed — the key you paste stays on your phone.
