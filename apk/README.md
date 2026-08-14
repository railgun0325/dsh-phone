# DSH Phone APK（历史工程，v0.1.0）

> 已被 app/ 取代：v0.2.0 起为双版本一键部署应用（app/root = Root 版、app/shizuku = Shizuku 版），
> 本目录仅保留 v0.1.0 的纯 WebView 套壳源码与构建脚本作历史参考。

最简 WebView 套壳：全屏加载 http://127.0.0.1:3080（手机本机 DSH web），
开启 JS/DOM 存储/本地明文流量，返回键支持网页回退。无第三方依赖、无图标资源。

## 构建

依赖：JDK 17 + Android SDK（cmdline-tools，装 platforms;android-34 与 build-tools;34.0.0）。

```powershell
powershell -File apk/build-apk.ps1
adb install -r dsh-phone.apk
```

构建链：javac → d8 → aapt2 link → zip 加 classes.dex → zipalign → apksigner（debug.keystore，密码 dshphone）。

> 想上应用商店分发需要换 TWA（Trusted Web Activity）+ HTTPS 域名；本壳仅供个人侧载。
