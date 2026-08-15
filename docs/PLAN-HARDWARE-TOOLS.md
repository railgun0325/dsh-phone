# 方案 A 实施计划：手机硬件工具集（termux-api 统一通道）

## 一、架构定论（已拍板）
- 两版插件共用一套 termux-api 硬件工具，执行通道完全相同（插件进程=com.termux uid -> termux-* 命令 -> Termux:API 应用）。
- root 的价值只用在三处：1) 部署时 su -c pm grant 静默授权（shizuku 版用 shell 级 pm grant，已查证可行）2) 亮度/音量/状态类 settings 直通 3) Doze 电池豁免。
- Termux 仅作为 DSH/node 运行时，硬件不再另起 App 原生 API 路线。

## 二、工具清单（定稿，全部新增于 plugin/index.js，纯增量）

### P0（11 个，必做）
1. android_status — 电量/充电/温度（termux-battery-status JSON）+ 亮度（settings get）+ 音量（termux-volume 读）+ 屏幕开关锁屏状态（dumpsys power）+ 网络摘要
2. android_sensor_list — termux-sensor -l，返回传感器名/类型清单
3. android_sensor_read — termux-sensor -s NAME 短采样（默认 2s、上限 10s，支持 -n 次数），返回截断 JSON 序列
4. android_camera_photo — termux-camera-photo -c 0 输出到 ~/dsh-shots/photo-时间戳.jpg，返回路径；失败重试一次；描述注明 read_image 需 vision 路由、个别机型 Legacy Camera 低分辨率
5. android_mic_record — termux-microphone-record -f 路径 -l 秒数（默认 5s、上限 60s），返回路径；描述注明：模型听不懂仅存档、锁屏/后台可能静音
6. android_speak — termux-tts-speak 文本（中文用系统 TTS 引擎）
7. android_play_media — termux-media-player play|stop|info 路径
8. android_volume — termux-volume [stream] [level] 读写
9. android_location — termux-location -p gps|network -r once，gps 失败自动 network 回退，返回经纬度/精度，超时 60s
10. android_brightness — 读 settings get system screen_brightness；写 settings put system screen_brightness N 且 screen_brightness_mode 0（root 通道 su 直通；shizuku 通道桥 shell 级，已查证 shell 持 WRITE_SETTINGS）
11. android_wakelock — termux-wake-lock / termux-wake-lock -r（长任务基础件）

### P1（4 个）
12. android_screen_off — input keyevent KEYCODE_POWER（root/桥都支持）
13. android_vibrate — termux-vibrate
14. android_notify — termux-notification（标题/内容；预留动作按钮参数）
15. android_confirm_dialog — termux-dialog confirm（高风险操作人工确认护栏）

实现约定：termux-* 命令走 run(cmd,{root:false})；settings/input 类走默认 root 通道（自动 su->桥回退）。每个工具描述含：所需权限、后台限制、输出文件位置。

## 三、权限与豁免（部署流程改动）

### 3.1 授权清单（对象：com.termux.api）
CAMERA、RECORD_AUDIO、ACCESS_FINE_LOCATION、ACCESS_COARSE_LOCATION、POST_NOTIFICATIONS、WAKE_LOCK、VIBRATE、MODIFY_AUDIO_SETTINGS

### 3.2 两版通道
- root 版：setup-root.sh 末尾新增授权段：su -c pm grant com.termux.api PERM 逐项 + su -c dumpsys deviceidle whitelist +com.termux.api（电池豁免），幂等，输出 granted 明细到日志
- shizuku 版：setup-shizuku.sh 末尾同一清单：pm grant（经 ShizukuExec，adb 级）+ 电池豁免；回退链：pm grant -> cmd appops set -> 仍失败则 App 日志提示用户跳转 Termux:API 详情页手动开（一次终身）

### 3.3 透明化
App 部署日志打印授权结果明细；README/向导加一句：为支持 agent 调用摄像头/麦克风/定位，部署将给 Termux:API 授予对应权限（系统隐私指示灯全程可见）。

## 四、改动文件清单
- plugin/index.js：+15 工具（约 +500 行，纯增量，不改现有 13 工具逻辑）
- plugin/README.md：工具表更新
- scripts/setup-root.sh、scripts/setup-shizuku.sh：授权+豁免段（约 +25 行/个）
- app/root 与 app/shizuku 的 MainActivity.java：部署日志打印授权结果（复用脚本输出，Java 改动最小）
- docs/ARCHITECTURE.md、README.md：硬件工具说明 + 权限透明化 + 视觉可选配置说明
- 两版 build-apk.ps1：版本号升 v0.2.5（code 9），其余不动

## 五、万全准备
1. 基线：记录当前 master commit 作为回滚点；新改动单独 commit，出问题 git revert 即可
2. 构建产物：两版 APK 构建后立即算 SHA256 存档，验证签名与上版本一致（apk/debug.keystore 不变）
3. 热更新冒烟通道（今晚）：插件文件直接 adb 推到两台设备 DSH node_modules + 重启 DSH，无需重装 APK 即可验证工具本身；明天装 APK 只验证部署流程+权限授予新环节
4. 回滚预案：插件工具全为新增，最坏情况删掉新增段重推旧 index.js，DSH 无感回退

