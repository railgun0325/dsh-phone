#!/data/data/com.termux/files/usr/bin/bash
# setup-shizuku.sh — one-tap DSH install inside Termux (unrooted / Shizuku edition).
# No PC proxy; TUNA mirror; npmmirror for npm. Idempotent: safe to re-run.
# Full log: ~/setup-dsh.log (tee'd). API key and bridge token come from env only.
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:$PREFIX/bin/applets:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib

: > "$HOME/setup-dsh.log"
set -eo pipefail
{
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
  cd "$DSH_DIR"
  npm install @img/sharp-wasm32 --no-save 2>/dev/null || echo "[warn] sharp-wasm32 skipped"

  echo "[step] patch node-pty lazy load"
  if [ -f "$HOME/patch-dsh.mjs" ]; then
    node "$HOME/patch-dsh.mjs" "$DSH_DIR/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js"
  else
    echo "[warn] patch-dsh.mjs 缺失，跳过（不影响主流程）"
  fi

  echo "[step] patch session/attachment publish (link -> rename, Android SELinux denies link)"
  if [ -f "$HOME/patch-dsh-link.mjs" ]; then
    node "$HOME/patch-dsh-link.mjs" "$DSH_DIR/node_modules/@deepseek-ai"
  else
    echo "[warn] patch-dsh-link.mjs 缺失，跳过（不影响主流程）"
  fi

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

  echo "[step] write bridge token"
  if [ -n "$DSH_BRIDGE_TOKEN" ]; then
    printf '%s' "$DSH_BRIDGE_TOKEN" > "$HOME/.dsh-bridge-token"
    chmod 600 "$HOME/.dsh-bridge-token"
    echo "[ok] bridge token saved to ~/.dsh-bridge-token (chmod 600)"
  else
    echo "[skip] DSH_BRIDGE_TOKEN not set"
  fi

  echo "[step] record launcher alias"
  cat > "$HOME/.bashrc" << 'EOF'
alias dsh='node --expose-internals $(npm root -g)/@deepseek-ai/dsh/lib/bin.js'
EOF

  echo "SETUP OK"
} 2>&1 | tee -a "$HOME/setup-dsh.log"
