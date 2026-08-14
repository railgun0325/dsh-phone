package com.dsh.phone.common;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Full-screen shell for the on-device DSH web UI at http://127.0.0.1:3080. */
public class WebActivity extends Activity {
    private static final String DSH_URL = "http://127.0.0.1:3080/";
    private WebView web;

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
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                view.loadData("<html><body style='font-family:sans-serif;padding:2em;color:#333'>"
                        + "<h3>DSH 还没起来</h3>"
                        + "<p>本页从 <code>http://127.0.0.1:3080</code> 加载。请回到部署页检查日志，"
                        + "确认服务已启动（可能需要几秒钟），然后重新打开。</p>"
                        + "</body></html>", "text/html", "UTF-8");
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.loadUrl(DSH_URL);
        setContentView(web);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
