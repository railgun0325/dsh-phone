# DSH Phone v0.2.2

真机复测追加修复（Xiaomi 17 Pro / Android 16 / Shizuku 版）：

1. **会话发送失败 EACCES 修复**：DSH 的会话/附件原子发布用 link()（硬链接），安卓 SELinux 对 App uid 拒绝 link → 发送消息报 permission denied。
   setup 流程新增 patch-dsh-link.mjs：把编译产物里的 link 改 rename（会话创建已实测 HTTP 200 + sessionId 返回）
2. **桥自愈**：打开 DSH Phone App 即拉起本地桥（MIUI 会把后台进程冻结，重开 App 可恢复）
3. **电池白名单提示**：部署完成后弹一次系统「忽略电池优化」请求，减少 MIUI 冻结

## 下载

- dsh-phone-shizuku-v0.2.2.apk — 未 root 手机（真机验证）
- dsh-phone-root-v0.2.2.apk — 已 root 手机（同步以上 setup 补丁；建议在 13 Pro 上复测）

注意：装过旧版的直接覆盖安装即可（签名未变）；若开着死隧道代理（Clash/v2ray fake-ip），先换节点或关代理再部署。

---

**v0.2.2** — fixes the EACCES 'send message' failure (Android SELinux denies link(); DSH session/attachment publish now uses rename() via patch-dsh-link.mjs), adds bridge self-heal on app open and a battery-optimization prompt.
