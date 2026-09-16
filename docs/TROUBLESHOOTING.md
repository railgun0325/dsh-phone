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
- 网络问题（apt/npm 拉不动）：确认手机能上网；脚本已内置 apt 镜像回退链 + npmmirror，一般无需改
- apt 报 403 Forbidden（常见于 TUNA）：**这不是手机断网**，而是镜像站 WAF/限流，或当前网络出口 IP 被该镜像封禁（手机浏览器能上网不能排除这种可能）。
  当前 setup 脚本会按 TUNA → USTC → BFSU → 腾讯云 → Termux 官方自动回退，并在同一镜像上再试一次强制 IPv4。
  旧版 APK 没有回退逻辑，可在 Termux 里先给 apt 加一个本地源覆盖（旧脚本写的 TUNA 源会被忽略），再回 App 重新部署：
  ```bash
  echo "deb https://mirrors.ustc.edu.cn/termux/apt/termux-main stable main" > "$HOME/termux-ustc.list"
  mkdir -p "$PREFIX/etc/apt/apt.conf.d"
  printf 'Dir::Etc::sourcelist "%s/termux-ustc.list";\nDir::Etc::sourceparts "-";\n' "$HOME" > "$PREFIX/etc/apt/apt.conf.d/99-dsh-ustc.conf"
  apt-get update
  # 然后回到 App 重新点部署（setup 仍会写 TUNA 源，但 apt 实际走上面的 USTC 文件）
  ```
  其他可选源：`https://mirrors.bfsu.edu.cn/termux/apt/termux-main`、`https://packages-cf.termux.dev/apt/termux-main`。

### RUN_COMMAND 一直无响应（Shizuku 版）
- Termux 未装好/bootstrap 未就绪：App 会每 5 秒重试，最长 4 分钟
- Android 10+ 后台启动服务受限：部署时请保持 DSH Phone 在前台
- MIUI 需允许 Termux 与 DSH Phone 的后台弹窗/自启动

### 安装新 APK 报 INSTALL_FAILED_UPDATE_INCOMPATIBLE（或"签名不一致"）
装过 v0.1.0 纯壳的手机：v0.2.0 换用了新签名（旧签名库已遗失），需先卸载旧壳：
adb uninstall com.dsh.phone 后重装。Termux/DSH 环境不受影响，新 APK 部署时会自动复用已有 Termux。
（后续版本签名请务必沿用仓库本地 apk/debug.keystore，勿再遗失。）

### Shizuku 版部署时报 pm install termux 失败（签名冲突）
若手机装过 F-Droid/Play 版 Termux（签名与 GitHub 版不同），自动安装会失败。
处理：先在系统设置卸载旧 Termux（或 adb uninstall com.termux），再点一键部署；
也可保留旧 Termux 改用「手动安装」路线（docs/INSTALL.md 第二节）。
另外 Shizuku 版的就绪探测依赖 Termux 为 debuggable 构建（本包分发的 GitHub 官方构建满足）；

### 发送消息失败：EACCES … session.jsonl.zstd.tmp → link permission denied
DSH 的会话文件用 link()（硬链接）原子发布，安卓 SELinux 对 App uid 拒绝 link。
处理：确保 setup 已跑 patch-dsh-link.mjs（v0.2.2 起内置），或手动执行：
node ~/patch-dsh-link.mjs /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
然后重启 dsh web。

### 手机重启/放后台后 android_* 工具报「bridge call failed」
MIUI 会冻结/回收后台的 DSH Phone 进程（桥随之失联）。处理：打开一次 DSH Phone App（v0.2.2 起打开即自愈）；
系统设置里允许其自启动、电池「无限制」、最近任务加锁。

## 运行类

### pkg 报 Cannot run 'pkg' command as root
Termux 硬性拒绝 root 跑包管理。用 su <UID> -c '...' 以 termux 应用 uid 执行
（先 su -c 'stat -c %u /data/data/com.termux' 拿 uid）。

