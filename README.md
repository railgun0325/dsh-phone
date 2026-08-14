# DSH Phone — 手机里跑一个会自己点屏幕的 AI

> 把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）装进安卓手机，AI 自己截图、点屏幕、滑页面、开应用、执行命令。**装一个 APK → 粘贴 API Key → 点一下，全自动部署。** 全程跑在手机本地，不依赖电脑常驻。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/railgun0325/dsh-phone?label=Release)](https://github.com/railgun0325/dsh-phone/releases)
[![Android](https://img.shields.io/badge/Android-11%2B-green.svg)](#选版本)
[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-compatible-4d6bfe.svg)](https://github.com/deepseek-ai/deepseek-harness)

## 它是干什么的

- **双版本一键部署**：Root 版（已 root 手机）与 Shizuku 版（未 root 手机）都是「装 APK → 粘贴 Key → 点一下」的零配置流程，Termux / Node / DSH / 插件全自动装好
- **AI 原生操作安卓**：13 个 android_* 工具 —— 截图、点击、滑动、输入、按键、打开应用、UI 层级分析、安装 APK、执行 shell 等
- **全程本地**：DSH 跑在手机里的 Termux + Node.js 上，界面是手机本机 3080 端口的 Web GUI（本 APK 内置 WebView 壳），电脑只在可选的 Shizuku 激活或调试时用一下
- **API Key 只存本机**：安装包**不含任何 Key**，你粘贴的 Key 只写进手机本机的 Termux 环境（chmod 600），不内置、不上传、不进仓库

## 选版本

| | Root 版 | Shizuku 版 |
|---|---|---|
| 适合 | 已 root 的手机（Magisk / Kitsune / KernelSU 等） | 未 root 的任何机型 |
| 前提 | 只有手机本身 | 手机 + 一次无线调试授权（Shizuku，约 30 秒） |
| 安装 | 装 APK → 贴 Key → 点部署 | 装 APK → 激活 Shizuku → 贴 Key → 点部署 |
| 权限边界 | agent 持 root（建议备用机） | adb shell 级，系统天然受限 |
| 重启后 | Termux:Boot 自动拉起 | Shizuku 自启 + Termux:Boot |
| 断网自愈 | 内置 DNS 修复（root） | 无（依赖网络正常） |

## 快速开始

### Root 版（三步）

1. 下载 [dsh-phone-root-v0.2.4.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.4/dsh-phone-root-v0.2.4.apk) 并安装（允许「未知来源」）
2. 打开 App，粘贴 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 申请）
3. 点 **一键部署** → 弹出超级用户授权时点允许 → 等待，部署完成后自动进入界面

部署过程全自动：安装 Termux（bootstrap 内置在 APK 里，无需联网）→ 配置国内镜像 → 安装 Node/DSH → 注入插件与 Key → 启动服务。

> 装过 v0.1.0 纯壳的：先卸载旧壳再装（v0.2.0 换用了新签名，无法覆盖安装；Termux/DSH 环境不受影响，新 APK 会自动复用）。

### Shizuku 版（四步）

1. 下载 [dsh-phone-shizuku-v0.2.4.apk](https://github.com/railgun0325/dsh-phone/releases/download/v0.2.4/dsh-phone-shizuku-v0.2.4.apk) 并安装
2. 打开 App → 点部署 → 按引导**一键安装 Shizuku**，然后按 Shizuku 提示完成无线调试配对（开发者选项 → 无线调试 → 配对码；系统级安全要求，仅此一次）
3. 回到 App，粘贴 API Key
4. 点 **一键部署** → 等待，完成后自动进入界面

> 重启手机后：打开一次 Shizuku 确认其自启（多数机型可自动恢复），DSH 会由 Termux:Boot 自动拉起。

## 怎么用

打开 App（或手机浏览器访问 http://127.0.0.1:3080）直接跟 agent 说话：

- 「截个图看看」
- 「打开微信，搜索 XX 公众号」
- 「点屏幕坐标 (540, 1200)」
- 「用 android_shell 执行 pm list packages」
- 「把 /sdcard/Download/xxx.apk 装上」

想用电脑操作：USB 连接后 adb forward tcp:3081 tcp:3080，浏览器开 http://127.0.0.1:3081。

## 架构

```
┌─────────────────────────────── 手机 ───────────────────────────────┐
│  DSH Phone APK ── 部署向导（贴 Key → 一键部署 → 滚动日志）           │
│        └── WebView ── http://127.0.0.1:3080                        │
│                                                                     │
│  Termux + Node.js                                                   │
│     └── DSH web（web profile）                                      │
│           ├── dsh-android-control 插件（13 个 android_* 工具）       │
│           │      ├─ Root 版：su ── input/screencap/am/pm/...       │
│           │      └─ Shizuku 版：127.0.0.1:36527 本地桥 ── Shizuku   │
│           │            daemon UserService（adb shell 级执行）        │
│           ├── bash-local（纯子进程 shell）                           │
│           └── 移动端 CSS（抽屉侧边栏 / 横排设置导航）                 │
│                                                                     │
│  开机自启：Termux:Boot → (Root 版含 DNS 自愈) → start-dsh.sh         │
└─────────────────────────────────────────────────────────────────────┘
```

## API Key 说明

- 本仓库与安装包**不含任何 Key**；发布前有全仓库扫描兜底
- 你粘贴的 Key 只写入手机本机 Termux 的 ~/.dsh-api-key（权限 600），随部署脚本注入环境变量
- Key 申请：https://platform.deepseek.com → API Keys
- 不想在 App 里填：部署完成后也可以手动改 ~/.dsh-api-key 再重启 DSH

## 常见问题

| 问题 | 处理 |
|---|---|
| Shizuku 连不上 / 配对失败 | 无线调试每次重启可能要重开；详见 docs/TROUBLESHOOTING.md |
| 部署到一半失败 | App 日志 + Termux 内 tail -50 ~/setup-dsh.log |
| 重启后界面打不开 | 等 30 秒（开机自启有延迟）；Root 版确认 Termux:Boot 自启动权限（MIUI 要允许） |
| 点屏幕没反应 / 截图失败 | MIUI screencap 兼容回退已内置；详见排障文档 |
| 手机断网（DNS 全挂） | 关掉死掉的 VPN 隧道；Root 版内置 DNS 修复 |
| Play Protect 警告 | 本 APK 侧载安装且含自动装 Termux 的资产，属正常；详见安全章节 |

完整排障：**docs/TROUBLESHOOTING.md**；手动安装与原理：**docs/INSTALL.md**、**docs/ARCHITECTURE.md**。

## 从源码构建

```powershell
# 依赖：JDK 17、Android SDK（platform-34 + build-tools 34.0.0）、PowerShell、curl
powershell -File tools/fetch-assets.ps1          # 拉取 Termux/Shizuku 等第三方 APK（自动校验哈希）
powershell -File app/root/build-apk.ps1          # → app/root/out/dsh-phone-root.apk
powershell -File app/shizuku/build-apk.ps1       # → app/shizuku/out/dsh-phone-shizuku.apk
```

构建链为零 Gradle 的手工管线：javac → d8 → aapt2 → zipalign → apksigner，依赖位置通过环境变量 ANDROID_JDK / ANDROID_SDK_ROOT 或仓库旁的 jdk17/、android-sdk/ 目录指定。

> ⚠️ 签名使用仓库本地的 apk/debug.keystore（gitignored，**务必备份**——v0.1.0 就因签名库遗失导致 v0.2.0 无法覆盖安装）。

## 目录结构

```
app/          双版本 Android 应用（common 共享 UI/图标，root 与 shizuku 各自实现）
tools/        资源拉取、图标生成、资源编译等构建工具
scripts/      Termux 侧脚本（安装/启动/自启/DNS 修复/兼容补丁）
plugin/       dsh-android-control 插件（13 个工具 + 移动端 CSS + su/Shizuku 桥双执行器）
docs/         安装手册 / 架构说明 / 排障手册
apk/          v0.1.0 历史纯壳工程（保留）
```

## 安全与责任

- **Root 版 agent 等于握着 root**：请用备用机，勿登录支付、网银等敏感账号
- Shizuku 版的权限边界是 adb shell 级，仍可操控界面与安装应用，同样建议备用机
- 本 APK 在部署时会自动安装 Termux / Termux:Boot / Termux:API（Root 版）或 Shizuku + Termux 系（Shizuku 版），安装来源均为官方 GitHub Release 原版，构建时校验 SHA256
- 开机自启需手机无锁屏密码（或首次解锁后生效）

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
