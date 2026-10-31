# CLI Capability Inventory

This inventory was checked against the locally available CLIs on 2026-08-31:

- Antigravity (`agy`) 1.1.22
- Codex 0.144.5
- Claude Code was not installed on this machine

## Antigravity

The CLI supports options Lyra can expose through the run protocol:

- `--model`
- `--effort low|medium|high`
- `--sandbox`
- `--mode accept-edits|plan`
- `--continue`
- `--conversation`
- `--add-dir`
- `--json-schema`
- `--input-format`
- `--output-format text|json|stream-json`
- `--project`
- `--new-project`
- `--disable-slash-commands`
- `--log-file`
- agent/model listing subcommands

Lyra currently forwards model, effort, continue, conversation, and additional directories through the server run options. Sandbox and mode remain pending GramBox integration.

## Codex

The CLI supports:

- `--model`
- `--sandbox read-only|workspace-write|danger-full-access`
- `--ask-for-approval untrusted|on-request|never`
- `--cd`
- `--add-dir`
- `--image`
- `--search`
- `resume`
- `review`
- `apply`
- `archive`, `delete`, `fork`, and `unarchive`
- MCP, plugin, app-server, remote-control, and exec-server subcommands

Lyra currently forwards model, sandbox policy, approval policy, additional directories, images, and search through the server run options. Session resume/review/archive/delete and MCP/plugin management are not yet represented in the Lyra UI.

## Claude Code

Claude Code was unavailable locally, so its exact installed version and flags could not be verified. The adapter should perform runtime capability detection and only advertise options returned by `claude --help` for the installed version.

Likely follow-up areas are model selection, resume/continue, permission mode, allowed/disallowed tools, additional directories, structured output, and stream format. These must be verified against the installed CLI before implementation.

## OpenCode

Lyra discovers `opencode` and starts a non-interactive `opencode run --format json` process in the assigned task worktree. The configured model is passed with `--model`. Provider authentication stays in OpenCode's native config. Lyra does not yet verify that provider auth is valid before a run; readiness reports the CLI as installed and authentication as unknown.

## Hermes Agent

Lyra discovers `hermes-agent` (or `hermes`) and starts `hermes-agent --query ...` in the task worktree. It can pass a configured `--model`; the rest of Hermes setup and provider authentication remain native. Lyra reports installed readiness only and does not currently configure Hermes toolsets or inspect its provider login.

## Remaining harness integration work

1. Add UI controls for model, effort, approval policy, sandbox policy, search, and additional directories.
2. Add authenticated/version-aware capability discovery for every installed CLI.
3. Add explicit resume/review/archive/delete actions for persisted CLI sessions.
4. Add structured output/schema support where the agent supports it.
5. Add MCP/plugin configuration only after the core run/session lifecycle is stable.
