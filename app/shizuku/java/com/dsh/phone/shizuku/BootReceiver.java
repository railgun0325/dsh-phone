package com.dsh.phone.shizuku;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restart the bridge foreground service after reboot. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            BridgeService.start(context);
        }
    }
}
