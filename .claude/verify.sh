#!/usr/bin/env bash
# Fast pre-stop check used by the global Claude Code Stop hook. No network or credentials.
set -e
cd "$(dirname "$0")/.."
bun run typecheck
