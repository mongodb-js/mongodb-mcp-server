#!/usr/bin/env bash
# firewall.sh
# ตัวอย่างสคริปต์สำหรับสร้าง ipset และตั้ง iptables เพื่อล็อก/ปลดล็อก IP ของโดเมน Facebook

SETNAME="fb_block_set"
IPTABLES_CHAIN="FB_BLOCK_CHAIN"
DOMAINS=("facebook.com" "www.facebook.com" "m.facebook.com" "graph.facebook.com" "upload.facebook.com")

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "โปรดรันสคริปต์นี้ด้วย sudo หรือ root"
    exit 1
  fi
}

create_ipset() {
  if ! ipset list "${SETNAME}" >/dev/null 2>&1; then
    ipset create "${SETNAME}" hash:ip family inet -exist
    echo "สร้าง ipset: ${SETNAME}"
  fi
}

resolve_and_add() {
  for d in "${DOMAINS[@]}"; do
    echo "Resolving ${d} ..."
    IPS=$(dig +short "${d}" | grep -E '^[0-9\.]+' || true)
    for ip in ${IPS}; do
      [ -n "${ip}" ] && ipset add "${SETNAME}" "${ip}" -exist && echo "เพิ่ม ${ip} ลงใน ${SETNAME}"
    done
  done
}

setup_iptables_chain() {
  if ! iptables -L "${IPTABLES_CHAIN}" >/dev/null 2>&1; then
    iptables -N "${IPTABLES_CHAIN}"
    echo "สร้าง chain ${IPTABLES_CHAIN}"
  fi
  iptables -F "${IPTABLES_CHAIN}"
  iptables -A "${IPTABLES_CHAIN}" -m set --match-set "${SETNAME}" dst -j DROP
  iptables -C OUTPUT -j "${IPTABLES_CHAIN}" >/dev/null 2>&1 || iptables -I OUTPUT -j "${IPTABLES_CHAIN}"
}

teardown() {
  iptables -F "${IPTABLES_CHAIN}" >/dev/null 2>&1
  iptables -X "${IPTABLES_CHAIN}" >/dev/null 2>&1
  ipset destroy "${SETNAME}" >/dev/null 2>&1
  echo "ปลดล็อก Facebook เสร็จสิ้น"
}

case "$1" in
  block) require_root; create_ipset; resolve_and_add; setup_iptables_chain;;
  unblock) require_root; teardown;;
  *) echo "การใช้งาน: ./firewall.sh [block|unblock]";;
esac
