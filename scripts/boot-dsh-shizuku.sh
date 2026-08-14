#!/data/data/com.termux/files/usr/bin/bash
# boot-dsh-shizuku.sh — Termux:Boot script (unrooted / Shizuku edition).
# Only starts the DSH web UI; no su / DNS / iptables here.
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib
setsid bash "$HOME/start-dsh.sh" >/dev/null 2>&1 < /dev/null &
echo "dsh boot started"
