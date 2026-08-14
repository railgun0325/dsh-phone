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
        if (!ShRoot.available()) {
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

        log("写入 payload 到 /data/local/tmp/dsh-stage…");
        transferPayload(payload, uid);

        log("开始安装 DSH（首次需联网下载依赖，可能耗时数分钟）…");
        String escKey = shq(apiKey);
        ShRoot.Result setup = ShRoot.execAs(uid,
            "env DEEPSEEK_API_KEY=" + escKey + " " + PREFIX + "/bin/bash " + HOME + "/setup-root.sh",
            30 * 60 * 1000);
        String setupOut = setup.out;
        if (setupOut.length() > 40000) setupOut = setupOut.substring(setupOut.length() - 40000);
        log(setupOut);
        if (setup.code != 0) {
            throw new Exception("DSH 安装失败（exit " + setup.code + "）。详见 Termux 内 ~/setup-dsh.log");
        }

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
        ShRoot.Result r = ShRoot.execAs(uid,
            "test -x /data/data/com.termux/files/usr/bin/sh && echo READY", 10000);
        return r.out.contains("READY");
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
        ShRoot.Result stage = ShRoot.exec(
            "rm -rf /data/local/tmp/dsh-stage && mkdir -p /data/local/tmp/dsh-stage && cp -r "
                + shq(payload.getAbsolutePath()) + "/. /data/local/tmp/dsh-stage/ && chmod -R 755 /data/local/tmp/dsh-stage",
            30000);
        if (stage.code != 0) {
            throw new Exception("写入中转目录失败：\n" + stage.out);
        }
        ShRoot.Result copy = ShRoot.execAs(uid,
            "cp -r /data/local/tmp/dsh-stage/. " + HOME + "/ && chmod 700 " + HOME + "/*.sh && chmod 700 " + HOME + "/*.mjs",
            30000);
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
