#!/data/data/com.termux/files/usr/bin/bash
# Boot the 0.1.5 web surface against a chosen DSH_HOME and leave it running so the
# api client can drive it. usage: phone-015-boot.sh <home> <port> [log]
set -u
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib
export DEEPSEEK_API_KEY="$(cat $HOME/.dsh-api-key)"
TREE=$HOME/dsh-0.1.5-rc.2/node_modules/@deepseek-ai/dsh
export DSH_HOME=$1
PORT=$2
LOG=${3:-$HOME/h015-boot.log}
: >"$LOG"
setsid node --expose-internals "$TREE/lib/bin.js" web --port "$PORT" >>"$LOG" 2>&1 &
SRV=$!
code=000
for i in $(seq 1 90); do
  code=$(node -e "fetch('http://127.0.0.1:$PORT/').then(r=>{console.log(r.status);process.exit(0)},()=>{console.log('000');process.exit(0)})" 2>/dev/null)
  [ "$code" = 200 ] && break
  sleep 1
done
echo "BOOT home=$DSH_HOME port=$PORT http=$code pid=$SRV after=${i}s"
[ "$code" = 200 ] || { echo "--- log ---"; tail -25 "$LOG"; }
