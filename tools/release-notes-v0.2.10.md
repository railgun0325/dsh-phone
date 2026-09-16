# v0.2.10 — 图片/附件现在真的能发了（两个独立的坑）

「添加附件」按钮在 v0.2.9 里已经能弹出系统选择器，但选完图片仍然发不出去。这一版修掉背后
两个互不相干的原因，两个都在 13 Pro 上实测通过：**`deepseek-flash` 对着一张红色 PNG 回答了
"Red"**，附件也落到了 `~/.dsh/attachments/v1/objects/…`。

## 坑 1：模型被当成纯文本（`Model "deepseek-flash" does not support image input.`）

`settings.yaml` 里如果写了 `llm-deepseek.models` 列表，它会**整套替换**出厂模型目录；而模型条目的
`inputModalities` 在 schema 里的默认值是 `["text"]`。这台手机的配置里正好只写了
`id/name/contextWindow`，于是 `deepseek-flash` 被登记成纯文本模型，服务端在收到图片时直接拒绝。

实测（直连 api.deepseek.com）：

| 模型 | 图片 |
|---|---|
| `deepseek-flash` | **支持** —— 描述了图片内容 |
| `deepseek-v4-pro` | 不支持 |
| `deepseek-v4-flash-vision-exp` | 支持（上游返回的 model 名就是 `deepseek-flash`） |

修法：在 `~/.dsh/settings.yaml` 对应条目下加一行

```yaml
    - id: deepseek-flash
      name: DeepSeek-Flash
      contextWindow: 1000000
      inputModalities: [text, image]     # ← 这一行
```

部署脚本现在会检查并**明确警告**少了这一行（不代改用户配置）。原配置备份在
`~/backups/settings-before-imagemodalities.yaml`。

## 坑 2：Android 上附件永远存不下去（`EACCES … open '/data/data'` / `EINVAL … fsync`）

`dsh-attachment-local` 为保证崩溃后目录项不丢，会把**从目标目录到文件系统根**的每一级祖先目录
都 `open()` 出来 `fsync()`。在 Android 上这条路必然失败：

- `open('/data/data', O_RDONLY)` → **EACCES**（应用沙箱禁止任何 app uid 打开它，root 除外）；
- `fsync('/')` → **EINVAL**（这台机器的内核/文件系统不接受根目录的目录 fsync）。

任一级失败就整个保存中断，而会话控制器把它报成 `session/agent-busy: prompt rejected`，
理由里完全不提附件——看起来像"发消息失败"，实际是存储层。祖先目录项的 fsync 只是额外的
崩溃持久化保险，跳过平台不支持的那一级不影响写入正确性（目录和文件都在），
所以新增补丁 `patch-dsh-attachment-fsync.mjs` 只对这两类错误放行，
真正重要的**文件本身**的 fsync 保持原样。

## 升级说明

- versionCode 14 / versionName 0.2.10（上一版 13 / 0.2.9）。可覆盖安装。
- payload 新增 `patch-dsh-attachment-fsync.mjs`；`setup-root.sh` / `setup-shizuku.sh` 会应用它，
  并检查 `llm-deepseek.models` 是否声明了 `inputModalities`。
- 已经在跑的机器：装完 App 后重新点一次「一键部署」即可让补丁生效（或直接在本机执行
  `node ~/patch-dsh-attachment-fsync.mjs <dsh>/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js`）。
