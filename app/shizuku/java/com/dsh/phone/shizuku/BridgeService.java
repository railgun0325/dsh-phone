package com.dsh.phone.shizuku;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import java.io.File;

/**
 * Foreground service hosting the local Shizuku bridge (127.0.0.1:36527).
 * Runs in the app main process; START_STICKY keeps it alive; BOOT_COMPLETED
 * restarts it. Exec requests are served by {@link BridgeHttp} -> {@link ShizukuExec}.
 */
public class BridgeService extends Service {

    private static final String CHANNEL_ID = "dsh_bridge";
    private static final int NOTIF_ID = 36527;

    private BridgeHttp bridge;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForegroundCompat();
        if (bridge == null) {
            bridge = new BridgeHttp(new File(getFilesDir(), "bridge-token"));
        }
        bridge.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (bridge != null) bridge.stop();
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                    "DSH 桥", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shizuku 本地桥（127.0.0.1:36527）");
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void startForegroundCompat() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private Notification buildNotification() {
        Intent i = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, i, flags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(this, CHANNEL_ID);
        } else {
            b = new Notification.Builder(this);
        }
        return b.setContentTitle("DSH 桥运行中")
                .setContentText("安卓操控桥已就绪（Shizuku）")
                .setSmallIcon(android.R.drawable.ic_menu_manage)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
    }

    public static void start(android.content.Context ctx) {
        Intent s = new Intent(ctx, BridgeService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(s);
            } else {
                ctx.startService(s);
            }
        } catch (Exception ignored) {}
    }
}
