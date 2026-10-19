# DSH 0.2.0 Root / Termux 适配

适配目标是用户确认的 `@deepseek-ai/dsh@0.2.0-rc.2`；rc.1 的实际发布包也纳入补丁测试。不会安装 `latest` 或降级到 0.1.5。未知版本、混合版本和未知补丁结构会停止。

## 手机上安装 / 更新

在**普通 Termux 终端**执行，不要进入 `su`，也不要用 `su UID` 跑 npm。需要已 Root、可用的软件源和网络。先完成当前对话；更新入口会暂停这个 DSH 的 web/watchdog，DNS 转发保持原状。

```bash
pkg install git
cd ~
git clone --branch codex/dsh-0.2-android-compat --single-branch https://github.com/RoxyLLL/dsh-phone.git dsh-phone-020
cd ~/dsh-phone-020
DSH_VERSION=0.2.0-rc.2 bash scripts/deploy-root-checkout.sh
```

已克隆过则先查看 `git status --short`，保留本地修改；干净时 `git pull --ff-only` 后重新运行最后一行。不要反复点击旧 APK 的部署按钮，它携带旧补丁。

安装保留 `~/.dsh` 会话、原 API Key、用户 profile 和 `.bashrc`；新增的必要 Android 后端覆盖写在有标记的配置区块中，修改前备份。默认复用已安装的同版本；若旧脚本留下不安全的存储 / flock / auth 修改而提示 `reinstall pristine`，用下面的**同版本清洁重装**，旧包会先保留到 `~/.dsh-install-backups/`：

```bash
cd ~/dsh-phone-020
DSH_VERSION=0.2.0-rc.2 DSH_REINSTALL=1 bash scripts/deploy-root-checkout.sh
```

npm 下载失败会恢复旧包并保留失败目录；后续补丁失败会恢复本轮补丁前的包文件。失败后没有成功标记，停止自动拉起，修复日志中具体错误后重跑即可。备份不会自动删除；API Key 不需要重新发送或写入命令。

首次没有 Key 时，可先在检出的仓库运行 `bash scripts/install-api-key.sh`，在本地隐藏输入后再部署。若服务启动后才保存 Key，需要重启这个 DSH web 进程才能读取新值。不要把 Key 放入 Git、截图或反馈日志。这个分支未发布 APK；从源代码更新脚本即可，现有 APK 可在安装完成后打开 WebView。

## 验收

必须区分以下结果：

- `TREE_OK`：只读检查实际包版本、所有补丁状态、28 个工具注册及配置。
- `RUNTIME_OK`：在手机上实际执行 Sharp 编解码、bionic `renameat2(RENAME_NOREPLACE)` 的排他发布/并发竞争、真实 flock 获取/竞争/释放。任何失败均阻止写入 `.dsh-setup-ok`。
- `SETUP OK`：安装及上述门禁通过。它不代表模型请求和手机控制都已通过。
- `VERIFY_OK`：启动服务后，真实模型回复内容正确且 `turn/end` 为 `completed`；失败/取消步骤计数不算通过。

```bash
node ~/verify-patched-tree.mjs ~/.dsh "$(npm root -g)/@deepseek-ai/dsh"
node ~/verify-android-runtime.mjs "$(npm root -g)/@deepseek-ai/dsh"
node ~/verify-turn.mjs 3080 ~
```

最后在 App 或 `http://127.0.0.1:3080` 中要求：使用 `android_shell` 执行 `id`、读取电量、截图；检查实际结果和图片，再测试点击。工具注册不等于设备操作通过。相机/麦克风/定位仍需要 Termux:API APK 和实际权限；不能只凭授权命令的日志认定可用。

交互式终端 PTY 仍没有 Android 原生 `node-pty` / inspector 后端，暂不可用。普通 Bash 子进程和 `android_*` 控制工具是本适配的执行路径；不会把 PTY 功能伪装成已通过。

## SELinux / npm EACCES 修复边界

旧 Root 安装用 `su UID` 仅切换 Unix UID，仍可能保留 su 进程域，产生没有应用 MCS 分类的 `u:object_r:app_data_file:s0`。这能解释 npm 在 `.bin/*` 符号链接上 rename 时的 EACCES，但必须以该手机的实际标签/AVC 为准。现在 APK 和 watchdog 使用 Android `run-as com.termux`；不支持 run-as 的正式 Termux 走上面的普通 Termux 路线，不会退回 su UID。

`root-install-selinux.sh` 从本机 `/data/data/com.termux` 读取完整标签及属主，先验证路径、属主和现有标签，然后只修复 DSH 包、它的 npm 暂存/专用缓存及明确列举的安装 payload；符号链接使用 `chcon -h`，不沿链接目标递归。它拒绝不相关标签、越界路径和符号链接安装根。不会关闭 SELinux，不递归 chmod/chcon 整个 HOME、PREFIX 或系统，也不会清空整个 npm 缓存。

如果 Termux HOME 本身已属主错误/标签为 s0，可能连克隆都做不到。先在普通 Termux 里记录 `id -u`，由 Root 仅修复 `/data/data/com.termux/files/home` **这个目录本身**，标签必须取同机 Termux 应用目录完整 MCS；不要套用另一台手机的 c 数字。若应用目录本身也没有可信分类，脚本会停止，不能安全地凭空推断标签。

## 日志与恢复

每次日志在 `~/.dsh-install-logs/`；兼容入口 `~/setup-dsh.log` 追加保留；Web 日志在 `~/dsh-web.log`。只回传脱敏错误行，不打包整个 `~/.dsh`、配置或 Key 文件。安装器使用排他锁；服务使用共享锁，避免 watchdog 在改包期间重新启动。

代码原始备份为各目标旁的 `.dsh-phone-original`，配置与 payload 另有带时间的备份。最可靠恢复方式是保留用户数据、重新安装指定版本并应用此分支；不要手工创建成功标记。确认备份不再需要后，由用户决定清理。

## 验证范围

主机测试使用官方 npm 实际发布包，不把历史截图或旧 APK 记录当作新版本证据。Linux 非 Root 测试覆盖原子排他发布、0400 不可变附件、并发写入、锁竞争/释放；主机集成测试覆盖自定义配置迁移、真实 Web/Session API 启动和跨域拒绝。Root Java 代码使用 Android API 34 编译检查。

本分支尚无该手机的实机完整部署、真实 DeepSeek 请求或 Android 输入/截图结果。`RUNTIME_OK` / `VERIFY_OK` 和最后的工具验收需要在手机上完成。Shizuku 一键部署不是本次实机验证范围。
