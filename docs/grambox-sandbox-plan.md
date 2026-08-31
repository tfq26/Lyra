# GramBox Sandbox Plan

## Context and initial findings

Lyra is a multi-agent developer workspace that launches Antigravity, Claude Code, and Codex. Its process manager originally ran agents directly on the host, including dangerous approval/sandbox bypass flags. The initial recommendation was to add a first-class sandbox layer before expanding agent execution.

GramBox was then inspected in:

`/Users/taufeeqali/Projects/Gram/Gram.Blazor`

The important finding was that GramBox already provides a strong sandbox architecture, but its current implementation is primarily a native Git worktree isolator. It currently protects the base Git checkout and supports worktree diffs, checkpoints, leases, scheduling, resource monitoring, path guards, network policy, environment sanitization, and cleanup. It is not yet a complete operating-system security boundary.

Although `OciContainer` exists in `GramBoxModels.cs`, no working Docker/OCI driver was found. `GramBoxService` currently selects `NativeWorktree`, and `Dockerfile.grambox` defines an image without being connected to a container execution driver.

The recommendation was therefore:

- Let Gram own GramBox for now.
- Improve GramBox rather than duplicating the sandbox implementation in Lyra.
- Keep native worktrees as the low-overhead trusted mode.
- Add a real Docker-compatible OCI driver for stronger isolation.
- Later expose GramBox through a stable package or service for Lyra and other projects.

## Product decisions

- Gram remains the owner of GramBox during this phase.
- The first implementation supports macOS, Linux, and Windows.
- Sandbox selection is native-first with a hardened fallback.
- Native worktree execution is the low-resource default.
- OCI/Docker execution is used for risky or untrusted tasks.
- Successful sandboxes are destroyed immediately after result collection.
- Failed or cancelled sandboxes receive a 15-minute diagnostic grace period.
- Only compact metadata, final diff summaries, and logs remain after destruction.
- Sandboxes are not persistent and are not resumed by default.
- Retries create fresh sandboxes.
- Project-specific OCI images are preferred; a small safe GramBox image is the fallback.
- Shared bounded dependency caches are allowed outside individual sandboxes.
- Run completion is explicit: completed, failed, cancelled, or timed out.
- Docker-compatible CLI behavior is the first OCI target.
- Full extraction into a standalone package/service is deferred until GramBox stabilizes.

## Target architecture

```text
AgentRun
  -> SandboxScheduler
  -> SandboxLease
  -> Temporary Worktree
  -> NativeWorktreeDriver or OciContainerDriver
  -> Process Execution
  -> Result / Diff / Metrics / Logs
  -> Explicit Terminal State
  -> Cleanup
  -> Compact Retained Metadata
```

Every sandbox belongs to exactly one run. No agent or tool should rely on a global active sandbox.

## Implementation plan

### 1. Establish the driver boundary

Refactor GramBox around a driver interface supporting:

- sandbox creation
- command execution
- file reads and writes
- diff collection
- checkpoint creation
- rollback while active
- disposal
- availability and capability reporting

Implement two drivers:

- `NativeWorktreeDriver`
- `OciContainerDriver`

`GramBoxService` remains the lifecycle coordinator and selects the driver based on engine policy, task risk, platform capability, and runtime availability.

If a caller explicitly requests OCI and Docker is unavailable, fail clearly rather than silently falling back to native execution.

### 2. Harden native worktree execution

Retain native worktrees as the fast, low-memory mode while making their limits explicit.

Required protections:

- per-run Git worktree and branch
- strict path containment
- traversal and symlink-escape rejection
- process-group tracking
- complete process-tree cancellation
- wall-clock timeout
- output byte limits
- child-process limits
- CPU and memory monitoring
- sensitive environment stripping
- configurable network policy
- bounded shared dependency caches
- diff collection before disposal

Native worktree mode must be presented as Git/filesystem-change isolation, not complete host OS isolation.

Use argument-array process invocation wherever possible. Do not interpolate untrusted branch names, paths, commit messages, or commands into shell strings.

### 3. Add Docker-compatible OCI execution

The OCI driver should create a temporary run directory such as:

```text
~/.gram/box/runs/<run-id>/
  worktree/
  logs/
  result.json
  checkpoints/
```

The container must:

- use a run-specific temporary name
- mount only the assigned worktree
- avoid host-home mounts
- never mount the Docker socket
- use `--network none` when networking is disabled
- enforce CPU, memory, PID, storage, and output limits
- receive only approved environment variables
- use an explicit working directory
- be removed automatically after completion
- terminate the full process tree during cancellation

Use project-configured images when available. Otherwise use a small GramBox base image with only common tools. Do not build an image per task in the first implementation.

Run as a non-root container user where practical. If root is needed inside the container, document that it is confined to the disposable container boundary.

### 4. Enforce network, filesystem, and environment policy

Support three network modes:

- `Disabled`
- `Allowlisted`
- `Unrestricted`

Network policy must be enforced by the container runtime, not only by inspecting command strings.

All host and container paths must resolve below the run’s assigned workspace. Reject:

- `..` traversal
- absolute-path escapes
- symlink escapes
- mount-point escapes
- artifact paths outside the run directory
- working directories outside the sandbox

Strip API keys, tokens, passwords, private keys, cloud credentials, and Git credentials by default. Explicit environment variables require an approved configuration path.

### 5. Add enforced resource budgets

GramBox configuration should include enforced limits for:

