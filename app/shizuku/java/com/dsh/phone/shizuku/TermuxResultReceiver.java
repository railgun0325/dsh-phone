package com.dsh.phone.shizuku;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** Receives RUN_COMMAND results delivered via PendingIntent. */
public class TermuxResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle result = intent == null ? null : intent.getBundleExtra(TermuxExec.RESULT_BUNDLE);
        TermuxExec.deliver(result);
    }
}
