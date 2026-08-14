# 架构说明

## 分层

```
┌─────────────── 交互层 ───────────────┐
│ DSH Phone APK（WebView 壳）           │  ← 手机本地应用体验
│ 手机浏览器 http://127.0.0.1:3080      │
│ 电脑浏览器 http://127.0.0.1:3081      │  ← adb forward（USB）
└──────────────────┬───────────────────┘
                   │ HTTP /api/* + WebSocket 事件（官方 GUI 协议）
┌─────────────── 服务层 ───────────────┐
│ DSH 0.1.x（npm 安装）跑在 Termux      │
│  web profile：标准插件树 + 补丁        │
│   禁用：hmr / sandbox / bash-sandbox  │  ← 安卓无 landlock/koffi/pty
│         / permission                 │
│   插入：bash-local（提供 shell 服务）  │  ← 纯子进程执行器
│         android-control（本插件）      │
│ 兼容补丁：subprocess-local 惰性加载    │
│          node-pty（patch-dsh.mjs）    │
└──────────────────┬───────────────────┘
                   │
┌─────────────── 能力层 ───────────────┐
│ dsh-android-control 插件              │
│  host 半：13 个 android_* 工具        │
│    └─ execFile('su') ── root shell    │
│       input tap/swipe/text/keyevent   │
│       screencap（LD_PRELOAD 回退）     │
│       uiautomator dump / monkey / pm  │
│       termux-api（剪贴板，免 root）    │
│  client 半：移动端 CSS（抽屉侧边栏、  │
│             设置横排导航）             │
└─────────────────────────────────────┘

## 关键机制

### 1. 插件挂载（免 pnpm）
DSH 的 loader 从 profile 目录解析插件包名，客户端 bundle 走 `/plugins/<id>/client.js`。
做法：插件放 DSH 包 node_modules 内 + profile node_modules 符号链接 + cordis.patch.yml `insert`。
package.json 的 exports 必须含 `./package.json`（否则 loader 扫描不到 dsh.client 声明）。

### 2. 安卓上执行命令的两条腿
- **host 工具链**：插件 `android_shell` 直接 execFile su，与 DSH 自身的 bash 工具无关
- **DSH 自身 shell 服务**：web profile 用 bash-local（子进程 spawn，无 PTY），保证会话创建/工具挂载不被 bash 工具卡死

### 3. root 通道的 MIUI 姿势
- `su <uid> -c`：以 app uid 执行（pkg 拒绝 root 的绕法）
- `install -m`：替代 chmod（app 数据目录 chmod 被拦）
- `screencap` LD_PRELOAD 回退：修 MIUI libunwindstack 符号问题
- Magisk db 预授权：`policies` 表写 uid=2（允许），免弹窗

### 4. 独立联网
- DNS 转发器（Node，零依赖）：监听 53，DoH 到阿里 DNS（IP 直连 + SNI，不依赖本机 DNS）
- iptables OUTPUT DNAT 把系统 DNS 查询重定向到本地转发器
- `ip -6 route local` 接管路由器发来的坏 IPv6 DNS 地址（fe80::5 案例）
- Termux:Boot 开机自启上述链路 + dsh web

