#!/usr/bin/env bash
set -euo pipefail

# Installs and starts Lyra RunnerDaemon as a persistent 24/7 background service
# on Linux (systemd user service) or macOS (launchd user agent).

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${LYRA_RUNNER_ENV:-$REPO_DIR/.env.runner}"
BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"

if [[ -z "$BUN_BIN" ]]; then
  echo "Error: bun is not installed or not in PATH." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Creating $ENV_FILE from .env.runner.example (edit LYRA_HUB_URL before starting if needed)..."
  cp "$REPO_DIR/.env.runner.example" "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

OS_NAME="$(uname -s)"

if [[ "$OS_NAME" == "Linux" ]]; then
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"
  SERVICE_FILE="$SERVICE_DIR/lyra-runner.service"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Lyra Homelab Runner Daemon
After=network-online.target tailscaled.service

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$BUN_BIN run server/runnerDaemon.ts
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now lyra-runner.service
  echo "Installed and started systemd user service: lyra-runner.service"
  echo "Logs: journalctl --user -u lyra-runner.service -f"
elif [[ "$OS_NAME" == "Darwin" ]]; then
  PLIST_DIR="$HOME/Library/LaunchAgents"
  mkdir -p "$PLIST_DIR"
  PLIST_FILE="$PLIST_DIR/com.lyra.runner.plist"
  cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.lyra.runner</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN_BIN</string>
    <string>run</string>
    <string>server/runnerDaemon.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LYRA_HUB_URL</key>
    <string>${LYRA_HUB_URL:-ws://127.0.0.1:3001}</string>
    <key>LYRA_RUNNER_NAME</key>
    <string>${LYRA_RUNNER_NAME:-$(hostname)}</string>
    <key>LYRA_RUNNER_MAX_CONCURRENCY</key>
    <string>${LYRA_RUNNER_MAX_CONCURRENCY:-4}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/.lyra/runner.out.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.lyra/runner.err.log</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  launchctl load "$PLIST_FILE"
  echo "Installed and started launchd agent: com.lyra.runner"
  echo "Logs: tail -f ~/.lyra/runner.out.log ~/.lyra/runner.err.log"
else
  echo "Unsupported OS: $OS_NAME. Run manually with: bun run runner" >&2
  exit 1
fi
