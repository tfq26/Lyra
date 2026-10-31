# Lyra: native Strands coding harness

Status: product direction updated October 26, 2026. This document contains both proposed and implemented behavior; implementation notes are marked where relevant.

## Current direction update

Lyra is becoming a native cloud coding harness. Solo coding runs use Strands agents with Amazon Bedrock or OpenRouter, Lyra-owned repository tools, compatibility checks, approval-gated shell commands, persisted agent snapshots, and resumable run checkpoints. The UI can import public GitHub repositories into a persistent workspace. Provider credentials are never stored in model profile JSON; hosted BYO secrets use AWS Secrets Manager.

External CLI harnesses remain only for the existing legacy team workflow during the transition. The intended integration is an optional Lyra MCP server after single-agent continuity is proven. Native swarms follow the single-agent recovery gate rather than being treated as complete today.

The hosted product is AWS-only. The current scaffold mounts EFS for workspace/data, journals events to PostgreSQL, stores Strands snapshots in S3, dispatches native runs to isolated Fargate tasks over an authenticated WebSocket, and uses Better Auth for email/password login. It is still not a production multi-tenant service: team membership/tenant authorization, complete relational state migration, CloudFront frontend hosting, and billing/cost allowance enforcement remain incomplete. Hosted sign-up is disabled by default and the seven-day resume and 24-hour active-session proof has not yet been run.

## Product promise

Give Lyra a project objective and repository. Lyra's native agent plans and edits code, runs approved checks, and resumes the conversation and workspace across devices. The user can inspect the diff, tool activity, checkpoints, and verification results in one conversation.

The target is one prompt to a verified result, with follow-up only when a decision, permission, unavailable capability, or unresolved blocker requires the user. Completion depends on acceptance checks, not an agent saying it is finished.

## Core experience

- A project points to a cloud workspace and owns its conversations, run history, checkpoints, and artifacts.
- A conversation is persisted independently of a device. Reconnecting clients fetch ordered events from their last cursor.
- Native agent turns use only Bedrock or OpenRouter models and expose Fully compatible or Limited compatibility results for each tested provider/model pair.
- Routine in-workspace edits and verification can proceed; shell commands outside the pre-approved check set pause for user approval.
- The conversation contains user instructions, agent answers, concise progress, decisions, and result evidence. Detailed execution logs live in the activity panel; private reasoning is not shown.

The Solo/Team CLI workflow below describes the legacy coordinator retained during the native-harness transition. It is not the first native-harness proof gate.

## Legacy CLI team workflow (transition only)

1. Select a project, enter an objective, and choose Team mode.
2. Select available harnesses and role assignments. Show connection readiness and supported controls. Let the user save team defaults per project.
3. The lead inspects the project and produces tasks with dependencies, expected outputs, and acceptance checks. Show the plan in the conversation; proceed automatically within the configured permissions. An optional review-plan setting pauses before implementation.
4. A server coordinator validates the plan and dispatches ready tasks. Each handoff includes the objective, assigned scope, relevant decisions, predecessor results, workspace identity, and expected checks.
5. For the initial milestone, run implementation sequentially in one isolated run worktree. Later, independent workers use separate task worktrees and merge through an integration worktree.
6. A reviewer inspects the actual changes and check results. Findings return to the implementer, with at most two repair rounds by default.
7. Verify the integrated result against the configured checks. A process exit code of zero is necessary for successful execution but is not sufficient for project completion.
8. Return a result card: completed requirements, changed files/diff, checks and outcomes, unresolved items, and the branch/worktree containing the result. Preserve the user's original checkout. Publishing and deployment are separate explicitly requested actions.

If a requested check cannot run, display it as unverified and keep the run in needs-attention until the user resolves or explicitly accepts the limitation. Never silently remove a requirement to obtain a green result.

## Run behavior and controls