### pkg 更新时所有镜像都 bad
新版 pkg 的镜像检测依赖 curl，bootstrap 里没有。先 apt-get install -y curl，或直接 apt-get update。
国内网络慢/不通时可换以下任一同版本仓库（签名相同，可随时互切）：
```bash
echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main" > "$PREFIX/etc/apt/sources.list"
echo "deb https://mirrors.ustc.edu.cn/termux/apt/termux-main stable main" > "$PREFIX/etc/apt/sources.list"
echo "deb https://packages-cf.termux.dev/apt/termux-main stable main" > "$PREFIX/etc/apt/sources.list"
```
若 TUNA 返回 403，优先切 USTC 或 packages-cf；IPv6 路由异常时加 `apt-get -o Acquire::ForceIPv4=true update`。

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

### 发消息一直报错：`DeepSeek API request to https://api.deepseek.com failed` / `code: TRANSPORT`
现象：会话日志里每次发送都是 `llm/retry` → `"code":"TRANSPORT"`，重试 2 次后
`turn/end reason:{kind:error}`；同一台手机上浏览器和其它 App 也解析不了域名，但裸 IP
（如 `curl https://223.5.5.5/`）能通 —— 这不是断网，是**全机 DNS 挂了**。
根因：`boot-dsh.sh` 把 `:53` 全部 DNAT 到 `127.0.0.1:53`，而 `dns-fwd.mjs` 后来死了
（2026-09-14 实例：开机约 25 小时后进程消失），重定向却留着 → 所有解析指向无人监听的端口。
诊断与恢复：
```bash
adb shell su -c 'sh /data/adb/service.d/dsh-watchdog.sh status'   # 一眼看全状态
adb shell su -c 'sh /data/adb/service.d/dsh-watchdog.sh once'     # 立即修一轮
```
看门狗（`scripts/dsh-watchdog.sh`，装到 `/data/adb/service.d/`）会在 ≤30 秒内自动拉起
dns-fwd，并在连拉失败时摘掉 `:53` 重定向（fail open）。注意 fail open 只在「网络自带
解析器是好的」时有用：本机常用的那个路由器会下发坏掉的 IPv6 DNS（fe80::5），所以真正
的保护是那 30 秒自愈，不是 fail open。

### 打开 App 白屏，只有一句「DSH 还没起来」
根因：`WebActivity` 只加载一次 `http://127.0.0.1:3080/`，主框架失败就进 `onReceivedError`
的静态兜底页 —— 不重试、没有重试按钮；而 App 启动路径（`resumeDsh()` → `startServices()`
→ `start-dsh.sh`）会 `pkill` 再重启 dsh web，node 启动要 20–30 秒。这一次加载正好落在这个
空窗里，页面就永久停在兜底页（2026-09-14 实例：03:35:07 加载，03:35:3x 服务才起来）。
缓解（已落地）：`start-dsh.sh` 在 3080 已健康时**不再重启**；看门狗让 3080 基本总是活的。
根治（待 APK 重编）：`WebActivity` 改为退避重试 + 兜底页自带自动刷新/重试按钮。
临时自救：退出 App（最近任务里划掉）再打开一次即可。

### 服务端重启后，已经打开的页面要重载吗？
不要。客户端是逐请求 HTTP（`POST /api/<method>`），不是长连接：dsh web 换进程后页面里的
RPC 依然返回 200，实测无需刷新。真正会卡住页面的是 MIUI 把后台 App 冻住（连 CDP 都不响应），
回到前台即恢复。


### 升级到 DSH 0.1.5（含 rc.1/rc.2）手机上要过哪几关
2026-09-14 在 13 Pro 上实测了一遍「0.1.0-rc.6 → 0.1.5-rc.2」，四关都过了才会起来，任何一关不过
都是**加载期报错或永久空转**（不是慢，是不收敛）：

1. **node-pty 惰性加载**：`patch-dsh.mjs` 的调用点锚点变了 —— 0.1.5 在 `async spawnTerminal(spec)`
   里 `terminal = nodePty.spawn(scope?.command ?? file, ...)`。脚本已同时兼容两版。
