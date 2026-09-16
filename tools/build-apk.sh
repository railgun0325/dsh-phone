#!/usr/bin/env bash
# build-apk.sh — Linux/CI port of app/<flavor>/build-apk.ps1.
# No Gradle, no AndroidX: aapt2 compile/link + javac + d8 + zipalign + apksigner.
#
# Usage: ANDROID_SDK_ROOT=/path/to/sdk bash tools/build-apk.sh <root|shizuku>
# Env:   VERSION_CODE (default 14), VERSION_NAME (default 0.2.10)
#        ANDROID_KEYSTORE_BASE64 — optional; decoded into apk/debug.keystore by CI
set -euo pipefail

FLAVOR=${1:-}
case "$FLAVOR" in root|shizuku) ;; *) echo "usage: $0 <root|shizuku>" >&2; exit 2 ;; esac

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
[ -n "$SDK" ] || { echo "set ANDROID_SDK_ROOT (or ANDROID_HOME)" >&2; exit 2; }
BT=$SDK/build-tools/34.0.0
PLAT=$SDK/platforms/android-34/android.jar
[ -f "$PLAT" ] || { echo "missing $PLAT — install platforms;android-34" >&2; exit 2; }
for t in aapt2 d8 zipalign apksigner; do
  [ -x "$BT/$t" ] || { echo "missing $BT/$t — install build-tools;34.0.0" >&2; exit 2; }
done
command -v javac >/dev/null || { echo "javac not on PATH (need JDK 17)" >&2; exit 2; }

VERSION_CODE=${VERSION_CODE:-14}
VERSION_NAME=${VERSION_NAME:-0.2.10}

ASSETS=$REPO/assets
OUT=$REPO/app/$FLAVOR/out
PROJ=$REPO/app/$FLAVOR
rm -rf "$OUT"
mkdir -p "$OUT/assets/payload/plugin/lib" "$OUT/classes"

# --- 1. assets + payload ------------------------------------------------------
for a in termux.apk termux-boot.apk termux-api.apk; do
  [ -s "$ASSETS/$a" ] || { echo "missing asset $a — run tools/fetch-assets.sh" >&2; exit 2; }
  cp "$ASSETS/$a" "$OUT/assets/"
done

if [ "$FLAVOR" = root ]; then
  # Every patch from scripts/ that the deployed runtime needs, in one list: a payload
  # that ships a stale patcher silently re-introduces the bug it was written to fix
  # (v0.2.6 shipped patch-dsh-link.mjs without its `rename` import — see
  # docs/TROUBLESHOOTING.md, gate 7).
  PAYLOAD="setup-root.sh start-dsh.sh boot-dsh.sh dsh-watchdog.sh dns-fwd.mjs \
patch-dsh.mjs patch-dsh-link.mjs patch-dsh-client-modules.mjs patch-dsh-web-auth.mjs \
patch-dsh-flock-android.mjs patch-dsh-presets.mjs patch-dsh-attachment-fsync.mjs upgrade-to-015.sh verify-turn.mjs verify-patched-tree.mjs \
install-api-key.sh cordis.patch.yml"
else
  [ -s "$ASSETS/shizuku.apk" ] || { echo "missing asset shizuku.apk" >&2; exit 2; }
  for a in shizuku-api.jar shizuku-provider.jar shizuku-aidl.jar shizuku-shared.jar androidx-annotation.jar; do
    [ -s "$ASSETS/$a" ] || { echo "missing asset $a — run tools/fetch-assets.sh" >&2; exit 2; }
  done
  cp "$ASSETS/shizuku.apk" "$OUT/assets/"
  PAYLOAD="setup-shizuku.sh start-dsh.sh boot-dsh-shizuku.sh \
patch-dsh.mjs patch-dsh-link.mjs patch-dsh-client-modules.mjs patch-dsh-web-auth.mjs \
patch-dsh-flock-android.mjs patch-dsh-presets.mjs patch-dsh-attachment-fsync.mjs verify-turn.mjs verify-patched-tree.mjs cordis.patch.yml"
fi

for f in $PAYLOAD; do
  [ -f "$REPO/scripts/$f" ] || { echo "payload source missing: scripts/$f" >&2; exit 2; }
  cp "$REPO/scripts/$f" "$OUT/assets/payload/$f"
