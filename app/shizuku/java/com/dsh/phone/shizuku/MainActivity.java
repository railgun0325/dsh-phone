package com.dsh.phone.shizuku;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.security.SecureRandom;

import com.dsh.phone.common.Assets;
import com.dsh.phone.common.WebActivity;
import com.dsh.phone.common.WizardActivity;

import rikka.shizuku.Shizuku;

/**
 * Shizuku (unrooted) one-tap deployer.
 * doDeploy runs on a background thread (see WizardActivity); every step logs.
 */
public class MainActivity extends WizardActivity {

    private static final String SHIZUKU_PKG = "moe.shizuku.privileged.api";
    private static final String TERMUX_PKG = "com.termux";
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";
    private static final String RUN_COMMAND_PERM = "com.termux.permission.RUN_COMMAND";

    @Override
    protected String title() { return "DSH Phone"; }

    @Override
    protected String modeLabel() { return "Shizuku 版"; }

    @Override
    protected Class<?> shellActivityClass() { return WebActivity.class; }

    @Override
    protected void doDeploy(String apiKey) throws Exception {
        File files = getFilesDir();

        // a. extract assets
        log("[1/12] 解压安装资源…");
        Assets.extract(this, "termux.apk", new File(files, "termux.apk"));
        Assets.extract(this, "termux-boot.apk", new File(files, "termux-boot.apk"));
        Assets.extract(this, "termux-api.apk", new File(files, "termux-api.apk"));
        Assets.extract(this, "shizuku.apk", new File(files, "shizuku.apk"));
        Assets.extract(this, "payload", new File(files, "payload"));
        log("[1/12] 资源就绪");

        // b. Shizuku binder
        log("[2/12] 检查 Shizuku…");
        if (!ShizukuExec.binderReady()) {
            if (!isPkgInstalled(SHIZUKU_PKG)) {
                log("  未检测到 Shizuku，正在打开安装…");
                runOnUiThread(new Runnable() { @Override public void run() { offerInstallShizuku(); } });
                log("  请在系统安装器里完成 Shizuku 安装");
            }
            log("  请：打开 Shizuku → 无线调试/配对（或电脑 adb）→ 启动 Shizuku");
            setStatus("等待 Shizuku 启动…");
            for (int i = 0; i < 300 && !ShizukuExec.binderReady(); i++) sleep(1000);
            if (!ShizukuExec.binderReady()) {
                throw new Exception("Shizuku 仍未启动（5 分钟超时）。请先在 Shizuku 里完成无线调试授权并启动，再点一键部署。");
            }
        }
        log("[2/12] Shizuku binder 已连接");

        // c. permission
        log("[3/12] 检查 Shizuku 授权…");
        if (!ShizukuExec.hasPermission()) {
            log("  请在 Shizuku 弹窗中允许本 App 使用 Shizuku…");
            setStatus("请在 Shizuku 弹窗点允许");
            try { Shizuku.requestPermission(1000); } catch (Throwable t) { /* ignore, poll below */ }
            for (int i = 0; i < 120 && !ShizukuExec.hasPermission(); i++) sleep(1000);
            if (!ShizukuExec.hasPermission()) {
                throw new Exception("Shizuku 授权超时。请在 Shizuku 的授权列表里允许 DSH Phone，再重试。");
            }
        }
        log("[3/12] Shizuku 已授权");

        // d. token
        log("[4/12] 生成本地桥 token…");
        String token = genToken();
        writeString(new File(files, "bridge-token"), token);
        log("[4/12] token 已写入 files/bridge-token");

        // start bridge foreground service early
        requestNotificationPermission();
        log("  启动本地桥前台服务（127.0.0.1:36527）…");
        BridgeService.start(this);

        // e. install Termux family
        boolean termuxBootstrapReady = isPkgInstalled(TERMUX_PKG) && bootstrapReady();
        if (!termuxBootstrapReady) {
            log("[5/12] 安装 Termux（bootstrap 内置，无需联网）…");
            pmInstall(new File(files, "termux.apk"));
            log("  安装 termux-boot / termux-api…");
            pmInstall(new File(files, "termux-boot.apk"));
            pmInstall(new File(files, "termux-api.apk"));
        } else {
            log("[5/12] Termux 已就绪，跳过安装");
            pmInstallQuiet(new File(files, "termux-boot.apk"));
            pmInstallQuiet(new File(files, "termux-api.apk"));
        }

        // f. monkey launch + bootstrap
        log("[6/12] 启动 Termux 完成 bootstrap…");
        if (!termuxBootstrapReady) {
            ShizukuExec.exec("monkey -p com.termux -c android.intent.category.LAUNCHER 1", 30000);
            log("  等待 bootstrap 解压（最长 4 分钟）…");
            setStatus("等待 Termux bootstrap…");
            boolean ready = false;
            for (int i = 0; i < 80; i++) {
                if (bootstrapReady()) { ready = true; break; }
                sleep(3000);
            }
            if (!ready) {
                throw new Exception("Termux bootstrap 未在 4 分钟内完成。请手动打开一次 Termux 再重试。");
            }
        }
        log("[6/12] bootstrap 就绪");

        // g. allow-external-apps (RUN_COMMAND prerequisite)
        log("  写入 Termux allow-external-apps=true…");
        runAs("mkdir -p " + TERMUX_HOME + "/.termux && echo allow-external-apps=true > " + TERMUX_HOME + "/.termux/termux.properties", 30000);
        log("  allow-external-apps 已开启");

        // h. RUN_COMMAND permission
        log("[7/12] 检查 Termux RUN_COMMAND 授权…");
        if (!ensureRunCommandPermission()) {
            throw new Exception("缺少 com.termux.permission.RUN_COMMAND 授权。请在系统设置里授予，再重试。");
        }
        log("[7/12] RUN_COMMAND 已授权");

        // i. transfer payload (self-extract via stdin)
        log("[8/12] 传输部署脚本与插件到 Termux…");
        String selfExtract = buildSelfExtract(new File(files, "payload"));
        TermuxExec.Result tr = TermuxExec.exec(this, TermuxExec.TERMUX_BASH, null, selfExtract,
                TermuxExec.TERMUX_HOME, true, 180000);
        if (!tr.ok()) {
            throw new Exception("payload 传输失败: " + detail(tr));
        }
        log("[8/12] payload 已写入 Termux HOME");

        // j. write key + token, run setup
        log("[9/12] 写入 API Key / bridge token 并执行 setup-shizuku.sh（首次安装约 5-15 分钟）…");
        setStatus("正在安装 DSH（首次较慢，请耐心）…");
        String setupCmd = "export DEEPSEEK_API_KEY=" + shq(apiKey)
                + "; export DSH_BRIDGE_TOKEN=" + shq(token)
                + "; bash " + TERMUX_HOME + "/setup-shizuku.sh";
        tr = TermuxExec.sh(this, setupCmd, 20 * 60 * 1000);
        if (!tr.ok()) {
            throw new Exception("setup-shizuku.sh 失败: " + detail(tr));
        }
        log("[9/12] DSH 安装完成");

        // k. boot script
        log("[10/12] 写开机自启（Termux:Boot）…");
        String boot = "mkdir -p " + TERMUX_HOME + "/.termux/boot"
                + " && cp " + TERMUX_HOME + "/boot-dsh-shizuku.sh " + TERMUX_HOME + "/.termux/boot/boot-dsh.sh"
                + " && chmod 700 " + TERMUX_HOME + "/.termux/boot/boot-dsh.sh";
        tr = TermuxExec.sh(this, boot, 60000);
        if (!tr.ok()) {
            log("[warn] 开机自启写入失败（不影响本次使用）: " + detail(tr));
        } else {
            log("[10/12] 开机自启就绪");
        }

        // l. start dsh web
        log("[11/12] 启动 DSH web（127.0.0.1:3080）…");
        String startCmd = "cd " + TERMUX_HOME + " && setsid bash " + TERMUX_HOME + "/start-dsh.sh >/dev/null 2>&1 < /dev/null &";
        tr = TermuxExec.sh(this, startCmd, 20000);
        log("[11/12] 启动命令已下发");

        // m. poll 3080
        log("[12/12] 等待 DSH web 端口就绪（最长 90 秒）…");
        setStatus("等待 DSH web 就绪…");
        if (!tcpReady(3080, 90000)) {
            log("[warn] 60 秒内未检测到 3080 端口，DSH 可能仍在启动，请稍后手动点“打开 DSH 界面”。");
        } else {
            log("[12/12] DSH web 已就绪 ✓");
        }
    }

