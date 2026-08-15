# dsh-android-control

DSH 插件：给 agent 一双操作安卓的「手」，外加手机竖屏布局适配。

## 工具（host 半）

### 屏幕与 UI（13 个，v0.1/v0.2）

| 工具 | 说明 |
|---|---|
| android_shell | 执行任意 shell 命令：root 手机走 Magisk su；未 root 走 Shizuku 桥（adb shell 级） |
| android_screenshot | 截图到 /data/local/tmp/dsh-shots（MIUI 链接错误自动 LD_PRELOAD 回退） |
| android_tap / android_swipe | 按坐标点击 / 滑动 |
| android_text / android_keyevent | 输入文本 / 按键事件（home/back/音量…） |
| android_open_app / android_current_app | 按包名启动应用 / 查前台应用 |
| android_ui_dump | uiautomator 界面层级 XML（找元素坐标） |
| android_install_apk / android_list_packages | 装 APK / 列包名 |
| android_wake_unlock | 点亮并上滑解锁 |
| android_clipboard | 系统剪贴板读写（termux-api） |

### 硬件工具（15 个，v0.2.5，统一走 termux-api 通道）

| 工具 | 说明 | 输出位置 |
|---|---|---|
| android_status | 电量/充电/温度 + 亮度 + 音量 + 亮灭屏/锁屏 + 网络摘要 | - |
| android_sensor_list | 传感器名/类型清单（termux-sensor -l） | - |
| android_sensor_read | 单传感器短采样（默认 2s、上限 10s、-n 次数，JSON 截断） | - |
| android_camera_photo | 后摄拍照（失败重试一次；Legacy Camera 机型可能低分辨率） | ~/dsh-shots/photo-*.jpg |
| android_mic_record | 麦克风录音（默认 5s、上限 60s；锁屏/后台可能静音） | ~/dsh-shots/rec-*.m4a |
| android_speak | 系统 TTS 朗读（中文用系统 TTS 引擎） | - |
| android_play_media | media player play / stop / info | - |
| android_volume | 音量读写（读全流；单流读取由插件过滤，写入走 termux-volume） | - |
| android_location | 一次定位（先读缓存 last-known，再 gps→network 单次；Android 14+ 冷定位受 Termux:API 限制，失败返回开关诊断） | - |
| android_brightness | 亮度读写（写时强制手动亮度模式；root=su / Shizuku=shell 桥） | - |
| android_wakelock | Termux 应用 TermuxService wakelock 获取 / 释放（长任务基础件） | - |
| android_screen_off | 按电源键灭屏（仅屏幕亮着时按下，不会误唤醒） | - |
| android_vibrate | 震动（默认 1s、上限 5s） | - |
| android_notify | 通知（标题/内容，预留按钮动作——按钮动作是 Termux 内 shell，务必简单安全） | - |
| android_confirm_dialog | 手机端 confirm 弹窗（高风险操作人工确认护栏） | - |

约定：termux-* 一律 `run(cmd, { root: false })`（Termux uid 直达 Termux:API）；settings/input 类走默认 root 通道（su → Shizuku 桥自动回退）。
模型能力注意：DeepSeek 文本模型听不懂录音、看不见照片，录音/照片是给用户播放或留给视觉模型读的。

## 执行通道（双执行器）

所有 root=true 的命令先探测 su（/system/bin/su 等候选，跑 id 验证 uid=0）；
没有 su 时自动切到 Shizuku 桥：HTTP POST 127.0.0.1:36527/exec（headers X-DSH-Token /
X-DSH-Cmd / X-DSH-Timeout，body 为 stdin，响应 JSON {ok,exitCode,stdout,stderr}）。
桥由 DSH Phone App（Shizuku 版）的前台服务提供；token 部署时写入 ~/.dsh-bridge-token。

## 硬件工具所需权限

部署脚本会给 **com.termux.api** 授予其声明的 4 个运行时危险权限，并做 Doze 电池豁免；App 部署日志打印逐项结果：

- CAMERA（拍照）
- RECORD_AUDIO（录音）
- ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION（定位）

其它权限的实际情况（已按内置 Termux:API 0.53 的 manifest 核实）：

- 通知：Termux:API targetSdk=28，无需 POST_NOTIFICATIONS（系统默认放行）
- wakelock：走 **com.termux 应用自身的 TermuxService**（`com.termux.service_wake_lock/_unlock`），WAKE_LOCK 随 Termux APK 安装授予；当前 Termux 已不带旧的 termux-wake-lock 脚本
- 震动：VIBRATE 是 Termux:API 的普通权限，安装时自动授予
- 音量：termux-volume 实测无需额外授权（Termux:API 0.53 未声明 MODIFY_AUDIO_SETTINGS）
- 亮度：读走 shell 级 WRITE_SETTINGS（Shizuku 版已查证 shell 持有；Root 版走 su）；写失败自动回退 `termux-brightness`（部署时给 com.termux.api 授 WRITE_SETTINGS appop）

Shizuku 版授权回退链：pm grant → cmd appops set → 仍失败则部署日志提示用户到 Termux:API 应用详情页手动开（一次终身）。

## 移动端布局（client 半）

lib/client.js 是手写的 factory-form 客户端 bundle（无需构建），注入 ≤768px 的响应式 CSS：
侧边栏收起保留 56px 轨道条、展开变抽屉；详情列右侧抽屉；设置面板顶部横向导航 + 内容全宽。

## 挂载方式

见仓库根 docs/INSTALL.md：放进 DSH 包 node_modules + profile 符号链接 + cordis.patch.yml insert。
package.json 的 exports 必须保留 ./package.json 条目（loader 依赖）。

## 安全

Root 版全部命令经 Magisk su（agent 在 root 手机上等于 root 权限）；Shizuku 版为 adb shell 级。
两种都建议只跑在备用机上。
