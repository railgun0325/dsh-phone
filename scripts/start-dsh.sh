#!/data/data/com.termux/files/usr/bin/bash
# Start dsh web on the phone. The API key is read from ~/.dsh-api-key
# (created by scripts/install-api-key.sh); never commit real keys.
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib
if [ -f "$HOME/.dsh-api-key" ]; then
  export DEEPSEEK_API_KEY="$(cat "$HOME/.dsh-api-key")"
fi
exec > "$HOME/dsh-web.log" 2>&1
exec /data/data/com.termux/files/usr/bin/node --expose-internals /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web
