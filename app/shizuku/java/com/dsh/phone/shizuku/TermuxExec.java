package com.dsh.phone.shizuku;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * RUN_COMMAND intent executor (termux-app v0.118.3).
 *
 * Result comes back through a PendingIntent broadcast; the receiver
 * ({@link TermuxResultReceiver}) writes the result bundle here. Commands are
 * issued strictly sequentially during deployment, so a single slot suffices.
 */
public final class TermuxExec {

    public static final String ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND";
    public static final String RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService";

    public static final String EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH";
    public static final String EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS";
    public static final String EXTRA_STDIN = "com.termux.RUN_COMMAND_STDIN";
    public static final String EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR";
    public static final String EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND";
    public static final String EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT";

    // Result bundle keys (termux-shared ResultSender / PluginUtils).
    public static final String RESULT_BUNDLE = "result";
    public static final String RESULT_STDOUT = "stdout";
    public static final String RESULT_STDERR = "stderr";
    public static final String RESULT_EXIT_CODE = "exitCode";
    public static final String RESULT_ERR = "err";
    public static final String RESULT_ERRMSG = "errmsg";

    public static final String TERMUX_SH = "/data/data/com.termux/files/usr/bin/sh";
    public static final String TERMUX_BASH = "/data/data/com.termux/files/usr/bin/bash";
    public static final String TERMUX_HOME = "/data/data/com.termux/files/home";

    public static final class Result {
        public final boolean delivered;
        public final int exitCode;
        public final int errCode;
        public final String stdout;
        public final String stderr;
        public final String errmsg;
        Result(boolean d, int c, int e, String o, String er, String m) {
            delivered = d; exitCode = c; errCode = e; stdout = o; stderr = er; errmsg = m;
        }
        public boolean ok() { return delivered && exitCode == 0; }
    }

    private static final Object LOCK = new Object();
    private static CountDownLatch latch;
    private static Bundle pendingResult;

    static void deliver(Bundle resultBundle) {
        synchronized (LOCK) {
            pendingResult = resultBundle;
            if (latch != null) latch.countDown();
        }
    }

    public static Result exec(Context ctx, String commandPath, String[] args, String stdin,
                              String workdir, boolean background, int timeoutMs) {
        synchronized (LOCK) {
            latch = new CountDownLatch(1);
            pendingResult = null;
        }
        try {
            Intent i = new Intent(ACTION_RUN_COMMAND);
            i.setComponent(new ComponentName("com.termux", RUN_COMMAND_SERVICE));
            i.putExtra(EXTRA_COMMAND_PATH, commandPath);
            if (args != null) i.putExtra(EXTRA_ARGUMENTS, args);
            if (stdin != null) i.putExtra(EXTRA_STDIN, stdin);
            if (workdir != null) i.putExtra(EXTRA_WORKDIR, workdir);
            i.putExtra(EXTRA_BACKGROUND, background);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 0,
                    new Intent(ctx, TermuxResultReceiver.class), flags);
            i.putExtra(EXTRA_PENDING_INTENT, pi);

            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
                else ctx.startService(i);
            } catch (Exception e) {
                return new Result(false, -1, -1, "", "", "startService failed: " + e);
            }

            boolean got;
            try {
                got = latch.await(timeoutMs, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                return new Result(false, -1, -1, "", "", "interrupted");
            }
            if (!got) {
                return new Result(false, -1, -1, "", "", "[timeout after " + timeoutMs + "ms]");
            }

            Bundle b;
            synchronized (LOCK) { b = pendingResult; }
            if (b == null) {
                return new Result(false, -1, -1, "", "", "no result bundle");
            }
            String out = b.getString(RESULT_STDOUT);
            String err = b.getString(RESULT_STDERR);
            int exit = b.getInt(RESULT_EXIT_CODE, -1);
            int errCode = b.getInt(RESULT_ERR, -1);
            String errmsg = b.getString(RESULT_ERRMSG);
            return new Result(true, exit, errCode,
                    out == null ? "" : out, err == null ? "" : err, errmsg);
        } finally {
            synchronized (LOCK) { latch = null; }
        }
    }

    /** Run a shell one-liner in Termux (background mode, clean stdout/stderr). */
    public static Result sh(Context ctx, String script, int timeoutMs) {
        return exec(ctx, TERMUX_SH, new String[]{"-c", script}, null, TERMUX_HOME, true, timeoutMs);
    }
}
