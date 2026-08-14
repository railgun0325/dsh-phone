package com.dsh.phone.common;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import java.net.InetSocketAddress;
import java.net.Socket;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * One-tap deployment wizard base.
 *
 * UX contract: no title bar; the API key is stored in local SharedPreferences
 * after the first successful deploy and prefilled afterwards; when DSH is already
 * running on 127.0.0.1:3080 the shell opens immediately; after a successful deploy
 * the shell opens automatically — there is no manual "open" button.
 */
public abstract class WizardActivity extends Activity {
    private static final String PREFS = "dsh_phone";
    private static final String KEY_API = "api_key";

    protected TextView statusView;
    protected TextView logView;
    protected EditText keyInput;
    protected Button deployBtn;
    private final StringBuilder logBuf = new StringBuilder();
    private boolean deploying = false;

    /** Short mode label, e.g. "Root 版" / "Shizuku 版". */
    protected abstract String modeLabel();

    /** Deploy on a background thread. Throwing reports failure and ends the run. */
    protected abstract void doDeploy(String apiKey) throws Exception;

    /** WebView shell activity, opened automatically once DSH is reachable. */
    protected abstract Class<?> shellActivityClass();

    protected SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /** Blocking TCP probe of the on-device DSH port. */
    protected boolean dshReachable(int timeoutMs) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", 3080), timeoutMs);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Open the WebView shell. */
    protected void openShell() {
        try {
            Intent i = new Intent(this, shellActivityClass());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(i);
        } catch (Exception ignored) {}
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // No system action bar; the custom content fills the window.
        try { requestWindowFeature(Window.FEATURE_NO_TITLE); } catch (Exception ignored) {}

        LinearLayout root = Ui.vbox(this);

        statusView = Ui.text(this, "状态：等待开始", 14, false);
        statusView.setTextColor(Color.parseColor("#4460A5"));
        root.addView(statusView, lp(0, 4, 0, 10));

        TextView keyLabel = Ui.text(this, "DeepSeek API Key（sk-…，只需填一次）", 13, true);
        root.addView(keyLabel, lp());
        keyInput = Ui.edit(this, "粘贴你的 DeepSeek API Key", true);
        // Prefill the key stored after the first successful deploy.
        String saved = prefs().getString(KEY_API, null);
        if (saved != null && !saved.isEmpty()) keyInput.setText(saved);
        root.addView(keyInput, lp());
        TextView keyHint = Ui.text(this, "Key 只保存在本机 App 与 Termux 环境里，不内置、不上传、不进安装包。", 11, false);
        keyHint.setTextColor(Color.parseColor("#888888"));
        root.addView(keyHint, lp(0, 2, 0, 8));

        deployBtn = Ui.button(this, "一键部署");
        root.addView(deployBtn, lp(0, 4, 0, 8));
        deployBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startDeploy();
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

        // If DSH is already running (e.g. after a reboot + Termux:Boot), skip the
        // wizard entirely and go straight to the shell.
        if (dshReachable(1500)) {
            openShell();
        }
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
                boolean ok = false;
                try {
                    doDeploy(key);
                    // First successful deploy persists the key locally (device-only).
                    prefs().edit().putString(KEY_API, key).apply();
                    ok = true;
                    setStatus("部署完成，正在打开界面…");
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
                if (ok) openShell();
            }
        }, "dsh-deploy").start();
    }
}
