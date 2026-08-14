package com.dsh.phone.common;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * One-tap deployment wizard base.
 *
 * Flavor activities extend this and implement:
 *   doDeploy(apiKey)   — runs on a background thread; report progress with log()/setStatus().
 *   shellActivityClass — the WebView shell to open when the user taps "打开 DSH".
 */
public abstract class WizardActivity extends Activity {
    protected TextView statusView;
    protected TextView logView;
    protected EditText keyInput;
    protected Button deployBtn;
    protected Button openBtn;
    private final StringBuilder logBuf = new StringBuilder();
    private boolean deploying = false;

    /** Heading shown above the status line. */
    protected abstract String title();

    /** Short mode label, e.g. "Root 版" / "Shizuku 版". */
    protected abstract String modeLabel();

    /** Deploy on a background thread. Throwing reports failure and ends the run. */
    protected abstract void doDeploy(String apiKey) throws Exception;

    /** WebView shell activity opened by the "打开 DSH" button (and after success). */
    protected abstract Class<?> shellActivityClass();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = Ui.vbox(this);

        TextView titleView = Ui.text(this, title(), 22, true);
        root.addView(titleView, lp());

        statusView = Ui.text(this, "状态：等待开始", 14, false);
        statusView.setTextColor(Color.parseColor("#4460A5"));
        root.addView(statusView, lp(0, 10, 0, 10));

        TextView keyLabel = Ui.text(this, "DeepSeek API Key（sk-…）", 13, true);
        root.addView(keyLabel, lp());
        keyInput = Ui.edit(this, "粘贴你的 DeepSeek API Key", true);
        root.addView(keyInput, lp());
        TextView keyHint = Ui.text(this, "Key 只写进手机本机的 Termux 环境，不内置、不上传、不进安装包。", 11, false);
        keyHint.setTextColor(Color.parseColor("#888888"));
        root.addView(keyHint, lp(0, 2, 0, 8));

        deployBtn = Ui.button(this, "一键部署");
        root.addView(deployBtn, lp(0, 4, 0, 4));
        deployBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startDeploy();
            }
        });

        openBtn = Ui.button(this, "打开 DSH 界面");
        root.addView(openBtn, lp(0, 4, 0, 8));
        openBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent i = new Intent(WizardActivity.this, shellActivityClass());
                startActivity(i);
            }
        });

        logView = Ui.text(this, "日志将显示在这里。", 11, false);
        logView.setTypeface(Typeface.MONOSPACE);
        logView.setTextIsSelectable(true);
        ScrollView logScroll = Ui.logScroll(this, logView);
        logScroll.setBackgroundColor(Color.parseColor("#F5F7FA"));
        root.addView(logScroll, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
    }

    private LinearLayout.LayoutParams lp() {
        return lp(0, 4, 0, 4);
    }

    private LinearLayout.LayoutParams lp(int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMargins(l, t, r, b);
        return p;
    }

    protected void setStatus(String s) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                statusView.setText("状态：" + s);
            }
        });
    }

    protected void log(String msg) {
        final String line = msg + "\n";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                logBuf.append(line);
                if (logBuf.length() > 60000) logBuf.delete(0, logBuf.length() - 60000);
                logView.setText(logBuf.toString());
            }
        });
    }

    protected boolean isDeploying() {
        return deploying;
    }

    private void startDeploy() {
        if (deploying) return;
        final String key = keyInput.getText().toString().trim();
        if (key.isEmpty()) {
            setStatus("请先粘贴 API Key");
            return;
        }
        if (!key.startsWith("sk-")) {
            setStatus("Key 看起来不对（应以 sk- 开头），已继续部署");
        }
        deploying = true;
        deployBtn.setEnabled(false);
        logBuf.setLength(0);
        logView.setText("");
        log("=== " + modeLabel() + " 一键部署开始 ===");
        setStatus("部署中…");
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    doDeploy(key);
                    setStatus("部署完成 ✓");
                    log("[done] 部署完成，可以打开 DSH 界面了");
                } catch (Exception e) {
                    log("[error] " + (e.getMessage() == null ? e.toString() : e.getMessage()));
                    setStatus("部署失败，请查看日志");
                } finally {
                    deploying = false;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            deployBtn.setEnabled(true);
                        }
                    });
                }
            }
        }, "dsh-deploy").start();
    }
}
