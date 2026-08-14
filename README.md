# DSH Phone — 让 DeepSeek Harness 的 agent 直接操作安卓手机

> 手机里跑一个“会自己点屏幕的 AI”：AI 本体（DeepSeek Harness）跑在手机里，
> 通过 Magisk root 原生操控安卓系统（截图/点击/滑动/打开应用），
> 再用 WebView 套壳 APK 装进手机。**不是 SSH，不依赖电脑常驻。**

## 这是什么

- **agent 跑在手机本地**：Termux + Node.js 上运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH，MIT 协议）
- **agent 有“手”**：`dsh-android-control` 插件把安卓系统能力包装成 13 个工具：`android_shell`（root 执行任意命令）、`android_screenshot`、`android_tap`、`android_swipe`、`android_text`、`android_keyevent`、`android_open_app`、`android_current_app`、`android_ui_dump`、`android_install_apk`、`android_list_packages`、`android_wake_unlock`、`android_clipboard`
- **手机界面**：DSH 官方 Web GUI 跑在手机 3080 端口；本仓库附带移动端布局补丁（侧边栏抽屉化 + 设置页横排导航）和一个 WebView 套壳 APK
- **独立运行**：可选 DNS 自动修复（DoH 转发器 + iptables），开机自启，换网络也不影响

## 演示效果

实测（小米 13 Pro / Android 14 / Magisk Kitsune）：agent 按指令完成“截图 → 查看前台应用 → 打开设置 → 再截图”，中途遇到 MIUI 的 screencap 链接错误还自己写了 LD_PRELOAD 包装脚本修好——全程手机本地完成。

## 前提条件

| 项目 | 要求 |
|---|---|
| 手机 | Android 12+（14 实测），**已 root（Magisk / Kitsune）** |
| 电脑 | 仅首次安装需要：Windows + adb（platform-tools）+ USB 线 |
| 网络 | 手机能上网（Wi-Fi 或流量均可；路由器 DNS 异常时用本仓库的 DNS 修复脚本） |
| API Key | DeepSeek API key（[platform.deepseek.com](https://platform.deepseek.com) 申请） |
| 机型 | 小米 MIUI/HyperOS 实测踩平；其他机型理论可用，未测 |

## 快速安装

完整图文步骤见 [docs/INSTALL.md](docs/INSTALL.md)，大致流程：

```
1. 电脑装 adb（platform-tools），手机开 USB 调试并连接
2. 装 Termux + Termux:API + Termux:Boot（官方 GitHub Releases 的 APK）
3. 把 scripts/ 推入手机，跑 setup-termux.sh（装 Node 24、npm 装 DSH、打兼容补丁）
4. 跑 patch-dsh.mjs（让 subprocess 插件在安卓上可加载）
5. 写 API key：bash install-api-key.sh sk-xxxx
6. 推 plugin/ 进 profile 并注册（cordis.patch.yml 已写好 insert）
7. 授权 Magisk su 给 com.termux（弹窗点允许，或写 magisk.db）
8. 重启 dsh web，装 APK（或手机浏览器开 http://127.0.0.1:3080）
```

## 使用

- 手机上打开 DSH Phone APK（或 Chrome 打开 `http://127.0.0.1:3080`）
- 电脑上（USB 连着时）`adb forward tcp:3081 tcp:3080` 后浏览器开 `http://127.0.0.1:3081`
- 直接对 agent 说：“截个图看看”、“点击 xxx”、“打开微信”、“用 android_shell 执行 ls /sdcard”

## 架构

```
┌───────────────────────────── 手机 ─────────────────────────────┐
│  DSH Phone APK (WebView) ── http://127.0.0.1:3080              │
│        │                                                       │
│  DSH web (Termux + Node 24)                                    │
│        ├── dsh-android-control 插件 ── 13 个 android_* 工具     │
│        │        └── Magisk su ── input tap / am start / ...    │
│        └── 移动端 CSS（抽屉侧边栏 / 横排设置导航）               │
│  开机自启：Termux:Boot → dns-fwd(DoH) + iptables + dsh web      │
└───────────────────────────────────────────────────────────────┘
```

## 目录结构

```
plugin/   dsh-android-control 插件（工具 + 移动端 CSS bundle）
apk/      WebView 套壳 APK 源码与构建脚本（JDK17 + Android SDK 手动构建）
scripts/  Termux 引导、启动、开机自启、DNS 修复、DSH 兼容补丁
docs/     安装手册 / 架构说明 / 排障
```

## 已知限制与风险

- **agent 在 root 手机上等于握着 root 权限**——请用备用机，勿登录敏感账号（支付/网银）
- 交互式 bash（PTY）在安卓上不可用（node-pty 无安卓构建）；命令执行用 `android_shell` 或 DSH 自带的非 PTY 工具替代
- Linux sandbox（landlock）在安卓上不可用，相关插件已禁用
- 开机自启需要手机无锁屏密码（或首次解锁后生效）
- 若手机装有 v2rayNG 等 VPN 类 App 且节点失效，会劫持全机流量导致断网——先修好它或关掉自启
- `su <uid>` 直跑脚本、`install -m` 代替 chmod、`screencap` LD_PRELOAD 回退等，都是安卓/MIUI 限制下的必要姿势，脚本里已内置

## 免 root 路线（未实现）

把插件里的 `su` 通道换成 [Shizuku](https://shizuku.rikka.app/)（免 root 的 ADB 通道）即可；DNS 修复用静态 DNS 代替。欢迎 PR。

## 致谢与协议

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）——DSH 本体
- 本仓库 MIT License，见 [LICENSE](LICENSE)

