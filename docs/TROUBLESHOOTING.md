# 排障手册

大部分条目来自小米 13 Pro / Android 14 / Magisk Kitsune 实测；Shizuku 版条目按机制推演，
真机验收后持续补充。

## 部署类

### 一键部署卡在「正在初始化 Termux」
- Termux 首次启动自动解压内置 bootstrap（10~60 秒），日志里会显示轮询进度
- 长时间不动：Root 版看 Termux 是否弹了安装界面、su 授权是否已允许；Shizuku 版确认 Shizuku 处于运行状态

### Shizuku 版提示未检测到 Shizuku / 权限未授予
- 打开 Shizuku App 点「启动」；首次需要无线调试配对（开发者选项 → 无线调试 → 使用配对码）
- 配对授权后回到 DSH Phone 点重试；权限弹窗在 Shizuku 侧，注意切换前台
- 部分系统重启后需要重新打开 Shizuku（其「开机自启」选项可缓解）

### 部署到一半失败
- 先看 App 日志；再看 Termux 内：tail -50 ~/setup-dsh.log
- 网络问题（apt/npm 拉不动）：确认手机能上网；脚本已内置 TUNA 源 + npmmirror，一般无需改

### RUN_COMMAND 一直无响应（Shizuku 版）
- Termux 未装好/bootstrap 未就绪：App 会每 5 秒重试，最长 4 分钟
- Android 10+ 后台启动服务受限：部署时请保持 DSH Phone 在前台
- MIUI 需允许 Termux 与 DSH Phone 的后台弹窗/自启动

## 运行类

### pkg 报 Cannot run 'pkg' command as root
Termux 硬性拒绝 root 跑包管理。用 su <UID> -c '...' 以 termux 应用 uid 执行
（先 su -c 'stat -c %u /data/data/com.termux' 拿 uid）。

### pkg 更新时所有镜像都 bad
新版 pkg 的镜像检测依赖 curl，bootstrap 里没有。先 apt-get install -y curl，或直接 apt-get update。
国内网络慢/不通时换清华源：deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main

### 往 /data/data/com.termux/... 写文件/执行失败（Permission denied）
- 小米的 root 无法 chmod/重定向写 app 数据目录：用 install -m 644/-755 替代 chmod+cp
- su -c 'cmd' 里的 shell 重定向写 app 目录会 EACCES：内容用 install/cp 落盘，或写进脚本文件再执行

### 重启手机后 Termux 目录写不进（FBE）
第一次开机解锁后 CE 存储才可写；无锁屏密码时一般自动解锁。解锁一次即可。

### dsh web 起不来：1 entry did not activate: permission-presets (waiting for service: shell)
主线 web profile 的 shell 提供者是 bash-sandbox（依赖 landlock/koffi，安卓不可用）。
处理：profile 补丁禁用 bash-sandbox，并 insert @deepseek-ai/dsh-bash-local（纯 subprocess 执行器）。

### 会话创建挂起 / agent-preset-invalid：tool-bash waiting for shell、tool-fs-search waiting for subprocess
subprocess 插件因静态 import node-pty（无安卓原生二进制）加载失败 → bash 工具链等待服务。
处理：node patch-dsh.mjs <subprocess-local/lib/index.js> 把 node-pty 改惰性加载，并在 profile 补丁里禁用 permission。

### 点屏幕没反应 / 截图失败：screencap 报 Xzs_* 符号缺失
MIUI 的 screencap 链接 libunwindstack 有符号问题。插件已内置回退：
LD_PRELOAD=/system/lib64/liblzma.so:/system/lib64/libz.so 重试。

### 未 root 手机：android_* 工具报「no su and no Shizuku bridge」
桥（DSH Phone App 的前台服务）没在跑：打开一次 DSH Phone App；开机后也需先开一次（或等开机自启 Receiver 拉起）。
确认 ~/.dsh-bridge-token 与 App 内 token 一致（部署时自动写好，手动改过才需要核）。

### 手机整个断网（DNS 全挂、TCP 数据面 0 字节）
两种常见元凶：
1. v2rayNG/Clash 等 VPN 开着但节点死了：am force-stop <包名>，并关掉其开机自启。
2. 路由器 DHCP 只发坏的 IPv6 DNS（如 fe80::5）：Root 版跑 boot-dsh.sh 的 DNS 修复；
   Shizuku 版改静态 DNS（223.5.5.5）或修路由器。

### dsh web 里侧边栏收起来就找不到（竖屏）
收起时保留 56px 轨道条，☰ 按钮常驻。确认用最新 plugin/lib/client.js 并重启 dsh web（bundle 带 rev 缓存，页面要刷新）。

### 设置面板挤成一列
移动端已改为「顶部横向导航 + 内容全宽」。同上更新 client.js 后刷新。

## 通用三板斧

```bash
# 看 dsh 日志
tail -50 ~/dsh-web.log
# 看插件树（确认 android-control/bash-local 在列）
dsh --profile web --dump-config | grep -E 'android|bash'
# 验证会话创建 API
curl -s -X POST http://127.0.0.1:3080/api/session.create -H 'Content-Type: application/json' -d '{"type":"client-request","method":"session.create","rpcId":"t","payload":{}}'
# 验证 Shizuku 桥
curl -s -H 'X-DSH-Token: <token>' -H 'X-DSH-Cmd: id' http://127.0.0.1:36527/exec
```
