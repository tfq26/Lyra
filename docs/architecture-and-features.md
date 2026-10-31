# Lyra: Autonomous Cloud Swarm & Orchestration Engine

Lyra is a **headless, harness-agnostic autonomous engineering platform** designed to execute complex, multi-stage software development swarms in the cloud while preserving zero disruption on your local workspace.

Rather than duplicating chat interfaces, Lyra plugs directly into your existing development tools (**Antigravity**, **OpenAI Codex CLI**, **Claude Code**, **Cursor**) via a **11-tool Model Context Protocol (MCP) server** and REST gateway. It orchestrates parallel worker fleets across isolated Git shadow worktrees, enforces AWS Bedrock security guardrails and FinOps budget ceilings, and deploys ephemeral web previews to AWS S3.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph HarnessLayer ["Developer Harness Layer (Local Machine)"]
        IDE["Developer IDE / Terminal\n(Antigravity, Codex, Cursor, Claude Code)"]
        MCP["Lyra Harness MCP Server\n(11 Standardized Tools via Stdio/HTTP)"]
        UI["Lyra Mission Control Dashboard\n(Vite Web UI :5173)"]
    end

    subgraph GatewayLayer ["Security Gateway & Session Storage"]
        GW["Lyra Secure API Gateway\n(:3001 /api/gateway/*)"]
        STORE["UnifiedStore + JSON Event Journal\n(Task Checkpoints & State)"]
        BUS["MessageBus & SSE Stream\n(Real-time Event Distribution)"]
    end

    subgraph CoreEngine ["Autonomous Swarm Orchestration Engine"]
        TC["TeamCoordinator\n(DAG Scheduler & Pipeline)"]
        WM["WorktreeManager\n(Isolated Shadow Worktrees)"]
        VR["VerificationRunner\n(Canary Checks, Linters, Test Runners)"]
        CARE["MaintenanceCaretaker\n(Documentation-Grounded Refactors)"]
    end

    subgraph AWSCloud ["AWS Cloud Infrastructure"]
        BEDROCK["AWS Bedrock Models\n(Claude 3.7 Sonnet / DeepSeek)"]
        GUARD["AWS Bedrock Guardrails\n(Secret Redaction & Command Jail)"]
        S3["AWS S3 + CloudFront\n(Ephemeral Pull Request Previews)"]
        FARGATE["AWS ECS Fargate\n(Isolated Cloud Runner Fleet)"]
        FINOPS["AWS CloudWatch & FinOps\n(Spend Ceilings & Cost Analyzer)"]
    end

    IDE <-->|MCP Protocol| MCP
    MCP <-->|Timing-Safe API Key| GW
    UI <-->|HTTP / WebSocket| GW
    GW <--> TC
    GW <--> STORE
    TC <--> WM
    TC <--> VR
    TC <--> STORE
    TC <--> CARE
    TC <--> BEDROCK
    TC -.->|Cloud Mode| FARGATE
    CARE -.->|Doc Invariants| BEDROCK
    GW -.->|Pre-Flight Screening| GUARD
    VR -.->|Deploy Previews| S3
    GW -.->|Budget Enforcement| FINOPS
