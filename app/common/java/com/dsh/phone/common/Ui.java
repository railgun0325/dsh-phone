package com.dsh.phone.common;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Minimal view builders; the project intentionally avoids androidx/Gradle. */
public final class Ui {
    private Ui() {}

    public static LinearLayout vbox(Context ctx) {
        LinearLayout v = new LinearLayout(ctx);
        v.setOrientation(LinearLayout.VERTICAL);
        v.setPadding(dp(ctx, 16), dp(ctx, 16), dp(ctx, 16), dp(ctx, 16));
        return v;
    }

    public static TextView text(Context ctx, String s, float sp, boolean bold) {
        TextView t = new TextView(ctx);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(Color.parseColor("#1F2430"));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    public static EditText edit(Context ctx, String hint, boolean password) {
        EditText e = new EditText(ctx);
        e.setHint(hint);
        e.setTextSize(14);
        e.setSingleLine(true);
        if (password) {
            e.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        }
        return e;
    }

    public static Button button(Context ctx, String label) {
        Button b = new Button(ctx);
        b.setText(label);
        b.setAllCaps(false);
        return b;
    }

    public static ScrollView logScroll(Context ctx, TextView log) {
        ScrollView s = new ScrollView(ctx);
        LinearLayout wrap = new LinearLayout(ctx);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.addView(log);
        s.addView(wrap, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
        return s;
    }

    public static int dp(Context ctx, float v) {
        return (int) (v * ctx.getResources().getDisplayMetrics().density + 0.5f);
    }
}
