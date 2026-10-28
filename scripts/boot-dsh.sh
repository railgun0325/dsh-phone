#!/data/data/com.termux/files/usr/bin/bash
# Termux:Boot script — DSH standalone services
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib

# 0. Does the phone's own resolver already work? Then leave :53 alone.
#
# Modern Android serves DNS from netd on 127.0.0.1:53. Binding 0.0.0.0:53 with
# dns-fwd and DNAT-ing every :53 packet at it does not "fix" a healthy phone — it
# breaks tethering: netd cannot install the tether DNS forwarders
# (ServiceSpecificException EREMOTEIO 121), the tethering session rolls back, the
# AP interface is torn down and the UI shows "个人热点已关闭" seconds after it
# started. Measured on Android 16 (iQOO), 2026-10-28. The takeover is only worth
# its risk on a network whose own resolver is actually dead (the case it was
# written for: a router handing out a dead IPv6 resolver).
dns_works() {
  timeout 6 "$PREFIX/bin/node" -e 'require("node:dns").lookup("www.baidu.com", (e) => process.exit(e ? 1 : 0))' >/dev/null 2>&1
}

DNS_URL="udp --dport 53 -j DNAT --to-destination 127.0.0.1:53"
DNS_TCP="tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53"

if dns_works; then
  echo "dns: system resolver works — leaving :53 alone"
  # Heal a phone that took the redirect on an earlier boot.
  su -c "iptables -t nat -D OUTPUT -p $DNS_URL 2>/dev/null; iptables -t nat -D OUTPUT -p $DNS_TCP 2>/dev/null"
  su -c "pkill -f dns-fwd.mjs" 2>/dev/null
else
  echo "dns: system resolver is broken — installing the DoH forwarder"
  # 1. DNS forwarder (root, binds 53) — DoH to AliDNS
  su -c "pgrep -f dns-fwd.mjs >/dev/null 2>&1 || setsid env LD_LIBRARY_PATH=$PREFIX/lib $PREFIX/bin/node $HOME/dns-fwd.mjs" &
  sleep 3

  # 2. redirect IPv4 port-53 to the local forwarder (VPN DNS 172.19.0.2 bypasses it)
  # ONLY once the forwarder actually answers. A :53 redirect with no listener takes
  # the whole phone's DNS down: every lookup dies and DSH turns fail with
  # {"code":"TRANSPORT"} on every retry. dsh-watchdog.sh fails open too, but the
  # trap should never be installed in the first place.
  if su -c "pgrep -f dns-fwd.mjs >/dev/null 2>&1"; then
    su -c "iptables -t nat -D OUTPUT -p $DNS_URL 2>/dev/null; iptables -t nat -D OUTPUT -p $DNS_TCP 2>/dev/null"
    su -c "iptables -t nat -D OUTPUT -p udp --dport 53 -d 172.19.0.2 -j RETURN 2>/dev/null; iptables -t nat -D OUTPUT -p tcp --dport 53 -d 172.19.0.2 -j RETURN 2>/dev/null"
    su -c "iptables -t nat -A OUTPUT -p udp --dport 53 -d 172.19.0.2 -j RETURN; iptables -t nat -A OUTPUT -p tcp --dport 53 -d 172.19.0.2 -j RETURN"
    su -c "iptables -t nat -A OUTPUT -p $DNS_URL; iptables -t nat -A OUTPUT -p $DNS_TCP"
    echo "dns: forwarder up, :53 redirect installed"
  else
    echo "dns: forwarder NOT listening — :53 redirect skipped (fail open); dsh-watchdog.sh will retry"
  fi

  # 3. make the router's broken IPv6 DNS (fe80::5) local so queries hit the forwarder
  su -c "ip -6 route replace local fe80::5/128 dev lo 2>/dev/null"
fi

# 4. start dsh web (a no-op when it is already healthy — see start-dsh.sh)
setsid $HOME/start-dsh.sh &

# 5. /data/adb/service.d/dsh-watchdog.sh keeps the forwarder and dsh web alive
#    from here on: it turns "the resolver died at 3am" into a 30-second blip
#    instead of a phone with no DNS and a dead DSH.
echo "boot services started"
