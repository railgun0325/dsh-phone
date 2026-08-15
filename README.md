<div align="center">

# DSH Phone

**把 DeepSeek Harness 装进安卓手机：AI 自己截图、点屏幕、滑页面、开应用、执行命令。**

装一个 APK → 粘贴 API Key → 点一下，全自动部署。全程跑在手机本地，不依赖电脑常驻。

[License](LICENSE) ·
[Latest Release](https://github.com/railgun0325/dsh-phone/releases/latest) ·
[安装手册](docs/INSTALL.md) ·
[排障手册](docs/TROUBLESHOOTING.md) ·
[English](README.en.md)

<img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
<img src="https://img.shields.io/github/v/release/railgun0325/dsh-phone?label=Latest%20Release" alt="Latest release">
<img src="https://img.shields.io/badge/Android-11%2B-green.svg" alt="Android 11+">
<img src="https://img.shields.io/badge/Android%20Tools-28-4d6bfe.svg" alt="28 android tools">
<img src="https://img.shields.io/badge/DeepSeek%20Harness-compatible-4d6bfe.svg" alt="DeepSeek Harness compatible">

</div>

## 它能做什么

- **双版本一键部署**：Root 版（已 root 手机）与 Shizuku 版（未 root 手机）都是「装 APK → 粘贴 Key → 点部署」，Termux、Node.js、DSH 和安卓控制插件全自动装好。
- **AI 原生操作安卓**：agent 可以截图、点击、滑动、输入文字、按键、打开应用、读 UI 层级、安装 APK、执行 shell。
- **硬件感知与控制**：查电量/亮度/音量/传感器，拍照、录音、朗读、播媒体、发通知、震动、定位，高危操作前可在手机弹窗人工确认。
- **全程本地运行**：DSH 跑在手机里的 Termux + Node.js 上，界面是本机 `3080` 端口的 Web GUI（APK 内置 WebView 壳）。
- **API Key 只存本机**：安装包不含任何 Key；你粘贴的 Key 只写入手机本机 `~/.dsh-api-key`（chmod 600），不内置、不上传、不进仓库。

## 选版本

| | Root 版 | Shizuku 版 |
|---|---|---|
| 适合 | 已 root 的手机（Magisk / Kitsune / KernelSU 等） | 未 root 的任何机型 |
| 前提 | 只有手机本身 | 手机 + 一次无线调试授权（Shizuku，约 30 秒） |
| 权限边界 | agent 持 root（建议备用机） | adb shell 级，系统天然受限 |
| 重启后 | Termux:Boot 自动拉起 | Shizuku 自启 + Termux:Boot |
| 断网自愈 | 内置 DNS 修复 | 无（依赖网络正常） |

## 快速开始

> 下载：打开 [Latest Release](https://github.com/railgun0325/dsh-phone/releases/latest)，按上面的版本选择下载 `dsh-phone-root-*.apk` 或 `dsh-phone-shizuku-*.apk`。校验和随 Release 附件提供。

<details open>
<summary><b>Root 版（三步）</b></summary>

1. 安装 Root 版 APK（允许「未知来源」）。
2. 打开 App，粘贴 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 申请）。
3. 点 **一键部署** → 允许超级用户授权 → 等待，完成后自动进入界面。

部署过程全自动：安装 Termux（bootstrap 内置）→ 配置镜像 → 安装 Node/DSH → 注入插件与 Key → 授予硬件权限 → 启动服务。

</details>

<details>
<summary><b>Shizuku 版（四步）</b></summary>

1. 安装 Shizuku 版 APK。
2. 打开 App → 点部署 → 按引导安装并激活 Shizuku（开发者选项 → 无线调试 → 配对码，仅此一次）。
3. 回到 App，粘贴 API Key。
4. 点 **一键部署** → 等待，完成后自动进入界面。

> 重启手机后打开一次 Shizuku 确认自启；DSH 会由 Termux:Boot 自动拉起。

</details>

> 装过 v0.1.0 纯壳的：先卸载旧壳再装（v0.2.0 换用了新签名；Termux/DSH 环境不受影响，新 APK 会自动复用）。

## 怎么用

打开 App（或手机浏览器访问 http://127.0.0.1:3080）直接跟 agent 说话：

| 你想做的 | 可以这样说 |
|---|---|
| 看屏幕 | 「截个图看看」 |
| 打开应用 | 「打开微信，搜索 XX 公众号」 |
| 点屏幕 | 「点屏幕坐标 (540, 1200)」 |
| 执行命令 | 「用 android_shell 执行 `pm list packages`」 |
| 硬件状态 | 「用 android_status 查一下手机状态」 |
| 媒体与设备控制 | 「拍张照给我看」 / 「把音量调到 8」 |

想用电脑操作：`adb forward tcp:3081 tcp:3080`，浏览器打开 http://127.0.0.1:3081。

## 工具速览

| 分类 | 包含能力 |
|---|---|
| 屏幕与输入 | 截图、点击、滑动、输入、按键、唤醒解锁、灭屏 |
| 应用与系统 | shell、打开应用、前台应用、UI 层级、安装 APK、包名列表 |
| 状态与传感器 | 电量/亮度/音量/网络状态，传感器列表与采样 |
| 媒体 | 拍照、录音、TTS 朗读、媒体播放 |
| 设备控制 | 音量、亮度、wakelock、震动 |
| 定位与通知 | 定位、系统通知、剪贴板 |
| 人工确认 | 高风险操作前弹窗确认 |

完整 28 个工具的参数与说明见 [`plugin/README.md`](plugin/README.md)。

## 安全与隐私

- **Root 版 agent 等于握着 root**：请用备用机，勿登录支付、网银等敏感账号；Shizuku 版同样建议备用机。
- 部署时会自动给 Termux:API 授予相机、麦克风、定位等运行时权限并做电池豁免，授权结果逐项打印在部署日志里；系统隐私指示灯全程可见。
- 安装包与仓库**不含任何 Key**；Key 只写本机 `~/.dsh-api-key`（chmod 600）。DeepSeek 文本模型看不懂照片、听不了录音，拍照/录音是给用户查看或留给视觉模型使用。

## 更多文档

| 文档 | 内容 |
|---|---|
| [Releases](https://github.com/railgun0325/dsh-phone/releases) | 每个版本的新增功能、验证状态、已知问题与升级说明 |
| [docs/INSTALL.md](docs/INSTALL.md) | 手动安装、插件挂载、API Key 与自启配置 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 执行链、Root/Shizuku 桥、插件与 DNS 修复原理 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 部署/运行/重启后的常见问题与处理 |
| [plugin/README.md](plugin/README.md) | 全部 `android_*` 工具清单与权限说明 |

## 从源码构建

```powershell
# 依赖：JDK 17、Android SDK（platform-34 + build-tools 34.0.0）、PowerShell、curl
powershell -File tools/fetch-assets.ps1          # 拉取 Termux/Shizuku 等第三方 APK（自动校验哈希）
powershell -File app/root/build-apk.ps1          # → app/root/out/dsh-phone-root.apk
powershell -File app/shizuku/build-apk.ps1       # → app/shizuku/out/dsh-phone-shizuku.apk
```

零 Gradle 手工构建链：javac → d8 → aapt2 → zipalign → apksigner。依赖位置通过环境变量 `ANDROID_JDK` / `ANDROID_SDK_ROOT` 或仓库旁的 `jdk17/`、`android-sdk/` 指定。

> ⚠️ 签名使用仓库本地的 `apk/debug.keystore`（gitignored，务必备份；v0.1.0 就因签名库遗失导致 v0.2.0 无法覆盖安装）。

## 目录结构

```
app/          双版本 Android 应用（common 共享 UI/图标，root 与 shizuku 各自实现）
tools/        资源拉取、图标生成、资源编译、发行说明等构建工具
scripts/      Termux 侧脚本（安装/启动/自启/DNS 修复/兼容补丁）
plugin/       dsh-android-control 插件（28 个工具 + 移动端 CSS + su/Shizuku 桥双执行器）
docs/         安装手册 / 架构说明 / 排障手册
apk/          v0.1.0 历史纯壳工程（保留）
```

## 第三方组件与许可

| 组件 | 协议 | 用途 |
|---|---|---|
| Termux / Termux:Boot / Termux:API | GPL-3.0 | DSH 运行环境（官方原版 APK 随包分发） |
| Shizuku / shizuku-api | Apache-2.0 | 未 root 手机的 adb 级能力通道 |
| DeepSeek Harness | MIT | AI agent 本体 |

本项目代码：**MIT**，见 [LICENSE](LICENSE)。感谢 DeepSeek 团队开源的 DSH。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 让这一切成为可能的 agent 框架
- Termux / Shizuku 社区 — 安卓生态最可靠的基建
