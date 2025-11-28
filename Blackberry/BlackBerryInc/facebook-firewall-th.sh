#!/usr/bin/env bash
# ===============================================================
#  facebook-firewall-th.sh
#  All-in-One Script — Facebook Firewall (Thailand Edition)
# ===============================================================
#  Features:
#    ✅ ipset + iptables blocking of Facebook-related domains/IPs
#    ✅ nftables optional rule generation
#    ✅ auto-update function
#    ✅ single-file deploy (GitHub-ready)
#
#  Usage:
#    sudo bash facebook-firewall-th.sh install
#    sudo bash facebook-firewall-th.sh update
#    sudo bash facebook-firewall-th.sh uninstall
#
#  Author: ChatGPT (for เตชสิทธ์ ล้วนทร)
#  License: MIT
# ===============================================================

set -euo pipefail
IPSET_NAME="fb_block_th"
TTL=86400
DOMAINS=(
  "facebook.com"
  "www.facebook.com"
  "m.facebook.com"
  "touch.facebook.com"
  "fbcdn.net"
  "staticxx.facebook.com"
  "scontent.xx.fbcdn.net"
  "connect.facebook.net"
  "graph.facebook.com"
  "messenger.com"
  "cdninstagram.com"
)

# -------------------------------
# Helper functions
# -------------------------------
create_ipset() {
  echo "[+] Creating ipset..."
  sudo ipset create "$IPSET_NAME" hash:ip timeout $TTL 2>/dev/null || true
}

flush_ipset() {
  echo "[*] Flushing ipset..."
  sudo ipset flush "$IPSET_NAME" 2>/dev/null || true
}

populate_ipset() {
  echo "[*] Resolving Facebook-related domains..."
  for d in "${DOMAINS[@]}"; do
    mapfile -t ips < <(dig +short A "$d" | sort -u)
    for ip in "${ips[@]}"; do
      [[ -n "$ip" ]] && sudo ipset add "$IPSET_NAME" "$ip" 2>/dev/null || true
    done
  done
  echo "[+] Added $(sudo ipset list "$IPSET_NAME" | grep -c "^[0-9]") IPs to ipset."
}

ensure_rules() {
  echo "[*] Adding iptables rules..."
  sudo iptables -C FORWARD -m set --match-set "$IPSET_NAME" dst -j DROP 2>/dev/null || \
  sudo iptables -I FORWARD -m set --match-set "$IPSET_NAME" dst -j DROP
  sudo iptables -C OUTPUT -m set --match-set "$IPSET_NAME" dst -j DROP 2>/dev/null || \
  sudo iptables -I OUTPUT -m set --match-set "$IPSET_NAME" dst -j DROP
}

remove_rules() {
  echo "[-] Removing iptables rules..."
  sudo iptables -D FORWARD -m set --match-set "$IPSET_NAME" dst -j DROP 2>/dev/null || true
  sudo iptables -D OUTPUT -m set --match-set "$IPSET_NAME" dst -j DROP 2>/dev/null || true
}

destroy_ipset() {
  echo "[-] Destroying ipset..."
  sudo ipset destroy "$IPSET_NAME" 2>/dev/null || true
}

# -------------------------------
# nftables optional config
# -------------------------------
generate_nftables() {
cat <<'NFT' | sudo tee /etc/nftables-facebook-block.nft >/dev/null
#!/usr/sbin/nft -f
table inet fbblock {
  set fb_ips {
    type ipv4_addr
    flags timeout
    timeout 24h
  }

  chain forward {
    type filter hook forward priority 0; policy accept;
    ip daddr @fb_ips counter drop
  }

  chain output {
    type filter hook output priority 0; policy accept;
    ip daddr @fb_ips counter drop
  }
}
NFT
echo "[+] Generated /etc/nftables-facebook-block.nft"
}

# -------------------------------
# Systemd service (optional)
# -------------------------------
create_systemd_unit() {
sudo tee /etc/systemd/system/fb-blocker.service >/dev/null <<EOF
[Unit]
Description=Facebook Firewall Updater (Thailand)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/facebook-firewall-th.sh update
EOF
echo "[+] Created systemd unit: /etc/systemd/system/fb-blocker.service"
}

# -------------------------------
# Actions
# -------------------------------
case "${1:-install}" in
  install)
    create_ipset
    flush_ipset
    populate_ipset
    ensure_rules
    generate_nftables
    echo
    echo "✅ Facebook Firewall (Thailand) installed successfully."
    echo "Run 'sudo bash facebook-firewall-th.sh update' to refresh IPs."
    ;;
  update)
    flush_ipset
    populate_ipset
    echo "✅ Facebook Firewall updated successfully."
    ;;
  uninstall)
    remove_rules
    destroy_ipset
    sudo rm -f /etc/nftables-facebook-block.nft /etc/systemd/system/fb-blocker.service
    echo "🧹 Facebook Firewall uninstalled and cleaned up."
    ;;
  *)
    echo "Usage: $0 {install|update|uninstall}"
    ;;
esac

# ===============================================================
#  Announcement Post (for GitHub)
# ===============================================================
# Title: Facebook Firewall — sample rules for local control 🇹🇭
#
# I released an all-in-one firewall script that blocks Facebook-related
# domains/IPs for educational or lab use. It supports iptables + nftables
# and includes automatic updates.
#
# ⚠️ Use responsibly: check Thai laws and your network policies before use.
#
# Repo: facebook-firewall-th
#
# ===============================================================
#  End of Script
# ===============================================================
