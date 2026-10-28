# Android 关卡清单与防复发协议

这份文档是为了终止一类循环：**同一个坑踩第二次**。它记录 13 Pro 上 DSH 移植过程中每一个
"Android 平台不给你这条普通桌面语义"的关卡，以及让它们不再复发的机器检查。

## 一、为什么会反复踩同类坑（先看这段）

1. **三个入口，一个真相**。补丁可以经 App 一键部署（`setup-root.sh`）、`upgrade-to-015.sh`、
   手工命令三条路应用。任何一条漏一步，设备上的表现都**不是**"补丁没打"，而是别的症状。
2. **症状和真因之间隔着包装**。已经遇到的三种伪装：
   - 未 await 的 promise 里的 `ReferenceError` → 表现为"发消息后永远没反应"；
   - 存储层 `EACCES` → 被会话控制器包成 `session/agent-busy: prompt rejected`；
   - 配置 schema 的默认值 → 报"当前模型不支持图片"，其实模型支持。
3. **只写散文记忆不解决问题**。`inputModalities` 这个坑在 Mac 端 2026-09-09 就记进过记忆，
   2026-09-16 在手机上又踩了一次——因为记忆没有连到任何**执行点**。所以本项目的规矩是：
   每条教训都要落到一个**能在 CI 或设备上跑的检查**，没有检查的教训不算教训。

## 二、关卡表

