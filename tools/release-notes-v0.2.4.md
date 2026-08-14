# v0.2.4 — Root 版核心修复 + 打开即用体验

## 修复（Root 版）

- **修复 HyperOS/MIUI 上一键部署必失败的真根因**：系统把每个 App 关进私有挂载命名空间，App 视角的 `/data/data` 是假的空目录，`su -c` 继承该命名空间后看不到 Termux → `stat /data/data/com.termux` 报 ENOENT。现在 su 调用自动探测并使用 `--mount-master`（全局命名空间），失败自动回退。
- 修复 `pm list packages` 子串误判（`com.termux.boot` 会被误认为 Termux 本体已装）。
- 修复切到 Termux uid 后 PATH 丢失导致 `bash` 找不到（exit 127），改用绝对路径。
- 修复 API Key 被污染问题：格式非法的 key（如误粘贴的日志文本）在 App 界面与安装脚本双重拦截，不再写入环境导致“HTTP header 非法字符”报错。

## 体验（两版通用）

- **部署后打开即用**：DSH 在跑 → 直接进界面；DSH 被系统杀掉 → 自动秒级拉起，绝不重装。
- **重复部署走快速路径**：环境完好时跳过 apt/npm 下载，几秒完成（强制重装删除 `~/.dsh-setup-ok`）。
- **右划/返回键回桌面**，不再退回部署向导页。
- Key 只在格式正确（`sk-` 开头纯文本）时才会保存与预填。

## 校验

见附件 SHA256SUMS-v0.2.4.txt。

## 升级

v0.2.x 用户直接覆盖安装即可（数据保留）。v0.1.0 老用户需先卸载旧版。