done
cp "$REPO/plugin/index.js" "$REPO/plugin/package.json" "$REPO/plugin/cordis.patch.yml" "$OUT/assets/payload/plugin/"
cp "$REPO/plugin/lib/client.js" "$OUT/assets/payload/plugin/lib/"
echo "--- assets assembled ---"

# --- 2. resources -------------------------------------------------------------
"$BT/aapt2" compile --dir "$REPO/app/common/res" -o "$OUT/res.zip"
RESZIP=$OUT/res.zip
echo "--- aapt2 compile ok ---"

# --- 3. javac -----------------------------------------------------------------
JAVA_FILES=$(find "$REPO/app/common/java" "$PROJ/java" -name '*.java')
if [ "$FLAVOR" = root ]; then
  javac -encoding UTF-8 -classpath "$PLAT" -d "$OUT/classes" $JAVA_FILES
else
  CP="$PLAT:$ASSETS/shizuku-api.jar:$ASSETS/shizuku-provider.jar:$ASSETS/shizuku-aidl.jar:$ASSETS/shizuku-shared.jar:$ASSETS/androidx-annotation.jar"
  javac -encoding UTF-8 -classpath "$CP" -d "$OUT/classes" $JAVA_FILES
fi
echo "--- javac ok ---"

# --- 4. d8 --------------------------------------------------------------------
if [ "$FLAVOR" = root ]; then
  # shellcheck disable=SC2046
  "$BT/d8" --lib "$PLAT" --min-api 24 --output "$OUT" $(find "$OUT/classes" -name '*.class')
else
  ( cd "$OUT/classes" && jar cf "$OUT/classes.jar" . )
  "$BT/d8" --lib "$PLAT" --min-api 24 --output "$OUT" "$OUT/classes.jar" \
    "$ASSETS/shizuku-api.jar" "$ASSETS/shizuku-provider.jar" "$ASSETS/shizuku-aidl.jar" \
    "$ASSETS/shizuku-shared.jar" "$ASSETS/androidx-annotation.jar"
fi
[ -f "$OUT/classes.dex" ] || { echo "d8 did not produce classes.dex" >&2; exit 2; }
echo "--- d8 ok ---"

# --- 5. aapt2 link ------------------------------------------------------------
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PLAT" --manifest "$PROJ/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$RESZIP"
echo "--- aapt2 link ok ---"

# --- 6. add assets + classes.dex (forward-slash entry names) ------------------
python3 - "$OUT/base.apk" "$OUT/assets" "$OUT/classes.dex" <<'PY'
import os, sys, zipfile
apk, assets_dir, dex = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(assets_dir):
        for f in sorted(files):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, assets_dir).replace(os.sep, "/")
            z.write(full, "assets/" + rel)
    z.write(dex, "classes.dex")
print("--- assets + classes.dex added ---")
PY

# --- 7. zipalign --------------------------------------------------------------
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"
echo "--- zipalign ok ---"

# --- 8. sign ------------------------------------------------------------------
KS=$REPO/apk/debug.keystore
if [ ! -f "$KS" ]; then
  echo "--- generating apk/debug.keystore (keep it: the signature must stay stable) ---"
  keytool -genkeypair -keystore "$KS" -storepass dshphone -keypass dshphone -alias dsh \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname 'CN=DSH Phone, OU=dev, O=dsh, L=none, ST=none, C=CN' >/dev/null 2>&1
  mkdir -p "$REPO/out-release"
  cp "$KS" "$REPO/out-release/debug.keystore"
  : >"$REPO/out-release/KEYSTORE-GENERATED"
fi

APK=$REPO/out-release/dsh-phone-$FLAVOR-v$VERSION_NAME.apk
mkdir -p "$REPO/out-release"
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:dshphone --key-pass pass:dshphone --out "$APK" "$OUT/aligned.apk"
"$BT/apksigner" verify "$APK" >/dev/null
echo "signature ok ($(unzip -p "$APK" META-INF/*.RSA >/dev/null 2>&1 && echo v1 || echo v2+))"
echo "APK BUILT: $APK"
