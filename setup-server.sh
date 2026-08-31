#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine or Docker Desktop, then run this script again."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required."
  exit 1
fi

ask_yes_no() {
  local prompt="$1" default="$2" answer
  while true; do
    read -r -p "$prompt [$default]: " answer || exit 1
    answer="${answer:-$default}"
    case "${answer,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) echo "Please answer yes or no." ;;
    esac
  done
}

echo "Lyra server setup"
echo "This creates a Docker deployment and persistent credential volumes."
echo

install_agy=false
install_codex=false
install_claude=false
ask_yes_no "Install Antigravity CLI?" "yes" && install_agy=true
ask_yes_no "Install Codex CLI?" "yes" && install_codex=true
ask_yes_no "Install Claude Code?" "no" && install_claude=true

workspace="${LYRA_WORKSPACE:-./workspace}"
read -r -p "Workspace directory [$workspace]: " input_workspace || exit 1
workspace="${input_workspace:-$workspace}"
mkdir -p "$workspace"

hub_port="${LYRA_HUB_PORT:-3001}"
read -r -p "Lyra hub port [$hub_port]: " input_hub_port || exit 1
hub_port="${input_hub_port:-$hub_port}"

auth_token="${LYRA_AUTH_TOKEN:-}"
if [[ -z "$auth_token" ]]; then
  read -r -s -p "Hub auth token (leave blank to generate one): " auth_token || exit 1
  echo
fi
if [[ -z "$auth_token" ]]; then
  auth_token="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  echo "Generated a hub auth token and stored it in .env."
fi

umask 077
cat > .env <<EOF
INSTALL_ANTIGRAVITY=$install_agy
INSTALL_CODEX=$install_codex
INSTALL_CLAUDE=$install_claude
LYRA_WORKSPACE=$workspace
LYRA_HUB_PORT=$hub_port
LYRA_AUTH_TOKEN=$auth_token
LYRA_ENABLE_UNRESTRICTED=false
EOF

echo
echo "Building Lyra with the selected CLIs..."
docker compose build
docker compose up -d

login_cli() {
  local cli="$1" command_line="$2"
  echo
  echo "Starting $cli authentication. Complete the login in this terminal/browser."
  docker compose run --rm -it lyra bash -lc "$command_line"
}

if [[ "$install_agy" == true ]] && ask_yes_no "Sign in to Antigravity now?" "yes"; then
  login_cli "Antigravity" "agy"
fi
if [[ "$install_codex" == true ]] && ask_yes_no "Sign in to Codex now?" "yes"; then
  login_cli "Codex" "codex login"
fi
if [[ "$install_claude" == true ]] && ask_yes_no "Sign in to Claude Code now?" "yes"; then
  login_cli "Claude Code" "claude"
fi

echo
echo "Lyra is running at http://localhost:$hub_port"
echo "Workspace: $workspace"
echo "Check status with: docker compose ps"
echo "View logs with:   docker compose logs -f lyra"
