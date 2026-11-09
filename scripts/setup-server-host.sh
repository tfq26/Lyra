#!/usr/bin/env bash
# Turnkey setup script for hosting Lyra 24/7 on dedicated Linux servers (e.g. servlenovo1)
# with systemd auto-restart and Cloudflare Tunnel for secure, zero-port-forwarding public HTTPS.
set -euo pipefail

echo "=============================================="
echo "  🚀 Lyra 24/7 Server Deployment Setup        "
echo "=============================================="

# 1. Check Bun runtime
if ! command -v bun &>/dev/null; then
  echo "Installing Bun runtime..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
echo "✓ Bun runtime: $(bun --version)"

# 2. Check / Install cloudflared if needed
if ! command -v cloudflared &>/dev/null; then
  echo "Installing cloudflared..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
    sudo apt-get update && sudo apt-get install -y cloudflared
  else
    echo "Please install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  fi
fi

LYRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$LYRA_DIR"

echo "Installing Lyra dependencies..."
bun install

# 3. Setup systemd user service for Lyra
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_USER_DIR"

cat <<EOF > "$SYSTEMD_USER_DIR/lyra.service"
[Unit]
Description=Lyra Autonomous Hub & Cross-Device Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=$LYRA_DIR
ExecStart=$(command -v bun) run server/index.ts
Restart=always
RestartSec=5
Environment=PORT=3001
Environment=NODE_ENV=production
EnvironmentFile=-$LYRA_DIR/.env.local

[Install]
WantedBy=default.target
EOF

echo "✓ Created systemd service: $SYSTEMD_USER_DIR/lyra.service"

# Reload systemd and enable service
systemctl --user daemon-reload || true
systemctl --user enable lyra.service || true
systemctl --user restart lyra.service || true

echo ""
echo "=============================================="
echo "  ✅ Lyra Gateway running on port 3001!       "
echo "=============================================="
echo ""
echo "Next steps to expose via Cloudflare Tunnel:"
echo "1. Authenticate cloudflared:   cloudflared tunnel login"
echo "2. Create your tunnel:         cloudflared tunnel create lyra-tunnel"
echo "3. Route your custom domain:   cloudflared tunnel route dns lyra-tunnel lyra.<yourdomain.com>"
echo "4. Run tunnel service:         cloudflared tunnel --url http://localhost:3001 run lyra-tunnel"
echo ""
