# v0.2.9 — 修好「添加附件」按钮 + 部署细节

## 修了什么

1. **「添加附件」按钮点下去没反应（本次的主修）**
   DSH 的输入栏那个回形针按钮，实现是 `fileInputRef.current?.click()` —— 点它等于点一个隐藏的
   `<input type="file">`。**Android WebView 对文件输入框只在一个条件下才会弹出选择器：宿主 App 实现
   `WebChromeClient.onShowFileChooser`。** 本 App 之前只 `new WebChromeClient()`，没实现它，所以
   点击被 WebView 静默吞掉 —— 表现就是"按了没用、连不上手机本地文件系统"。
   现在 `WebActivity` 会：
   - `onShowFileChooser` → `FileChooserParams.createIntent()`（自动带上 accept 类型与多选）；
     拿不到就退化成 `ACTION_GET_CONTENT` + `*/*`；
   - 带 `FLAG_GRANT_READ_URI_PERMISSION`，文件以 `content://` 交给页面，**不需要任何存储权限**；
   - `onActivityResult` 用 `FileChooserParams.parseResult()` 回填；取消选择也回填 `null`
     （不然页面那个 input 会一直处于"已武装"状态，之后每次点击都被吞）；
   - `onDestroy` 兜底释放回调。
   root 版和 Shizuku 版共用这个 `WebActivity`，两边一起修好。

2. **root 被拒时说人话**
   之前 Magisk 拒绝授权时，App 只会报「未检测到 root。本 APK 是 Root 版…」，把人往"没 root"上引。
   现在 `ShRoot.denied()` 区分「被超级用户管理器拒绝」和「真的没有 root」，并直接给出操作路径：
   打开 Magisk → 底栏「超级用户」→ DSH Phone → 打开开关（允许）。一键部署失败时同样提示。

3. **部署不再重复起看门狗**
   `setup-root.sh` 装 watchdog 时无条件 `setsid` 拉起一个新循环；脚本自带的 pidfile 守卫在 pidfile
   过期时会放行，于是可能出现两个 watchdog 同时探测/抢救。现在先 `pgrep` 判断，已在运行就不重复启动。

## 升级说明

- versionCode 13 / versionName 0.2.9（上一版 12 / 0.2.8）。可覆盖安装。
- 只影响 App 与部署脚本；已在运行的 DSH 运行时不受影响。
- 附件上传走 `content://`，不需要授予存储权限；如果系统选择器被 MIUI 限制，会回落到
  `ACTION_GET_CONTENT`。