    // ---- helpers ----

    private void pmInstall(File apk) throws Exception {
        long size = apk.length();
        byte[] data = readFully(apk);
        log("  pm install " + apk.getName() + " (" + (size / 1024 / 1024) + " MB)…");
        ShizukuExec.Result r = ShizukuExec.exec("pm install -r -S " + size, data, 300000);
        String combined = r.out + r.err;
        if (r.code != 0 || combined.contains("Failure") || combined.contains("Error")) {
            throw new Exception("pm install " + apk.getName() + " 失败: " + combined.trim());
        }
        log("  " + apk.getName() + " 安装成功");
    }

    private void pmInstallQuiet(File apk) {
        try { pmInstall(apk); } catch (Exception e) { log("[warn] " + e.getMessage()); }
    }

    private boolean bootstrapReady() {
        try {
            ShizukuExec.Result r = runAs("test -x /data/data/com.termux/files/usr/bin/sh && echo READY", 20000);
            return r.code == 0 && r.out.contains("READY");
        } catch (Exception e) {
            return false;
        }
    }

    private ShizukuExec.Result runAs(String inner, int timeoutMs) throws Exception {
        return ShizukuExec.exec("run-as com.termux sh -c '" + inner.replace("'", "'\''") + "'", timeoutMs);
    }

