# DSH Phone v0.2.3

交互简化 + 13 Pro（root 版）真机升级验证：

1. 去掉顶部黑条标题（NoActionBar）
2. API Key 只填一次：首次部署成功后保存在本机 App 内，之后自动预填
3. 去掉「打开 DSH 界面」按钮：部署完成自动进入界面；打开 App 时若 DSH 已在运行直接进入
4. 13 Pro 实测：新版 DSH + link 改 rename 补丁 + 插件 bundle 全通过（会话创建 200、插件 bundle 200）

## 下载

- dsh-phone-root-v0.2.3.apk — 已 root 手机（13 Pro 真机验证）
- dsh-phone-shizuku-v0.2.3.apk — 未 root 手机（17 Pro 复测待进行）

已知环境问题（非 App 问题）：手机开着的代理 App（v2rayNG/Clash/Surfboard）fake-ip 会劫持 DNS、死隧道会吞掉流量，部署前请先关掉或换节点。

---

v0.2.3 — removes the title bar and the manual open button, persists the API key after first deploy, auto-opens the shell when DSH is reachable. Root edition verified on-device (Xiaomi 13 Pro).
