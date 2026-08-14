#!/data/data/com.termux/files/usr/bin/bash
# Termux:Boot script — DSH standalone services
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib

# 1. DNS forwarder (root, binds 53) — DoH to AliDNS
su -c "setsid env LD_LIBRARY_PATH=$PREFIX/lib $PREFIX/bin/node $HOME/dns-fwd.mjs" &
sleep 2

# 2. redirect IPv4 port-53 to the local forwarder
su -c "iptables -t nat -D OUTPUT -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null; iptables -t nat -D OUTPUT -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null"
su -c "iptables -t nat -A OUTPUT -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53; iptables -t nat -A OUTPUT -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53"

# 3. make the router's broken IPv6 DNS (fe80::5) local so queries hit the forwarder
su -c "ip -6 route replace local fe80::5/128 dev lo 2>/dev/null"

# 4. start dsh web
setsid /data/data/com.termux/files/home/start-dsh.sh &

echo "boot services started"
