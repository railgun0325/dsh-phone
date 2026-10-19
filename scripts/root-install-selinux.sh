#!/system/bin/sh
# Only the root half of setup-root. Do not generalise this into a home/system
# relabel: app MCS categories are device-specific and enforce app isolation.
set -eu
PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin
export PATH
export LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib
[ "$(id -u)" = 0 ] || { echo '[error] SELinux repair requires root'; exit 1; }
APP_UID=${1:?Termux UID required}
APP_GID=${2:?Termux GID required}
case "$APP_UID:$APP_GID" in *[!0-9:]*|:*|*:) echo '[error] invalid app UID/GID'; exit 1;; esac
[ "$APP_UID" -ge 10000 ] || { echo '[error] refusing non-app UID'; exit 1; }
BASE=/data/data/com.termux/files
APP_HOME=$BASE/home
APP_PREFIX=$BASE/usr
# These fixed existing directories are references, not recursive repair targets.
[ ! -L "$APP_HOME" ] && [ ! -L "$APP_PREFIX" ] || { echo '[error] symlink home/prefix refused'; exit 1; }
[ "$(stat -c %u "$APP_HOME")" = "$APP_UID" ] || { echo '[error] Termux home owner differs from invoking UID'; exit 1; }
[ "$(stat -c %u /data/data/com.termux)" = "$APP_UID" ] || { echo '[error] Termux app root owner differs'; exit 1; }
CONTEXT=$(stat -c %C /data/data/com.termux)
case "$CONTEXT" in
  u:object_r:app_data_file:s0:c[0-9]*,c[0-9]*) ;;
  *) echo '[error] Termux app root lacks a trusted full app_data_file MCS context; create/fix the reference through the real Termux app first'; exit 1;;
esac
CANON_BASE=$(readlink -f "$BASE")
[ -d "$CANON_BASE" ] || exit 1
repair_path() {
  target=$1
  [ -e "$target" ] || [ -L "$target" ] || return 0
  # Never follow install-root symlinks (e.g. old pnpm/path installs). Leaf .bin
  # symlinks are handled below with -h, so their targets are never relabelled.
  if [ -L "$target" ]; then
    case "$target" in "$APP_PREFIX/bin/dsh") ;; *) echo "[error] symlink managed root refused: $target"; exit 1;; esac
    parent=$(readlink -f "$(dirname "$target")")
    canonical=$parent/$(basename "$target")
  else
    canonical=$(readlink -f "$target")
  fi
  case "$canonical" in "$CANON_BASE"/*) ;; *) echo "[error] escaped Termux files root: $target"; exit 1;; esac
  if [ "${2:-}" = single ]; then
    set -- "$target" -maxdepth 0
  else
    set -- "$target"
  fi
  # First validate every owner without mutation, then repair only this managed
  # tree. find defaults to -P: symlink targets are outside the traversal.
  find "$@" -exec sh -c '
    uid=$1; context=$2; shift 2
    for entry do
      owner=$(stat -c %u "$entry") || exit 1
      [ "$owner" = 0 ] || [ "$owner" = "$uid" ] || { echo "[error] unexpected owner: $entry"; exit 1; }
      current=$(stat -c %C "$entry") || exit 1
      case "$current" in u:object_r:app_data_file:s0|"$context") ;; *) echo "[error] refusing unrelated SELinux type/categories: $entry ($current)"; exit 1;; esac
    done
  ' sh "$APP_UID" "$CONTEXT" {} + || return 1
  find "$@" -exec sh -c '
    uid=$1; gid=$2; context=$3; shift 3
    for entry do
      [ "$(stat -c %u:%g "$entry")" = "$uid:$gid" ] || chown -h "$uid:$gid" "$entry" || exit 1
      current=$(stat -c %C "$entry") || exit 1
      if [ "$current" != "$context" ]; then
        case "$current" in u:object_r:app_data_file:s0|"$context") ;; *) echo "[error] refusing unrelated SELinux type/categories: $entry ($current)"; exit 1;; esac
        chcon -h "$context" "$entry" || exit 1
      fi
      [ "$(stat -c %C "$entry")" = "$context" ] || exit 1
    done
  ' sh "$APP_UID" "$APP_GID" "$CONTEXT" {} + || return 1
}
# Bootstrap mode repairs only the installer-owned coordination/log paths. It is
# safe before flock because it never replaces their inodes or touches DSH code.
repair_path "$APP_HOME/.cache" single
repair_path "$APP_HOME/.dsh-install-logs"
repair_path "$APP_HOME/.dsh-install.lock"
[ "${3:-}" != bootstrap ] || { echo '[ok] installer log/lock labels verified'; exit 0; }
# Parent directories are checked individually, never traversed: unrelated global
# npm packages and executables keep their labels/ownership.
repair_path "$APP_PREFIX/lib/node_modules" single
repair_path "$APP_PREFIX/lib/node_modules/@deepseek-ai" single
repair_path "$APP_PREFIX/lib/node_modules/@deepseek-ai/dsh"
# npm may leave a rename staging directory after EACCES. Do not touch siblings.
for path in "$APP_PREFIX/lib/node_modules/@deepseek-ai"/.dsh-*; do repair_path "$path"; done
repair_path "$APP_PREFIX/bin/dsh"
repair_path "$APP_HOME/.cache/dsh-phone-npm"
# APK payload copies may themselves be unreadable by the Termux app UID.
for name in setup-root.sh root-install-selinux.sh apply-android-patches.mjs configure-android-profile.mjs dsh-compat.mjs patch-utils.mjs verify-android-runtime.mjs start-dsh.sh boot-dsh.sh dsh-watchdog.sh dns-fwd.mjs patch-dsh.mjs patch-dsh-link.mjs patch-dsh-client-modules.mjs patch-dsh-web-auth.mjs patch-dsh-attachment-fsync.mjs patch-dsh-flock-android.mjs patch-dsh-presets.mjs verify-patched-tree.mjs verify-turn.mjs cordis.patch.yml plugin; do
  repair_path "$APP_HOME/$name"
done
echo '[ok] scoped DSH ownership/MCS repair verified (symlink targets untouched)'
