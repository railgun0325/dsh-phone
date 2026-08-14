# dsh-android-control

DSH 插件：给 agent 一双操作安卓的“手”，外加手机竖屏布局适配。

## 工具（host 半）

| 工具 | 说明 |
|---|---|
| `android_shell` | root 执行任意 shell 命令（root=false 走 Termux shell） |
| `android_screenshot` | 截图到 /data/local/tmp/dsh-shots（MIUI 链接错误自动 LD_PRELOAD 回退） |
| `android_tap` / `android_swipe` | 按坐标点击 / 滑动 |
| `android_text` / `android_keyevent` | 输入文本 / 按键事件（home/back/音量…） |
| `android_open_app` / `android_current_app` | 按包名启动应用 / 查前台应用 |
| `android_ui_dump` | uiautomator 界面层级 XML（找元素坐标） |
| `android_install_apk` / `android_list_packages` | 装 APK / 列包名 |
| `android_wake_unlock` | 点亮并上滑解锁 |
| `android_clipboard` | 系统剪贴板读写（termux-api） |

## 移动端布局（client 半）

`lib/client.js` 是手写的 factory-form 客户端 bundle（无需构建），注入 ≤768px 的响应式 CSS：
侧边栏收起保留 56px 轨道条、展开变抽屉；详情列右侧抽屉；设置面板顶部横向导航 + 内容全宽。

## 挂载方式

见仓库根 [docs/INSTALL.md](../docs/INSTALL.md) 第 3 节：放进 DSH 包 node_modules + profile 符号链接 +
`cordis.patch.yml` insert。package.json 的 exports 必须保留 `./package.json` 条目（loader 依赖）。

## 安全

全部 root 命令经 Magisk su：**agent 在 root 手机上等于 root 权限**，只建议跑在备用机上。