    private boolean isPkgInstalled(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        try {
                            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 9002);
                        } catch (Throwable ignored) {}
                    }
                });
            }
        }
    }

    private boolean ensureRunCommandPermission() throws Exception {
        if (Build.VERSION.SDK_INT < 23) return true;
        if (checkSelfPermission(RUN_COMMAND_PERM) == PackageManager.PERMISSION_GRANTED) return true;
        log("  需要授予“在 Termux 环境中运行命令”权限（弹窗请允许）…");
        setStatus("请在权限弹窗点允许");
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try { requestPermissions(new String[]{RUN_COMMAND_PERM}, 9001); } catch (Throwable ignored) {}
            }
        });
        for (int i = 0; i < 120; i++) {
            if (checkSelfPermission(RUN_COMMAND_PERM) == PackageManager.PERMISSION_GRANTED) return true;
            sleep(1000);
        }
        return false;
    }

    private void offerInstallShizuku() {
        File apk = new File(getFilesDir(), "shizuku.apk");
        if (!apk.exists()) { log("  shizuku.apk 缺失"); return; }
        Uri uri = Uri.parse("content://" + ApkProvider.AUTHORITY + "/shizuku.apk");
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); } catch (Exception e) { log("  无法打开安装器: " + e.getMessage()); }
    }

    private String buildSelfExtract(File payloadDir) throws Exception {
        StringBuilder sb = new StringBuilder();
        sb.append("H=").append(TERMUX_HOME).append("\n");
        sb.append("set -e\n");
        sb.append("mkdir -p $H/plugin/lib\n");
        String[] rel = {
            "setup-shizuku.sh", "start-dsh.sh", "patch-dsh.mjs", "cordis.patch.yml", "boot-dsh-shizuku.sh",
            "plugin/index.js", "plugin/package.json", "plugin/cordis.patch.yml", "plugin/lib/client.js"
        };
        int k = 0;
        for (String r : rel) {
            File f = new File(payloadDir, r);
            byte[] data = readFully(f);
            String b64 = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
            String d = "DSH_B64_" + (k++);
            sb.append("base64 -d << '").append(d).append("' > $H/").append(r).append("\n");
            sb.append(b64).append('\n');
            sb.append(d).append('\n');
        }
        sb.append("chmod +x $H/setup-shizuku.sh $H/start-dsh.sh $H/boot-dsh-shizuku.sh $H/patch-dsh.mjs 2>/dev/null || true\n");
        return sb.toString();
    }

    private boolean tcpReady(int port, int timeoutMs) {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress("127.0.0.1", port), 1500);
                return true;
            } catch (Exception e) {
                sleep(2500);
            }
        }
        return false;
    }

    private static String detail(TermuxExec.Result r) {
        StringBuilder sb = new StringBuilder();
        if (r.errmsg != null && !r.errmsg.isEmpty()) sb.append(r.errmsg).append(" | ");
        if (!r.stderr.isEmpty()) sb.append(r.stderr).append(" | ");
        if (!r.stdout.isEmpty()) sb.append(r.stdout);
        return sb.toString().trim();
    }

    private static String shq(String s) {
        return "'" + s.replace("'", "'\''") + "'";
    }

    private static String genToken() {
        SecureRandom rnd = new SecureRandom();
        StringBuilder sb = new StringBuilder(32);
        String hex = "0123456789abcdef";
        for (int i = 0; i < 32; i++) sb.append(hex.charAt(rnd.nextInt(16)));
        return sb.toString();
    }

    private static byte[] readFully(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[64 * 1024];
            int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            return buf.toByteArray();
        }
    }

    private static void writeString(File f, String s) throws Exception {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(s.getBytes("UTF-8"));
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }
}
