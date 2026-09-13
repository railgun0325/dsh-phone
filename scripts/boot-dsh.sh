#!/data/data/com.termux/files/usr/bin/bash
# Termux:Boot script — DSH standalone services
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib

# 1. DNS forwarder (root, binds 53) — DoH to AliDNS
su -c "pgrep -f dns-fwd.mjs >/dev/null 2>&1 || setsid env LD_LIBRARY_PATH=$PREFIX/lib $PREFIX/bin/node $HOME/dns-fwd.mjs" &
sleep 3

# 2. redirect IPv4 port-53 to the local forwarder (VPN DNS 172.19.0.2 bypasses it)
# ONLY once the forwarder actually answers. A :53 redirect with no listener takes
# the whole phone's DNS down: every lookup dies and DSH turns fail with
# {"code":"TRANSPORT"} on every retry. dsh-watchdog.sh fails open too, but the
# trap should never be installed in the first place.
if su -c "grep -q ':0035' /proc/net/udp /proc/net/udp6"; then
  su -c "iptables -t nat -D OUTPUT -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null; iptables -t nat -D OUTPUT -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null"
  su -c "iptables -t nat -D OUTPUT -p udp --dport 53 -d 172.19.0.2 -j RETURN 2>/dev/null; iptables -t nat -D OUTPUT -p tcp --dport 53 -d 172.19.0.2 -j RETURN 2>/dev/null"
  su -c "iptables -t nat -A OUTPUT -p udp --dport 53 -d 172.19.0.2 -j RETURN; iptables -t nat -A OUTPUT -p tcp --dport 53 -d 172.19.0.2 -j RETURN"
  su -c "iptables -t nat -A OUTPUT -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53; iptables -t nat -A OUTPUT -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53"
  echo "dns: forwarder up, :53 redirect installed"
else
  echo "dns: forwarder NOT listening — :53 redirect skipped (fail open); dsh-watchdog.sh will retry"
fi

# 3. make the router's broken IPv6 DNS (fe80::5) local so queries hit the forwarder
su -c "ip -6 route replace local fe80::5/128 dev lo 2>/dev/null"

# 4. start dsh web (a no-op when it is already healthy — see start-dsh.sh)
setsid $HOME/start-dsh.sh &

# 5. /data/adb/service.d/dsh-watchdog.sh keeps the forwarder and dsh web alive
#    from here on: it turns "the resolver died at 3am" into a 30-second blip
#    instead of a phone with no DNS and a dead DSH.
echo "boot services started"
