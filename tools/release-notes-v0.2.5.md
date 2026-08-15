# v0.2.5 Release Notes

## 新增

- **dsh-android-control 插件 v2：15 个硬件工具**（统一走 termux-api 通道，Termux uid 直连，root 不参与）：
  - 状态与传感器：`android_status`、`android_sensor_list`、`android_sensor_read`
  - 媒体：`android_camera_photo`、`android_mic_record`、`android_speak`、`android_play_media`
  - 设备控制：`android_volume`、`android_brightness`、`android_wakelock`、`android_screen_off`、`android_vibrate`
  - 定位与通知：`android_location`、`android_notify`
  - 安全护栏：`android_confirm_dialog`
- **部署授权链透明化**：一键部署自动给 `com.termux.api` 授予 CAMERA / RECORD_AUDIO / ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION 四项运行时权限，并授予 WRITE_SETTINGS appop 与 Doze 电池豁免；App 部署日志逐项打印结果。
- **Shizuku 版部署快速路径**：marker 存在且 node/DSH 可用时跳过 apt/npm 下载。

## 修复

- termux-brightness 写入失败回退 + WRITE_SETTINGS appop 授权。
- `/system/bin/settings` 绝对路径（Termux settings 包装在 su 下会破坏 binder）。
- 工具输出递归剔除 undefined，全部返回 lossless JSON。
- `android_location` 在 Android 14+ 冷定位受限时返回开关诊断。
- wakelock 改为 `com.termux` TermuxService intent（新版 Termux 无 `termux-wake-lock` 脚本）。
- Shizuku 版桥 token 部署后与 Termux 侧对齐。
- 部署/恢复失败后杀死残留 DSH，避免半成品状态伪装成已部署。

## 校验

- 附件 `SHA256SUMS-v0.2.5.txt`：
  - `dsh-phone-root-v0.2.5.apk`
  - `dsh-phone-shizuku-v0.2.5.apk`

## 验证状态

| 设备 | 系统 | 版本 | 结果 |
|---|---|---|---|
| Xiaomi 17 Pro | Android 16 | Shizuku | 一键部署 + 硬件工具验证通过 |
| Xiaomi 13 Pro | Android 14 / MIUI 14 | Root | 部署、恢复、自启、DSH 端到端与 20/28 工具通过；已知问题见下 |

## 已知问题（Root 版，v0.2.5 真机测试）

1. **`android_list_packages` / `android_install_apk` 可能失败**
   - 现象：`android_list_packages` 返回空列表；`android_install_apk` 返回
     `cmd: Failure calling service package: Failed transaction (2147483646)`。
   - 原因：DSH 进程 PATH 使 root shell 命中 Termux 的 `pm` 包装脚本。
   - 临时方案：让 agent 用 `android_shell` 执行 `/system/bin/pm ...` 或 `cmd package ...`。
   - 计划：插件 root 通道统一使用 `/system/bin` PATH 或绝对路径。

2. **Android 14 后台限制下部分工具“假成功/假失败”**
   - `android_camera_photo` 可能返回成功但文件为 0 字节（logcat：Camera disabled by policy）；
   - `android_confirm_dialog` 可能不弹窗并返回 dismissed/failed；
   - `android_clipboard` 可能 set/get 成功但读回空串。
   - 临时方案：先让 `com.termux.api/.activities.TermuxAPILauncherActivity` 到前台再调用这些工具。
   - 计划：工具调用前自动前置 Termux:API 前台页，或检测空结果并返回可操作错误。

3. **`android_mic_record` 提前返回**
   - 现象：录制 2 秒音频时 CLI 约 0.3 秒就退出，录音仍在后台落盘；返回时文件尚未写完。
   - 临时方案：录音后等待 1–3 秒再播放或读取。
   - 计划：工具等待文件大小稳定（或至少等待录制时长）后再返回。

4. **从 v0.2.4 覆盖安装时可能不刷新 Termux 侧 payload**
   - 现象：旧 DSH 仍在运行时，升级 App 后直接进入界面，Termux 侧插件仍是旧版。
   - 临时方案：清空 DSH Phone App 数据后重新走一遍一键部署（Termux 环境与 `~/.dsh-api-key` 保留）。
   - 计划：检测 App 版本变化后强制完整部署，或提供“重新部署”入口。

## 升级

- v0.2.x 用户可直接覆盖安装（数据保留）。
- v0.1.0 用户需先卸载旧版（v0.2.0 起换用新签名）。
- Root 版从 v0.2.4 升级请留意“已知问题 4”；如工具列表没有新增硬件工具，按临时方案重新部署。
