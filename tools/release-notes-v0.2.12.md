# v0.2.12

## 修复

- **一键部署在 DSH 0.2.x 上必然中断**：部署脚本原先装 `@deepseek-ai/dsh@latest`，而这个 APK 发布 12 天后 npm 的 latest 从 0.1.x 跳到了 0.2.0-rc.2。补丁锚点全部失配，`set -e` 把「一个可选补丁没命中」放大成整场部署失败，手机停在半部署状态：Termux、Node、DSH 都装好了，插件注册、API Key 与 bridge token 落盘、权限授予全被跳过。
  - 部署现在锁定 `DSH_VERSION=0.2.1-rc.2`，日志里同时打印实装版本（`DSH_VERSION_INSTALLED=`），版本漂移一眼可见。
  - `node-pty` 补丁改成按能力判断：0.2.1-rc.2 上游已经用 `createLazyRequire()` 懒加载，补丁打印「不需要」并正常退出，不再报错。
- **0.2.x 上六个补丁的锚点全部重新对过**：web auth（`isAuthenticated` 单点）、link→rename、flock、附件 fsync、client-modules 去抖都已适配 0.2.1-rc.2 的真实构建产物；关卡复核脚本同步改了判断条件（g2 只要求 `rename` 已被 import，g6 只要求 node-pty 没有被静态 import）。
- **0.2.x 在手机上根本起不来：界面卡在「正在等待 3080 就绪」**。0.2.x 的启动流程通过 `node-addon-require-builtin` 读取 Node 内部模块，而这个包只提供 darwin 与 linux（glibc/musl）的预编译二进制，Android 用的 bionic 一个都没有。模块在自己的加载阶段就抛错，`dsh web` 在绑定 3080 之前退出，App 于是一直等端口。
  - 新增 `patch-dsh-require-builtin.mjs`：能用原生绑定就照旧用，用不了就退回 `--expose-internals` 下的普通 `require`（dsh 自己的两个调用方本来就是先试这条路）。补丁同时进了 Shizuku 版与 Root 版的部署包，关卡校验新增 g14 复核。
- **手机会莫名其妙没有 DNS，个人热点开起来几秒就自动关闭**。Root 版的开机脚本和看门狗会在 DNS 本来就正常的手机上启动 `dns-fwd`（绑 `0.0.0.0:53`）并把所有 `:53` 流量重定向到本机。Android 16 的 netd 自己就在 `127.0.0.1:53` 上解析，两者冲突后 tethering 写入 DNS 转发器失败（`EREMOTEIO 121`），热点会话整体回滚，界面上就是「热点已关闭」；同一原因也让整机解析不了域名，DSH 的模型请求随之失败。
  - 两个脚本现在先探测系统解析：能解析就完全不接管 `:53`，并撤掉之前遗留的重定向；只有确实解析不了时才启用 DoH 转发。
- **部署顺序调整**：`.dsh-setup-ok` 标记与关卡复核挪到最后，先写入 Key/插件/权限再复核。复核失败时环境仍是完整的，重跑走快速路径只复核关卡，不用重新下载。
- **手机端布局适配 0.2.1 的前端结构**：右栏类名从 `detailsCol` 改成了 `rightbarCol`，折叠状态属性从 `data-details-collapsed` 改成了 `data-rightbar-collapsed`，移动端抽屉布局恢复生效。
- **`curl` 拉取第三方 APK 的网络兼容**：GitHub release 资源被挡、但 github.com 可通的网络下，`tools/fetch-assets.sh` 现在会依次尝试 `gh-proxy.com`、`ghfast.top` 两个镜像。

## 升级

- 覆盖安装即可（versionCode 16 / v0.2.12）。
- 已经卡在半部署状态的设备：安装后点一次「一键部署」。旧的 `.dsh-setup-ok` 存在时会走快速路径，但已装的 DSH 版本不是 0.2.1-rc.2 的话，建议先删掉标记再部署一次：
  ```sh
  rm -f ~/.dsh-setup-ok
  ```
  再点「一键部署」，让它按锁定版本重装 DSH 并重打补丁。