```

---

## 🚀 Complete Feature Catalog

### 1. Headless Orchestration & Standardized MCP Server (11 Tools)
Lyra operates as a background daemon exposing 11 standardized MCP tools to external AI harnesses:

| MCP Tool Name | Purpose & Workflow |
| :--- | :--- |
| `lyra_dispatch_task` | Dispatches an autonomous software task to the cloud swarm, establishing a plan DAG. |
| `lyra_get_run_status` | Returns live status, active tasks, check outcomes, and token/dollar telemetry. |
| `lyra_get_pending_requests` | Queries pending file excerpt requests and sensitive permission requests. |
| `lyra_provide_file_context` | Delivers targeted local file excerpts to remote agents without uploading the entire repo. |
| `lyra_respond_permission` | Approves or denies elevated permissions (git push, network calls, file deletions). |
| `lyra_inspect_diff` | Returns line-by-line unified git patches across active worktrees. |
| `lyra_resolve_conflict` | Safely resolves file merge conflicts between workers from the local harness. |
| `lyra_run_qa_sandbox` | Executes dynamic QA, fuzzing, and stress testing against live preview URLs. |
| `lyra_create_github_pr` | Opens an authenticated GitHub Pull Request with Guardrail audit badges. |
| `lyra_dispatch_and_pr` | 1-shot autonomous workflow: dispatches, monitors tests, and creates PR upon success. |
| `lyra_run_maintenance` | Runs documentation-grounded package upgrades, deprecation modernizations, and cleanup. |

---

### 2. Zero-Disruption "Shadow Worktrees"
Traditional coding assistants operate directly inside your active workspace, locking files and causing git churn while you code.

Lyra utilizes **Git Shadow Worktrees** (`.lyra/worktrees/run-*`):
- Multiple workers operate simultaneously in dedicated worktrees branching from `HEAD`.
- Each worker commits changes atomically to a dedicated task branch.
- Changes are serially integrated into a run-level `integration` branch.
- **Your active working directory, branch, and staged files are never touched.**

```mermaid
gitGraph
    commit id: "main (HEAD)"
    branch lyra/run-123-integration
    checkout lyra/run-123-integration
    commit id: "Integration Worktree Created"
    branch lyra/worker-task-1
    checkout lyra/worker-task-1
    commit id: "Task 1: Auth Scaffold"
    checkout lyra/run-123-integration
    merge lyra/worker-task-1 id: "Merged Task 1"
    branch lyra/worker-task-2
    checkout lyra/worker-task-2
    commit id: "Task 2: Database Tokens"
    checkout lyra/run-123-integration
    merge lyra/worker-task-2 id: "Merged Task 2"
    commit id: "Verified & Scribe Docs"
    checkout main
    merge lyra/run-123-integration id: "PR Merged to Main"
```

---

### 3. Multi-Agent Parallel Assembly Line
When a task is dispatched, Lyra coordinates a structured multi-role pipeline:

```mermaid
flowchart LR
    Objective["User Objective"] --> Lead["1. Lead Architect\n(Decomposes into DAG Tasks)"]
    Lead --> Approval{"2. Plan Approval\n(Gated Verification)"}
    Approval -->|Approved| Workers["3. Parallel Workers\n(Isolated Worktrees)"]
    Workers --> SerialMerge["4. Serial Integration\n(Lock-Protected Git Merge)"]
    SerialMerge --> Reviewer["5. Adversarial Reviewer\n(Independent Model Audit)"]
    Reviewer --> Verify["6. Automated Canary Checks\n(Tests, Linter, Typecheck)"]
    Verify --> Scribe["7. Scribe Documentarian\n(Updates architecture.md & AGENTS.md)"]
    Scribe --> Complete["8. Ready for PR / Merge"]
```

1. **Lead Architect**: Analyzes problem space, avoids XY traps, outputs structured JSON plan with dependencies.
2. **Parallel Workers**: Executes independent tasks concurrently up to configured `concurrencyLimit`.
3. **Adversarial Reviewer**: Audits integrated diff against original acceptance criteria using a distinct model architecture.
4. **Verification Runner**: Discovers and runs project checks (`tsc`, `bun test`, database migration canaries).
5. **Scribe Documentarian**: Automatically updates `docs/architecture.md` and `AGENTS.md` before completion.

---

### 4. Task Resiliency & Checkpoint Resume State Machine
Swarm runs are fault-tolerant state machines that survive process restarts, network outages, laptop sleep, and cloud spot evictions:

```mermaid
stateDiagram-v2
    [*] --> Planning
    Planning --> AwaitingApproval: Plan Generated
    AwaitingApproval --> Executing: Plan Approved (Checkpoint 1)
    
    state Executing {
        [*] --> RunningTasks
        RunningTasks --> TaskCompleted: Worker Done
        TaskCompleted --> CheckpointSaved: Save Snapshot
        CheckpointSaved --> RunningTasks: Next Pending Task
    }

    Executing --> Reviewing: All Tasks Succeeded (Checkpoint 2)
    Executing --> Paused: Laptop Sleep / Spot Eviction
    Paused --> Executing: resumeInterruptedRun()
    
    Reviewing --> Verifying: Code Approved (Checkpoint 3)
    Verifying --> Scribing: Checks Passed
    Scribing --> Completed: Run Succeeded (Final Checkpoint)
    Completed --> [*]
