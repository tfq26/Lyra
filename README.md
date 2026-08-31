# Lyra — Multi-Agent Developer Interface

Lyra is a minimal, typography-first desktop & web workspace for developers using **Antigravity CLI**, **Claude Code**, and **Codex CLI**.

It replaces noisy terminal escape sequences with a clean, high-contrast engineering interface featuring native Mermaid diagram rendering, live reasoning streams, collapsible tool execution cards, side-by-side git diffs, and an autonomous inter-agent dispatch bridge.

---

## ⚡ Features

- **Noisy Terminal Stripping**: Converts raw CLI streams and JSONL trajectories into clean markdown with typography and syntax highlighting.
- **Native Mermaid Vector Diagrams**: Automatically renders architecture charts, entity relationships, sequence diagrams, and state machines directly in the response.
- **Collapsible Reasoning Streams**: Non-intrusive disclosure panels for model thinking and chain-of-thought traces.
- **Structured Tool Call Cards**: Inspect bash executions, file edits, and codebase grep operations with status badges and inputs/outputs.
- **Cross-Agent Dispatch Bridge**: Seamlessly pass architectural plans and task breakdowns from Antigravity (as planner/lead) to Claude Code (as implementer) and Codex (for automated tests).
- **Live Antigravity Transcript Watcher**: Connects to `~/.gemini/antigravity-cli/brain/` to automatically mirror active terminal agent runs in real time.

---

## 🚀 Quickstart

### Prerequisites
- Node.js (v20+) or Bun (v1.2+)

### Starting Lyra
In the project directory:

```bash
cd /Users/taufeeqali/projects/Lyra
bun run dev
# or npm run dev
```

This starts both:
1. **Lyra Hub (WebSocket/Process Server)** on `http://localhost:3001`
2. **Lyra UI (Vite Frontend)** on `http://localhost:5173`

Open `http://localhost:5173` in your browser.

### Safety and runtime configuration

Agent runs default to `safe` mode. Dangerous CLI bypass flags are only enabled when both
the session requests `unrestricted` mode and `LYRA_ENABLE_UNRESTRICTED=true` is set on the
server. Use `LYRA_AGENT_TIMEOUT_MS` to configure the maximum run duration.

For a protected hub deployment, set `LYRA_AUTH_TOKEN`; API requests must send it as a
Bearer token and WebSocket clients may provide it as a bearer header or `?token=` query
parameter. This token gate is intended as a deployment bridge; a complete OIDC provider
integration remains a follow-up before exposing Lyra to multiple users.

For the Vite client to attach the token automatically, also set
`VITE_LYRA_AUTH_TOKEN` when starting the UI.

See [`docs/cli-capabilities.md`](docs/cli-capabilities.md) for the locally verified agent
CLI options and current Lyra forwarding support.

### Linux Docker deployment

On the Linux server, run `./setup-server.sh`. The script interactively selects which CLIs
to install, builds the image, starts Lyra, and then launches each selected CLI's own login
flow. Antigravity's official Linux/macOS installer is used, Codex is installed from its
official npm package, and Claude Code is installed from Anthropic's official npm package.
Credentials are kept in Docker volumes rather than committed to the image.

---

## 📁 Architecture Overview

```
Lyra/
├── src/
│   ├── components/
│   │   ├── MermaidDiagram.tsx      # Interactive vector SVG diagram renderer
│   │   ├── ToolExecutionCard.tsx   # Clean tool invocation inspector
│   │   ├── DiffViewer.tsx          # Minimal patch / file diff viewer
│   │   ├── MessageItem.tsx         # Markdown, code blocks & handoff triggers
│   │   ├── AgentSelector.tsx       # Switch between Antigravity, Claude, Codex
│   │   ├── MultiAgentBridge.tsx    # Autonomous cross-agent pipeline coordinator
│   │   ├── Sidebar.tsx             # Workspace selector & agent engine statuses
│   │   └── ChatView.tsx            # Main stream console and prompt input
│   ├── types/                      # Shared session and message schemas
│   └── App.tsx                     # Main layout & WebSocket event loop
├── server/
│   ├── antigravityWatcher.ts       # Watches ~/.gemini/antigravity-cli/brain/
│   ├── processManager.ts           # Subprocess / SDK runner
│   ├── messageBus.ts               # Inter-agent task queue
│   └── index.ts                    # WebSocket & HTTP API hub
```

---

## 🛠 Design Philosophy

- **Zero "Vibe-Coded" Fluff**: No neon gradients, artificial glowing bubbles, or generic AI chat illustrations.
- **Utilitarian & Minimal**: Monochromatic neutral palette (Zinc / Neutral 950), crisp 1px borders, compact padding, and monospace fonts for technical data.
