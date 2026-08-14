package com.dsh.phone.shizuku;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Minimal HTTP/1.1 bridge on 127.0.0.1:36527.
 *
 * Android's runtime does NOT ship com.sun.net.httpserver, so this is a plain
 * ServerSocket implementation of the plugin protocol:
 *   GET  /health            -> {"ok":true}
 *   POST /exec              -> headers X-DSH-Token / X-DSH-Cmd / X-DSH-Timeout(Ms),
 *                              body = stdin bytes, response {"ok","exitCode","stdout","stderr"}.
 */
public final class BridgeHttp {

    public static final int PORT = 36527;

    private final File tokenFile;
    private volatile ServerSocket server;
    private Thread thread;

    public BridgeHttp(File tokenFile) { this.tokenFile = tokenFile; }

    public synchronized void start() {
        if (thread != null && thread.isAlive()) return;
        thread = new Thread(new Runnable() {
            @Override public void run() { loop(); }
        }, "dsh-bridge");
        thread.setDaemon(true);
        thread.start();
    }

    public synchronized void stop() {
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        server = null;
    }

    private void loop() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                server = new ServerSocket();
                server.setReuseAddress(true);
                server.bind(new InetSocketAddress("127.0.0.1", PORT));
                while (true) {
                    final Socket s = server.accept();
                    Thread t = new Thread(new Runnable() {
                        @Override public void run() { handle(s); }
                    }, "dsh-bridge-conn");
                    t.setDaemon(true);
                    t.start();
                }
            } catch (Exception e) {
                try { if (server != null) server.close(); } catch (Exception ignored) {}
                server = null;
                try { Thread.sleep(1000); } catch (InterruptedException ie) { return; }
            }
        }
    }

    private void handle(Socket s) {
        try (Socket c = s) {
            c.setSoTimeout(30000);
            InputStream in = c.getInputStream();
            OutputStream out = c.getOutputStream();
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String path = parts[1];
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    headers.put(line.substring(0, idx).trim().toLowerCase(Locale.ROOT),
                            line.substring(idx + 1).trim());
                }
            }
            if ("GET".equals(method) && "/health".equals(path)) {
                respond(out, 200, "{\"ok\":true}");
                return;
            }
            if ("POST".equals(method) && "/exec".equals(path)) {
                handleExec(in, out, headers);
                return;
            }
            respond(out, 404, "{\"ok\":false}");
        } catch (Exception ignored) {}
    }

    private void handleExec(InputStream in, OutputStream out, Map<String, String> headers) throws Exception {
        String expected = readToken();
        String token = headers.get("x-dsh-token");
        if (expected.isEmpty() || token == null || !token.equals(expected)) {
            respond(out, 401, j(false, -1, "", "unauthorized"));
            return;
        }
        String cmd = headers.get("x-dsh-cmd");
        if (cmd == null || cmd.isEmpty()) {
            respond(out, 400, j(false, -1, "", "missing X-DSH-Cmd"));
            return;
        }
        int timeout = 120000;
        String ts = headers.get("x-dsh-timeout-ms");
        if (ts == null) ts = headers.get("x-dsh-timeout");
        if (ts != null) {
            try { timeout = Integer.parseInt(ts.trim()); } catch (Exception ignored) {}
        }
        if (timeout <= 0) timeout = 120000;
        if (timeout > 300000) timeout = 300000;

        byte[] body = readBody(in, headers);
        try {
            ShizukuExec.Result r = ShizukuExec.exec(cmd, body, timeout);
            respond(out, 200, j(r.code == 0, r.code, r.out, r.err));
        } catch (Exception e) {
            respond(out, 200, j(false, -1, "", "exec failed: " + (e.getMessage() == null ? e.toString() : e.getMessage())));
        }
    }

    private String readToken() {
        try {
            byte[] b = new byte[(int) tokenFile.length()];
            try (FileInputStream f = new FileInputStream(tokenFile)) {
                int off = 0;
                while (off < b.length) {
                    int n = f.read(b, off, b.length - off);
                    if (n < 0) break;
                    off += n;
                }
            }
            return new String(b, StandardCharsets.UTF_8).trim();
        } catch (Exception e) { return ""; }
    }

    private byte[] readBody(InputStream in, Map<String, String> headers) throws IOException {
        int len = 0;
        String cl = headers.get("content-length");
        if (cl != null) { try { len = Integer.parseInt(cl.trim()); } catch (Exception ignored) {} }
        if (len <= 0) return new byte[0];
        ByteArrayOutputStream buf = new ByteArrayOutputStream(len);
        byte[] b = new byte[8192];
        int remaining = len;
        while (remaining > 0) {
            int n = in.read(b, 0, Math.min(b.length, remaining));
            if (n < 0) break;
            buf.write(b, 0, n);
            remaining -= n;
        }
        return buf.toByteArray();
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') buf.write(c);
        }
        if (c < 0 && buf.size() == 0) return null;
        return buf.toString("UTF-8");
    }

    private static void respond(OutputStream out, int status, String body) throws IOException {
        String reason = status == 200 ? "OK" : status == 401 ? "Unauthorized" : status == 400 ? "Bad Request" : "Not Found";
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        h.append("Content-Type: application/json; charset=utf-8\r\n");
        h.append("Content-Length: ").append(b.length).append("\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.US_ASCII));
        out.write(b);
        out.flush();
    }

    private static String j(boolean ok, int exitCode, String stdout, String stderr) {
        return "{\"ok\":" + ok + ",\"exitCode\":" + exitCode
                + ",\"stdout\":\"" + esc(stdout) + "\",\"stderr\":\"" + esc(stderr) + "\"}";
    }

    private static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
                    else b.append(ch);
            }
        }
        return b.toString();
    }
}
