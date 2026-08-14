#!/data/data/com.termux/files/usr/bin/bash
# setup-dsh.sh — bootstrap DSH on Android/Termux (rooted Xiaomi 13 Pro)
# Network: router DNS is broken; apt/npm/git go through the PC proxy tunnel
# (adb reverse tcp:8119) configured in apt.conf.d/99proxy and npm/git configs.
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:$PREFIX/bin/applets:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib
exec > "$HOME/setup-dsh.log" 2>&1
set -e
echo "[step] apt-get update (via proxy)"
apt-get update
echo "[step] install base packages"
DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold nodejs-lts git openssh termux-api python clang make binutils openssl curl wget
echo "[step] node/npm versions"
node -v
npm -v
echo "[step] npm/git proxy config"
npm config set proxy http://127.0.0.1:8119
npm config set https-proxy http://127.0.0.1:8119
npm config set registry https://registry.npmmirror.com
git config --global http.proxy http://127.0.0.1:8119
git config --global https.proxy http://127.0.0.1:8119
echo "[step] install pnpm"
npm install -g pnpm@11.7.0 2>/dev/null || npm install -g pnpm 2>/dev/null || echo "[warn] pnpm skipped"
echo "[step] install DSH from npm"
npm install -g @deepseek-ai/dsh@latest || {
  echo "[fallback] retry DSH with --ignore-scripts (native modules are patched out anyway)"
  npm install -g --ignore-scripts @deepseek-ai/dsh@latest
}
DSH_DIR="$(npm root -g)/@deepseek-ai/dsh"
echo "DSH_DIR=$DSH_DIR"
echo "[step] patch koffi statx for Android"
KOFFI_CC="$DSH_DIR/node_modules/koffi/lib/native/base/base.cc"
if [ -f "$KOFFI_CC" ] && ! grep -q 'ANDROID' "$KOFFI_CC"; then
  sed -i 's/#if defined(__linux__)/#if defined(__linux__) \&\& !defined(__ANDROID__)/' "$KOFFI_CC"
  echo "[ok] koffi patched"
else
  echo "[skip] koffi patch (already applied or file missing)"
fi
echo "[step] sharp wasm fallback"
cd "$DSH_DIR"
npm install @img/sharp-wasm32 --no-save 2>/dev/null || echo "[warn] sharp-wasm32 skipped"
echo "[step] write web profile cordis patch"
mkdir -p "$HOME/.dsh/profiles/web"
cat > "$HOME/.dsh/profiles/web/cordis.patch.yml" << 'EOF'
- id: hmr
  disabled: true
- id: subprocess
  disabled: true
- id: bash-sandbox
  disabled: true
- id: permission
  disabled: true
EOF
echo "[step] record launcher alias + proxy env"
cat > "$HOME/.bashrc" << 'EOF'
alias dsh='node --expose-internals $(npm root -g)/@deepseek-ai/dsh/lib/bin.js'
export HTTPS_PROXY=http://127.0.0.1:8119
export HTTP_PROXY=http://127.0.0.1:8119
EOF
echo "SETUP OK"