| # | 症状（设备上看到的） | 真因 | 修法 | 机器检查 |
|---|---|---|---|---|
| g1 | 发消息后什么都没发生 | Android 无 `flock` 原生支持，`@deepseek-ai/node-addon-system` 抛 `ERR_FLOCK_UNSUPPORTED_PLATFORM`，会话日志永远写不出来 | `patch-dsh-flock-android.mjs` 让它退化为无竞争锁 | `verify-patched-tree` g1 |
| g2 | `accepted:true` 后轮次永不启动，目录只有 `session.lock` | 补丁把 `link()` 改成 `rename()` 却没把 `rename` 加进 `node:fs/promises` import（0.1.5 原始 import 里没有它）；异常抛在没人 await 的 promise 里 | `patch-dsh-link.mjs`（含 import 修复 + 修复已打补丁树的规则） | `verify-patched-tree` g2 |
| g3 | 发图片/附件被拒，理由却是 `session/agent-busy` / `EACCES open '/data/data'` | `dsh-attachment-local` 会把从目标目录到**文件系统根**的每级祖先目录都 `open()`+`fsync()`：`/data/data` 是 EACCES（应用沙箱），`/` 的 fsync 是 EINVAL | `patch-dsh-attachment-fsync.mjs` 放行 EACCES/EPERM/EINVAL 等；文件的 fsync 保持原样 | `verify-patched-tree` g3 |
| g4 | 首屏永远不出现，CPU 跑满几分钟 | 0.1.5 给每个客户端模块合成 identity sourcemap 并每次注册都重组 10.8MB bundle | `patch-dsh-client-modules.mjs`（空 map + flush 去抖） | `verify-patched-tree` g4 |
| g5 | WebView 永远 401 / 空白 | 0.1.5 给 UI 和 `/api` 加了每进程 token 门禁，壳子拿不到 token | `patch-dsh-web-auth.mjs`（loopback 放行，LAN 仍要 token） | `verify-patched-tree` g5 |
| g6 | 终端/子进程相关功能加载即崩 | `node-pty` 在模块顶层 require 原生 addon（0.1.x）。0.2.1-rc.2 上游已经改用 `createLazyRequire()` | `patch-dsh.mjs` 按**能力**判定：已惰性加载就报“不需要”并 exit 0，只有“既没惰性加载、锚点又不命中”才算失败 | `verify-patched-tree` g6（校验 node-pty 没有被静态 import） |
| g7 | 用某个预设建会话直接失败（`$.prefix missing required value`） | 0.1.5 的 `dsh-persona` 把 persona 提示词键从 `text:` 改成必填的 `prefix:` | `patch-dsh-presets.mjs` | `verify-patched-tree` g7 |
| g8 | 报"当前模型不支持图片"，但模型明明支持 | `settings.yaml` 里的 `llm-deepseek.models` 会**整套替换**出厂目录，而 `inputModalities` 的 schema 默认是 `["text"]` | 给真正支持图片的条目加 `inputModalities: [text, image]` | `verify-patched-tree` g8（WARN） |
| g9 | 「添加附件」点击毫无反应 | Android WebView 只有在宿主实现 `WebChromeClient.onShowFileChooser` 时才会弹选择器，否则 `<input type=file>` 的 click 被静默吞掉 | `WebActivity` 实现 chooser（v0.2.9+） | 人工：点一次回形针 |
| g10 | 部署中途 `ENOENT ... dsh-subprocess-local/lib/index.js` | 部署脚本写死 `$DSH_DIR/node_modules/@deepseek-ai/<pkg>`；符号链接安装的依赖副本是启动器的**兄弟目录** | 部署脚本先 `readlink -f` 再判两种布局（`SCOPE_DIR`/`MODROOT`） | `preflight` 第 3 项 |
| g11 | 一键部署"成功"了但什么都没修 | 补丁脚本对缺失目标只打印 `skip (missing)` 并 exit 0 | 补丁脚本在**一个目标都没找到**时 exit 1 | `preflight` 第 2 项 |
| g12 | 部署脚本在某一步突然中止 | `set -e` + 可失败的补丁步骤 | 目标缺失降级为 warn；关键步骤单独判断 | 代码审查 |
| g13 | 上游发新版后部署必挂，且卡在半部署状态 | `npm install -g @deepseek-ai/dsh@latest`：APK 发布 12 天后 npm 的 latest 从 0.1.x 跳到 0.2.0-rc.2，全部补丁锚点失配，`set -e` 把“可选补丁失配”放大成致命失败 | 部署脚本锁定 `DSH_VERSION`（当前 `0.2.1-rc.2`）；关卡复核挪到**最后**，且先写 `.dsh-setup-ok` 再复核，失败时 Key/插件/权限都已就位，重跑走快速路径 | 每次发版跑一次真机部署，末尾必须出现 `SETUP OK` |
| g14 | 界面一直停在「正在等待 3080 就绪」，日志首行 `host preparation failed: No usable native binding found for node-addon-require-builtin-android-arm64` | 0.2.x 的 `dsh-app-boot` 通过 `node-addon-require-builtin` 取 Node 内部模块；该包只发布 darwin 与 linux-gnu/musl 预编译产物，Android（bionic）没有可加载的原生模块，模块在自己体内直接抛错，`dsh web` 在绑定 3080 之前就退出 | `patch-dsh-require-builtin.mjs`：原生可用时照旧用原生，不可用时退回 `--expose-internals` 下的普通 `require`（两个消费方本来就先试这条路） | `verify-patched-tree` g14（旧版本没有该包则 skip） |
| g15 | 新建会话一直转圈，界面提示 `waiting for workflow engine` | 两处叠加：① profile 补丁禁用了 `sandbox` 行，而 `dsh-ptc-runtime-node` 注入 `sandbox`、预设里的 `workflow-ptc` 又注入 `ptcRuntime`，两者一起挂起，会话的 agent 预设永远等不到 workflow 引擎；② 插件原先用软链放进 `profiles/web/node_modules`，0.2.x 的 profile 整理会把它当"链接投影"删掉，留下悬空链接后每次启动都在 `realpath` 上 `EACCES` | `sandbox` 行恢复启用（`bash-sandbox` 仍然禁用，`bash-local` 提供 `shell`，bash 工具不依赖 `sandbox`）；插件改为**真实目录**复制进 profile | `verify-patched-tree` g15（profile 未禁用 sandbox + 插件是真实目录） |
| g16 | 个人热点开起来几秒就自动关闭；整机任何域名都解析不了 | `boot-dsh.sh` 与 `dsh-watchdog.sh` 在 DNS 正常时也启动 `dns-fwd`（绑 `0.0.0.0:53`）并把所有 :53 流量 DNAT 到本机。现代 Android 的 netd 自己就在 `127.0.0.1:53` 上服务 DNS，两者抢同一端口/同一重定向：tethering 写 DNS 转发器失败（`ServiceSpecificException EREMOTEIO 121`），热点会话整体回滚，AP 接口被拆 | 两个脚本先探测系统解析：能用就完全不接管 :53，并撤掉遗留重定向；只有确实解析不了才走 DoH 转发 | 真机复核：热点能稳住，`/data/adb/dsh-watchdog.log` 里出现 `system resolver healthy` 而不是 `redirect restored` |

