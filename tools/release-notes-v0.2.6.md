# v0.2.6 — 白屏自愈 + DNS/服务看门狗

## 修了什么

- **白屏根治（APK 侧）**：`WebActivity` 以前只加载一次 `http://127.0.0.1:3080/`，主框架失败就把页面
  换成静态兜底页「DSH 还没起来」—— 不重试、没有重试按钮。触发条件其实很常见：App 的启动路径
  （`resumeDsh()` → `start-dsh.sh`）会重启 dsh web，而 node 要 20–30 秒才开始监听，这一次加载正好
  落在空窗里就是**永久白屏**（2026-09-14 13 Pro 实测复现）。
  现在：主框架失败先退避重试 4 次，然后显示等待页，并由 Java 侧每 2 秒探测 3080，端口一活立刻加载
  真界面；再次进入 App（launcher → MainActivity → openShell）也会强制重载，不再停在旧页面上。
- **DNS 看门狗（`dsh-watchdog.sh` → `/data/adb/service.d/`）**：手机把所有 `:53` 重定向到
  `127.0.0.1:53` 的 dns-fwd。它一死，全机 DNS 就指向一个没人监听的端口：DSH 每次发消息都
  `llm/retry` → `{"code":"TRANSPORT"}`，浏览器也解析不了域名。看门狗 ≤30 秒把它拉起来，每 5 分钟
  做一次真实解析探测（抓「端口还在、DoH 已挂」的僵死态），连续救不回来时摘掉重定向（fail open）。
- **dsh web 看门狗**：3080 不响应时自动以 Termux 身份重新拉起（MIUI 会冻结/回收后台进程，
  以前只能靠手动打开 App 自愈）。
- **`start-dsh.sh` 不再无脑重启**：3080 已健康就直接退出 —— 这正是白屏的触发窗口。
- **`boot-dsh.sh` 只在转发器真的在监听时**才安装 `:53` 重定向，不再给手机埋「零 DNS」陷阱。
- **`setup-root.sh`** 部署时自动安装并启动看门狗（root 版）。

## 升级说明

- versionCode 10 / versionName 0.2.6（上一版 9 / 0.2.5）。
- **签名变更**：本版由 CI 生成新密钥（原 keystore 未随仓库分发），因此**无法覆盖安装**：需要先卸载
  旧版再装。Termux/DSH 环境与 `~/.dsh-api-key` 不受影响；App 内保存的 API Key 需要重填一次
  （或还原 `dsh_phone.xml`）。
- 从下一版起：把本次构建产物中的 keystore 存为仓库 secret `ANDROID_KEYSTORE_BASE64`，签名即可保持
  稳定，后续版本恢复「覆盖安装」。
- 构建：GitHub Actions `.github/workflows/android.yml`（JDK 17 + Android SDK build-tools 34.0.0，
  等价于 `app/*/build-apk.ps1` 的流水线；`tools/build-apk.sh`、`tools/fetch-assets.sh` 是 Linux 版）。