2. **link→rename**：0.1.5 的 `session-persistence-jsonl` 有三处相关代码，不能只换 import：
   - `defaultFileSystem` 用 `link` 作**简写属性**（去掉 import 会 ReferenceError）；
   - `publishCurrentExclusive` 的 `internals.fs.link(staged, currentPath)` 要换成
     `copyFile(..., COPYFILE_EXCL)`（rename 会搬走调用方还持有的暂存文件）；
   - 原子发布那处才是 `rename`。另外该文件已从 `node:zlib` 引入 `constants`，
     fs/promises 的那个必须起别名（`fsConstants`），否则 `Identifier 'constants' has already been declared`。
3. **sharp**：0.1.5 的 `attachment-local` 在**加载期**就 `import sharp`，而 Android 上 sharp 需要
   `@img/sharp-wasm32` **加它的依赖 `@emnapi/runtime`**（老树里恰好有，新装的扁平树没有）。
   少一个就是 `Could not load the "sharp" module using the android-arm64 runtime`。
4. **客户端打包器（`dsh-client-modules`）**：0.1.5 给每个模块合成「恒等 source map」（把整份源码
   塞进 `sourcesContent` 再 JSON+Buffer），而且**每次插件注册都会重新 compose 一遍全部 bundle**。
   手机上 10.8 MB 客户端产物（其中 `dsh-client-ui-sidebar-documentpreview` 单体 6.9 MB）会让
   boot 永远不收敛：CPU profile 225 秒里 buildCombo 48s、newlineCount 45s、Buffer/utf8Write 62s。
   `patch-dsh-client-modules.mjs` 做两件事：恒等映射降级成空映射（纯 devtools 数据，执行不变）+
   把 flush 的微任务合并改成 150ms 防抖。打完 16 秒起来。

5. **web 鉴权门禁**：0.1.5 的 index 与 `/api/*` 都要求"每进程随机 launch token → 签名 cookie"，
   而 App 的 WebView 打开裸 loopback 地址、也没有地址栏可粘 token，会 401。
   `patch-dsh-web-auth.mjs` 让 **loopback 权威免鉴权**（0.1.5 之前本来就没有鉴权），LAN 仍需 token：
   - `BrowserAuth.authorizeIndex`（index）
   - `Connection.requestRejection`（`/api/*`）

**还要注意第三方插件**：手机 profile 里的 `dsh-mnemon@0.1.2` 在 0.1.5 下会让 UI 抛
`Cannot read properties of undefined (reading 'refreshSnapshot')`（核心 workspace controller 的
getSnapshot）。Mac 上配 0.1.5 的是 `dsh-mnemon@^0.5.5` —— 升级 mnemon（以及 super-injector）
是切到 0.1.5 的前置条件。

**历史上的集成阻塞（已由上面的补丁解决）**：0.1.5 的 web UI 带 **token 门禁**，启动横幅是
`dsh web: http://127.0.0.1:3080/?token=…`；不带 token 访问 `/` 返回 401（带 token 是 303 → cookie）。
APK 里 `WebActivity` 写死加载 `http://127.0.0.1:3080/`，所以直接切到 0.1.5 会看到 401 页面 ——
要么找到关掉/固定 token 的配置，要么改 APK 让它带着 token 打开（root 版可经 su 读横幅）。



### 0.1.5 移植进展与坑（2026-09-16 实测，未完成）
在 13 Pro 上完整试过一次 0.1.0-rc.6 → 0.1.5-rc.2，已解决 6 关，**但最后一关未过，已回滚**。
已解决（补丁都在 scripts/，实测有效）：
1. composer CPU 黑洞（`patch-dsh-client-modules.mjs`）
2. web 鉴权 token 门禁对 loopback 放行（`patch-dsh-web-auth.mjs`）
3. sharp wasm 回退需 `@img/sharp-wasm32` + `@emnapi/runtime`
4. `link→rename/alias` 三处语义 + `constants` 别名（`patch-dsh-link.mjs`）
5. node-pty 惰性加载新锚点（`patch-dsh.mjs`）
6. **`flock` 原生模块在 Android 上直接抛 `ERR_FLOCK_UNSUPPORTED_PLATFORM`**（`process.platform === 'android'`），
   会话日志因此永远写不出来；`patch-dsh-flock-android.mjs` 让它在 android 上退化为无竞争锁。
