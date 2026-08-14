package com.dsh.phone.shizuku;

import android.content.pm.PackageManager;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.concurrent.TimeUnit;

import rikka.shizuku.Shizuku;
import rikka.shizuku.ShizukuRemoteProcess;

/**
 * Synchronous executor over Shizuku's adb-shell-level process API.
 *
 * NOTE (API 13.1.5 fact-check): {@code Shizuku.newProcess(String[], String[], String)}
 * is {@code private} in the published 13.1.5 jar (deprecated, planned for removal in
 * API 14; the UserService protocol is its replacement). To avoid the v13 UserService
 * handshake (app_process + ServiceStarter + destroy()=16777114 transaction), this class
 * invokes the private newProcess via reflection — it still works and returns a public
 * {@link ShizukuRemoteProcess} (a {@link Process}).
 */
public final class ShizukuExec {

    public static final class Result {
        public final int code;
        public final String out;
        public final String err;
        Result(int code, String out, String err) { this.code = code; this.out = out; this.err = err; }
        public boolean ok() { return code == 0; }
    }

    private ShizukuExec() {}

    public static boolean binderReady() {
        try { return Shizuku.pingBinder(); } catch (Throwable t) { return false; }
    }

    public static boolean hasPermission() {
        try {
            return Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) { return false; }
    }

    private static ShizukuRemoteProcess newProcess(String[] cmd) throws Exception {
        Method m = Shizuku.class.getDeclaredMethod("newProcess",
                String[].class, String[].class, String.class);
        m.setAccessible(true);
        return (ShizukuRemoteProcess) m.invoke(null, cmd, null, null);
    }

    /** Run {@code sh -c cmd} with optional stdin bytes; synchronous with timeout. */
    public static Result exec(String cmd, byte[] stdin, int timeoutMs) throws Exception {
        if (!binderReady()) {
            throw new IllegalStateException("Shizuku 未就绪（binder 未连接）");
        }
        String safeCmd = cmd.replaceAll("sk-[A-Za-z0-9]{6,}", "sk-***");
        android.util.Log.i("DSHDeploy", "exec[" + timeoutMs + "ms]: " + safeCmd.substring(0, Math.min(120, safeCmd.length())));
        ShizukuRemoteProcess p = newProcess(new String[]{"sh", "-c", cmd});
        InputStream in = p.getInputStream();
        InputStream errIn = p.getErrorStream();
        OutputStream os = p.getOutputStream();

        ByteArrayOutputStream outBuf = new ByteArrayOutputStream();
        ByteArrayOutputStream errBuf = new ByteArrayOutputStream();
        Thread outT = pump(in, outBuf);
        Thread errT = pump(errIn, errBuf);
        Thread feeder = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    if (stdin != null) os.write(stdin);
                } catch (Exception ignored) {
                } finally {
                    try { os.close(); } catch (Exception ignored) {}
                }
            }
        });
        feeder.start();

        // Poll exitValue instead of waitForTimeout: ShizukuRemoteProcess.waitForTimeout
        // has proven unreliable on fast-exiting processes (call never returns on some ROMs).
        int code = -1;
        boolean finished = false;
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            try {
                code = p.exitValue();
                finished = true;
                break;
            } catch (IllegalThreadStateException stillRunning) {
                try { Thread.sleep(100); } catch (InterruptedException ie) { break; }
            } catch (IllegalArgumentException stillRunning) {
                // ShizukuRemoteProcess.exitValue() throws IllegalArgumentException
                // ("process hasn't exited") instead of IllegalThreadStateException.
                try { Thread.sleep(100); } catch (InterruptedException ie) { break; }
            }
        }
        if (!finished) {
            try { p.destroy(); } catch (Throwable ignored) {}
            code = -1;
        }
        join(feeder); join(outT); join(errT);
        String out = outBuf.toString("UTF-8");
        String err = errBuf.toString("UTF-8");
        if (!finished) err = err + "\n[timeout after " + timeoutMs + "ms]";
        return new Result(code, out, err);
    }

    public static Result exec(String cmd, int timeoutMs) throws Exception {
        return exec(cmd, null, timeoutMs);
    }

    private static Thread pump(final InputStream in, final ByteArrayOutputStream buf) {
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    byte[] b = new byte[8192];
                    int n;
                    while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                } catch (Exception ignored) {}
            }
        });
        t.start();
        return t;
    }

    private static void join(Thread t) {
        try { t.join(2000); } catch (InterruptedException ignored) {}
    }
}