- maximum runtime
- memory
- CPU
- output bytes
- child processes
- disk usage
- concurrent sandboxes per user
- concurrent executions per user

Map resource classes to native controls where available and Docker flags for OCI execution. Report unsupported hard limits honestly on macOS, Windows, or restricted Linux environments.

Suggested default resource classes:

| Class | CPU | Memory | Purpose |
|---|---:|---:|---|
| Tiny | 1 core | 1 GB | Small inspection or formatting task |
| Small | 2 cores | 2 GB | Default coding task |
| Medium | 4 cores | 8 GB | Larger builds or test suites |
| Large | 8 cores | 16 GB | Explicitly requested heavy task |

The scheduler must enforce per-user and per-project concurrency and queue work when capacity is unavailable.

### 6. Implement temporary lifecycle and cleanup

Terminal states:

- `Completed`
- `Failed`
- `Cancelled`
- `TimedOut`
- `Disposed`

Successful sandboxes are destroyed immediately. Failed sandboxes remain for 15 minutes for diagnosis, then are automatically destroyed. Abandoned leases are recovered on startup or lease expiry.

Cleanup must be idempotent and include:

- process-tree termination
- container stop/removal
- worktree removal
- Git worktree pruning
- lease release
- temporary mount cleanup
- run-owned file deletion
- result metadata persistence before deletion

Persist compact result data containing sandbox ID, run ID, engine, status, exit code, timestamps, resource usage, output summaries, final diff summary, and failure reason.

### 7. Add checkpoints and recovery

Checkpoints preserve recoverable results, not persistent sandboxes. Store compact patches or summaries and allow rollback only while the sandbox remains active.

Retries create new sandboxes. They do not resume old workspaces by default.

On startup:

1. Load leases.
2. Find expired or abandoned runs.
3. Terminate surviving processes and containers.
4. Collect available result metadata.
5. Remove abandoned worktrees and containers.
6. Mark runs recovered or failed.
7. Release scheduler capacity.

### 8. Add auditability and UI/API reporting

Record structured events for sandbox creation, engine selection, command execution, policy blocks, resource violations, cancellation, and cleanup.

Expose:

- engine type
- actual isolation level
- network mode
- resource budget
- cleanup countdown
- lifecycle state
- cleanup result
- final diff summary
- resource usage

The UI must never imply that native worktree mode provides complete host protection.

## Testing plan

### Unit tests

Cover:

- engine selection
- OCI availability handling
- path and symlink protection
- network policy
- environment sanitization
- timeout and output limits
- resource budget mapping
- image policy validation
- cleanup idempotency
- lease expiry and recovery
- checkpoint metadata

### Native integration tests

Verify:

- concurrent worktrees remain isolated
- base repositories are unchanged
- process trees terminate on cancellation
- timed-out commands clean up
- successful sandboxes are immediately deleted
- failed sandboxes expire after the grace period
- cleanup can safely run more than once
- abandoned worktrees recover after restart
- final diffs remain after workspace deletion

### OCI integration tests

Run when Docker is available. Verify:

- container creation and removal
- workspace-only mounts
- no host-home access
- disabled and allowlisted networking
- CPU, memory, PID, storage, and output limits
- cancellation and process-tree cleanup
- project image and fallback image selection
- cleanup after crashes

OCI tests should be skipped clearly, not treated as passing, when Docker is unavailable.

### Performance benchmarks

Compare native and OCI modes for:

- sandbox creation latency
- peak memory
- disk usage
- command startup time
- concurrent throughput
- cleanup latency
- dependency-cache reuse

The native driver should remain materially cheaper for trusted tasks.

## Acceptance criteria

- Successful sandboxes leave no worktree, container, or run-owned temporary workspace.
- Failed sandboxes are automatically deleted after 15 minutes.
- Compact result metadata and final diff summaries survive deletion.
- Native mode uses materially fewer resources than OCI mode.
- OCI mode provides actual container filesystem and network isolation.
- Path and symlink escapes are rejected.
- Cancellation terminates the complete process tree/container.
- Resource limits are enforced or reported as unavailable.
- Abandoned runs are recovered after restart.
- Concurrent runs have independent sandbox handles and leases.
- Existing GramBox tests continue to pass.
- New OCI tests run when Docker is available.
- The UI exposes the real isolation level.
- Retry creates a fresh sandbox rather than preserving a persistent workspace.

## Related GramBox reference files

- `Shared/GramBoxModels.cs` — configuration, session, result, diff, checkpoint models
- `Shared/GramBoxService.cs` — lifecycle service and public service contract
- `Shared/GramBoxWorktreeManager.cs` — native worktree creation, diff, merge, and removal
- `Shared/NativeScratchpadDriver.cs` — native execution, limits, environment filtering, and path use
- `Shared/SandboxPathGuard.cs` — traversal and symlink checks
- `Shared/SandboxNetworkPolicy.cs` — network and sensitive-environment policy
- `Shared/SandboxScheduling.cs` — leases, budgets, and execution slots
- `Shared/PlatformSandboxController.cs` — platform capability detection and Linux cgroup attachment
- `Shared/SandboxCleanupService.cs` — inactive sandbox cleanup
- `Shared/SandboxCheckpointService.cs` — checkpoint and rollback behavior
- `docs/sandbox-architecture.md` — target architecture and isolation principles
- `docs/Gram-Box-Design.md` — current implementation boundary and recommended build order