**未解决**：打完 1–6 后，`session/prompt` 返回 `accepted:true`、会话目录只生成 `session.lock`、
没有 `session.jsonl.zstd`、进程空闲在 `processTimers`、没有任何对外模型连接 —— 即轮次从未启动。
纯自带 profile 同样复现，所以不是用户 profile/预设的问题；怀疑仍有某个服务/插件在 Android 上永不激活
（0.1.0 时代同类故障是 `tool-bash waiting for shell`）。诊断手法：用 `--inspect` 起实例，复现后
`Debugger.pause` 抓栈（只会看到 `processTimers`，说明在等一个永不 settle 的 promise）。

**混用 home 的两个真实事故（回滚时必须处理）**：
- 0.1.5 会把 `~/.dsh/.credentials.yaml` 改写成新格式（`version: 1` 是数字）；0.1.0-rc.6 读它会直接拒绝启动
  （`value for "version" ... must be a string`）。用真实 home 跑一次新版就会中招。
- mnemon 0.5.9 迁移会往共享 `settings.yaml` 写 `mnemon.displayMode: builtin`，而 mnemon 0.1.2 的 schema 只认
  `sidebar`/`buildin`（它自己的拼写）→ 回滚后旧版起不来。
- 预设的 persona 配置键 0.1.5 用 `prefix:`、0.1.0 用 `text:`，回滚时要改回去。

### 手机整个断网（DNS 全挂、TCP 数据面 0 字节）
两种常见元凶：
1. v2rayNG/Clash 等 VPN 开着但节点死了：am force-stop <包名>，并关掉其开机自启。
2. 路由器 DHCP 只发坏的 IPv6 DNS（如 fe80::5）：Root 版跑 boot-dsh.sh 的 DNS 修复；
   Shizuku 版改静态 DNS（223.5.5.5）或修路由器。

### dsh web 里侧边栏收起来就找不到（竖屏）
收起时保留 56px 轨道条，☰ 按钮常驻。确认用最新 plugin/lib/client.js 并重启 dsh web（bundle 带 rev 缓存，页面要刷新）。

### 设置面板挤成一列
移动端已改为「顶部横向导航 + 内容全宽」。同上更新 client.js 后刷新。

### Root 版 android_install_apk / android_list_packages 失败（Failed transaction）
DSH 进程 PATH 会让 root shell 命中 Termux 的 `pm` 包装脚本，PackageManager 调用可能失败。
临时方案：让 agent 改用 `android_shell` 执行 `/system/bin/pm ...` 或 `cmd package ...`。
（v0.2.5 已知问题，计划在后续版本统一 root 通道 PATH。）

### 拍照返回成功但文件是 0 字节 / 剪贴板读回空 / confirm 弹窗不出现
Android 14 后台限制：`android_camera_photo`、`android_confirm_dialog`、`android_clipboard`
需要 Termux:API 处于前台。临时方案：调用前让
`com.termux.api/.activities.TermuxAPILauncherActivity` 到前台，再执行工具。

### 录音完成后立刻播放提示 Prepare failed
`android_mic_record` 的 CLI 会提前退出，录音仍在后台写文件。录音后等 1–3 秒再播放；
或确认文件大小不再变化后再交给 `android_play_media`。

### 覆盖安装新 APK 后没有新增工具
旧 DSH 仍在运行时，App 可能直接进入界面而不会刷新 Termux 侧 payload。
临时方案：清空 DSH Phone App 数据后重新一键部署（Termux 环境与 `~/.dsh-api-key` 保留，
重新部署时会复用）；计划在后续版本检测版本变化后强制重部署。



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
