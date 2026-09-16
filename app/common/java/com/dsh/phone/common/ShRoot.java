package com.dsh.phone.common;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.TimeUnit;

/** Root shell helper (Magisk/Kitsune/APatch/KernelSU su). Used by the root-flavor deployer. */
public final class ShRoot {
    private ShRoot() {}

    public static final class Result {
        public final int code;
        public final String out;
        Result(int code, String out) { this.code = code; this.out = out; }
    }

    // HyperOS/MIUI runs each app in a private mount namespace: /data/data there
    // is a tmpfs showing only the app's own dir, so a plain `su -c` (which
    // inherits the caller's namespace) cannot see /data/data/com.termux at all
    // (stat -> ENOENT). Magisk-family su supports --mount-master to run in the
    // global namespace instead. Probe once; fall back to plain su when the
    // flag is rejected (unknown flag => non-zero exit) or silently ignored.
    private static volatile boolean mmProbed = false;
    private static volatile boolean mmWorks = false;

    private static synchronized boolean useMountMaster() {
        if (!mmProbed) {
            Result r = run(new String[]{"su", "--mount-master", "-c",
                "ls -1 /data/data | wc -l"}, 8000);
            try {
                mmWorks = r.code == 0 && Integer.parseInt(r.out.trim()) > 5;
            } catch (NumberFormatException e) {
                mmWorks = false;
            }
            mmProbed = true;
        }
        return mmWorks;
    }

    /** True when su answers 'id' with uid=0. */
    public static boolean available() {
        Result r = exec("id", 8000);
        return r != null && r.code == 0 && r.out.contains("uid=0");
    }

    /** Run cmd through su (as root). */
    public static Result exec(String cmd, int timeoutMs) {
        return useMountMaster()
            ? run(new String[]{"su", "--mount-master", "-c", cmd}, timeoutMs)
            : run(new String[]{"su", "-c", cmd}, timeoutMs);
    }

    /** Run cmd through su as the given numeric uid (e.g. the Termux app uid). */
    public static Result execAs(String uid, String cmd, int timeoutMs) {
        return useMountMaster()
            ? run(new String[]{"su", "--mount-master", uid, "-c", cmd}, timeoutMs)
            : run(new String[]{"su", uid, "-c", cmd}, timeoutMs);
    }

    /**
     * True when a failed su was REFUSED by the superuser manager rather than absent.
     * Magisk/Kitsune answer "Permission denied" for a uid whose stored policy is deny
     * (this app's uid had exactly that after an update), and that is the difference
     * between "install Magisk" and "flip one switch in the Magisk app" — worth
     * reporting separately instead of the generic "未检测到 root".
     */
    public static boolean denied(Result r) {
        if (r == null || r.code == 0) return false;
        String out = r.out == null ? "" : r.out.toLowerCase();
        return out.contains("permission denied")
            || out.contains("not allowed")
            || out.contains("superuser")
            || out.contains("拒绝")
            || out.contains("授权");
    }

    /** Operator-facing fix for {@link #denied}: exactly where to flip the switch. */
    public static String deniedHint(Result r) {
        String detail = r == null || r.out == null ? "" : r.out.trim();
        if (detail.length() > 200) detail = detail.substring(0, 200);
        return "超级用户权限被拒绝（" + detail + "）。请打开 Magisk → 底栏「超级用户」→ 找到 DSH Phone"
            + " → 打开右侧开关（设为「允许」并勾选记住），再回到本页重新点一键部署。"
            + "也可在 Magisk 设置里确认没有开启 SuList/白名单模式。";
    }

    private static Result run(String[] argv, int timeoutMs) {
        try {
            Process p = new ProcessBuilder(argv).redirectErrorStream(true).start();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            Thread pump = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        InputStream in = p.getInputStream();
                        byte[] b = new byte[8192];
                        int n;
                        while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                    } catch (Exception ignored) {}
                }
            });
            pump.start();
            if (!p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) {
                p.destroyForcibly();
                p.waitFor(2, TimeUnit.SECONDS);
                pump.join(2000);
                return new Result(-1, buf.toString() + "\n[timeout after " + timeoutMs + "ms]");
            }
            pump.join(2000);
            return new Result(p.exitValue(), buf.toString());
        } catch (Exception e) {
            return new Result(-1, "su exec failed: " + e);
        }
    }
}
