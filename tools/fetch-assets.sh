#!/usr/bin/env bash
# fetch-assets.sh — Linux/CI port of tools/fetch-assets.ps1.
# Downloads the pinned third-party APKs/JARs the DSH Phone APKs embed into assets/
# (gitignored). Sources and licences are listed in tools/fetch-assets.ps1.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ASSETS=$REPO/assets
mkdir -p "$ASSETS"

fetch() { # name url [fallback-url ...]
  local name=$1
  shift
  if [ -s "$ASSETS/$name" ]; then echo "skip     $name"; return 0; fi
  local u
  for u in "$@"; do
    # --retry-all-errors covers the TLS resets some networks raise on the first
    # connection; a half-written file is removed so the next mirror starts clean.
    if curl -fsSL --retry 4 --retry-all-errors --retry-delay 2 -o "$ASSETS/$name" "$u" \
       && [ -s "$ASSETS/$name" ]; then
      echo "fetched  $name ($(du -h "$ASSETS/$name" | cut -f1))"
      return 0
    fi
    rm -f "$ASSETS/$name"
  done
  echo "download failed: $name <- $1" >&2
  return 1
}

GH=https://github.com
# GitHub release assets are served from release-assets.githubusercontent.com,
# which some networks block while github.com itself answers. Both proxies take the
# full github.com URL as their path.
MIR1=https://gh-proxy.com
MIR2=https://ghfast.top
T_TERMUX=termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3+github-debug_arm64-v8a.apk
T_BOOT=termux/termux-boot/releases/download/v0.8.1/termux-boot-app_v0.8.1+github.debug.apk
T_API=termux/termux-api/releases/download/v0.53.0/termux-api-app_v0.53.0+github.debug.apk
T_SHIZUKU=RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk
fetch termux.apk      "$GH/$T_TERMUX"   "$MIR1/$GH/$T_TERMUX"   "$MIR2/$GH/$T_TERMUX"
fetch termux-boot.apk "$GH/$T_BOOT"     "$MIR1/$GH/$T_BOOT"     "$MIR2/$GH/$T_BOOT"
fetch termux-api.apk  "$GH/$T_API"      "$MIR1/$GH/$T_API"      "$MIR2/$GH/$T_API"
fetch shizuku.apk     "$GH/$T_SHIZUKU"  "$MIR1/$GH/$T_SHIZUKU"  "$MIR2/$GH/$T_SHIZUKU"

MVN=https://repo1.maven.org/maven2
ALI=https://maven.aliyun.com/repository/central
for a in api provider aidl shared; do
  fetch "shizuku-$a.aar" "$MVN/dev/rikka/shizuku/$a/13.1.5/$a-13.1.5.aar" "$ALI/dev/rikka/shizuku/$a/13.1.5/$a-13.1.5.aar"
done
fetch androidx-annotation.jar "https://dl.google.com/dl/android/maven2/androidx/annotation/annotation/1.3.0/annotation-1.3.0.jar" \
  "https://maven.aliyun.com/repository/google/androidx/annotation/annotation/1.3.0/annotation-1.3.0.jar"

# AARs are zips; javac/d8 only need their classes.jar.
python3 - "$ASSETS" <<'PY'
import os, sys, zipfile
assets = sys.argv[1]
for name in ("api", "provider", "aidl", "shared"):
    aar = os.path.join(assets, f"shizuku-{name}.aar")
    jar = os.path.join(assets, f"shizuku-{name}.jar")
    if os.path.exists(jar):
        print(f"skip     shizuku-{name}.jar")
        continue
    with zipfile.ZipFile(aar) as z, z.open("classes.jar") as src, open(jar, "wb") as dst:
        dst.write(src.read())
    print(f"extracted shizuku-{name}.jar")
PY

( cd "$ASSETS" && shasum -a 256 ./* 2>/dev/null || sha256sum ./* ) >"$ASSETS/SHA256SUMS.txt"
echo "SHA256SUMS.txt written"
