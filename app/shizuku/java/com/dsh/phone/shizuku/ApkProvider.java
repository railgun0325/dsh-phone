package com.dsh.phone.shizuku;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Minimal FileProvider replacement (no androidx): serves files under getFilesDir()
 * (e.g. shizuku.apk) to the system package installer via a content:// URI.
 * Only reachable with a URI permission grant (exported=false + grantUriPermissions=true).
 */
public class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.dsh.phone.shizuku.apk";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("read only");
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..")) {
            throw new FileNotFoundException("invalid path");
        }
        File base = getContext().getFilesDir();
        File f = new File(base, name);
        try {
            if (!f.getCanonicalPath().startsWith(base.getCanonicalPath())) {
                throw new FileNotFoundException("invalid path");
            }
        } catch (Exception e) {
            throw new FileNotFoundException("invalid path");
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