## 六、实施顺序（今晚全部完成）
1. 写插件 v2（P0 11 个 + P1 4 个）
2. 写 setup-root.sh / setup-shizuku.sh 授权+豁免段
3. 版本 bump（0.2.5 / code 9）+ 构建两版 APK + SHA256 存档
4. 真机热更新冒烟：推插件到 13 Pro、17 Pro 的 DSH 目录 -> 重启 DSH -> 通过会话让 agent 逐一调用新工具，验证 status/sensor/photo/mic/speak/volume/brightness/location/wakelock/notify（权限暂缺的项先用 adb 手工 pm grant 补齐再验）
5. 修冒烟发现的坑，重推验证
6. commit + push（不发布 release，等明天你验收）

## 七、验收（明天，两设备各一遍）
1. 安装新 APK（覆盖升级）-> 点一键部署 -> 日志出现权限授予明细（root 版 su 直授；shizuku 版 shell 授，若小米限制按提示手动开一次）
2. 打开 DSH -> 发消息让 agent 用 android_status 查状态、用 android_camera_photo 拍张照给你看
3. 抽查 sensor_read / speak / volume / brightness / location 各一条
4. 确认现有发消息、桥、插件加载无回归

## 八、风险与兜底
- 锁屏/后台录音可能静音、Legacy Camera 机型差异：工具描述已注明，实测记录到文档
- MIUI 冻结 Termux:API：部署已加电池豁免；工具前置 wakelock
- 用户手动关系统相机/麦克风开关 -> 工具返回清晰错误提示
- DeepSeek 无视觉：截图/拍照给用户看不受影响；agent 视觉闭环留待可选配置 vision 模型（本次不实现，文档说明）

## 九、明确不做（本次）
视频流、通话/短信、指纹/NFC/红外、whisper 转写、传感器连续长监听、vision 模型集成。

## 十、假设
- termux-api 0.53（内置）与 0.59（apt 最新）行为兼容
- 用户接受部署时静默授予清单内权限（向导明示）
- 主模型 DeepSeek 文本

## 十一、实施修正（2026-08-15，按内置包实际源码核实）

对第 2/3 节做以下修正（均以 termux-api-package v0.59.1 脚本与 Termux:API v0.53 源码为准，v0.59.1 与 master 脚本逐字节一致）：

1. **无 termux-wake-lock 命令**：当前 Termux 仓库与 Termux:API 0.53 都不再提供该脚本。
   android_wakelock 改为 `am startservice --user 0 -a com.termux.service_wake_lock|_unlock com.termux/com.termux.app.TermuxService`，
   由 Termux 应用（0.118.3，声明 WAKE_LOCK）自身的 TermuxService 持有 PARTIAL_WAKE_LOCK。
2. **termux-location 无 `-u` 参数**：传 `-u` 会直接报 illegal option。android_location 改为先读
   `-r last` 缓存，再 `-p <provider> -r once` 单次（GPS 45s，network 回退 20s），失败返回诊断。
3. **termux-volume 不支持单流读取**：只传 stream 会报 Invalid argument count。android_volume 改为
   无参读取全部流后在插件内过滤；写入仍为 `termux-volume <stream> <level>`。
4. **授权清单收敛**：Termux:API 0.53 targetSdk=28，manifest 未声明 POST_NOTIFICATIONS / WAKE_LOCK /
   MODIFY_AUDIO_SETTINGS，逐项 pm grant 必失败。部署只授 CAMERA、RECORD_AUDIO、
   ACCESS_FINE_LOCATION、ACCESS_COARSE_LOCATION；通知默认放行、震动安装期授予、wakelock 归 Termux 应用。
5. **sensor list 返回 JSON**：`termux-sensor -l` 输出 `{"sensors":["..."]}`，插件按 JSON 解析并保留文本回退。
6. **settings 必须绝对路径**（13 Pro 实测）：PATH 首项会命中 Termux 的 `$PREFIX/bin/settings` 包装脚本，
   su 通道下报 `cmd: Failure calling service settings: Failed transaction`；统一改用 `/system/bin/settings`。
7. **工具返回值必须 lossless JSON**（DSH 0.1.0-rc.6 实测）：返回值里出现 `undefined` 属性会报
   `value is not lossless JSON`；插件在注册时统一包装 execute，递归剥掉 undefined 再返回。
8. **termux-location 冷定位受限**（Android 14 实测）：Termux:API 广播接收器约 10s 被系统回收，
   无缓存定位时 `-r once` 拿不到冷启动 fix（termux-api issue #776）。工具改为先试 `-r last` 缓存，
   再试 gps/network 单次，失败时返回 location_mode 与可操作提示。
9. **亮度写增加 termux-brightness 回退**（17 Pro 实测）：桥 token 未对齐时 settings 通道不可用；
   部署时给 com.termux.api 授 `WRITE_SETTINGS` appop，android_brightness 写失败后自动走
   `termux-brightness`（Termux:API 通道），17 Pro 实测 120 设置成功并恢复。
10. **17 Pro 桥 token 历史错配**：Termux 侧 `~/.dsh-bridge-token` 为手写占位串、App 侧为随机 token，
   导致桥依赖工具（亮度读/屏幕态/wake_unlock）返回 unauthorized；装 v0.2.5 APK 重跑部署即可对齐，
   不属于插件代码问题。