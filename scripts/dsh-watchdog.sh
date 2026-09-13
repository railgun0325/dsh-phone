#!/system/bin/sh
# dsh-watchdog.sh — keep the on-device DSH stack alive on the rooted 13 Pro.
#
# Install: /data/adb/service.d/dsh-watchdog.sh  (chmod 755). Magisk runs it as
#          root at late_start service — independent of Termux:Boot and of the app,
#          so it also covers "the app was never opened after a reboot".
# Log:     /data/adb/dsh-watchdog.log
# Usage:   dsh-watchdog.sh          watch loop (default)
#          dsh-watchdog.sh once     one check cycle, then exit
#          dsh-watchdog.sh status   print state, change nothing
#
# Why this exists (2026-09-14 incident): boot-dsh.sh points *all* :53 traffic at
# 127.0.0.1:53 so the phone always has a resolver that survives a broken router
# DNS. If dns-fwd.mjs dies afterwards the redirect stays behind, and the phone is
# left with NO DNS at all: DSH turns fail with {"code":"TRANSPORT"} on every
# retry and every app that needs a name lookup breaks.
#
# Two failure shapes, two responses (measured on the 13 Pro, 2026-09-14):
#   process gone / cannot bind  -> restart it; after FAIL_LIMIT tries drop the
#                                  redirect (fail open). Fail open only helps on
#                                  a network whose own resolver works — this
#                                  phone's usual router hands out a dead IPv6
#                                  resolver (fe80::5), so the real protection is
#                                  the <=30s revival, not the fail-open.
#   bound but not answering     -> hung DoH upstream; restart it and keep the
#                                  redirect (failing open would not resolve
#                                  either, and would break a healthy upstream).
# The functional probe is what catches the hung-but-bound shape.

set -u

PREFIX=/data/data/com.termux/files/usr
THOME=/data/data/com.termux/files/home
NODE=$PREFIX/bin/node
LOG=/data/adb/dsh-watchdog.log
PIDFILE=/data/adb/dsh-watchdog.pid
DNS_LOG=/data/local/tmp/dns-fwd.log
INTERVAL=30
FAIL_LIMIT=3       # consecutive failed DNS revivals before failing open
PROBE_EVERY=10     # functional DNS probe every N cycles (~5 min)
DNS_HEX=0035       # 127.0.0.1:53
DSH_HEX=0C08       # 127.0.0.1:3080
BOOT_GRACE=45      # let Termux:Boot + start-dsh.sh win the first round
DSH_COOLDOWN=90    # never relaunch dsh web more often than this

log() {
  echo "[$(date '+%F %T')] $*" >>"$LOG"
  [ "$(wc -c <"$LOG" 2>/dev/null || echo 0)" -gt 65536 ] && tail -n 200 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  return 0
}

# --- socket state ------------------------------------------------------------
# $1 = local port as hex, $2 = state (0A = TCP LISTEN, 07 = UDP bound)
port_state() {
  for f in /proc/net/tcp /proc/net/tcp6 /proc/net/udp /proc/net/udp6; do
    [ -r "$f" ] || continue
    while read -r _sl local _rem st _rest; do
      case "$local" in
        *":$1") [ "$st" = "$2" ] && return 0 ;;
      esac
    done <"$f"
  done
  return 1
}

dns_up() { port_state "$DNS_HEX" 07 || port_state "$DNS_HEX" 0A; }
dsh_up() { port_state "$DSH_HEX" 0A; }

# End-to-end probe: name lookup + TCP/TLS through the redirected resolver. This is
# what catches a forwarder that still holds the port but answers nothing.
CURL=$PREFIX/bin/curl
PROBE_URL=https://api.deepseek.com/
dns_functional() {
  [ -x "$CURL" ] || return 0
  code=$("$CURL" -s -o /dev/null -w '%{http_code}' --max-time 6 "$PROBE_URL" 2>/dev/null)
  case "$code" in ''|000) return 1 ;; *) return 0 ;; esac
}

# --- DNS forwarder -----------------------------------------------------------
start_dns() {
  pkill -f dns-fwd.mjs 2>/dev/null
  sleep 1
  setsid env LD_LIBRARY_PATH="$PREFIX/lib" "$NODE" "$THOME/dns-fwd.mjs" >>"$DNS_LOG" 2>&1 </dev/null &
  sleep 3
  dns_up
}

dns_rules_present() {
  iptables -t nat -C OUTPUT -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null
}

