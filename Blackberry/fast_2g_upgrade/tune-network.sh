#!/bin/sh
set -e
iw reg set US
ip link set wlan0 down
iw dev wlan0 set type managed || true
iw dev wlan0 set txpower fixed 2000
ip link set wlan0 up
iw dev wlan0 set power_save off || true
ethtool -K wlan0 tso off gso off gro off || true
tc qdisc replace dev br-lan root fq_codel
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216
sysctl -w net.core.rmem_default=262144
sysctl -w net.core.wmem_default=262144
systemctl restart hostapd || service hostapd restart || true
echo "Tune complete"
