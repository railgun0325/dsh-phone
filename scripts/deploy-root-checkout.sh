#!/data/data/com.termux/files/usr/bin/bash
# Run from a reviewed checkout in ordinary Termux, never through su UID.
set -Eeuo pipefail
umask 077
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
app_home=/data/data/com.termux/files/home
[ "$(id -u)" != 0 ] && [ "$HOME" = "$app_home" ] || { echo 'Open ordinary Termux and retry.'; exit 1; }
case "$(cat /proc/self/attr/current)" in u:r:untrusted_app*:s0:c*|u:r:runas_app:s0:c*) ;; *) echo 'Unsafe SELinux execution domain; use ordinary Termux.'; exit 1;; esac
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
echo 'Stopping this DSH web/watchdog for update; user sessions and API key stay on the phone.'
su -c "pkill -TERM -f '[/]dsh-watchdog[.]sh([[:space:]]|$)' 2>/dev/null || true; pkill -TERM -u $(id -u) -f '[/]dsh/lib/bin[.]js web' 2>/dev/null || true"
sleep 2
# Use the new reviewed helper before overwriting old, potentially inaccessible payloads.
su -c "sh $(quote "$repo/scripts/root-install-selinux.sh") $(id -u) $(id -g)"
backup="$app_home/.dsh-payload-backups/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$backup" "$app_home/plugin/lib"
files='setup-root.sh root-install-selinux.sh configure-android-profile.mjs apply-android-patches.mjs dsh-compat.mjs patch-utils.mjs verify-android-runtime.mjs start-dsh.sh boot-dsh.sh dsh-watchdog.sh dns-fwd.mjs patch-dsh.mjs patch-dsh-link.mjs patch-dsh-client-modules.mjs patch-dsh-web-auth.mjs patch-dsh-flock-android.mjs patch-dsh-presets.mjs patch-dsh-attachment-fsync.mjs verify-turn.mjs verify-patched-tree.mjs install-api-key.sh cordis.patch.yml'
for file in $files; do
  [ ! -e "$app_home/$file" ] || cp -p "$app_home/$file" "$backup/"
  install -m 600 "$repo/scripts/$file" "$app_home/$file"
done
cp -R "$app_home/plugin" "$backup/plugin"
install -m 600 "$repo/plugin/index.js" "$repo/plugin/package.json" "$repo/plugin/cordis.patch.yml" "$app_home/plugin/"
install -m 600 "$repo/plugin/lib/client.js" "$app_home/plugin/lib/"
DSH_VERSION="${DSH_VERSION:-0.2.0-rc.2}" bash "$app_home/setup-root.sh"
# This block runs only after every mandatory gate succeeds.
mkdir -p "$app_home/.termux/boot"
install -m 700 "$app_home/boot-dsh.sh" "$app_home/.termux/boot/boot-dsh.sh"
# A Termux:Boot invocation executes directly, so this launcher needs execute mode.
chmod 700 "$app_home/start-dsh.sh"
setsid bash "$app_home/start-dsh.sh" >/dev/null 2>&1 </dev/null &
echo 'Installed and startup requested. Next: node ~/verify-turn.mjs 3080 ~ (uses your local API account).'