## 三、防复发协议（每次改动照做）

**改代码/补丁时**
1. `bash tools/preflight.sh` —— 语法、静默 no-op、布局硬编码、版本一致性、payload 完整性。
   CI 在打包前跑同一支脚本（`.github/workflows/android.yml` 的 preflight 步骤）。

**部署/升级后（设备上）**
2. `node ~/verify-patched-tree.mjs ~/.dsh` —— 期望 `TREE_OK`，逐个关卡确认补丁真的在树里。
3. `node ~/verify-turn.mjs 3080 ~` —— 期望 `VERIFY_OK turns=1`，真跑一轮。
4. 改动涉及附件/图片时，再用 inline 图片 prompt 验一次（`tools/phone-probes/`）。

**诊断时（省时间的关键）**
5. **先跑最薄的 surface**：`dsh --profile headless 'hi'`。它一秒就能吐出 boot/轮次类异常；
   web 模式会把同样的异常吞进静默 promise，看起来只是"卡住"。用 web+HTTP 探针起步是最贵的一课。
6. **静默症状规则**：`accepted:true` 之后没动静 = 有 rejection 被吞了。优先怀疑
   "没人 await 的 promise"和"被 `|| echo [warn]` 掩盖的失败"，而不是"服务没激活"。
7. **永远不要在真实 home 上试新版**：`cp -a ~/.dsh ~/h015-<名字>` 克隆演练，端口也要另开。

**部署脚本的硬性要求**
8. 必须幂等（重复执行 = 无操作）；必须单例（看门狗用 `pgrep` 判断，别只信 pidfile，过期 pidfile 会放行第二个实例）。
9. 备份先行（`~/backups/upgrade-015-<时间戳>/`），回滚一条命令可达。

## 四、Android 平台事实速查（写代码前先看）

- **应用沙箱**：任何 app uid（含 Termux）都不能 `open('/data/data')`——不要写"向上遍历祖先目录"的持久化逻辑；
  目录 fsync 在根目录可能返回 `EINVAL`。
- **`link(2)` 被拒绝**：app uid 下硬链接报 EACCES，原子发布要改成 `rename`/`copyFile`。
- **没有 `flock` 原生模块**：涉及跨进程锁的依赖要在 Android 上退化。
- **WebView 是"半个浏览器"**：`<input type=file>` 需要宿主实现 `onShowFileChooser`；外部存储/权限模型与 Chrome 不同。
- **`--expose-internals`**：0.1.5 起 HMR 与 0.2.x 的 `node-addon-require-builtin` 都依赖它，`dsh web` 必须带这个参数启动。
- **su 的坑（工具链）**：`adb shell su -c '...'` 的引号会被远端 shell 二次解析；从 adb shell 调用的
  `su <uid>` 写 app 数据目录会被 SELinux 拒（要嵌在 root shell 里）；toybox 的 `grep` 不支持 `\|` 交替。
- **后台限制**：MIUI 会冻结 Termux；看门狗与电池豁免是必需品，不是优化。

## 五、文档关系（先读这一份）

`dsh-phone` 的历史文档已经攒了四份（运维手册、部署管线 runbook、App 侧宿主问题、以及本份），
再写第五份同类记录没有意义——本份是**索引 + 协议**：

| 文档 | 定位 |
|---|---|
| **ANDROID-GATES.md（本份）** | 关卡总表 + 防复发协议 + 平台事实速查；排查任何 Android 端问题时先看这里 |
| `TROUBLESHOOTING.md` | 按症状检索的详细条目（含诊断过程与技术细节） |
| `UPGRADE-0.1.5.md` | 版本迁移的操作步骤与回滚 |
| Mnemon Documents（`67de0687` / `c8fec054` / `6931b306` / `1af7e033`） | 历史现场记录；其中 1af7e033 与本文同源 |

**规矩**：新踩到的坑先补进本份的关卡表（症状/真因/修法/**机器检查**），再补 `TROUBLESHOOTING.md` 细节；
只写进 Mnemon 记忆不算完成——没有机器检查的教训会再踩第二次。
