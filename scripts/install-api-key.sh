#!/data/data/com.termux/files/usr/bin/bash
# Save the DeepSeek API key to ~/.dsh-api-key (read by start-dsh.sh at boot).
# Usage: bash install-api-key.sh sk-xxxx   (or run without args and paste it)
set -e
export HOME=/data/data/com.termux/files/home
if [ -n "$1" ]; then
  KEY="$1"
else
  printf 'DeepSeek API key (sk-...): '
  read -r KEY
fi
printf '%s' "$KEY" > "$HOME/.dsh-api-key"
chmod 600 "$HOME/.dsh-api-key"
echo 'key saved to ~/.dsh-api-key (chmod 600)'
