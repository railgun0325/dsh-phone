#!/data/data/com.termux/files/usr/bin/bash
# Save the DeepSeek API key to ~/.dsh-api-key (read by start-dsh.sh at boot).
# Usage: bash install-api-key.sh sk-xxxx   (or run without args and paste it)
set -euo pipefail
umask 077
export HOME=/data/data/com.termux/files/home
if [ -n "${1:-}" ]; then
  KEY="$1"
else
  printf 'DeepSeek API key (sk-...): '
  read -rs KEY
  printf '\n'
fi
printf '%s' "$KEY" | grep -Eq '^sk-[A-Za-z0-9_-]+$' || { echo 'Invalid key format; existing key preserved.'; exit 1; }
KEY_FILE=$(mktemp "$HOME/.dsh-api-key.XXXXXX")
trap 'rm -f "$KEY_FILE"' EXIT
printf '%s' "$KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"
mv -f "$KEY_FILE" "$HOME/.dsh-api-key"
unset KEY
echo 'key saved to ~/.dsh-api-key (chmod 600)'
