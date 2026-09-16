#!/data/data/com.termux/files/usr/bin/bash
# upgrade-to-015.sh — migrate this phone's DSH install from 0.1.0-rc.6 to the
# patched 0.1.5 tree (default $HOME/dsh-0.1.5-rc.2), in place, with backups.
#
#   usage: upgrade-to-015.sh              print the plan, change nothing
#          upgrade-to-015.sh --apply      back up, migrate, restart, verify
#          upgrade-to-015.sh --rollback   restore the 0.1.0 install + user data
#
# What 0.1.5 needs beyond the runtime patches (see docs/UPGRADE-0.1.5.md):
#   * the live install stays a path symlink so the package's dependency root
#     ($HOME/dsh-0.1.5-rc.2/node_modules) is what the profile links already
#     point at — a plain copy would break module resolution;
#   * user Agent presets must say `prefix:` — 0.1.5's @deepseek-ai/dsh-persona
#     made the prompt key required and renamed it from `text:`;
#   * dsh-mnemon must be >= 0.5.x — 0.1.2 throws
#     "Cannot read properties of undefined (reading 'filter')" at turn end;
#   * ~/.dsh/.credentials.yaml is version-specific and must NOT be shared.
set -u

PREFIX=/data/data/com.termux/files/usr
HOME_DIR=/data/data/com.termux/files/home
NODE=$PREFIX/bin/node
PNPM=$PREFIX/bin/pnpm
DSH_HOME_DIR=$HOME_DIR/.dsh
LIVE=$PREFIX/lib/node_modules/@deepseek-ai/dsh
TREE=${TREE:-$HOME_DIR/dsh-0.1.5-rc.2}
TREE_DSH=$TREE/node_modules/@deepseek-ai/dsh
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP=$HOME_DIR/backups/upgrade-015-$STAMP
LOG=$HOME_DIR/upgrade-015.log
PORT=3080

export PREFIX HOME=$HOME_DIR TMPDIR=$PREFIX/tmp TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:/system/bin:/system/xbin LD_LIBRARY_PATH=$PREFIX/lib
[ -f "$HOME_DIR/.dsh-api-key" ] && export DEEPSEEK_API_KEY="$(cat "$HOME_DIR/.dsh-api-key")"

say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
die() { say "FATAL: $*"; exit 1; }

plan() {
  cat <<EOF
live install : $LIVE ($(installed_version))
target tree  : $TREE_DSH ($(tree_version))
backup dir   : $BACKUP
steps        : stop web -> back up ~/.dsh + presets + profile manifest
               -> symlink live install at the patched tree
               -> convert presets (persona text: -> prefix:)
               -> pnpm add dsh-mnemon@0.5.10 in $DSH_HOME_DIR/profiles/web
               -> restart dsh web -> verify HTTP 200 and one real turn
EOF
}
installed_version() { "$NODE" -e "console.log(require('$LIVE/package.json').version)" 2>/dev/null || echo missing; }
tree_version() { "$NODE" -e "console.log(require('$TREE_DSH/package.json').version)" 2>/dev/null || echo missing; }

case "${1:-}" in
  --apply) MODE=apply ;;
  --rollback) MODE=rollback ;;
  "") MODE=plan ;;
  *) die "unknown argument: $1" ;;
esac

[ "$MODE" = plan ] && { plan; exit 0; }

# --- rollback ---------------------------------------------------------------
if [ "$MODE" = rollback ]; then
  LIVE_BAK=$LIVE.0.1.0-rc.6.bak
  [ -e "$LIVE_BAK" ] || die "no 0.1.0 backup at $LIVE_BAK"
  say "stopping dsh web"
  pkill -f 'bin.js web' 2>/dev/null
  sleep 2
  say "restoring 0.1.0 install"
  rm -rf "$LIVE" && mv "$LIVE_BAK" "$LIVE"
  LAST=$(ls -1d "$HOME_DIR"/backups/upgrade-015-* 2>/dev/null | tail -1)
  if [ -n "$LAST" ] && [ -f "$LAST/user-data.tgz" ]; then
    say "restoring user data from $LAST"
    tar xzf "$LAST/user-data.tgz" -C "$HOME_DIR"
  fi
  say "restarting dsh web"
  setsid "$HOME_DIR/start-dsh.sh" >/dev/null 2>&1 &
  sleep 20
  say "rollback done: live install is $(installed_version)"
  exit 0
