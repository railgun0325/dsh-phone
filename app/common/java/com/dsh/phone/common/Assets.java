package com.dsh.phone.common;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Extract APK assets (recursively) into the app's files dir. */
public final class Assets {
    private Assets() {}

    /** Copy assetDir (recursive) to outDir. Returns the number of files written. */
    public static int extract(Context ctx, String assetDir, File outDir) throws IOException {
        AssetManager am = ctx.getAssets();
        return extractInto(am, assetDir, outDir);
    }

    private static int extractInto(AssetManager am, String assetDir, File outDir) throws IOException {
        int count = 0;
        String[] names = am.list(assetDir);
        if (names == null || names.length == 0) {
            // leaf file
            if (!outDir.getParentFile().exists() && !outDir.getParentFile().mkdirs()) {
                throw new IOException("mkdir failed: " + outDir.getParentFile());
            }
            InputStream in = null;
            OutputStream out = null;
            try {
                in = am.open(assetDir);
                out = new FileOutputStream(outDir);
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                count = 1;
            } finally {
                if (in != null) in.close();
                if (out != null) out.close();
            }
            return count;
        }
        for (String n : names) {
            String child = assetDir + "/" + n;
            count += extractInto(am, child, new File(outDir, n));
        }
        return count;
    }
}