```

- **Checkpoint Snapshot**: Persists completed task IDs, failed task IDs, working branch names, worktree locations, and test outcomes to `run-<runId>-checkpoint.json`.
- **Zero Token Duplication**: Resuming an interrupted run skips all already-succeeded tasks and picks up immediately at the next uncompleted task.

---

### 5. AWS Cloud Integrations

#### A. AWS Bedrock Guardrails ([`server/bedrockGuardrails.ts`](file:///Users/taufeeqali/Projects/Lyra/server/bedrockGuardrails.ts))
Screens agent prompts, shell commands, and generated code:
- **Secret Redaction**: Detects and redacts AWS access keys (`AKIA...`), GitHub PATs (`ghp_...`), and RSA/SSH private keys.
- **Destructive Command Jail**: Blocks destructive shell injections (`rm -rf /`, raw disk overwrites `dd if=/dev/zero`, fork bombs).
- **Cloud Policy Integration**: Integrates directly with AWS Bedrock `ApplyGuardrailCommand`.

#### B. Ephemeral S3 Previews ([`server/previewDeployer.ts`](file:///Users/taufeeqali/Projects/Lyra/server/previewDeployer.ts))
- Builds static assets or generates an automated run summary HTML.
- Deploys to `s3://<bucket>/previews/<tenant>/<runId>/index.html` distributed via CloudFront.
- Automatically embeds the live preview URL into GitHub Pull Requests.
- Falls back to local dev servers (`http://localhost:<port>`) in offline mode.

#### C. FinOps Spend Ceilings ([`server/finopsAnalyzer.ts`](file:///Users/taufeeqali/Projects/Lyra/server/finopsAnalyzer.ts))
- Computes estimated infrastructure delta costs for CloudFormation templates (NAT Gateways, ALBs, Fargate).
- Enforces strict spending ceilings (e.g. max \$2.00 per run, \$25.00 monthly cap).
- Emits warnings at 85% budget consumption and halts dispatches when limits are reached.

#### D. AWS Fargate Cloud Execution ([`server/ecsNativeDispatcher.ts`](file:///Users/taufeeqali/Projects/Lyra/server/ecsNativeDispatcher.ts))
- Supports hybrid execution: dispatches tasks locally by default, or cloud-bursts onto ECS Fargate containers when `cloudExecution: true` is requested.

---

### 6. Autonomous Codebase Caretaker ([`server/maintenanceCaretaker.ts`](file:///Users/taufeeqali/Projects/Lyra/server/maintenanceCaretaker.ts))
Routine, non-disruptive codebase maintenance grounded in official documentation:

```mermaid
flowchart TD
    Scan["1. Workspace Audit\n(package.json & source files)"] --> Detect{"2. Issues Detected?"}
    Detect -->|Yes| Ground["3. Documentation Grounding\n(MDN, Node docs, GitHub Releases)"]
    Ground --> Worktree["4. Shadow Maintenance Worktree\n(.lyra/worktrees/maint-*)"]
    Worktree --> Apply["5. Apply Code Refactor / Version Bump"]
    Apply --> Verify["6. Run Verification Checks\n(tsc, unit tests)"]
    Verify -->|Pass| Commit["7. Commit with Doc Citations"]
    Verify -->|Fail| Discard["8. Discard Safely (Zero Breakage)"]
    Commit --> PR["9. Open Atomic PR"]
```

- **Grounded Deprecation Modernization**: Replaces deprecated APIs (`.substr()` -> `.slice()`, `new Buffer()` -> `Buffer.from()`, `escape()` -> `encodeURIComponent()`) citing official documentation.
- **Major Package Upgrades**: Updates packages (Zod, TypeScript, Lucide, etc.) and refactors breaking changes.
- **Dead Code Pruning**: Cleans up leftover debug statements and unreferenced code.

---

### 7. Lyra Mission Control Web Dashboard ([`src/App.tsx`](file:///Users/taufeeqali/Projects/Lyra/src/App.tsx))
A focused, 2-tab operational visualizer built in React, Vite, and Tailwind CSS:
1. **Active Swarms & Worktrees**:
   - Real-time stage tracker (Planning, Executing, Reviewing, Verifying, Completed).
   - Task DAG checklist with status indicators and assigned harnesses.
   - Collapsible line-by-line unified git diff viewer.
   - Real-time FinOps telemetry (tokens used, model ID, estimated cost in USD, elapsed time).
2. **Cloud & Settings**:
   - AWS Bedrock region and model selection.
   - GitHub Integration status (`@tfq26` / GitHub App).
   - FinOps budget limits and spending guardrails.

---

## 🔄 End-to-End Life of a Task

