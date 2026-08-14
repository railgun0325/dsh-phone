# 安装手册（手机 + 电脑，首次安装）

## 0. 准备

- 电脑：下载 [platform-tools](https://dl.google.com/android/repository/platform-tools-latest-windows.zip) 并解压（adb）
- 手机：设置 → 开发者选项 → 开 **USB 调试 / USB 调试（安全设置）/ USB 安装**（小米需要登录小米账号）
- 手机连电脑，`adb devices` 确认出现 `device`，`adb shell su -c id` 确认输出 `uid=0`（root 正常）
- 下载 Termux 全家桶 APK（[termux-app](https://github.com/termux/termux-app/releases)、[termux-api](https://github.com/termux/termux-api/releases)、[termux-boot](https://github.com/termux/termux-boot/releases) 的 universal 版）

## 1. 安装 Termux

```bash
adb uninstall com.termux            # 如果装过 Play 停更版（0.101）必须先卸
adb install -r termux-app.apk
adb install -r termux-api.apk
adb install -r termux-boot.apk
adb shell am start -n com.termux/.app.TermuxActivity   # 首次启动完成 bootstrap
adb shell dumpsys deviceidle whitelist +com.termux     # 防 MIUI 杀后台
```

## 2. 引导 DSH（在 Termux 里）

把本仓库 `scripts/` 全部推到手机上：

```bash
adb push scripts/ /data/local/tmp/scripts
# 以 termux 身份落盘（app 数据目录 root 直写会被 MIUI 拦，用 su <uid> 通道）
adb shell "su -c 'stat -c %u /data/data/com.termux'"    # 记下 uid，下面统一用 <UID> 代替
adb shell "su <UID> -c 'mkdir -p /data/data/com.termux/files/home/dsh-phone && cp /data/local/tmp/scripts/* /data/data/com.termux/files/home/dsh-phone/'"
```

> 注意：Termux 的 `pkg` 拒绝 root 执行，所以所有包管理操作都必须以 **termux 应用 uid** 跑，
> `su <UID> -c ...` 是绕开这一限制的通道（root 通道降身份执行）。
> MIUI 上 chmod/重定向写入 app 数据目录会被拒，脚本里统一用 `install -m` 与 cp 代替。

进入 Termux 跑引导（或通过 adb 的 `su <UID> -c` 执行）：

```bash
cd ~/dsh-phone
bash setup-termux.sh        # pkg 更新、装 Node24/git/curl 等、npm 装 DSH、写 profile 补丁
node patch-dsh.mjs $(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js
bash install-api-key.sh sk-你的key
```

## 3. 挂载 android-control 插件

```bash
adb push plugin/ /data/local/tmp/plugin
# 1) 插件放进 DSH 包内（import 解析用）
adb shell "su <UID> -c 'mkdir -p /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control && install -m 644 /data/local/tmp/plugin/index.js /data/local/tmp/plugin/package.json /data/local/tmp/plugin/cordis.patch.yml /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control/'"
adb shell "su <UID> -c 'mkdir -p /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control/lib && install -m 644 /data/local/tmp/plugin/lib/client.js /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control/lib/'"
# 2) profile 里放符号链接（loader 从 profile 解析插件名）
adb shell "su <UID> -c 'mkdir -p ~/.dsh/profiles/web/node_modules && ln -sfn /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control ~/.dsh/profiles/web/node_modules/dsh-android-control'"
# 3) profile 补丁（禁用安卓不可用的插件 + 插入 bash-local 与 android-control）
adb shell "su <UID> -c 'install -m 644 /data/local/tmp/scripts/cordis.patch.yml ~/.dsh/profiles/web/cordis.patch.yml'"
```

## 4. 授权 Magisk su（免弹窗）

方式 A（简单）：手机上打开任意 Termux 会话执行 `su`，弹窗点「允许」。
方式 B（无头）：Termux 里 `apt install sqlite`，然后：

```bash
su -c "sqlite3 /data/adb/magisk.db \"INSERT OR REPLACE INTO policies (uid,policy,until,logging,notification) VALUES (<UID>,2,0,1,1);\""
# 注意：部分 Kitsune 版本 policies 表无 package_name 列，见报错调整
```

## 5. 启动与使用

```bash
# 手机 Termux 里：
bash ~/dsh-phone/start-dsh.sh        # 起 dsh web（3080 端口）
# 开机自启（可选）：把 boot-dsh.sh 放 ~/.termux/boot/
install -m 755 ~/dsh-phone/boot-dsh.sh ~/.termux/boot/boot-dsh.sh
```

- 手机：打开 DSH Phone APK 或浏览器 `http://127.0.0.1:3080`
- 电脑：`adb forward tcp:3081 tcp:3080` → `http://127.0.0.1:3081`

## 6. APK 构建（可选）

需要 JDK 17 + Android SDK（platforms;android-34 与 build-tools;34.0.0），见 `apk/build-apk.ps1`：

```powershell
# 先装 sdkmanager 组件（接受许可后）
sdkmanager "platforms;android-34" "build-tools;34.0.0"
# 再跑构建（自动 keytool 生成 debug keystore、javac/d8/aapt2/zipalign/apksigner）
powershell -File apk/build-apk.ps1
adb install -r dsh-phone.apk
```

不想构建就用浏览器/PWA 方式（官方 GUI 自带 manifest，Chrome 可“添加到主屏幕”）。

## 7. 网络异常（DNS）自救

如果手机 DNS 解析全挂（有些路由器 DHCP 只发不可用的 IPv6 DNS）：

```bash
# 免 root 最省事：Wi-Fi 设置里改静态 IP，DNS 填 223.5.5.5 / 119.29.29.29
# root 自动方案（开机自启已内置）：
su -c "nohup node ~/dsh-phone/dns-fwd.mjs &"          # DoH 转发器监听 53
su -c "iptables -t nat -A OUTPUT -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53"
su -c "iptables -t nat -A OUTPUT -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53"
# 若路由器把 fe80::5 这种 IPv6 地址当 DNS 发出来（DNS 包走 IPv6）：
su -c "ip -6 route replace local fe80::5/128 dev lo"   # 让本机接管该地址
```

