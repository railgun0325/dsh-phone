# DSH Phone 项目总结（截至 2026-08-15）

## 一、项目是什么
把 AI agent（DSH = DeepSeek Harness）装进 Android 手机并让它操作手机：一键安装 APK -> 粘贴 DeepSeek API key -> 点部署 -> 手机内跑 DSH web + 安卓控制插件（截图/点击/输入/shell 等 13 个工具）。双版本：Root 版（Magisk）与 Shizuku 版（免 root，adb 级桥）。开源仓库：github.com/railgun0325/dsh-phone，已发布到 v0.2.4。

## 二、已完成
1. 双版本一键部署 APK 全链路跑通：13 Pro（root）与 17 Pro（Shizuku）两台真机都能部署、发消息（17 Pro 实测模型回复 OK）。
2. 修复的关键缺陷：HyperOS 私有挂载命名空间（部署必挂的真根因）、API key 污染（日志被当 key 写入）、pm list 子串误判、bash 路径、部署失败后伪装已部署等。
3. UX 打磨：部署后打开即用（DSH 被杀自动拉起不重装）、右划回桌面、setup 快速路径（跳过重复下载）、key 格式双重校验。
4. 发布与安全：v0.2.4 发布前做了独立 agent 安全审查 + 全历史/APK 逐字节扫描，确认无 API key 泄露；签名密钥备份。
5. 硬件工具可行性研究完成：termux-api 能力矩阵（root/Shizuku 分版）+ DSH 图片/音频集成机制，方案 A 已批准（见 PLAN-HARDWARE-TOOLS.md）。

## 三、踩过的坑与避免方法（按重要性排序）

### 坑 1：HyperOS 把每个 App 关进私有挂载命名空间（最隐蔽）
- 现象：App 内 su 执行 stat /data/data/com.termux 报 No such file，但 adb 下正常。
- 原理：MIUI/HyperOS 给 App 一个 tmpfs 的 /data/data 视图（只有自己和 GMS），Magisk su 默认继承调用者命名空间。
- 避免：su 调用一律加 --mount-master 跳回全局命名空间，并做运行时探测（ls -1 /data/data | wc -l > 5）失败自动回退。

### 坑 2：API key 被部署日志污染
- 现象：发消息报 the API key resolved from DEEPSEEK_API_KEY contains characters no HTTP header can carry。
- 原理：key 输入框曾把失败日志当 key 存进 SharedPreferences，部署时整段日志写进 ~/.dsh-api-key。
- 避免：UI 与 setup 脚本双重硬校验 ^sk-[A-Za-z0-9_-]+$，不合法直接拒绝；预填时清理脏值。

### 坑 3：VPN（Clash fake-ip）是部署杀手
- 现象：npm 下载卡死（第九步）、curl api.deepseek.com 返回 000、无线调试显示假 IP（172.19.0.1）。
- 原理：fake-ip 劫持 DNS、死隧道黑洞 TCP；Clash 关掉后 iptables/TUN 残留还会继续坑（重启才清）。
- 避免：部署/下载全程关 VPN；遇到"网络死但其他应用正常"先查路由表残留和 iptables；无线调试用 mDNS 发现真实端口而不是信屏幕显示的 IP。

### 坑 4：run-as 的 PATH 里有残缺 curl，误诊"Termux 没网"
- 现象：run-as 里 curl 全 000，但 Termux App 会话里 curl 200。
- 原理：run-as 继承 adb shell 的 PATH，/system/bin 的 curl 残缺；termux 自带的 curl 用绝对路径完全正常。
- 避免：设备端验证一律用绝对路径 /data/data/com.termux/files/usr/bin/curl；判定"没网"前先在 Termux App 会话里跑一次。

### 坑 5：PowerShell 引号与变量展开（效率杀手）
- 现象：设备端命令被 PS 拆碎；$(...) 被 PS 本地展开导致传给设备的 key 是空的（误判 401）；${#K} 在 TS 模板字符串里是语法错误。
- 避免：多命令诊断写成脚本文件 -> base64 -> 设备端解码执行；引号嵌套用 PS 单引号字符串（内层单引号双写）；key 不进命令行（文件传输）；命令执行后立即单独验证输出。

### 坑 6：MIUI 冻结后台进程
- 现象：桥/DSH/App 后台被杀，下次打开全挂；NotificationShade 反复挡住 UI 自动化。
- 避免：部署时 dumpsys deviceidle whitelist 电池豁免；App 冷启动检测 DSH 没跑就自动轻量拉起（绝不重装）；桥随 App onCreate 自启。

### 坑 7：部署半途而废被伪装成"已部署"
- 现象：卡在第九步退出，再进 App 直接进界面（旧 DSH 进程还在），发消息全挂。
- 避免：部署/恢复失败时 killStaleDsh 杀旧进程，下次打开回到向导而非假成功界面；setup 加快速路径（marker）避免重复下载。

### 坑 8：构建与发布工程细节
- PowerShell 5.1 读 BOM-less UTF-8 当 ANSI -> 脚本全 ASCII；gh 的 stderr 会触发 NativeCommandError 终止脚本 -> 用 cmd /c 包装；out-release 目录里的 APK 差点进 git -> gitignore *.apk + out-release/；APK 每版算 SHA256 存档。

### 坑 9：adb 无线调试的日常摩擦
- 端口每次开关都变；配对码几分钟过期；Clash 显示假 IP。
- 避免：adb mdns services 找真实连接端口直接 connect（配对凭据长期有效，不用反复配对）；PC 与手机必须同网段。

### 坑 10：设备端文件归属问题
- shell 写的文件（如 /data/local/tmp 的 keyfile）termux 覆盖不了（owner 不同）-> 先 rm 再写；termux uid 读 /data/local/tmp 需要文件 chmod 666/644；run-as 读不了 /sdcard（无存储权限）。

## 四、当前进度
- 两设备在线且正常：13 Pro 与 17 Pro 均可收发消息；17 Pro 用有效 key 全链路验证过。
- v0.2.4 已发布（含独立安全审查），代码全部推送。
- 硬件工具计划（方案 A：两版共用 termux-api，root 只管静默授权）已批准，文档：docs/PLAN-HARDWARE-TOOLS.md。
- 今晚待办：插件 v2（15 个新工具）-> 部署脚本授权段 -> 构建 v0.2.5 -> 真机热更新冒烟 -> 修坑。
- 明天待办：用户装机验收（部署流程 + 权限授予 + 工具抽查）。

## 五、重要资产与约定
- 签名密钥：D:\AI\DSH\android-deploy\dsh-phone-signing.keystore + repo 内 apk/debug.keystore（丢失过 v0.1.0 的，务必双备份）。
- 有效 DeepSeek key 只存在：PC 的 D:\AI\DSH\android-deploy\start-dsh.sh（本地）与两台手机的 ~/.dsh-api-key（600），绝不进仓库/APK/命令行。
- 设备：13 Pro = root（nuwa，Magisk Kitsune，uid 10598）；17 Pro = Shizuku（25098PN5AC，Android 16，Termux uid 10691）。同一时刻只连一台调试时注意 -s 指定。
- 常用通道：root 版 su；shizuku 版 桥 36527（App 内 ServerSocket + Shizuku binder）。