#!/data/data/com.termux/files/usr/bin/bash
# 0.1.5 upgrade-blocker repro loop. Runs an ISOLATED 0.1.5 home so the live
# 0.1.0 home is never touched.
#   usage: phone-015-loop.sh <headless|web> [timeout_s]
#   env:   FRESH=1  wipe the isolated home first
set -u
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib
export DEEPSEEK_API_KEY="$(cat $HOME/.dsh-api-key)"
TREE=$HOME/dsh-0.1.5-rc.2/node_modules/@deepseek-ai/dsh
MODE=${1:-headless}
TMO=${2:-150}
H=$HOME/h015
LOG=$HOME/h015-$MODE.log
if [ "${FRESH:-0}" = 1 ]; then rm -rf "$H"; fi
mkdir -p "$H"
export DSH_HOME=$H
: > "$LOG"
say() { echo "[$(date +%H:%M:%S)] $*" >>"$LOG"; }
say "MODE=$MODE DSH_HOME=$H TMO=$TMO"
case "$MODE" in
  headless)
    timeout -s KILL "$TMO" node "$TREE/lib/bin.js" --profile headless 'Reply with exactly: pong' >>"$LOG" 2>&1
    say "EXIT=$?" ;;
  web)
    timeout -s KILL "$TMO" node "$TREE/lib/bin.js" web --port 3099 >>"$LOG" 2>&1
    say "EXIT=$?" ;;
  *) say "unknown mode"; exit 2 ;;
esac
say "done"
