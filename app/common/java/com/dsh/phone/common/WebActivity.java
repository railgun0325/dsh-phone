package com.dsh.phone.common;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Full-screen shell for the on-device DSH web UI at http://127.0.0.1:3080.
 *
 * <p>Loading that URL is not a single-shot operation. dsh web needs 20-30s to bind
 * 3080 (node boot + plugin tree), the wizard restarts it on resume, and MIUI happily
 * kills it in the background — so a plain {@code loadUrl} + "show something dead on
 * error" parks the user on a blank page that never comes back (the "DSH 还没起来"
 * white screen reported on 2026-09-14). This activity therefore:
 *
 * <ol>
 *   <li>retries a failed <em>main frame</em> load a few times with backoff;</li>
 *   <li>then shows a placeholder and watches the port from Java, reloading the real
 *       UI the moment 3080 accepts a connection again;</li>
 *   <li>reloads when the shell is entered again (launcher tap -&gt; MainActivity -&gt;
 *       openShell), so a resumed instance never keeps showing an old page.</li>
 * </ol>
 */
public class WebActivity extends Activity {
    private static final String DSH_URL = "http://127.0.0.1:3080/";
    private static final int HOST_PORT = 3080;
    /** Fast in-WebView retries before falling back to the port probe. */
    private static final int RETRY_LIMIT = 4;
    private static final long PROBE_INTERVAL_MS = 2000;
    private static final int REQ_FILE_CHOOSER = 4701;

    private WebView web;
    private int retries = 0;
    private volatile boolean destroyed = false;
    private Thread probeThread;
    /** Live <input type=file> callback; the picker result arrives asynchronously. */
    private ValueCallback<Uri[]> filePathCallback;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable reload = new Runnable() {
        @Override
        public void run() {
            if (!destroyed) web.loadUrl(DSH_URL);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith(DSH_URL)) retries = 0;
            }

            // Deprecated overload, but it is the one that still reports a failed
            // *main frame* across every API level we ship; the WebResourceRequest
            // overload below fires for subresources as well, so it is filtered.
            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl == null || failingUrl.startsWith(DSH_URL)) onShellUnreachable();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) onShellUnreachable();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            /**
             * The DSH composer's "添加附件" button clicks a hidden
             * {@code <input type="file">}. A WebView only surfaces that as a chooser
             * when the host answers here — with a bare WebChromeClient the click is a
             * silent no-op, which is exactly what the phone showed.
             */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                Intent intent = null;
                try {
                    intent = params.createIntent();
                } catch (Exception ignored) {
                    intent = null;
                }
                if (intent == null) {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                }
                // Files reach the WebView as content:// URIs, so it only needs read
                // access to the one the user picked; no storage permission involved.
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });
        web.loadUrl(DSH_URL);
        setContentView(web);

        // Android 13+: predictive back replaces onBackPressed.
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                new android.window.OnBackInvokedCallback() {
                    @Override
                    public void onBackInvoked() {
                        moveTaskToBack(true);
                    }
                });
        }
    }

    /** 3080 refused the load: back off a few times, then poll the port from Java. */
    private void onShellUnreachable() {
        handler.removeCallbacks(reload);
        if (retries < RETRY_LIMIT) {
            retries++;
            long delay = Math.min(1000L << Math.min(retries, 2), 4000L);   // 2s, 4s, 4s, 4s
            handler.postDelayed(reload, delay);
            return;
        }
        showWaitingPage();
        startPortProbe();
    }

    /**
     * Placeholder that needs no navigation tricks: the real UI is loaded by
     * {@link #startPortProbe()} as soon as the server is actually listening.
     */
    private void showWaitingPage() {
        if (destroyed) return;
        web.loadData("<html><body style='font-family:sans-serif;padding:2em;color:#333'>"
            + "<h3>DSH 正在启动…</h3>"
            + "<p>正在等待 <code>http://127.0.0.1:3080</code> 就绪，就绪后本页会自动进入界面。"
            + "若长时间停在这里，回到部署页查看日志（Termux 内 <code>~/dsh-web.log</code>）。</p>"
            + "</body></html>", "text/html", "UTF-8");
    }

    private void startPortProbe() {
        if (probeThread != null && probeThread.isAlive()) return;
        probeThread = new Thread(new Runnable() {
            @Override
            public void run() {
                while (!destroyed) {
                    try {
                        Thread.sleep(PROBE_INTERVAL_MS);
                    } catch (InterruptedException e) {
                        return;
                    }
                    if (portOpen()) {
                        handler.post(new Runnable() {
                            @Override
                            public void run() {
                                if (destroyed) return;
                                retries = 0;
                                web.loadUrl(DSH_URL);
                            }
                        });
                        return;
                    }
                }
            }
        }, "dsh-port-probe");
        probeThread.setDaemon(true);
        probeThread.start();
    }

    private static boolean portOpen() {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress("127.0.0.1", HOST_PORT), 1000);
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            try { socket.close(); } catch (Exception ignored) {}
        }
    }

    /**
     * Entering the shell again must show live state: MainActivity probes 3080 and
     * then calls openShell(), which lands here as a new intent on the existing
     * instance rather than a fresh onCreate.
     */
    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        retries = 0;
        handler.removeCallbacks(reload);
        web.loadUrl(DSH_URL);
    }

    /**
     * Deliver the system picker's result to the waiting {@code <input type="file">}.
     * A cancelled picker must still answer (with null), otherwise the page's input
     * stays armed forever and every later tap is swallowed.
     */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacks(reload);
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        super.onDestroy();
    }

    // Back / swipe-back goes home instead of falling back to the deploy
    // wizard; the shell stays in the task and next launch resumes it.
    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }
}