- **Steer:** send a follow-up to the lead. Persist a revision of the objective; apply it at the next safe boundary. Show whether the instruction is queued or applied.
- **Pause:** stop dispatching new tasks; allow in-flight work to reach its boundary. Show “Pausing” until that occurs.
- **Stop:** cancel active processes and pending tasks; retain logs and partial changes. Never mark cancelled work completed.
- **Resume:** continue from persisted state. After a server restart, reconcile interrupted tasks before dispatching; do not assume their child processes stopped or their work succeeded.
- **Retry:** create a new recorded attempt with prior errors attached. Avoid automatic repeated retries for missing authentication or exhausted usage.
- **Harness unavailable:** hold dependent work and show the actionable reason. Switching harness requires a compatible capability set and an explicit assignment or previously configured fallback.
- **Limits:** default to two concurrent workers in the later parallel milestone, two repair rounds, and a configurable run deadline. Reaching a limit produces needs-attention, not success.
- **Usage:** display provider-reported usage/limits only when available. Otherwise label them unavailable. No synthetic subscription balances or automatic switch to paid API billing.

## Professional chat UI

### Information architecture

Use one application shell with three areas:

| Area | Contents | Default behavior |
| --- | --- | --- |
| Left sidebar | Project switcher, New conversation, search, pinned/recent conversations; Connections and Settings at the bottom | 260px wide; collapsible |
| Main conversation | Title and project, message timeline, run summary cards, sticky composer | Primary workspace; readable message width of 760–820px |
| Right inspector | Team, Tasks, Changes, Checks | 340–400px wide; optional, opened from run cards or header |

Replace “Console” with “Chat” and fold “Agent Bridge” into Team mode. A user should not leave their conversation to coordinate agents. Harness-specific task transcripts open in the inspector and remain linked to their parent run.

### Visual direction

- Quiet neutral surfaces, restrained accent color, clear typography, and consistent spacing. Keep the Lyra identity and existing harness icons.
- Default to a polished dark theme; build with semantic tokens so a light theme can follow without rewriting components.
- Conversation body: 15–16px with 1.6 line height. Navigation: 13–14px. Metadata: 12px minimum. Reserve monospace for code, paths, and command output.
- Distinguish sidebar, conversation, and popovers with subtle surface differences. Use borders at meaningful boundaries rather than boxing every text block.
- Use an 8px spacing rhythm, 8–12px control radii, and restrained shadows for floating surfaces. Avoid decorative gradients and constant animation.
- Agent answers have clear author identity and generous spacing. User messages use a restrained tinted surface. Tool activity is compact and collapsed by default.
- Keep the application version, storage paths, and advanced runtime settings in Settings instead of the conversation header.

### Header and composer

- Header: conversation title, project name, concise run status, inspector toggle, and overflow menu. Rename/archive and destructive conversation actions belong in the menu.
- Composer: a growing multiline input in a clearly bounded surface, Solo/Team selector, harness or team summary, context picker, and send/stop control.
- Keep model selection accessible; put effort, permissions, additional directories, and advanced harness options in a secondary popover. Show only controls verified as supported.
- Enter sends; Shift+Enter adds a newline. Respect IME composition. Preserve per-conversation drafts when navigating or when disconnected.
- During a run, label sending as a follow-up; indicate queued delivery. Scope stop controls to the active conversation and its run.
- Show selected project/context visibly before sending. Unsupported attachment actions should not appear as working controls.

### Conversation details

- Stream answers without moving the reader when they scroll upward; offer “Jump to latest.”
- Show concise stages such as Planning, Implementing, Reviewing, and Checking with expandable task details.
- Separate progress summaries from final answers. Do not expose internal reasoning traces as the primary conversation content.
- Support readable Markdown, copyable code blocks, diagrams, and expandable diffs using the existing renderers.
- Display errors inline with a specific recovery action; reserve toast notifications for transient confirmations.
- Provide designed states for an empty project, no harness connected, loading history, reconnecting, running, paused, failed, cancelled, and completed.
- At narrow widths, the sidebar and inspector become drawers. No horizontal page overflow; code and diffs may scroll within their own containers.
- All controls need accessible names, visible keyboard focus, sufficient contrast, and reduced-motion support. State must not be conveyed by color alone.

## Engineering contract

### Harness adapter

Introduce a common execution interface with discovery, readiness, start, event streaming, cancel, and optional resume. Discovery distinguishes installed, authenticated, ready, busy, and unavailable; unsupported checks are unknown, not implicitly successful.

The adapter declares supported modes, options, structured results, and resume semantics from the installed interface. Keep transcript import separate from managed execution. Additional harnesses integrate through this contract without changes to the workflow scheduler.