fi

# --- preflight --------------------------------------------------------------
[ -f "$TREE_DSH/package.json" ] || die "patched tree missing: $TREE_DSH"
grep -q 'rename, rm, stat, truncate' "$TREE/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js" \
  || die "session store still misses the 'rename' import — rerun scripts/patch-dsh-link.mjs"
mkdir -p "$BACKUP" || die "cannot create $BACKUP"
say "upgrade 015: $(installed_version) -> $(tree_version)"

# --- 1. stop the live server ------------------------------------------------
say "stopping dsh web"
pkill -f 'bin.js web' 2>/dev/null
sleep 2

# --- 2. back up user data ---------------------------------------------------
say "backing up ~/.dsh (sessions, presets, settings, storages)"
tar czf "$BACKUP/user-data.tgz" -C "$HOME_DIR" \
  --exclude='.dsh/profiles/node_modules' --exclude='.dsh/profiles/*/node_modules' .dsh \
  || die "backup failed"
cp "$DSH_HOME_DIR/settings.yaml" "$BACKUP/settings.yaml" 2>/dev/null
cp "$DSH_HOME_DIR/profiles/web/package.json" "$BACKUP/profile-web-package.json" 2>/dev/null
"$NODE" -e "console.log(require('$DSH_HOME_DIR/profiles/web/node_modules/dsh-mnemon/package.json').version)" \
  >"$BACKUP/mnemon-version-before.txt" 2>/dev/null
say "backup written: $BACKUP"

# --- 3. flip the live install ----------------------------------------------
if [ -L "$LIVE" ]; then
  say "live install is already a symlink -> $(readlink "$LIVE")"
else
  say "moving 0.1.0 install aside"
  mv "$LIVE" "$LIVE.0.1.0-rc.6.bak" || die "cannot move $LIVE"
  ln -s "$TREE_DSH" "$LIVE" || die "cannot symlink $LIVE"
fi
say "live install now: $(installed_version)"

# --- 4. presets -------------------------------------------------------------
say "converting user presets to the 0.1.5 persona key"
"$NODE" "$HOME_DIR/patch-dsh-presets.mjs" "$DSH_HOME_DIR/.agent-presets" | tee -a "$LOG"

# --- 5. mnemon --------------------------------------------------------------
MNEMON_NOW=$("$NODE" -e "console.log(require('$DSH_HOME_DIR/profiles/web/node_modules/dsh-mnemon/package.json').version)" 2>/dev/null)
case "$MNEMON_NOW" in
  0.[1-4].*|"") say "upgrading dsh-mnemon $MNEMON_NOW -> 0.5.10"
    ( cd "$DSH_HOME_DIR/profiles/web" && "$PNPM" add dsh-mnemon@0.5.10 --reporter=append-only ) >>"$LOG" 2>&1 \
      || say "WARN: pnpm add failed — see $LOG" ;;
  *) say "dsh-mnemon already $MNEMON_NOW" ;;
esac

# --- 6. restart + verify ----------------------------------------------------
say "restarting dsh web"
setsid "$HOME_DIR/start-dsh.sh" >/dev/null 2>&1 &
code=000
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null || true)
  [ "$code" = 200 ] && break
  sleep 2
done
say "web http=$code after $((i * 2))s"
[ "$code" = 200 ] || die "dsh web did not come up — roll back with: $0 --rollback"

say "one-shot turn smoke test (live web API)"
VERIFY=$HOME_DIR/verify-turn.mjs
if [ -f "$VERIFY" ]; then
  VOUT=$(timeout -s KILL 180 "$NODE" "$VERIFY" "$PORT" "$HOME_DIR" 2>&1 | tail -4)
  echo "$VOUT" | tee -a "$LOG"
  case "$VOUT" in
    *VERIFY_OK*) say "VERIFIED: 0.1.5 answers a real turn over $PORT" ;;
    *) say "WARN: turn verification failed — inspect $LOG, roll back with $0 --rollback" ;;
  esac
else
  say "note: $VERIFY not installed, skipping the turn check"
fi
say "done. rollback: $0 --rollback"
