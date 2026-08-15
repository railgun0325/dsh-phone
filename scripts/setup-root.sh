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
  echo "[step] write TUNA apt source"
  cat > "$PREFIX/etc/apt/sources.list" << 'EOF'
# TUNA mirror (Termux main repo)
deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main
EOF

  echo "[step] apt-get update"
  apt-get update

  echo "[step] install base packages"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold nodejs-lts git python clang make binutils openssl curl wget termux-api

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

  echo "[step] grant Termux:API hardware permissions (camera/mic/location/notification)"
  # 硬件工具（plugin v2）依赖 Termux:API 的运行时权限；逐项 pm grant，幂等可重跑。
  # WAKE_LOCK/VIBRATE/MODIFY_AUDIO_SETTINGS 是安装期普通权限，装 APK 时即自动授予。
  API_RUNTIME_PERMS="android.permission.CAMERA android.permission.RECORD_AUDIO android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION android.permission.POST_NOTIFICATIONS"
  for P in $API_RUNTIME_PERMS; do
    if su -c "pm grant com.termux.api $P" 2>/dev/null; then
      echo "[ok] pm grant com.termux.api $P"
    else
      echo "[warn] pm grant 失败: $P（可到 Termux:API 应用详情页手动开启，一次终身）"
    fi
  done
  echo "[ok] 安装期权限 WAKE_LOCK / VIBRATE / MODIFY_AUDIO_SETTINGS 已随 APK 安装授予"
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
