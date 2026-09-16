#!/data/data/com.termux/files/usr/bin/bash
# Upgrade rehearsal: boot 0.1.5 against a CLONE of the real home (h015-real) and
# exercise the paths the live setup depends on: plugin load (mnemon,
# super-injector, android-control), old-session reads, and a fresh turn.
set -u
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib
export DEEPSEEK_API_KEY="$(cat $HOME/.dsh-api-key)"
TREE=$HOME/dsh-0.1.5-rc.2/node_modules/@deepseek-ai/dsh
H=$HOME/h015-real
PORT=${PORT:-3098}
LOG=$HOME/h015-real-web.log
BASE="http://127.0.0.1:$PORT/api"
export DSH_HOME=$H
echo "mnemon: $(node -e "const p=require('$H/profiles/web/node_modules/dsh-mnemon/package.json');console.log(p.name,p.version)" 2>&1 | tail -1)"
echo "old sessions: $(ls -1 $H/sessions/--root-- 2>/dev/null | wc -l)"
: >"$LOG"
setsid node --expose-internals "$TREE/lib/bin.js" web --port "$PORT" >>"$LOG" 2>&1 &
SRV=$!
code=000
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null || true)
  [ "$code" = 200 ] && break
  sleep 1
done
echo "HTTP=$code after ${i}s (pid $SRV)"
rpc() {
  curl -s --max-time 30 -X POST "$BASE/$1" -H 'content-type: application/json' \
    -d "{\"type\":\"client-request\",\"rpcId\":\"p-$$-$RANDOM\",\"method\":\"$1\",\"payload\":{\"args\":$2}}"
  echo
}
echo "--- session/list (old sessions visible?) ---"
rpc session/list '{}' | head -c 700; echo
OLD=$(ls -1t $H/sessions/--root-- 2>/dev/null | head -1)
echo "--- inspect oldest-activity session: $OLD ---"
rpc session/inspect "{\"sessionId\":\"$OLD\"}" | head -c 400; echo
echo "--- create + prompt (fresh turn) ---"
CREATED=$(rpc session/create '{"request":{"cwd":"/data/data/com.termux/files/home"}}')
SID=$(printf '%s' "$CREATED" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')
echo "SID=$SID"
SDIR="$H/sessions/--data-data-com.termux-files-home--/$SID"
RID=$(cat /proc/sys/kernel/random/uuid)
rpc session/prompt "{\"request\":{\"sessionId\":\"$SID\",\"requestId\":\"$RID\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"Reply with exactly: pong\"}]}}"
for i in $(seq 1 20); do
  sleep 2
  SZ=$(stat -c %s "$SDIR/session.v3.jsonl.zstd" 2>/dev/null || echo none)
  echo "t=$((i*2))s durable=$SZ"
done
echo "--- server log ---"
tail -40 "$LOG"
kill "$SRV" 2>/dev/null
