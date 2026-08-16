#!/data/data/com.termux/files/usr/bin/bash
# setup-root.sh — one-tap DSH install inside Termux (root edition, no PC proxy).
# Idempotent: safe to re-run. Full log: ~/setup-dsh.log (tee'd).
# The API key is taken from the DEEPSEEK_API_KEY env var only — never embedded.
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:$PREFIX/bin/applets:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib

: > "$HOME/setup-dsh.log"
set -eo pipefail
{
  # Fast path: a previous run completed (marker) and node+DSH are still there
  # -> skip apt/npm downloads entirely (seconds instead of minutes).
  FAST=""
  if [ -f "$HOME/.dsh-setup-ok" ] && [ -x "$PREFIX/bin/node" ]      && [ -f "$PREFIX/lib/node_modules/@deepseek-ai/dsh/package.json" ]; then
    FAST=1
    echo "[fast] 环境已就绪，跳过 apt/npm 下载（强制重装请删除 ~/.dsh-setup-ok）"
  fi

  if [ -z "$FAST" ]; then
  echo "[step] configure apt mirrors (TUNA → USTC → BFSU → Tencent → official)"
  # 403 is a mirror-side rejection (WAF/rate-limit or blocked egress IP), not the
  # phone being offline. Try each mirror; on failure retry once with forced IPv4.
  APT_SOURCES="
https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main
https://mirrors.ustc.edu.cn/termux/apt/termux-main
https://mirrors.bfsu.edu.cn/termux/apt/termux-main
https://mirrors.cloud.tencent.com/termux/apt/termux-main
https://packages-cf.termux.dev/apt/termux-main
https://packages.termux.dev/apt/termux-main
"
  APT_OPTS="-o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20"
  APT_UPDATE_LOG="$TMPDIR/dsh-apt-update.log"
  APT_PKGS="nodejs-lts git python clang make binutils openssl curl wget termux-api"
  APT_OK=""
  # Drop a leftover manual 403 workaround so the fallback chain below can take effect.
  rm -f "$PREFIX/etc/apt/apt.conf.d/99-dsh-ustc.conf"

  try_apt_source() {
    _URL="$1"
    _MODE="$2"
    echo "[step] trying apt source: $_URL${_MODE:+ (force IPv4)}"
    echo "deb $_URL stable main" > "$PREFIX/etc/apt/sources.list"
    rm -f "$PREFIX/var/lib/apt/lists"/* 2>/dev/null || true
    if ! apt-get $APT_OPTS $_MODE update > "$APT_UPDATE_LOG" 2>&1; then
      cat "$APT_UPDATE_LOG"
      if grep -q '403' "$APT_UPDATE_LOG"; then
        echo "[warn] mirror returned 403 (mirror WAF/rate-limit or egress IP blocked); switching mirror"
      fi
      return 1
    fi
    cat "$APT_UPDATE_LOG"
    if DEBIAN_FRONTEND=noninteractive apt-get $APT_OPTS $_MODE install -y -o Dpkg::Options::=--force-confold $APT_PKGS; then
      APT_OK="$_URL"
      return 0
    fi
    echo "[warn] update ok but package install failed; switching mirror"
    return 1
  }

  for APT_URL in $APT_SOURCES; do
    if try_apt_source "$APT_URL" ""; then
      break
    fi
    if try_apt_source "$APT_URL" "-o Acquire::ForceIPv4=true"; then
      break
    fi
  done

  if [ -z "$APT_OK" ]; then
    echo "[error] all apt mirrors failed; check Termux network/DNS/IPv6 and retry"
    exit 1
  fi
  echo "[ok] apt packages installed from $APT_OK"

  echo "[step] node/npm versions"
  node -v
  npm -v

  echo "[step] npm retry hardening"
  npm config set fetch-retries 5
  npm config set fetch-retry-mintimeout 20000
  npm config set fetch-retry-maxtimeout 120000

  echo "[step] install DSH (ignore scripts; native modules patched later; registry fallback chain)"
  # npmmirror -> Huawei Cloud -> official npmjs. VPN fake-ip / flaky WiFi proofing.
  DSH_INSTALLED=""
  for REG in https://registry.npmmirror.com https://repo.huaweicloud.com/repository/npm/ https://registry.npmjs.org; do
    echo "[step] trying registry: $REG"
    if npm install -g --ignore-scripts --registry "$REG" @deepseek-ai/dsh@latest; then
      npm config set registry "$REG"
      DSH_INSTALLED=1
      break
    fi
    echo "[fallback] registry $REG failed — patching koffi if present, then trying next"
    KOFFI_CC="$(npm root -g)/@deepseek-ai/dsh/node_modules/koffi/lib/native/base/base.cc"
    if [ -f "$KOFFI_CC" ] && ! grep -q 'ANDROID' "$KOFFI_CC"; then
      sed -i 's/#if defined(__linux__)/#if defined(__linux__) && !defined(__ANDROID__)/' "$KOFFI_CC"
    fi
  done
  if [ -z "$DSH_INSTALLED" ]; then
    echo "[error] all npm registries failed; aborting"
    exit 1
  fi
  fi  # end fast-skip

  DSH_DIR="$(npm root -g)/@deepseek-ai/dsh"
  echo "DSH_DIR=$DSH_DIR"

  echo "[step] patch koffi statx for Android"
  KOFFI_CC="$DSH_DIR/node_modules/koffi/lib/native/base/base.cc"
  if [ -f "$KOFFI_CC" ] && ! grep -q 'ANDROID' "$KOFFI_CC"; then
    sed -i 's/#if defined(__linux__)/#if defined(__linux__) && !defined(__ANDROID__)/' "$KOFFI_CC"
    echo "[ok] koffi patched"
  else
    echo "[skip] koffi patch (already applied or file missing)"
  fi

  echo "[step] sharp wasm fallback"
  if [ -z "$FAST" ]; then
    cd "$DSH_DIR"
    npm install @img/sharp-wasm32 --no-save 2>/dev/null || echo "[warn] sharp-wasm32 skipped"
  else
    echo "[skip] sharp wasm (fast path, already installed)"
  fi

  echo "[step] patch node-pty lazy load"
  node "$HOME/patch-dsh.mjs" "$DSH_DIR/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js"

  echo "[step] patch session/attachment publish (link -> rename, Android SELinux denies link)"
  node "$HOME/patch-dsh-link.mjs" "$DSH_DIR/node_modules/@deepseek-ai"

  echo "[step] register dsh-android-control plugin"
  PLUGIN_DIR="$DSH_DIR/node_modules/dsh-android-control"
  mkdir -p "$PLUGIN_DIR/lib"
  install -m 644 "$HOME/plugin/index.js" "$HOME/plugin/package.json" "$HOME/plugin/cordis.patch.yml" "$PLUGIN_DIR/"
  install -m 644 "$HOME/plugin/lib/client.js" "$PLUGIN_DIR/lib/"
  mkdir -p "$HOME/.dsh/profiles/web/node_modules"
  ln -sfn "$PLUGIN_DIR" "$HOME/.dsh/profiles/web/node_modules/dsh-android-control"

  echo "[step] write web profile cordis patch"
  mkdir -p "$HOME/.dsh/profiles/web"
  install -m 644 "$HOME/cordis.patch.yml" "$HOME/.dsh/profiles/web/cordis.patch.yml"

  echo "[step] write API key"
  if [ -n "$DEEPSEEK_API_KEY" ] && printf '%s' "$DEEPSEEK_API_KEY" | grep -Eq '^sk-[A-Za-z0-9_-]+$'; then
    printf '%s' "$DEEPSEEK_API_KEY" > "$HOME/.dsh-api-key"
    chmod 600 "$HOME/.dsh-api-key"
    echo "[ok] API key saved to ~/.dsh-api-key (chmod 600)"
  elif [ -n "$DEEPSEEK_API_KEY" ]; then
    echo "[error] DEEPSEEK_API_KEY 格式非法（应为 sk- 开头的纯文本，不含换行）；未写入"
    exit 1
  else
    echo "[skip] DEEPSEEK_API_KEY not set"
  fi

  echo "[step] grant Termux:API hardware permissions (camera/mic/location)"
  # 硬件工具（plugin v2）依赖 Termux:API 的运行时权限；逐项 pm grant，幂等可重跑。
  # 0.53 版 Termux:API 只声明了这 4 个危险权限；通知 targetSdk=28 无需 POST_NOTIFICATIONS；
  # wakelock 走 Termux 应用自身的 TermuxService（WAKE_LOCK 随 Termux 安装授予）；震动随安装授予。
  API_RUNTIME_PERMS="android.permission.CAMERA android.permission.RECORD_AUDIO android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION"
  for P in $API_RUNTIME_PERMS; do
    if su -c "pm grant com.termux.api $P" 2>/dev/null; then
      echo "[ok] pm grant com.termux.api $P"
    else
      echo "[warn] pm grant 失败: $P（可到 Termux:API 应用详情页手动开启，一次终身）"
    fi
  done
  echo "[ok] 通知无需授权：Termux:API targetSdk=28，系统默认放行通知"
  echo "[ok] wakelock 走 com.termux TermuxService（WAKE_LOCK 已随 Termux 安装授予）"
  echo "[ok] 震动 VIBRATE 已随 Termux:API 安装自动授予"
  if su -c "cmd appops set com.termux.api WRITE_SETTINGS allow" 2>/dev/null; then
    echo "[ok] appops allow com.termux.api WRITE_SETTINGS（termux-brightness 亮度写回退）"
  else
    echo "[warn] WRITE_SETTINGS appop 授权失败: com.termux.api（亮度写将走 su/bridge 通道）"
  fi
  if su -c "dumpsys deviceidle whitelist +com.termux.api" 2>/dev/null; then
    echo "[ok] 电池豁免 deviceidle whitelist +com.termux.api"
  else
    echo "[warn] 电池豁免失败: com.termux.api（MIUI 可能冻结 Termux:API，建议到设置里允许后台无限制）"
  fi

  echo "[step] record launcher alias"
  cat > "$HOME/.bashrc" << 'EOF'
alias dsh='node --expose-internals $(npm root -g)/@deepseek-ai/dsh/lib/bin.js'
EOF

  touch "$HOME/.dsh-setup-ok"
  echo "SETUP OK"
} 2>&1 | tee -a "$HOME/setup-dsh.log"
