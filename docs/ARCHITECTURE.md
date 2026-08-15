# 架构说明（v0.2.5）

## 总览

```
┌──────────────────────────── 安装阶段 ────────────────────────────┐
│  DSH Phone APK（部署向导 WizardActivity）                         │
│   Root 版：su 编排（ShRoot.exec / execAs）                        │
│   Shizuku 版：Shizuku.newProcess（pm install / monkey / 桥）      │
│        ↓ 全自动：装 Termux → bootstrap → 装 Node/DSH → 插件/Key  │
│        ↓ setup 末尾：给 com.termux.api 授硬件权限 + Doze 豁免     │
│          Root：su pm grant / dumpsys whitelist                    │
│          Shizuku：经桥 pm grant → cmd appops → 日志提示手动开     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────── 运行阶段 ────────────────────────────┐
│  WebView ── http://127.0.0.1:3080                                │
│     DSH web（Termux + Node.js，web profile）                      │
│       ├── dsh-android-control 插件（28 个 android_* 工具）        │
│       │     ├─ 屏幕/UI 13 个：执行器抽象 run()                    │
│       │     │    su 可用 → execFile('su','-c',cmd)  (root)        │
│       │     │    su 缺失 → HTTP 桥 127.0.0.1:36527/exec (Shizuku) │
│       │     └─ 硬件 15 个：termux-* 统一走 root:false（Termux uid │
│       │          → Termux:API），settings/input 类走 root 通道    │
│       │     └─ 截图落 /data/local/tmp/dsh-shots；拍照/录音落      │
│       │          ~/dsh-shots/（755/644，Termux 可读）             │
│       ├── bash-local（纯子进程 shell，无 PTY）                    │
│       └── 移动端 CSS（plugin/lib/client.js）                      │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────── 能力通道 ────────────────────────────┐
│  Root 版：Magisk su ── input/screencap/am/pm/uiautomator/...     │
│  Shizuku 版：DSH Phone App 前台服务（主进程）                     │
│     ├── HttpServer 127.0.0.1:36527（X-DSH-Token 校验）           │
│     └── Shizuku.newProcess(['sh','-c',cmd]) = adb shell 级       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────── 开机自启 ────────────────────────────┐
│  Termux:Boot → ~/.termux/boot/boot-dsh.sh                        │
│    Root 版：dns-fwd.mjs(DoH) + iptables DNAT 53 → start-dsh.sh   │
│    Shizuku 版：start-dsh.sh；桥随 App BOOT_COMPLETED Receiver 起  │
└──────────────────────────────────────────────────────────────────┘
```

## 关键机制

### 1. 插件挂载（免 pnpm）
DSH 的 loader 从 profile 目录解析插件包名，客户端 bundle 走 /plugins/<id>/client.js。
做法：插件放 DSH 包 node_modules 内 + profile node_modules 符号链接 + cordis.patch.yml insert。
package.json 的 exports 必须含 ./package.json（否则 loader 扫描不到 dsh.client 声明）。

### 2. 安卓上执行命令的两条腿
- **host 工具链**：插件 android_shell 直接 execFile su；无 su 时自动切换 Shizuku 桥（见下）
- **DSH 自身 shell 服务**：web profile 用 bash-local（子进程 spawn，无 PTY），保证会话创建不被 bash 工具卡死

### 2.1 硬件工具通道（v0.2.5，方案 A）
- termux-* 命令（battery/sensor/camera/mic/tts/media/volume/location/vibrate/notify/dialog）
  一律 `run(cmd, { root: false })`：插件进程即 com.termux uid，直接调 Termux:API，root 不参与。
- wakelock 是例外：当前 Termux 已不带 termux-wake-lock 脚本，改走 com.termux 应用自身的
  TermuxService（`am startservice -a com.termux.service_wake_lock/_unlock`）。
- brightness/screen_off 等 settings/input 类走默认 root 通道：root 版 su 直通；Shizuku 版桥回退（adb shell 级）。
- 权限对象：com.termux.api 声明并需授予的运行时权限只有 CAMERA / RECORD_AUDIO /
  ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION；通知因 targetSdk=28 无需 POST_NOTIFICATIONS；
  VIBRATE 随安装授予；Doze 电池豁免防止 MIUI 冻结 Termux:API。
- 模型边界：DeepSeek 文本模型看不懂照片、听不懂录音；拍照/录音用于给用户看/播，视觉闭环留待可选 vision 模型。

### 3. Shizuku 桥（未 root 手机）
- 协议：POST /exec，headers X-DSH-Token（= App files/bridge-token 与 Termux ~/.dsh-bridge-token）、
  X-DSH-Cmd、X-DSH-Timeout；body 即 stdin（装 APK 时用它流式喂 pm install -S）
- 实现：com.sun.net.httpserver 跑在 App 主进程前台服务里，命令经 Shizuku.newProcess 以
  adb shell 权限执行（input/screencap/am/pm/uiautomator 全可用，无需 root）
- token 在部署时随机生成，双端各存一份，只认 127.0.0.1 回环

### 4. Termux bootstrap（v0.118.3 关键事实）
bootstrap 压缩包内嵌在 termux APK 的 libtermux-bootstrap.so 里，首次启动 App 时由
TermuxInstaller 解压到 /data/data/com.termux/files/usr（解压含 SYMLINKS.txt 软链处理）；
usr/ 非空则跳过。因此两个版本都无需联网下载 bootstrap。

### 5. root 通道的 MIUI 姿势（Root 版）
- su <uid> -c：以 app uid 执行（pkg 拒绝 root 的绕法）
- install -m：替代 chmod（app 数据目录 chmod 被拦）
- screencap LD_PRELOAD 回退：修 MIUI libunwindstack 符号问题
- 文件跨身份传递走 /data/local/tmp 中转

### 6. 独立联网（仅 Root 版）
- DNS 转发器（Node，零依赖）：监听 53，DoH 到阿里 DNS（IP 直连 + SNI，不依赖本机 DNS）
- iptables OUTPUT DNAT 把系统 DNS 查询重定向到本地转发器
- ip -6 route local 接管路由器发来的坏 IPv6 DNS 地址（fe80::5 案例）

### 7. 部署引导（两版共用结构）
WizardActivity（app/common）：Key 输入 → 一键部署（后台线程）→ 滚动日志 → WebActivity 壳。
Root 版实现 doDeploy=su 编排；Shizuku 版实现 doDeploy=Shizuku + RUN_COMMAND 编排。
安装资源（termux.apk 等第三方 APK）构建期由 tools/fetch-assets.ps1 拉取并校验 SHA256，
随包 assets 分发，不提交 git。
