#!/usr/bin/env bash
# fetch-assets.sh — Linux/CI port of tools/fetch-assets.ps1.
# Downloads the pinned third-party APKs/JARs the DSH Phone APKs embed into assets/
# (gitignored). Sources and licences are listed in tools/fetch-assets.ps1.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ASSETS=$REPO/assets
mkdir -p "$ASSETS"

fetch() { # name url [mirror]
  local name=$1 url=$2 mirror=${3:-}
  if [ -s "$ASSETS/$name" ]; then echo "skip     $name"; return 0; fi
  local u
  for u in "$url" $mirror; do
    if curl -fsSL --retry 3 --retry-delay 2 -o "$ASSETS/$name" "$u" && [ -s "$ASSETS/$name" ]; then
      echo "fetched  $name ($(du -h "$ASSETS/$name" | cut -f1))"
      return 0
    fi
  done
  echo "download failed: $name <- $url" >&2
  return 1
}

GH=https://github.com
MIR=https://ghfast.top
fetch termux.apk      "$GH/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3+github-debug_arm64-v8a.apk" "$MIR/$GH/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3+github-debug_arm64-v8a.apk"
fetch termux-boot.apk "$GH/termux/termux-boot/releases/download/v0.8.1/termux-boot-app_v0.8.1+github.debug.apk"           "$MIR/$GH/termux/termux-boot/releases/download/v0.8.1/termux-boot-app_v0.8.1+github.debug.apk"
fetch termux-api.apk  "$GH/termux/termux-api/releases/download/v0.53.0/termux-api-app_v0.53.0+github.debug.apk"           "$MIR/$GH/termux/termux-api/releases/download/v0.53.0/termux-api-app_v0.53.0+github.debug.apk"
fetch shizuku.apk     "$GH/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk"       "$MIR/$GH/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk"

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
