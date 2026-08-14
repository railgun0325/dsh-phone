# DSH Phone v0.2.1

**真机验收通过**（Xiaomi 17 Pro / Android 16 / 未 root / Shizuku 13.5.4）：装 APK → 贴 Key → 点部署 → 全自动装 Termux/Node/DSH/插件 → DSH web 起在 127.0.0.1:3080 → 桥三测通过（health / adb 级命令 / 截图落盘 / 坏 token 拒绝）。

## 下载

- dsh-phone-shizuku-v0.2.1.apk — 未 root 手机（经 Shizuku）
- dsh-phone-root-v0.2.1.apk — 已 root 手机（本次仅更新了 setup 脚本，未真机复测）

## 相对 v0.2.0 的修复（全部来自真机实测）

1. Termux 侧执行通道从 RUN_COMMAND 换成 run-as（分发的 Termux 为 debug 构建）：RUN_COMMAND 后台命令在部分 ROM 上静默卡死，run-as 已被 bootstrap 轮询验证稳定
2. payload 传输弃用 heredoc 自解压：run-as 下 heredoc 从 stdin 读取，而 Shizuku 远程管道不传递 EOF → 永久挂起；改为逐文件 dd bs=1 count=N（与 pm install -S 同款 EOF 无关模式）
3. ShizukuExec 退出检测弃用 waitForTimeout（秒退进程偶发不返回）：改为 exitValue 轮询（兼容其抛 IllegalArgumentException 的行为）
4. setup 脚本 npm 加固：fetch-retries + registry 三级回退（npmmirror → 华为云 → 官方），应对弱网与 VPN fake-ip 劫持
5. 命令日志脱敏：sk- key 一律显示为 sk-***；pm install 对已安装包静默跳过
6. 部署日志写入 logcat（tag=DSHDeploy），排障不再抓瞎

## 注意

- 若手机开着代理类 App（Clash/v2ray 等）且隧道是死的，其 fake-ip 会劫持整机 DNS 导致 npm 失败：换节点或先关闭代理
- 装过 v0.1.0 纯壳的先卸载再装（签名已换）

---

**v0.2.1** — verified on-device (Xiaomi 17 Pro / Android 16 / unrooted / Shizuku): one-tap deploy completes end-to-end; bridge health/exec/screenshot/auth all pass. Fixes: run-as execution channel, EOF-safe dd payload transfer, exitValue polling, npm registry fallback chain, log redaction.