The following sequence diagram illustrates an external harness dispatching a feature task to Lyra:

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Harness as Antigravity / Codex
    participant MCP as Lyra MCP Server
    participant GW as Lyra Gateway
    participant TC as TeamCoordinator
    participant WM as WorktreeManager
    participant Bedrock as AWS Bedrock
    participant VR as VerificationRunner

    Dev->>Harness: "Implement session token revocation in Duit API"
    Harness->>MCP: lyra_dispatch_task(objective, workspacePath)
    MCP->>GW: POST /api/gateway/dispatch
    GW->>TC: startTeamRun(params)
    TC->>WM: createRunWorktree() & createIntegrationBranch()
    TC->>Bedrock: Generate Task DAG Plan
    Bedrock-->>TC: Structured JSON Plan
    TC->>GW: Save Checkpoint (Awaiting Approval)
    Dev->>Harness: "Approved"
    Harness->>MCP: lyra_get_run_status() & Approve
    TC->>WM: Spawn Worker Shadow Worktrees
    par Worker Execution
        TC->>Bedrock: Execute Task 1 (Auth Routes)
        TC->>Bedrock: Execute Task 2 (Token Store)
    end
    TC->>WM: Serial Merge into Integration Branch
    TC->>GW: Save Checkpoint (Tasks Succeeded)
    TC->>Bedrock: Reviewer Audit Diff against Acceptance Criteria
    TC->>VR: Run Verification Checks (tsc, tests)
    VR-->>TC: All Checks Passed (Exit Code 0)
    TC->>GW: Save Checkpoint (Completed)
    Harness->>MCP: lyra_create_github_pr()
    MCP->>GW: Create PR with Bedrock Guardrail Stamp
    GW-->>Dev: GitHub PR #12 Opened Successfully
```

---

## 🛠️ Quickstart & Local Setup

### 1. Prerequisites
- **Runtime**: [Bun](https://bun.sh) (v1.2+) or Node.js (v20+)
- **Git**: Installed and available in PATH (required for isolated worktrees)
- **AWS Credentials**: (Optional for cloud execution) `AWS_REGION=us-east-1`, configured via standard AWS CLI or environment variables.

### 2. Starting Lyra
```bash
# Clone and enter repo
cd /Users/taufeeqali/Projects/Lyra

# Start both Gateway Server (:3001) and Mission Control (:5173)
bun run dev
```

### 3. Running Verification & Typecheck
```bash
# Verify TypeScript typecheck (0 errors)
bun run typecheck

# Run full automated test suite (89 tests)
bun test

# Run live harness demonstration script
bun run scripts/demo-harness-integration.ts
```

### 4. Connecting Antigravity / Cursor / Claude Code via MCP
Add the following to your MCP client configuration (`antigravity.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lyra_harness": {
      "command": "bun",
      "args": [
        "run",
        "/Users/taufeeqali/Projects/Lyra/scripts/mcp-server-stdio.ts"
      ],
      "env": {
        "LYRA_GATEWAY_URL": "http://localhost:3001",
        "LYRA_GATEWAY_API_KEY": "lyra-harness-default-secret"
      }
    }
  }
}
```

---

## 📁 Repository Directory Structure

```
Lyra/
├── .agents/skills/lyra-harness/ # Antigravity native skill definition
├── docs/
│   ├── architecture-and-features.md # This document
│   ├── api.md                  # REST Gateway specification
│   └── openapi.yaml            # OpenAPI 3.0 specification
├── infra/aws/                  # AWS CloudFormation template (ECS, S3, ALB)
├── scripts/
│   ├── demo-harness-integration.ts # End-to-end simulation script
│   └── mcp-server-stdio.ts     # Standard MCP stdio transport bridge
├── server/
│   ├── bedrockGuardrails.ts    # AWS Bedrock Guardrails & secret redaction
│   ├── ecsNativeDispatcher.ts  # AWS ECS Fargate runner fleet dispatcher
│   ├── finopsAnalyzer.ts       # CloudWatch spending ceilings & CFN estimator
│   ├── gateway.ts              # Timing-safe API gateway & rate limiter
│   ├── harnessMcpServer.ts     # Standardized 11-tool MCP server
│   ├── maintenanceCaretaker.ts # Documentation-grounded maintenance swarm
│   ├── previewDeployer.ts      # AWS S3 ephemeral preview pipeline
│   ├── teamCoordinator.ts      # Swarm orchestrator & checkpoint resume
│   ├── unifiedStore.ts         # Persistent event journal & run checkpoints
│   ├── verificationRunner.ts   # Automated canary and test runner
│   └── worktreeManager.ts      # Git shadow worktree isolation engine
├── src/                        # Lyra Mission Control Web Dashboard
│   ├── App.tsx                 # 2-tab Mission Control UI
│   └── lib/platform.ts         # Web platform adapter
├── package.json
└── tsconfig.json
```
