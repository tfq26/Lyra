# Lyra & Antigravity: Universal UI/UX Design System Specification

> **Version:** 1.0.0  
> **Aesthetic Archetype:** High-Density Autonomous Engineering Console  
> **Influences:** Linear, Vercel, Bloomberg Terminal, Raycast  
> **Target Form Factors:** Responsive Web, PWA, Native Desktop (Tauri/macOS), Mobile Companion  

---

## 1. Core Design Philosophy

Lyra is an autonomous AI software engineering console. Its interface must balance **dense technical rigor** with **effortless, frictionless clarity**. It is neither a generic conversational chatbot nor a bloated legacy IDE; it is an executive cockpit for human-agent software synthesis.

### Foundational Tenets
1. **Zero Cognitive Friction:** Information is organized by urgency and causality. Crucial metrics (Compile Gate status, test pass rates, live USD spend) are visible at a glance; exhaustive AST logs and raw traces are accessible in one click.
2. **Speed as a Feature:** Instantaneous UI responses (<16ms, 60fps), optimistic mutations, local-first cached navigation, and zero layout shift during real-time token streaming.
3. **High Information Density with Generous Breathing Room:** Compact tabular layouts paired with deliberate 4px/8px spacing rhythms, high-contrast typography, and purposeful borders.
4. **Dark-First Elegance:** Crafted natively for deep-focus environments using an obsidian/zinc palette, subtle specular glows, and zero harsh pure whites (`#FFFFFF` is reserved strictly for high-priority badges and key data points).
5. **Keyboard-First Ergonomics:** 100% of actions (dispatching tasks, toggling worktrees, approving permissions, switching lanes) are bindable to global key commands (`Cmd+K`, `J/K`, `Esc`).

---

## 2. Color System & Semantic Tokens

### 2.1 Neutral Canvas & Elevation Ramps
Lyra uses a tailored, warm obsidian-zinc scale rather than cold sterile grays.

| Token | Hex Value | Semantic Role |
| :--- | :--- | :--- |
| `--canvas-root` | `#08080A` | Deepest root background / desktop window frame |
| `--canvas-subtle` | `#0D0D11` | Primary workbench canvas & panel backgrounds |
| `--canvas-card` | `#131318` | Elevated cards, diff blocks, inspector drawers |
| `--canvas-overlay` | `#1A1A22` | Modal dialogs, dropdown menus, command palettes |
| `--canvas-active` | `#22222D` | Active / focused list items, selected worktree rows |

### 2.2 Border & Stroke Hierarchy
Borders define structure and elevation rather than heavy drop shadows.

| Token | Hex Value | Usage |
| :--- | :--- | :--- |
| `--border-subtle` | `rgba(255, 255, 255, 0.06)` | Standard component dividers, table row borders |
| `--border-default` | `rgba(255, 255, 255, 0.12)` | Card perimeters, input field outlines |
| `--border-strong` | `rgba(255, 255, 255, 0.22)` | Active panel focus borders, keyboard focus rings |
| `--border-specular` | `rgba(255, 255, 255, 0.40)` | Top 1px highlight line on modals (specular glass edge) |

### 2.3 Semantic Intent & Status Colors
Every accent color conveys precise machine state:

```css
:root {
  /* Autonomous Agent Engine: Cyan to Electric Indigo */
  --accent-primary: #00F0FF;
  --accent-primary-glow: rgba(0, 240, 255, 0.15);
  --accent-secondary: #6366F1;

  /* Verified / Green Gate (Tests Pass, Compile Success) */
  --status-success: #10B981;
  --status-success-subtle: rgba(16, 185, 129, 0.12);
  --status-success-border: rgba(16, 185, 129, 0.28);

  /* Warning / Throttling / Human Review Needed */
  --status-warning: #F59E0B;
  --status-warning-subtle: rgba(245, 158, 11, 0.12);
  --status-warning-border: rgba(245, 158, 11, 0.32);

  /* Failure / Compile Error / Spend Cap Breach */
  --status-danger: #EF4444;
  --status-danger-subtle: rgba(239, 68, 68, 0.12);
  --status-danger-border: rgba(239, 68, 68, 0.32);

  /* Info / Diagnostic / Neutral Machine State */
  --status-info: #38BDF8;
  --status-info-subtle: rgba(56, 189, 248, 0.12);
}
```

---

## 3. Typography & Numerical Representation

### 3.1 Font Families
* **Prose & Interface:** `Geist Variable`, `Inter Variable`, `-apple-system`, `sans-serif`.
  * Clean, geometric neo-grotesque with optimized legibility at small sizes (11px–13px).
* **Code, FinOps & Telemetry:** `Geist Mono`, `JetBrains Mono`, `ui-monospace`, `monospace`.
  * Mandatory tabular figures (`font-variant-numeric: tabular-nums`) so live-ticking token meters and costs never shift adjacent text.

### 3.2 Typographic Hierarchy & Scale

| Style | Size | Weight | Line Height | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | 24px (1.5rem) | 600 SemiBold | 1.2 | -0.025em | Main dashboard headers, run ID titles |
| **Heading** | 16px (1.0rem) | 600 SemiBold | 1.3 | -0.015em | Panel titles, modal headlines |
| **Subheading** | 14px (0.875rem) | 500 Medium | 1.4 | -0.01em | Card titles, step labels |
| **Body Default** | 13px (0.8125rem) | 400 Regular | 1.5 | normal | Agent thought stream, chat messages |
| **Code / Diff** | 12px (0.75rem) | 400 / 500 | 1.6 | normal | Code blocks, diff lines, terminal stdout |
| **Caption / Micro** | 11px (0.6875rem) | 500 Medium | 1.3 | +0.02em | Live FinOps badges, timestamps, tags (UPPERCASE) |

