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

  echo "[step] npm registry (npmmirror)"
  npm config set registry https://registry.npmmirror.com

  echo "[step] install DSH (ignore scripts; native modules patched later)"
  if ! npm install -g --ignore-scripts @deepseek-ai/dsh@latest; then
    echo "[fallback] first attempt failed — patch koffi if present, then retry"
    KOFFI_CC="$(npm root -g)/@deepseek-ai/dsh/node_modules/koffi/lib/native/base/base.cc"
    if [ -f "$KOFFI_CC" ] && ! grep -q 'ANDROID' "$KOFFI_CC"; then
      sed -i 's/#if defined(__linux__)/#if defined(__linux__) && !defined(__ANDROID__)/' "$KOFFI_CC"
    fi
    npm install -g --ignore-scripts @deepseek-ai/dsh@latest
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
  node "$HOME/patch-dsh.mjs" "$DSH_DIR/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js"

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
  if [ -n "$DEEPSEEK_API_KEY" ]; then
    printf '%s' "$DEEPSEEK_API_KEY" > "$HOME/.dsh-api-key"
    chmod 600 "$HOME/.dsh-api-key"
    echo "[ok] API key saved to ~/.dsh-api-key (chmod 600)"
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
