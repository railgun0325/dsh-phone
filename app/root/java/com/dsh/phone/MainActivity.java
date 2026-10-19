package com.dsh.phone;

import com.dsh.phone.common.Assets;
import com.dsh.phone.common.ShRoot;
import com.dsh.phone.common.WebActivity;
import com.dsh.phone.common.WizardActivity;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Root one-tap flavor: install Termux + DSH + the android-control plugin,
 * then start the on-device DSH web server, entirely from a rooted phone.
 * No PC, no adb — paste a key, tap deploy.
 */
public class MainActivity extends WizardActivity {
    private static final String PREFIX = "/data/data/com.termux/files/usr";
    private static final String HOME = "/data/data/com.termux/files/home";

    @Override
    protected String modeLabel() { return "Root 版"; }

    @Override
    protected Class<?> shellActivityClass() { return WebActivity.class; }

    @Override
    protected void doDeploy(String apiKey) throws Exception {
        File filesDir = getFilesDir();

        log("解压安装资源…");
        File termuxApk = new File(filesDir, "termux.apk");
        File bootApk = new File(filesDir, "termux-boot.apk");
        File apiApk = new File(filesDir, "termux-api.apk");
        File payload = new File(filesDir, "payload");
        Assets.extract(this, "termux.apk", termuxApk);
        Assets.extract(this, "termux-boot.apk", bootApk);
        Assets.extract(this, "termux-api.apk", apiApk);
        Assets.extract(this, "payload", payload);
        log("资源解压完成");

        log("检测 root…（如弹出超级用户授权请点允许并勾选记住）");
        ShRoot.Result rootProbe = ShRoot.exec("id", 8000);
        if (rootProbe.code != 0 || !rootProbe.out.contains("uid=0")) {
            if (ShRoot.denied(rootProbe)) throw new Exception(ShRoot.deniedHint(rootProbe));
            throw new Exception("未检测到 root。本 APK 是 Root 版，需要 Magisk/Kitsune 等已 root 手机；未 root 请下载 Shizuku 版。");
        }
        log("root 可用");

        // pm path 精确匹配：pm list 的 "package:com.termux.boot/api" 子串会误判为已安装
        boolean termuxInstalled = ShRoot.exec("pm path com.termux", 15000).code == 0;
        String uid;
        if (termuxInstalled) {
            uid = termuxUid();
            if (uid != null && shReady(uid)) {
                log("检测到可用 Termux，复用（跳过安装）");
            } else {
                log("安装 Termux（APK 内嵌 bootstrap，全程无需网络）…");
                installApk(termuxApk, 300000);
                uid = termuxUid();
                initTermux(uid);
            }
        } else {
            log("安装 Termux（APK 内嵌 bootstrap，全程无需网络）…");
            installApk(termuxApk, 300000);
            uid = termuxUid();
            initTermux(uid);
        }

        log("安装 Termux:Boot…");
        installApk(bootApk, 120000);
        log("安装 Termux:API…");
        installApk(apiApk, 120000);
        log("部署将给 Termux:API 授予相机/麦克风/定位等硬件权限（系统隐私指示灯全程可见，逐项结果见下方 setup 日志）…");

        log("写入 payload 到 /data/local/tmp/dsh-stage…");
        prepareTermuxHome(uid);
        ShRoot.Result identity = ShRoot.execAs(uid, "id && cat /proc/self/attr/current", 15000);
        if (identity.code != 0) throw new Exception("无法进入 Termux 应用身份：\n" + identity.out);
        log("Termux 应用身份：" + identity.out.trim());
        transferPayload(payload, uid);

        log("暂停旧 DSH web 和 watchdog，准备更新（DNS 转发继续运行）…");
        ShRoot.Result stop = ShRoot.exec(
            "pkill -TERM -f '[/]data/adb/service.d/dsh-watchdog[.]sh' 2>/dev/null || true; "
                + "pkill -TERM -u " + uid + " -f '[/]dsh/lib/bin[.]js web' 2>/dev/null || true", 15000);
        if (stop.code != 0) throw new Exception("暂停旧服务失败：\n" + stop.out);
        Thread.sleep(1500);
        log("开始安装 DSH（首次需联网下载依赖，可能耗时数分钟）…");
        String escKey = shq(apiKey);
        ShRoot.Result setup = ShRoot.execAs(uid,
            "env DEEPSEEK_API_KEY=" + escKey + " " + PREFIX + "/bin/bash " + HOME + "/setup-root.sh",
            30 * 60 * 1000);
        String setupOut = setup.out;
        if (setupOut.length() > 40000) setupOut = setupOut.substring(setupOut.length() - 40000);
        log(setupOut);
        if (setup.code != 0) {
            if (ShRoot.denied(setup)) throw new Exception(ShRoot.deniedHint(setup));
            throw new Exception("DSH 安装失败（exit " + setup.code + "）。详见 Termux 内 ~/setup-dsh.log");
        }
        log("Termux:API 硬件权限处理完成（grant/豁免明细见上方 setup 日志）");

        log("配置开机自启（Termux:Boot）…");
        ShRoot.Result boot = ShRoot.execAs(uid,
            "mkdir -p " + HOME + "/.termux/boot && cp " + HOME + "/boot-dsh.sh " + HOME + "/.termux/boot/boot-dsh.sh && chmod 700 " + HOME + "/.termux/boot/boot-dsh.sh",
            15000);
        if (boot.code != 0) {
            log("[warn] 开机自启配置失败（不影响本次使用）：" + boot.out);
        }

        startServices(uid);

        log("等待 DSH 服务就绪（最多 60 秒）…");
        pollDsh(60000);
    }