---

## 4. Spacing, Grid & Layout Structure

### 4.1 4px / 8px Spatial Rhythm
All padding, margin, gap, and sizing values strictly follow the 4px baseline grid:
* `4px` (`space-1`): Inner badge padding, micro gaps.
* `8px` (`space-2`): Button internal padding, tag spacing.
* `12px` (`space-3`): Form input padding, card internal gap.
* `16px` (`space-4`): Panel padding, container gutters.
* `24px` (`space-6`): Section separation, modal margins.
* `32px` (`space-8`): Major workbench view dividing margins.

### 4.2 Multi-Pane Workbench Architecture

```
+-------------------------------------------------------------------------------+
| Lyra TopBar: [Repo: draco] [Branch: main] [Live Spend: $0.77] [Status: GREEN] |
+-----------------------+-------------------------------+-----------------------+
| Pane 1: Session Tree  | Pane 2: Primary Stream & Diff | Pane 3: Inspector     |
| - Active Swarm Runs   | - Real-time agent turns       | - Compile Gate check  |
| - Worktree branches   | - Interactive unified diffs   | - Token spend chart   |
| - Task dependency DAG | - Step-by-step repair log     | - Council opinions    |
| (Width: 260px-320px)  | (Flexible: 1fr)               | (Width: 320px-400px)  |
+-----------------------+-------------------------------+-----------------------+
| BottomBar: [Cmd+K Command Bar] [Active Model: Nova 2 Lite] [AHP Cloud: Sync]  |
+-------------------------------------------------------------------------------+
```

### 4.3 Responsive Viewport Adaptation
* **Desktop (>1280px):** 3-column tri-pane layout with persistent inspector and live diff view.
* **Laptop / Compact (960px - 1279px):** 2-column layout (Sessions + Primary Stream), inspector opens as a sliding drawer on right.
* **Mobile / Tablet (<960px):** Single-pane card stack with a bottom tab bar (`Chat`, `Diffs`, `Gates`, `FinOps`), touch-friendly 44px tap targets.

---

## 5. Motion, Physics & Micro-Interactions

Lyra avoids gratuitous, sluggish animations. Motion is used exclusively to convey **state transitions**, **spatial continuity**, and **system feedback**.

### 5.1 Timing Curves
* **Instant Feedback (hover, click, toggle):** `100ms cubic-bezier(0.4, 0, 0.2, 1)`
* **Layout Transitions (drawer open, card expansion):** `200ms cubic-bezier(0.16, 1, 0.3, 1)`
* **Deliberate Entrances (modals, toasts):** `150ms cubic-bezier(0, 0, 0.2, 1)`

### 5.2 Micro-Interactions Specification
* **Live Ticker Pulsing:** During active agent generation, a subtle 2px cyan aura pulses on the active turn card (`box-shadow: 0 0 12px var(--accent-primary-glow)`).
* **Diff Expand/Collapse:** Smooth accordion transition preserving scroll position so the developer never loses context in 200+ line diffs.
* **Copy & Action Confirmation:** Buttons momentarily morph icon (e.g. `Clipboard` $\rightarrow$ `Check` in emerald) for 1200ms without displacing layout.
* **Accessibility (`prefers-reduced-motion`):** All transitions drop to zero-duration opacity fades when the user enables reduced motion.

---

## 6. Component Standards

### 6.1 Unified Diff Viewer
* Additions: `rgba(16, 185, 129, 0.15)` background with `#34D399` text and a subtle 2px left border in emerald.
* Deletions: `rgba(239, 68, 68, 0.15)` background with `#F87171` text and a subtle 2px left border in rose.
* Line Numbers: 48px width, right-aligned, muted `rgba(255, 255, 255, 0.3)` color.
* Word-Level Diffs: Highlighting within lines uses a 20% higher alpha overlay.

### 6.2 FinOps Telemetry Pill
* Real-time counter displaying: `[Model: Nova 2 Lite] [Tokens: 2.7M] [Spend: $0.77]`.
* When spend is within safe limits: subtle zinc badge with white text.
* When spend approaches 80% of budget cap: amber glow.
* When spend exceeds budget cap: pulsing rose alert with auto-pause toggle.

### 6.3 Compile Gate & Verification Pill
* **Green:** Checkmark icon + `Compile Passed (0 errors)` in emerald badge.
* **Yellow / Repairing:** Refresh icon (spinning at 1.2s) + `Repair Loop Attempt 2/3` in amber badge.
* **Red:** X icon + `Compile Failed: CS0246` with direct 1-click jump to failing line.

---

## 7. Command Palette & Keyboard Interaction Architecture

Pressing `Cmd+K` (or `Ctrl+K`) opens the central command surface.

### Shortcut Conventions
* `Cmd + K`: Open Command Palette.
* `Cmd + Enter`: Submit Prompt / Approve Plan.
* `Cmd + B`: Toggle Sidebar / File Tree.
* `Cmd + D`: Toggle Fullscreen Unified Diff.
* `Esc`: Dismiss modal / Cancel current selection.
* `J / K`: Navigate turn history up / down.
