# 升级到 DSH 0.1.5（13 Pro 实操手册）

0.1.0-rc.6 → 0.1.5-rc.2 在小米 13 Pro（Android 14 / Termux / Magisk）上已验证可以完整跑通：
web 起得来、会话能建、轮次能完成、旧会话能列出并续聊、mnemon 正常注入。

> **2026-09-16 23:50 已在本机正式切换**：线上安装现在是 0.1.5-rc.2（`$PREFIX/lib/node_modules/@deepseek-ai/dsh`
> 是指向 `~/dsh-0.1.5-rc.2/...` 的符号链接），预设已转成 `prefix:`，`dsh-mnemon` 0.5.10，
> 旧安装留在 `dsh.0.1.0-rc.6.bak`，用户数据备份在 `~/backups/upgrade-015-20260916-235010/`。
> 切换后实测：web 8s 起来、用 `anchored-standard` 预设建会话并跑完一轮（`turn/end: completed`）、
> 37 个历史会话带标题列出、`dsh-web.log` 零报错。

- 运行时补丁：`scripts/patch-*.mjs`（7 关，见 `docs/TROUBLESHOOTING.md`）
- 一键迁移：`scripts/upgrade-to-015.sh`（默认只打印计划，`--apply` 才动手，`--rollback` 回滚）

## 一、升级前必须知道的四件事

| 事项 | 0.1.0-rc.6 | 0.1.5 | 处理 |
|---|---|---|---|
| 预设 persona 键 | `text:` | `prefix:`（schema 强制） | `scripts/patch-dsh-presets.mjs` |
| `dsh-mnemon` | ≥0.1.2 | **≥0.5.x** | `pnpm add dsh-mnemon@0.5.10` |
| `.credentials.yaml` | `version: "1"`（字符串） | `version: 1`（数字） | 两边不能共用同一个 home |
| 会话存储 | `session.jsonl.zstd` | `session.v3.jsonl.zstd`（v0 自动迁移，原件保留） | 无需处理 |

不改预设 = 用该预设的会话直接起不来（`$.prefix missing required value`）；
不升 mnemon = 每轮收尾报 `Cannot read properties of undefined (reading 'filter')`（模型其实已经答完）；
共用 home 跑新版 = 旧版再也起不来（`version` 类型不对）。

## 二、升级步骤（脚本做的事）

```bash
# 0. 演练：用克隆 home 先试，绝不拿真实 home 试新版
cp -a ~/.dsh ~/h015-real
DSH_HOME=~/h015-real dsh web --port 3098      # 另开端口，别碰 3080

# 1. 打印计划（不改任何东西）
bash ~/upgrade-to-015.sh

# 2. 执行：备份 → 切换安装 → 转预设 → 升 mnemon → 重启 → 验证
bash ~/upgrade-to-015.sh --apply

# 3. 回滚
bash ~/upgrade-to-015.sh --rollback
```

脚本内部的关键点：

1. **安装用符号链接，不要复制**：把 `$PREFIX/lib/node_modules/@deepseek-ai/dsh` 换成指向
   `~/dsh-0.1.5-rc.2/node_modules/@deepseek-ai/dsh` 的符号链接。包的真实路径落在
   `~/dsh-0.1.5-rc.2/node_modules/` 里，Node 的依赖解析（以及 profile 里已有的
   `profiles/node_modules/@deepseek-ai/*` 链接）才找得到 —— 直接 `cp` 过去会因为找不到依赖而启动失败。
2. 旧的 0.1.0 安装改名为 `dsh.0.1.0-rc.6.bak` 留在原地，回滚就是一次 `mv`。
3. 用户数据整体备份到 `~/backups/upgrade-015-<时间戳>/user-data.tgz`。
4. 验证走**线上 web API**：`node ~/verify-turn.mjs 3080 ~` —— 建一个临时会话、发一句话、
   轮询到该会话 `sessionStats.turns >= 1` 才算过（`tools/phone-probes/verify-turn.mjs`）。
   **别用 `--profile headless` 当验收**：这个 home 的 `cordis.patch.yml` 会把
   `dsh-android-control` 插进**每一个** profile，而该包只装在 web profile 里，
   所以 headless 一定死在 `ERR_MODULE_NOT_FOUND`，和 0.1.5 本身无关。

## 三、升级后的自检

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/     # 期望 200
node ~/verify-turn.mjs 3080 ~                                       # 期望 VERIFY_OK
tail -20 ~/dsh-web.log                                              # 期望无插件报错
ls ~/.dsh/sessions/*/ | grep session.v3                             # 新会话写的是 v3 日志
```

App 侧：解锁手机打开 DSH Phone，确认 UI 正常、随便发一句话能出结果。
（loopback 已放行，`?token=` 门禁对手机本地请求不再是拦路虎。）

## 四、出问题时的定位顺序

1. **先跑最薄的 surface**：`node ~/verify-turn.mjs 3080 ~`（web API 一轮）或
   `dsh --profile headless 'hi'`（注意上面那条 headless 的坑）。
   headless 的好处是它一秒就能暴露 boot/轮次类异常（例如 `dsh: rename is not defined`），
   而 web 模式会把它吞进静默的 promise，看起来像"卡住"。
2. 会话只有 `session.lock`、没有 `session.v3.jsonl.zstd`：轮次没起来，按上一條查参考。
3. 轮次完成但 `turn/end` 是 error：看 `reason.error.message`，多半是插件与新版不兼容
   （mnemon <0.5 就是典型）。
4. 想看某轮到底发生了什么：

   ```bash
   node ~/h015-decode.mjs <session.v3.jsonl.zstd>      # 分帧解压并打印事件
   ```

## 五、这次没走通、但下次可能要面对的

- `dsh-session-format-v0-to-v1` 对**被压缩过**的旧会话可能拒绝迁移
  （`user/message 5 source summary requires notice form`）。这类会话在列表里可能仍显示标题，
  但续聊会失败。已知可用做法是在 0.1.0 里先把该会话续着用，或接受它成为只读历史。
- `flock` 补丁让 Android 上退化为"无竞争锁"：单实例使用没问题，**别在同一 home 上同时起两个 dsh
  写同一会话**。