    @Override
    protected void killStaleDsh() {
        ShRoot.exec("pkill -f 'bin.js web' 2>/dev/null", 8000);
    }

    /** Lightweight restart of an already-deployed DSH (no reinstall). */
    @Override
    protected void resumeDsh() throws Exception {
        if (!ShRoot.available()) {
            throw new Exception("未检测到 root，请点部署重新初始化");
        }
        String uid = termuxUid();
        if (!shReady(uid)) {
            throw new Exception("Termux 环境不可用，请点部署重新初始化");
        }
        log("Termux 环境正常，拉起 DNS 转发与 DSH 服务…");
        startServices(uid);
        pollDsh(45000);
    }

    // ---- helpers -----------------------------------------------------------

    private static String shq(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }

    private void installApk(File apk, int timeoutMs) throws Exception {
        ShRoot.Result r = ShRoot.exec("pm install -r -g " + shq(apk.getAbsolutePath()), timeoutMs);
        if (r.code != 0) {
            throw new Exception("安装 " + apk.getName() + " 失败：\n" + r.out);
        }
        log(apk.getName() + " 安装完成");
    }

    private String termuxUid() throws Exception {
        ShRoot.Result r = ShRoot.exec("stat -c %u /data/data/com.termux", 15000);
        String t = r.out.trim();
        if (r.code != 0 || !t.matches("\\d+")) {
            throw new Exception("无法获取 Termux uid：\n" + r.out);
        }
        return t;
    }

    private boolean shReady(String uid) {
        ShRoot.Result r = ShRoot.exec(
            "test -x /data/data/com.termux/files/usr/bin/sh && echo READY", 10000);
        return r.out.contains("READY");
    }

    private void prepareTermuxHome(String uid) throws Exception {
        // Only this directory is repaired here. Never recursively relabel the
        // Termux prefix, and never invent MCS categories from a different app.
        String cmd = "test ! -L " + HOME + " && test -d " + HOME
            + " && context=$(ls -Zd /data/data/com.termux | awk '{print $1}')"
            + " && case \"$context\" in u:object_r:app_data_file:s0:c*) ;; *) exit 1 ;; esac"
            + " && chown " + uid + ":" + uid + " " + HOME + " && chmod 700 " + HOME
            + " && chcon \"$context\" " + HOME;
        ShRoot.Result r = ShRoot.exec(cmd, 15000);
        if (r.code != 0) throw new Exception("无法从 Termux 应用目录取得完整 SELinux 标签；已停止部署：\n" + r.out);
    }

