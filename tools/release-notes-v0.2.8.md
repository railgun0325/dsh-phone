# v0.2.8 — 修掉 v0.2.7 一键部署里的两个真 bug

v0.2.7 的方向对了（payload 补齐 7 关补丁 + 0.1.5 前置条件），但在真机上跑一遍发现两个问题，
本版修掉。**已经装过 v0.2.7 的机器请直接升到 v0.2.8。**

## 修了什么

1. **部署脚本写死了依赖路径，在"符号链接安装"上直接崩**
   `setup-root.sh` / `setup-shizuku.sh` 一直用 `$DSH_DIR/node_modules/@deepseek-ai/<pkg>` 定位补丁目标。
   这对普通 `npm install -g` 是对的，但 `scripts/upgrade-to-015.sh` 产出的安装是**指向手工树的符号链接**，
   依赖副本是启动器的**兄弟目录**。结果是部署在第 3 步（node-pty 补丁）就以
   `ENOENT ... dsh-subprocess-local/lib/index.js` 中止，后面的补丁、看门狗、自检全都没跑。
   现在两个脚本都先 `readlink -f` 再判断两种布局（`SCOPE_DIR` / `MODROOT`），并在目标缺失时**降级为警告**
   而不是 `set -e` 直接掐死整个部署。

2. **`patch-dsh-client-modules.mjs` 自己就是坏的**
   第 65 行注释和 `const flushAnchor = [` 被挤在同一行，注释把声明吞了 → 脚本一执行就
   `SyntaxError: Unexpected token ']'`，composer 补丁从来没在部署流程里生效过
   （日志里还会误报成 "client-modules not present (pre-0.1.5 build?)"）。已修好，并顺手把那句
   误导性警告改成"补丁未生效（目标缺失，或该版本锚点已变）"。

## 实测（小米 13 Pro，线上 0.1.5-rc.2 + 符号链接安装）

```
[step] patch node-pty lazy load            already patched — nothing to do
[step] patch session/attachment publish    already patched: .../dsh-session-persistence-jsonl/lib/index.js
[step] patch client-modules composer       already patched — nothing to do
[step] patch web auth                      already patched — nothing to do
[step] patch flock native module           already patched — nothing to do
[step] convert user Agent presets          presets scanned: 2, patched: 0
[step] dsh-mnemon version floor            [skip] dsh-mnemon 0.5.10 已满足
[step] install dsh-watchdog                [ok] 已安装并在运行
[step] verify one real turn over the web API
                                           VERIFY_OK turns=1 steps=1 ttft=1646ms
SETUP OK
```

## 升级说明

- versionCode 12 / versionName 0.2.8（v0.2.7 是 11 / 0.2.7）。
- 可覆盖安装（签名自 v0.2.6 起固定）。
- 本版只动"部署"这条路：已经在跑的 DSH 不受影响（`~/.dsh-setup-ok` 快路径让重新部署只重打补丁）。
- 自检命令：`node ~/verify-turn.mjs 3080 ~` → 期望 `VERIFY_OK turns=1 ...`。
