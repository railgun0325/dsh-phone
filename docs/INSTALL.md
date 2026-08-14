# 安装手册

本仓库提供两种安装方式：**一键 APK**（推荐，见 README）与**手动安装**（本文档）。
只有想了解细节、或在 APK 部署失败需要手动排障时才需要看这篇。

## 一、Root 版手动安装（adb 流程）

### 0. 准备

- 电脑：下载 [platform-tools](https://dl.google.com/android/repository/platform-tools-latest-windows.zip) 解压（adb）
- 手机：开发者选项 → 开 USB 调试 / USB 调试（安全设置）/ USB 安装（小米需登录账号）
- 手机连电脑：adb devices 出现 device，adb shell su -c id 输出 uid=0（root 正常）
- 下载 Termux 全家桶 APK（[termux-app](https://github.com/termux/termux-app/releases)、[termux-api](https://github.com/termux/termux-api/releases)、[termux-boot](https://github.com/termux/termux-boot/releases)，arm64 版）

> Termux v0.118.3 起 bootstrap 内置在 APK 中，首次启动自动解压，**无需联网下载 bootstrap**。

### 1. 安装 Termux

```bash
adb uninstall com.termux            # 装过 Play 停更版（0.101）必须先卸
adb install -r termux-app.apk
adb install -r termux-api.apk
adb install -r termux-boot.apk
adb shell am start -n com.termux/.app.TermuxActivity   # 首次启动完成 bootstrap
adb shell dumpsys deviceidle whitelist +com.termux     # 防 MIUI 杀后台
```

### 2. 引导 DSH（在 Termux 里）

把本仓库 scripts/ 推到手机，再以 termux 身份落盘（app 数据目录 root 直写会被 MIUI 拦，用 su <uid> 通道）：

```bash
adb push scripts/ /data/local/tmp/scripts
adb shell "su -c 'stat -c %u /data/data/com.termux'"    # 记下 uid，下面统一用 <UID> 代替
adb shell "su <UID> -c 'mkdir -p ~/dsh-phone && cp /data/local/tmp/scripts/* ~/dsh-phone/'"
adb shell "su <UID> -c 'cd ~/dsh-phone && bash setup-termux.sh'"   # 或改为 scripts/setup-root.sh
```

> Termux 的 pkg 拒绝 root 执行，所有包管理操作必须用 su <UID> -c 以 termux 应用 uid 跑。
> MIUI 上 chmod/重定向写 app 数据目录会被拒，统一用 install -m 与 cp。

脚本要点（scripts/setup-root.sh / setup-shizuku.sh）：TUNA 源 → apt 装 nodejs-lts/git/curl 等 →
npm registry 换 npmmirror → npm i -g --ignore-scripts @deepseek-ai/dsh → koffi/sharp/node-pty 兼容补丁
（patch-dsh.mjs）→ 写 web profile cordis.patch.yml。

### 3. 挂载 android-control 插件

```bash
adb push plugin/ /data/local/tmp/plugin
# 1) 插件放进 DSH 包内（import 解析用）
adb shell "su <UID> -c 'mkdir -p /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control/lib && install -m 644 /data/local/tmp/plugin/index.js /data/local/tmp/plugin/package.json /data/local/tmp/plugin/cordis.patch.yml /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control/ && install -m 644 /data/local/tmp/plugin/lib/client.js /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control/lib/'"
# 2) profile 里放符号链接（loader 从 profile 解析插件名）
adb shell "su <UID> -c 'mkdir -p ~/.dsh/profiles/web/node_modules && ln -sfn /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control ~/.dsh/profiles/web/node_modules/dsh-android-control'"
# 3) profile 补丁（禁用安卓不可用插件 + 插入 bash-local 与 android-control）
adb shell "su <UID> -c 'install -m 644 /data/local/tmp/scripts/cordis.patch.yml ~/.dsh/profiles/web/cordis.patch.yml'"
```

### 4. 授权 Magisk su

手机上打开任意 Termux 会话执行 su，弹窗点「允许」（或按 TROUBLESHOOTING 写 magisk.db 免弹窗）。

### 5. API Key 与启动

```bash
adb shell "su <UID> -c 'bash ~/dsh-phone/install-api-key.sh sk-你的key'"
adb shell "su <UID> -c 'setsid bash ~/dsh-phone/start-dsh.sh'"
adb forward tcp:3081 tcp:3080   # 电脑浏览器 http://127.0.0.1:3081
```

### 6. 开机自启与 DNS 修复（root）

把 boot-dsh.sh 放进 ~/.termux/boot/；Root 版内含 dns-fwd.mjs（DoH 转发器）+ iptables 重定向，
修路由器坏 DNS；详见 ARCHITECTURE.md。

## 二、Shizuku 版手动安装（未 root）

```bash
# 1) 手机上安装 Shizuku 并激活（无线调试配对，官方教程 https://shizuku.rikka.app/zh-hans/）
# 2) 经 Shizuku shell（或电脑 adb）装 Termux 全家桶：
adb install -r termux-app.apk && adb install -r termux-api.apk && adb install -r termux-boot.apk
adb shell am start -n com.termux/.app.TermuxActivity    # 完成 bootstrap
# 3) 在 Termux 里跑 scripts/setup-shizuku.sh（apt/npm 同上，无 root 步骤）
# 4) 装本仓库的 Shizuku 版 APK：它提供 127.0.0.1:36527 的本地桥，插件经桥执行 adb 级命令；
#    桥 token 写在 Termux 的 ~/.dsh-bridge-token（与 App 内 files/bridge-token 一致）
# 5) API Key：bash ~/dsh-phone/install-api-key.sh sk-你的key；setsid bash start-dsh.sh
```

## 三、验证

```bash
# 看 dsh 日志
adb shell "su <UID> -c 'tail -50 ~/dsh-web.log'"
# 验证会话创建 API
curl -s -X POST http://127.0.0.1:3081/api/session.create -H 'Content-Type: application/json' -d '{"type":"client-request","method":"session.create","rpcId":"t","payload":{}}'
```
