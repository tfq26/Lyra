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
