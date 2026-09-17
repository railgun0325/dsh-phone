# v0.2.11 — 「新建文件夹」EACCES 的真因：不是 root，也不是 SELinux

## 症状

在 DSH 界面里新建文件夹，弹窗报：

```
cannot create /data/data/com.termux/files/home/11:
EACCES: permission denied, mkdir '/data/data/com.termux/files/home/11'
```

有 root、Termux 也正常，所以第一反应是 SELinux / 应用沙箱。**两条都不是。**

## 真因：Termux home 目录的属主和权限被改掉了

```
$ stat -c '%a %u:%g' ~
775 2000:2000          # ← shell:shell，不是 Termux 的 10598
```

`~` 变成 `shell:shell`、模式 `775` 之后，Termux uid(10598) 在这台手机上只是 **other**，
对 `~` 只有 `r-x` —— 于是任何新建（文件或目录）都是普通 Unix 权限拒绝（DAC），
报错就是 EACCES。同一个目录里 `~/.dsh`（10598 所有、700）一直读写正常，正好对得上。

**怎么变成这样的**：`cp -a/-r <staging>/. $HOME/` 这种写法会把**源目录自己的属主/权限**套到目标目录上。
payload 从 `adb push` 的中转目录（`shell` 所有）或 root 的临时目录拷进 Termux home 时，
就会把 `~` 的属主/模式一起改掉。这和 DSH、和 root 权限都无关。

## 修了什么

1. **立即修复**（用户机上已执行）：`chown 10598:10598 ~ && chmod 700 ~`。
2. **部署时自愈**：`setup-root.sh` / `setup-shizuku.sh` 第一步检查 `~` 的属主与权限，
   不对就用 root 修回来（`chown <uid>:<uid> ~ && chmod 700 ~`）。
3. **App 侧兜底**：`transferPayload` 拷完 payload 之后，用 root 把 `$HOME` 的属主/权限恢复，
   避免"部署一次就把家目录搞坏一次"。
4. **机器检查 g0**：`verify-patched-tree.mjs` 现在会**真的在 home 里 mkdir 一次再删掉**，
   不通过就打印修复命令。这个检查加在所有关卡之前——它过不了，后面全是噪音。
5. **preflight 新守卫**：CI 会扫出脚本里 `cp -a/-r <src>/. <dst>/` 的写法并失败，
   逼着改动方在拷贝后恢复目标目录的属主/权限。
6. `docs/ANDROID-GATES.md` 增加 g0 行与「拷贝会改目标目录属性」的平台事实。

## 升级说明

- versionCode 15 / versionName 0.2.11（上一版 14 / 0.2.10）。可覆盖安装。
- 本版不改运行时；已在跑 DSH 的机器装完 App 后，点一次「一键部署」即可让自愈逻辑就位
  （也可以直接在该机执行 `chown $(id -u):$(id -g) ~ && chmod 700 ~` 立即恢复）。
