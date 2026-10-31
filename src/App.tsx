import React, { useState, useEffect } from 'react';
import {
  Activity,
  Cpu,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Clock,
  Terminal,
  Settings,
  ShieldCheck,
  GitPullRequest,
  DollarSign,
  Layers,
  FileCode,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

interface ActiveTask {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  assignedAgent: string;
  stage: string;
}

interface ActiveCheck {
  id: string;
  name: string;
  command: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'unverified';
}

interface ActiveRun {
  runId: string;
  sessionId: string;
  objective: string;
  stage: string;
  state: string;
  elapsedSeconds: number;
  tasks: ActiveTask[];
  checks: ActiveCheck[];
  diffs?: Array<{ filename: string; additions: number; deletions: number; patch?: string }>;
  telemetry?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

export function App() {
  const [activeTab, setActiveTab] = useState<'runs' | 'settings'>('runs');
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ActiveRun | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [hubStatus, setHubStatus] = useState<'connected' | 'connecting' | 'offline'>('connecting');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState<number>(5);

  // Settings state
  const [awsRegion, setAwsRegion] = useState('us-east-1');
  const [bedrockModel, setBedrockModel] = useState('us.anthropic.claude-sonnet-4-6');
  const [githubUser, setGithubUser] = useState('tfq26');
  const [maxRunSpend, setMaxRunSpend] = useState('2.00');
  const [monthlySpendCap, setMonthlySpendCap] = useState('25.00');

  const fetchHubData = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        setHubStatus('connected');
      } else {
        setHubStatus('offline');
      }

      // Query active runs telemetry
      const runsRes = await fetch('/api/gateway/runs/active');
      if (runsRes.ok) {
        const data = await runsRes.json();
        setRuns(Array.isArray(data) ? data : []);
      }
    } catch {
      setHubStatus('connected'); // Fallback in standalone dev
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHubData();
    const interval = setInterval(fetchHubData, 4000);
    return () => clearInterval(interval);
  }, []);

  // Mock sample run if no active swarm is currently streaming
  useEffect(() => {
    if (runs.length === 0) {
      const demoRun: ActiveRun = {
        runId: 'run-duit-features-1793343442681',
        sessionId: 'session-duit-features-1793343442681',
        objective: 'Implement Double-Entry Credits Ledger & Atomic Hangouts Capacity Manager with Unit Tests',
        stage: 'completed',
        state: 'completed',
        elapsedSeconds: 3,
        tasks: [
          {
            id: 'task-1',
            title: 'Implement Double-Entry Credits Ledger & Anti-Abuse Multipliers',
            status: 'succeeded',
            assignedAgent: 'hermes',
            stage: 'implement',
          },
          {
            id: 'task-2',
            title: 'Implement Atomic Hangouts Capacity Manager & Priority Waitlist State Machine',
            status: 'succeeded',
            assignedAgent: 'hermes',
            stage: 'implement',
          },
          {
            id: 'task-3',
            title: 'Integrate Economy and Hangouts routes into Fastify app',
            status: 'succeeded',
            assignedAgent: 'hermes',
            stage: 'implement',
          },
        ],
        checks: [
          { id: 'chk-1', name: 'Economy Ledger Tests', command: 'bun test economy.test.ts', status: 'passed' },
          { id: 'chk-2', name: 'Hangouts Waitlist Tests', command: 'bun test hangouts.test.ts', status: 'passed' },
          { id: 'chk-3', name: 'Personalization Tests', command: 'bun test activityScoring.test.ts', status: 'passed' },
          { id: 'chk-4', name: 'Wellbeing Protection Tests', command: 'bun test wellbeingEngine.test.ts', status: 'passed' },
        ],
        diffs: [
          {
            filename: 'apps/api/src/modules/economy/rewardCalculator.ts',
            additions: 55,
            deletions: 0,
            patch: `+ export function calculateActivityReward(params: RewardCalculationParams) {\n+   // Score, streak, and novelty multipliers\n+   return { earnedCredits, breakdown };\n+ }`,
          },
          {
            filename: 'apps/api/src/modules/hangouts/waitlistService.ts',
            additions: 120,
            deletions: 0,
            patch: `+ export class WaitlistService {\n+   // Atomic promotion from waitlist with 2-hour reservation window\n+   public leaveHangout(params) { ... }\n+ }`,
          },
        ],
        telemetry: {
          model: 'Claude Sonnet 4.6 (us-east-1)',
          inputTokens: 8000,
          outputTokens: 3250,
          totalTokens: 11250,
          estimatedCostUsd: 0.0728,
        },
      };
      setRuns([demoRun]);
      setSelectedRun(demoRun);
    }
  }, [runs.length]);

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => ({ ...prev, [filename]: !prev[filename] }));
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[#090a0f] text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Top Header */}
      <header className="flex h-14 items-center justify-between border-b border-white/5 bg-[#0d0e15] px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-md shadow-indigo-500/20">
            <Activity className="h-4 w-4 text-white" />
          </div>
          <div>
            <span className="text-sm font-semibold tracking-wide text-white">LYRA</span>
            <span className="ml-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-400">
              MISSION CONTROL
            </span>
          </div>
        </div>

        {/* Center Navigation */}
        <nav className="flex items-center gap-1 rounded-lg border border-white/5 bg-white/[0.02] p-1">
          <button
            onClick={() => setActiveTab('runs')}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === 'runs'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Active Swarms
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === 'settings'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            Cloud & Settings
          </button>
        </nav>

        {/* Right Status */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span
              className={`h-2 w-2 rounded-full ${
                hubStatus === 'connected' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-amber-400'
              }`}
            />
            <span className="capitalize">{hubStatus}</span>
          </div>
          <button
            onClick={fetchHubData}
            disabled={isRefreshing}
            className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-slate-400 hover:border-white/20 hover:text-white transition"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex flex-1 overflow-hidden">
        {activeTab === 'runs' ? (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: Swarms List */}
            <aside className="w-80 border-r border-white/5 bg-[#0b0c12] p-4 overflow-y-auto">
              <div className="flex items-center justify-between pb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Swarm Invocations ({runs.length})
                </span>
              </div>
              <div className="space-y-2">
                {runs.map((r) => {
                  const isSelected = selectedRun?.runId === r.runId;
                  const isDone = r.state === 'completed';
                  return (
                    <div
                      key={r.runId}
                      onClick={() => setSelectedRun(r)}
                      className={`cursor-pointer rounded-lg border p-3 transition ${
                        isSelected
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : 'border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-[11px] text-slate-400">
                          {r.runId.slice(0, 18)}...
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] uppercase font-semibold ${
                            isDone ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400 animate-pulse'
                          }`}
                        >
                          {r.stage}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs font-medium text-slate-200">
                        {r.objective}
                      </p>
                      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          {r.tasks.filter((t) => t.status === 'succeeded').length}/{r.tasks.length} tasks
                        </span>
                        <span>{r.elapsedSeconds}s</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>

            {/* Right: Active Swarm Deep Inspection */}
            {selectedRun ? (
              <section className="flex flex-1 flex-col overflow-y-auto p-6 space-y-6">
                {/* Header Banner */}
                <div className="rounded-xl border border-white/5 bg-gradient-to-r from-white/[0.02] to-transparent p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-400 border border-indigo-500/20">
                        RUN #{selectedRun.runId}
                      </span>
                      <h2 className="mt-2 text-base font-semibold text-white">
                        {selectedRun.objective}
                      </h2>
                    </div>
                    <div className="text-right">
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                        {selectedRun.stage.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* FinOps & Cloud Telemetry Bar */}
                  {selectedRun.telemetry && (
                    <div className="mt-4 grid grid-cols-4 gap-4 rounded-lg border border-white/5 bg-black/30 p-3 text-xs">
                      <div>
                        <span className="text-slate-500">Bedrock Model</span>
                        <p className="font-medium text-slate-200">{selectedRun.telemetry.model}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Total Tokens</span>
                        <p className="font-medium text-slate-200">
                          {selectedRun.telemetry.totalTokens.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Estimated Cost</span>
                        <p className="font-semibold text-emerald-400">
                          ${selectedRun.telemetry.estimatedCostUsd}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Execution Time</span>
                        <p className="font-medium text-slate-200">{selectedRun.elapsedSeconds}s</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Interactive Swarm Timeline Scrubber */}
                <div className="rounded-xl border border-white/5 bg-white/[0.015] p-4">
                  <div className="flex items-center justify-between text-xs mb-3">
                    <span className="flex items-center gap-2 font-semibold uppercase tracking-wider text-slate-300">
                      <Clock className="h-3.5 w-3.5 text-indigo-400" />
                      Swarm Timeline Scrubber
                    </span>
                    <span className="text-[11px] font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
                      Step {timelineIndex + 1} of 6: {['Planning (Lead)', 'Worker Task 1 (Scaffold)', 'Worker Task 2 (Implementation)', 'Adversarial Review', 'Automated Verification', 'Scribe Docs & PR'][timelineIndex]}
                    </span>
                  </div>

                  {/* Progress track with nodes */}
                  <div className="relative flex items-center justify-between py-2 px-1">
                    <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 bg-white/10 rounded-full" />
                    <div
                      className="absolute left-0 top-1/2 h-1 -translate-y-1/2 bg-indigo-500 rounded-full transition-all duration-300"
                      style={{ width: `${(timelineIndex / 5) * 100}%` }}
                    />
                    {['Plan', 'Task 1', 'Task 2', 'Review', 'Verify', 'Complete'].map((stepName, idx) => (
                      <button
                        key={stepName}
                        onClick={() => setTimelineIndex(idx)}
                        className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
                          idx <= timelineIndex
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/40 scale-110'
                            : 'bg-slate-800 text-slate-400 border border-white/10 hover:border-indigo-400'
                        }`}
                        title={stepName}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="5"
                    value={timelineIndex}
                    onChange={(e) => setTimelineIndex(parseInt(e.target.value, 10))}
                    className="w-full mt-3 accent-indigo-500 cursor-pointer"
                  />
                </div>

                {/* Tasks Grid */}
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <GitBranch className="h-3.5 w-3.5 text-indigo-400" />
                    Isolated Worktree Tasks ({selectedRun.tasks.length})
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedRun.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-lg border border-white/5 bg-white/[0.01] p-3 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] text-slate-500">{task.id}</span>
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                            {task.status}
                          </span>
                        </div>
                        <p className="font-medium text-slate-200">{task.title}</p>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span>Agent: {task.assignedAgent}</span>
                          <span>•</span>
                          <span>Stage: {task.stage}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Automated Check Verification */}
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    Automated Verification Checks ({selectedRun.checks.length})
                  </h3>
                  <div className="grid gap-2">
                    {selectedRun.checks.map((chk) => (
                      <div
                        key={chk.id}
                        className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.01] px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <span className="font-medium text-slate-200">{chk.name}</span>
                          <code className="text-[11px] text-slate-500">{chk.command}</code>
                        </div>
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          {chk.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Diff Inspector */}
                {selectedRun.diffs && selectedRun.diffs.length > 0 && (
                  <div>
                    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <FileCode className="h-3.5 w-3.5 text-indigo-400" />
                      Generated Code Diffs ({selectedRun.diffs.length} files)
                    </h3>
                    <div className="space-y-2">
                      {selectedRun.diffs.map((diff) => (
                        <div
                          key={diff.filename}
                          className="rounded-lg border border-white/5 bg-black/40 text-xs overflow-hidden"
                        >
                          <div
                            onClick={() => toggleFile(diff.filename)}
                            className="flex cursor-pointer items-center justify-between bg-white/[0.02] px-3 py-2 hover:bg-white/[0.04]"
                          >
                            <div className="flex items-center gap-2">
                              {expandedFiles[diff.filename] ? (
                                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                              )}
                              <span className="font-mono text-slate-200">{diff.filename}</span>
                            </div>
                            <span className="font-mono text-emerald-400">+{diff.additions}</span>
                          </div>
                          {expandedFiles[diff.filename] && diff.patch && (
                            <pre className="p-3 font-mono text-[11px] text-emerald-300/90 overflow-x-auto bg-[#07080c]">
                              {diff.patch}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <div className="flex flex-1 items-center justify-center text-slate-500 text-xs">
                Select a swarm invocation on the left to inspect telemetry and diffs.
              </div>
            )}
          </div>
        ) : (
          /* Cloud & Settings Tab */
          <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-8">
            <div>
              <h2 className="text-lg font-semibold text-white">Lyra Engine Settings & Integrations</h2>
              <p className="text-xs text-slate-400 mt-1">
                Configure AWS Bedrock foundation models, GitHub app credentials, and FinOps spending limits.
              </p>
            </div>

            {/* AWS Bedrock Section */}
            <div className="rounded-xl border border-white/5 bg-white/[0.01] p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Cpu className="h-5 w-5 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">AWS Bedrock Models</h3>
                  <p className="text-xs text-slate-500">Autonomous intelligence and reasoning engine</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs pt-2">
                <div>
                  <label className="text-slate-400 block mb-1">AWS Region</label>
                  <input
                    type="text"
                    value={awsRegion}
                    onChange={(e) => setAwsRegion(e.target.value)}
                    className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Default Swarm Model</label>
                  <select
                    value={bedrockModel}
                    onChange={(e) => setBedrockModel(e.target.value)}
                    className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                  >
                    <option value="us.anthropic.claude-sonnet-4-6">Claude Sonnet 4.6 (Recommended)</option>
                    <option value="us.anthropic.claude-haiku-4-5-20251001-v1:0">Claude Haiku 4.5 (Fast & Low Cost)</option>
                    <option value="us.anthropic.claude-opus-4-6-v1">Claude Opus 4.6 (High Complexity)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* GitHub Integration */}
            <div className="rounded-xl border border-white/5 bg-white/[0.01] p-5 space-y-4">
              <div className="flex items-center gap-3">
                <GitPullRequest className="h-5 w-5 text-white" />
                <div>
                  <h3 className="text-sm font-semibold text-white">GitHub Integration</h3>
                  <p className="text-xs text-slate-500">Automated branch pushing and Pull Request creation</p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/30 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                  <span className="text-slate-200">Connected to account: <strong>@{githubUser}</strong></span>
                </div>
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  Write & PR Scopes Active
                </span>
              </div>
            </div>

            {/* FinOps Spending Limits */}
            <div className="rounded-xl border border-white/5 bg-white/[0.01] p-5 space-y-4">
              <div className="flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">FinOps Spending Guardrails</h3>
                  <p className="text-xs text-slate-500">Automated budget limits to prevent runaway model loops</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs pt-2">
                <div>
                  <label className="text-slate-400 block mb-1">Max Cost Per Swarm Run (USD)</label>
                  <input
                    type="text"
                    value={maxRunSpend}
                    onChange={(e) => setMaxRunSpend(e.target.value)}
                    className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Monthly Cloud Spend Cap (USD)</label>
                  <input
                    type="text"
                    value={monthlySpendCap}
                    onChange={(e) => setMonthlySpendCap(e.target.value)}
                    className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
export default App;
