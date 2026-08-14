# 排障手册（全部来自小米 13 Pro / Android 14 / Kitsune 实测）

## 症状 → 原因 → 处理

### `pkg` 报 "Cannot run 'pkg' command as root"
Termux 硬性拒绝 root 跑包管理。用 `su <UID> -c '...'` 以 termux 应用 uid 执行（先 `su -c 'stat -c %u /data/data/com.termux'` 拿 uid）。

### pkg 更新时所有镜像都 "bad"
新版 pkg 的镜像检测依赖 curl，bootstrap 里没有。先 `apt-get install -y curl`，或直接 `apt-get update` 绕过检测。国内网络慢/不通时把 sources.list 换成清华镜像：
`deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main`

### 往 /data/data/com.termux/... 里写文件/执行失败（Permission denied）
- 小米的 root 无法 chmod/重定向写 app 数据目录：**用 `install -m 644/-755` 替代 chmod+cp**
- `su -c 'cmd'` 里的 shell 重定向写 app 目录会 EACCES：把要写的内容用 `install`/`cp` 落盘，或写进脚本文件再执行
- RUN_COMMAND 服务在 MIUI 上不可靠：直接用 `su <UID> -c` 通道

### 重启手机后 Termux 目录写不进（FBE）
第一次开机解锁后 CE 存储才可写；无锁屏密码时一般自动解锁。解锁一次即可。

### dsh web 起不来：`1 entry did not activate: permission-presets (waiting for service: shell)`
主线 web profile 的 shell 提供者是 bash-sandbox（依赖 landlock/koffi，安卓不可用）。处理：profile 补丁里禁用 `bash-sandbox`，并 insert `@deepseek-ai/dsh-bash-local`（纯 subprocess 执行器）提供 shell。

### 会话创建挂起 / agent-preset-invalid：`tool-bash waiting for shell`、`tool-fs-search waiting for subprocess`
`subprocess` 插件因静态 import node-pty（无安卓原生二进制）而加载失败 → bash 工具链等待服务。处理：跑 `node patch-dsh.mjs <subprocess-local/lib/index.js>` 把 node-pty 改成惰性加载（挂载正常，首次真用 PTY 才报错），并在 profile 补丁里把 `permission` 禁用（它强制要求受限 bash 执行器）。

### 点屏幕没反应 / 截图失败：screencap 报 Xzs_* 符号缺失
MIUI 的 screencap 链接 libunwindstack 有符号问题。插件已内置回退：`LD_PRELOAD=/system/lib64/liblzma.so:/system/lib64/libz.so` 重试。

### 手机整个断网（DNS 全挂、TCP 数据面 0 字节）
两种常见元凶：
1. **v2rayNG/Clash 等 VPN 开着但节点死了**：隧道吞掉全机流量。`am force-stop com.v2ray.ang`（按实际包名），并关掉其开机自启。
2. **路由器 DHCP 只发坏的 IPv6 DNS**（如 fe80::5）：手机 Wi-Fi 设静态 DNS 223.5.5.5，或跑 docs/INSTALL.md 第 7 节的 root 自动修复。

### dsh web 里侧边栏收起来就找不到（竖屏）
早期移动端 CSS 的锅；当前版本收起时保留 56px 轨道条，☰ 按钮常驻。确保用最新 `plugin/lib/client.js` 并重启 dsh web（bundle 带 rev 缓存，页面要刷新）。

### 设置面板挤成一列（模型栏占满整屏）
同上，更新 client.js 后刷新页面：移动端已改为“顶部横向导航 + 内容全宽”。

## 通用三板斧

```bash
# 看 dsh 日志
tail -50 ~/dsh-web.log
# 看插件树（确认 android-control/bash-local 在列）
dsh --profile web --dump-config | grep -E 'android|bash'
# 验证会话创建 API
curl -s -X POST http://127.0.0.1:3080/api/session.create -H 'Content-Type: application/json' -d '{"type":"client-request","method":"session.create","rpcId":"t","payload":{}}'
```