Do not extract credentials into a shared model proxy. Verify each harness's supported authentication and automation behavior before enabling it. Existing subscriptions do not imply identical capabilities or unlimited use.

### Persisted entities

| Entity | Required data |
| --- | --- |
| Project | ID, canonical workspace path, repository identity, defaults |
| Conversation | ID, project ID, title, messages, draft, timestamps |
| Run | ID, conversation ID, objective revision, acceptance criteria, role assignments, state, limits, integration workspace |
| Task | ID, run ID, scope, dependencies, assigned harness, status, expected outputs |
| Attempt | ID, task ID, native session ID, workspace, start/end times, exit/signal/error, result |
| Artifact/check | Run/task/attempt IDs, source revision, path or command, outcome, evidence |
| Event | Stable ID, sequence, project/conversation/run/task/attempt IDs, type, timestamp, payload |

The server owns state transitions. The browser renders snapshots and ordered events; reconnecting or reloading must not launch new tasks. Dispatch needs idempotency, dependency checks, and a per-task execution claim to prevent duplicate work.

Task states: pending, ready, running, succeeded, failed, blocked, cancelled. Run states: queued, planning, executing, reviewing, verifying, pausing, paused, needs-attention, completed, failed, cancelled. Only validated coordinator transitions may start dependent work or declare completion.

All process paths must emit exactly one terminal outcome, preserve run IDs, capture nonzero exits and spawn failures, flush final stream fragments, and terminate managed descendants on cancellation/deadline. A human-readable fallback response must never substitute for harness execution.

### Workspace handling

Use the selected project's canonical directory, never the hub process directory by default. Record base revisions and worktree ownership. Do not overwrite dirty user changes. For non-Git directories, initially support Solo mode and explain that Team isolation requires a Git repository. Retain incomplete worktrees until explicit cleanup or a configured retention policy.

## Delivery sequence and acceptance

### 1. Reliable execution foundation

Fix premature completion, simulated fallback success, missing exit/error propagation, task updates, selected-project routing, and conversation-scoped cancellation. Validate supported installed CLI interfaces.

Acceptance: success, nonzero exit, missing executable, cancellation, timeout, and incomplete stream scenarios produce one correct terminal outcome. Dependencies never start after a failed predecessor. Two conversations cannot stop or misattribute each other's runs.

### 2. Chat UI refresh

Refactor the existing Sidebar, ChatView, MessageItem, AgentSelector, and AgentOptions into the new shell. Establish tokens and typography, improve composer and message layout, and implement loading/error/responsive states. Preserve working session history, streaming, code/diagram rendering, and native desktop behavior.

Acceptance: inspect desktop and narrow layouts; verify keyboard/IME input, draft preservation, focus, scrolling during streaming, reconnect feedback, and scoped stop behavior. Do not display fabricated Team activity while the coordinator is unfinished.

### 3. Two-harness Team workflow

Add persisted runs/tasks/attempts, a sequential scheduler, one isolated run worktree, configurable roles, structured handoffs, independent review, checks, and bounded repair. Replace the bridge panel with run cards and the inspector.

Acceptance: one objective executes planning, implementation, review, and verification across two actual harnesses; inject a failing check and observe repair or needs-attention. Refresh/restart without duplicate dispatch. Inspect the final diff and check evidence. Never count an unverified check as passing.

### 4. Parallel workers and extensibility

Add task worktrees, bounded concurrency, dependency scheduling, serialized integration, conflict handling, and a documented harness registration contract. Surface actual provider usage where supported.

Acceptance: independent tasks can run concurrently without sharing a writable checkout; merge conflicts block integration visibly; checks run on the integrated revision; a test adapter can register without adding scheduler branches.

## Initial scope boundaries

Local, single-user coordination first. Cross-machine scheduling, hosted multi-user execution, automatic deployment, billing aggregation, arbitrary autonomous agent spawning, and universal skill synchronization are later work. The first release uses configurable role assignments; automatic “best harness” routing requires measured project outcomes rather than assumed brand strengths.

## Decisions to revisit after the first prototype

- User preference for density, default theme, and inspector behavior after seeing the chat refresh.
- Which two installed, authenticated harnesses pass the first end-to-end integration checks.
- Which project checks constitute completion and which require explicit user acceptance.
- How native skills/configuration can be selected per harness without changing their meaning or execution permissions.
