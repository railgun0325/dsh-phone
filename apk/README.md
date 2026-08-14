# DSH Phone APK

最简 WebView 套壳：全屏加载 `http://127.0.0.1:3080`（手机本机 DSH web），
开启 JS/DOM 存储/本地明文流量，返回键支持网页回退。无第三方依赖、无图标资源。

## 构建

依赖：JDK 17 + Android SDK（cmdline-tools，装 `platforms;android-34` 与 `build-tools;34.0.0`）。

```powershell
# 本脚本从仓库根目录运行（路径基于 $PSScriptRoot 自动解析）
powershell -File apk/build-apk.ps1
adb install -r dsh-phone.apk
```

构建链：javac → d8 → aapt2 link → zip 加 classes.dex → zipalign → apksigner（自动生成 debug.keystore，密码 dshphone）。

> 想上应用商店分发需要换 TWA（Trusted Web Activity）+ HTTPS 域名；本壳仅供个人侧载。

