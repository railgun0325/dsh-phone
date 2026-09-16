# v0.2.7 — 一键部署现在真的能装出可用的 0.1.5

## 修了什么

- **payload 补齐（这是本版的重点）**：v0.2.6 的 payload 只有 4 个补丁脚本，而且是
  `patch-dsh-link.mjs` 的**旧版**——那一版把 `await link(tmp, finalPath)` 改成 `rename()`
  却没把 `rename` 写进 `node:fs/promises` 的 import。而 `setup-termux.sh` 装的是
  `@deepseek-ai/dsh@latest`，所以**新手机上一键部署必然装出一个"发不出消息"的 DSH**：
  `session/prompt` 返回 `accepted:true`、会话目录只生成 `session.lock`、没有
  `session.v3.jsonl.zstd`、进程空闲在 `processTimers`、一个模型连接都不发——异常抛在没人
  await 的 promise 里，所以看起来不是报错而是"卡死"。
  现在 payload 带齐 7 关的全部补丁 + 部署后自检：

  | 文件 | 作用 |
  |---|---|
  | `patch-dsh.mjs` | node-pty 惰性加载（新锚点） |
  | `patch-dsh-link.mjs` | `link→rename/alias`（含本次的 `rename` import 修复） |
  | `patch-dsh-client-modules.mjs` | composer 身份 sourcemap → 空 map + flush 去抖（否则手机 CPU 225 秒不收敛） |
  | `patch-dsh-web-auth.mjs` | web token 门禁对 loopback 放行（否则 WebView 永远 401） |
  | `patch-dsh-flock-android.mjs` | `flock` 原生模块在 Android 上退化为无竞争锁 |
  | `patch-dsh-presets.mjs` | 用户预设 persona 键 `text:` → `prefix:`（0.1.5 必填，不改则用该预设的会话起不来） |
  | `verify-turn.mjs` | 走 web API 的端到端自检：建会话 + 发一句话 + 等 `sessionStats.turns >= 1` |
  | `upgrade-to-015.sh` | 已有 0.1.0 安装的机器上做原地迁移（备份/切换/回滚） |

- **部署流程补齐 0.1.5 前置条件**（`setup-root.sh` / `setup-shizuku.sh`）：
  - 新增 `flock` 补丁步骤（旧 payload 缺这一步，0.1.5 的持久化会话日志永远写不出来）。
  - 部署时自动转换用户预设的 persona 键。
  - **`dsh-mnemon` 版本下限**：检测到 `< 0.5` 就 `pnpm add dsh-mnemon@0.5.10`。0.1.5 配 mnemon 0.1.2
    会在轮次收尾抛 `Cannot read properties of undefined (reading 'filter')`——模型其实已经答完，
    错误却挂在 `turn/end` 上。
  - 部署末尾跑一次 `verify-turn.mjs`（3080 已在监听时），绿了才算装好。

## 升级说明

- versionCode 11 / versionName 0.2.7（上一版 10 / 0.2.6）。
- **可以覆盖安装**：从 v0.2.6 起签名由 CI 的 `ANDROID_KEYSTORE_BASE64` 固定，同一把密钥。
- 本版**不会**动你已经在跑的 DSH：`setup-root.sh` 的快路径（`~/.dsh-setup-ok` 存在时跳过
  apt/npm）保证"重新部署"只是重打补丁，不会重装或降级运行时。只有删除 `~/.dsh-setup-ok`
  才会走完整安装。
- 想立刻验证手上的机器：`node ~/verify-turn.mjs 3080 ~`（期望 `VERIFY_OK turns=1 ...`）。
- 已在小米 13 Pro（Android 14 / Termux / Magisk）上实测：0.1.5-rc.2 + mnemon 0.5.10 +
  用户预设 `anchored-standard`，`turn/end: completed`，37 个历史会话可列出、旧 v0 会话可续聊。