dns_rules_add() {
  # Let the VPN's own resolver (172.19.0.2) bypass the local forwarder.
  for proto in udp tcp; do
    iptables -t nat -C OUTPUT -p $proto --dport 53 -d 172.19.0.2 -j RETURN 2>/dev/null \
      || iptables -t nat -A OUTPUT -p $proto --dport 53 -d 172.19.0.2 -j RETURN
  done
  for proto in udp tcp; do
    iptables -t nat -C OUTPUT -p $proto --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null \
      || iptables -t nat -A OUTPUT -p $proto --dport 53 -j DNAT --to-destination 127.0.0.1:53
  done
}

# Fail open: no forwarder -> no redirect -> the system resolver works again.
dns_rules_del() {
  for proto in udp tcp; do
    while iptables -t nat -C OUTPUT -p $proto --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null; do
      iptables -t nat -D OUTPUT -p $proto --dport 53 -j DNAT --to-destination 127.0.0.1:53
    done
  done
}

# --- dsh web -----------------------------------------------------------------
start_dsh() {
  uid=$(stat -c %u /data/data/com.termux 2>/dev/null)
  case "$uid" in ''|*[!0-9]*) log "dsh: cannot resolve Termux uid — skip"; return 1 ;; esac
  # Run as the Termux uid: dsh web must not create root-owned files in $THOME.
  setsid su "$uid" -c "$PREFIX/bin/bash $THOME/start-dsh.sh" >/dev/null 2>&1 </dev/null &
  return 0
}

# --- one cycle ---------------------------------------------------------------
dns_fails=0
probe_fails=0
cycle_no=0
last_dsh_start=0

cycle() {
  cycle_no=$((cycle_no + 1))

  # 1. DNS forwarder + its redirect
  if dns_up; then
    dns_fails=0
    dns_rules_present || { dns_rules_add; log "dns: forwarder up, redirect restored"; }
    if [ $((cycle_no % PROBE_EVERY)) -eq 0 ] && ! dns_functional; then
      probe_fails=$((probe_fails + 1))
      log "dns: bound but not answering (probe fail $probe_fails) — restarting dns-fwd.mjs"
      if start_dns; then
        log "dns: probe revival ok"
      else
        log "dns: probe revival failed; redirect kept (failing open would not resolve either)"
      fi
    else
      probe_fails=0
    fi
  else
    log "dns: 127.0.0.1:53 not served — restarting dns-fwd.mjs"
    if start_dns; then
      dns_fails=0
      dns_rules_add
      log "dns: recovered"
    else
      dns_fails=$((dns_fails + 1))
      log "dns: revival failed ($dns_fails/$FAIL_LIMIT)"
      if [ "$dns_fails" -ge "$FAIL_LIMIT" ] && dns_rules_present; then
        dns_rules_del
        log "dns: FAIL OPEN — :53 redirect removed, system resolver is back in charge"
      fi
    fi
  fi

  # 2. dsh web (MIUI freezes/kills it; the app's WebView only gets one load)
  if dsh_up; then
    :
  else
    now=$(date +%s)
    if [ $((now - last_dsh_start)) -ge "$DSH_COOLDOWN" ]; then
      last_dsh_start=$now
      log "dsh: 3080 not listening — starting dsh web"
      start_dsh
    fi
  fi
}

status() {
  echo "dns-fwd process : $(pgrep -f dns-fwd.mjs | tr '\n' ' ')"
  echo "port 53 served  : $(dns_up && echo yes || echo NO)"
  echo "dns probe       : $(dns_functional && echo ok || echo FAIL)"
  echo ":53 redirect    : $(dns_rules_present && echo present || echo absent)"
  echo "dsh web process : $(pgrep -f 'bin.js web' | tr '\n' ' ')"
  echo "port 3080       : $(dsh_up && echo listening || echo DOWN)"
  echo "--- iptables nat OUTPUT ---"
  iptables -t nat -S OUTPUT 2>/dev/null | grep -E 'DNAT|RETURN' || echo "(no dns rules)"
}

case "${1:-watch}" in
  status) status ;;
  once)   cycle; status ;;
  watch)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
      echo "dsh-watchdog already running (pid $(cat "$PIDFILE"))" >&2
      exit 0
    fi
    echo $$ >"$PIDFILE"
    while [ "$(getprop sys.boot_completed 2>/dev/null)" != "1" ]; do sleep 5; done
    log "watchdog start (pid $$)"
    sleep "$BOOT_GRACE"
    while :; do
      cycle
      sleep "$INTERVAL"
    done
    ;;
  *) echo "usage: $0 [watch|once|status]" >&2; exit 2 ;;
esac