    private void initTermux(String uid) throws Exception {
        log("首次启动 Termux 完成 bootstrap（内嵌，无需网络）…");
        ShRoot.Result m = ShRoot.exec("monkey -p com.termux -c android.intent.category.LAUNCHER 1", 30000);
        if (m.code != 0) {
            ShRoot.exec("am start -n com.termux/.app.TermuxActivity", 30000);
        }
        log("等待 Termux 环境解压（最长 4 分钟）…");
        long deadline = System.currentTimeMillis() + 4 * 60 * 1000L;
        while (System.currentTimeMillis() < deadline) {
            if (shReady(uid)) {
                log("Termux 环境就绪");
                return;
            }
            Thread.sleep(3000);
        }
        throw new Exception("Termux 初始化超时（4 分钟）。请确认已授权超级用户，并手动打开一次 Termux 后重试。");
    }

    private void transferPayload(File payload, String uid) throws Exception {
        String stagePath = "/data/local/tmp/dsh-stage-" + uid + "-" + System.nanoTime();
        ShRoot.Result stage = ShRoot.exec(
            "mkdir -m 755 " + stagePath + " && cp -r "
                + shq(payload.getAbsolutePath()) + "/. " + stagePath + "/ && chmod -R 755 " + stagePath,
            30000);
        if (stage.code != 0) {
            throw new Exception("写入中转目录失败：\n" + stage.out);
        }
        // Repair old payload destinations before app-context cp can overwrite
        // them. Execute the trusted helper from the freshly extracted stage.
        ShRoot.Result repair = ShRoot.exec("sh " + stagePath + "/root-install-selinux.sh " + uid + " " + uid, 120000);
        if (repair.code != 0) {
            ShRoot.exec("rm -rf " + stagePath, 15000);
            throw new Exception("旧部署文件标签修复失败：\n" + repair.out);
        }
        ShRoot.Result copy = ShRoot.execAs(uid,
            "export PATH=" + PREFIX + "/bin:/system/bin; export LD_LIBRARY_PATH=" + PREFIX + "/lib; "
                + "for entry in " + stagePath + "/*; do cp -R --no-preserve=all \"$entry\" " + HOME + "/ || exit 1; done; "
                + "chmod 700 " + HOME + "/*.sh " + HOME + "/*.mjs",
            30000);
        ShRoot.exec("rm -rf " + stagePath, 15000);
        if (copy.code != 0) {
            throw new Exception("payload 拷贝进 Termux 失败：\n" + copy.out);
        }
        log("payload 已就位");
    }

    private void startServices(String uid) throws Exception {
        log("启动 DNS 转发（root，监听 53）…");
        ShRoot.exec("pgrep -f dns-fwd.mjs >/dev/null 2>&1 || (setsid env LD_LIBRARY_PATH=" + PREFIX + "/lib "
            + PREFIX + "/bin/node " + HOME + "/dns-fwd.mjs >/data/local/tmp/dns-fwd.log 2>&1 &)", 8000);
        Thread.sleep(2000);
        log("配置 iptables DNS 重定向…");
        ShRoot.exec("iptables -t nat -D OUTPUT -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null; "
            + "iptables -t nat -D OUTPUT -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null; "
            + "iptables -t nat -A OUTPUT -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53; "
            + "iptables -t nat -A OUTPUT -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53", 15000);
        ShRoot.exec("ip -6 route replace local fe80::5/128 dev lo 2>/dev/null", 10000);
        log("启动 DSH web（Termux 身份）…");
        ShRoot.execAs(uid, "setsid " + PREFIX + "/bin/bash " + HOME + "/start-dsh.sh >/dev/null 2>&1 &", 8000);
    }

    private void pollDsh(int timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            Socket s = new Socket();
            try {
                s.connect(new InetSocketAddress("127.0.0.1", 3080), 2000);
                log("DSH 服务已就绪（http://127.0.0.1:3080）");
                return;
            } catch (Exception ignored) {
                // not ready yet
            } finally {
                try { s.close(); } catch (Exception ignored) {}
            }
            Thread.sleep(2000);
        }
        throw new Exception("等待 DSH 服务超时（60 秒）。请查看 Termux 内 ~/dsh-web.log 与 ~/setup-dsh.log");
    }
}
