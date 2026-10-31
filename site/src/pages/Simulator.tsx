import React, { useRef, useEffect, useState } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Layers, 
  Code2, 
  Eye 
} from 'lucide-react';

interface SwarmNode {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  active: boolean;
  model: string;
  tokens: number;
  cost: number;
  logs: string[];
}

interface Packet {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number; // 0 to 1
  speed: number;
  color: string;
}

const Simulator: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [selectedNode, setSelectedNode] = useState<SwarmNode | null>(null);
  const [packetFrequency, setPacketFrequency] = useState(1.5);
  
  const nodesRef = useRef<SwarmNode[]>([]);
  const packetsRef = useRef<Packet[]>([]);
  const animationFrameRef = useRef<number>(0);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);

  // Initialize Swarm Topology
  const initSwarm = () => {
    const width = canvasRef.current?.width || 900;
    const height = canvasRef.current?.height || 540;
    const cx = width / 2;
    const cy = height / 2;

    nodesRef.current = [
      {
        id: 'coordinator',
        label: 'Lead Architect',
        role: 'DAG Planner & Coordinator',
        x: cx,
        y: cy - 20,
        vx: 0,
        vy: 0,
        radius: 26,
        color: '#6366f1', // Indigo
        active: true,
        model: 'qwen.qwen3-coder-480b',
        tokens: 11250,
        cost: 0.0168,
        logs: [
          'Lead: Ingested developer prompt',
          '49 deep repository inspections complete',
          'Validated 4-task acyclic DAG with 0 cycles',
          'Allocating worker task worktrees on Bedrock...',
        ],
      },
      {
        id: 'worker-1',
        label: 'Worker 1: Auth',
        role: 'JWT & Session Middleware',
        x: cx - 180,
        y: cy - 80,
        vx: 0,
        vy: 0,
        radius: 18,
        color: '#38bdf8', // Cyan
        active: true,
        model: 'qwen.qwen3-coder-480b',
        tokens: 14800,
        cost: 0.021,
        logs: [
          'Checked out branch lyra/task-auth',
          'Generating password hashing invariants',
          'TSDoc exports added to verifyToken()',
          'Self-healing: fixed unused import',
        ],
      },
      {
        id: 'worker-2',
        label: 'Worker 2: Stripe',
        role: 'Webhook Signature Verifier',
        x: cx + 180,
        y: cy - 80,
        vx: 0,
        vy: 0,
        radius: 18,
        color: '#a855f7', // Purple
        active: true,
        model: 'qwen.qwen3-coder-480b',
        tokens: 13200,
        cost: 0.019,
        logs: [
          'Checked out branch lyra/task-stripe',
          'Wiring raw body buffer for HMAC-SHA256',
          'Handling checkout.session.completed',
          'Committed clean changeset',
        ],
      },
      {
        id: 'worker-3',
        label: 'Worker 3: Vitest',
        role: 'Unit & Edge Assertion Suite',
        x: cx - 140,
        y: cy + 120,
        vx: 0,
        vy: 0,
        radius: 18,
        color: '#10b981', // Emerald
        active: true,
        model: 'us.amazon.nova-pro',
        tokens: 9500,
        cost: 0.012,
        logs: [
          'Checked out branch lyra/task-vitest',
          'Writing boundary tests for token expiration',
          'Running: bun test (18/18 passing)',
          'Coverage: 94.2% across target files',
        ],
      },
      {
        id: 'worker-4',
        label: 'Worker 4: API',
        role: 'Fastify Controllers & Routes',
        x: cx + 140,
        y: cy + 120,
        vx: 0,
        vy: 0,
        radius: 18,
        color: '#f59e0b', // Amber
        active: true,
        model: 'us.amazon.nova-pro',
        tokens: 8800,
        cost: 0.011,
        logs: [
          'Checked out branch lyra/task-api',
          'Connecting endpoints with Zod schemas',
          'Enforcing anti-replay token nonce',
          'Exported REST handler controllers',
        ],
      },
      {
        id: 'bedrock',
        label: 'AWS Bedrock',
        role: 'Cloud Inference Cluster',
        x: cx,
        y: 60,
        vx: 0,
        vy: 0,
        radius: 20,
        color: '#f43f5e', // Rose
        active: true,
        model: 'Pareto Fleet',
        tokens: 57550,
        cost: 0.0798,
        logs: [
          'Streaming response deltas to 4 worktrees',
          'Pareto optimization: $1.20/M in, $4.80/M out',
          'Average TTFT: 520ms',
          'Zero local CPU usage',
        ],
      },
      {
        id: 'git-remote',
        label: 'Git Remote',
        role: 'Indestructible Transport',
        x: cx,
        y: height - 60,
        vx: 0,
        vy: 0,
        radius: 20,
        color: '#06b6d4', // Cyan
        active: true,
        model: 'Git Transport',
        tokens: 0,
        cost: 0.0,
        logs: [
          'Integration lock acquired for run',
          'Merging lyra/task-auth -> integration branch',
          'Zero merge conflicts detected',
          'Release branch ready for developer pull',
        ],
      },
    ];

    setSelectedNode(nodesRef.current[0] ?? null);
  };

  useEffect(() => {
    initSwarm();

    const canvas = canvasRef.current;
    if (!canvas) return;

    let packetId = 0;

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      // 1. Clear background with subtle cyber gradient
      ctx.fillStyle = '#06080E';
      ctx.fillRect(0, 0, width, height);

      // Draw subtle grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const nodes = nodesRef.current;
      const coord = nodes.find((n) => n.id === 'coordinator');
      const bedrock = nodes.find((n) => n.id === 'bedrock');
      const git = nodes.find((n) => n.id === 'git-remote');
      const workers = nodes.filter((n) => n.id.startsWith('worker-'));

      // 2. Draw connections (Curves & Lines)
      if (coord && bedrock && git) {
        // Bedrock -> Coordinator
        drawConnection(ctx, bedrock.x, bedrock.y, coord.x, coord.y, 'rgba(244, 63, 94, 0.35)', 2);

        // Coordinator -> Workers
        workers.forEach((w) => {
          drawConnection(ctx, coord.x, coord.y, w.x, w.y, 'rgba(99, 102, 241, 0.3)', 1.5);
          // Workers -> Git Remote
          drawConnection(ctx, w.x, w.y, git.x, git.y, 'rgba(6, 182, 212, 0.25)', 1.5);
        });

        // 3. Spawn Random Data Packets
        if (isPlaying && Math.random() < 0.08 * packetFrequency) {
          // Packet from Bedrock to Coordinator or Worker
          const targetWorker = workers[Math.floor(Math.random() * workers.length)];
          if (targetWorker) {
            packetsRef.current.push({
              id: packetId++,
              fromX: bedrock.x,
              fromY: bedrock.y,
              toX: targetWorker.x,
              toY: targetWorker.y,
              t: 0,
              speed: 0.012 + Math.random() * 0.008,
              color: '#f43f5e',
            });
          }
        }

        if (isPlaying && Math.random() < 0.06 * packetFrequency) {
          // Packet from Worker to Git Remote
          const fromWorker = workers[Math.floor(Math.random() * workers.length)];
          if (fromWorker) {
            packetsRef.current.push({
              id: packetId++,
              fromX: fromWorker.x,
              fromY: fromWorker.y,
              toX: git.x,
              toY: git.y,
              t: 0,
              speed: 0.01 + Math.random() * 0.008,
              color: '#38bdf8',
            });
          }
        }
      }

      // 4. Update and Draw Energy Packets
      packetsRef.current = packetsRef.current.filter((p) => {
        if (!isPlaying) return true;
        p.t += p.speed;
        if (p.t >= 1) return false;

        const currentX = p.fromX + (p.toX - p.fromX) * p.t;
        const currentY = p.fromY + (p.toY - p.fromY) * p.t;

        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(currentX, currentY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        return true;
      });

      // 5. Draw Swarm Nodes
      nodes.forEach((node) => {
        const isHovered = mousePosRef.current &&
          Math.hypot(mousePosRef.current.x - node.x, mousePosRef.current.y - node.y) < node.radius + 6;
        const isSelected = selectedNode?.id === node.id;

        // Outer glow aura
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + (isSelected ? 8 : isHovered ? 5 : 2), 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? `${node.color}33` : `${node.color}18`;
        ctx.fill();

        // Node circle body
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = isSelected ? 16 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner core
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#0F172A';
        ctx.fill();

        // Center dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Node Label
        ctx.fillStyle = '#f1f5f9';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y + node.radius + 16);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px monospace';
        ctx.fillText(node.role, node.x, node.y + node.radius + 28);
      });

      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, packetFrequency]);

  const drawConnection = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clicked = nodesRef.current.find((node) => Math.hypot(node.x - x, node.y - y) <= node.radius + 8);
    if (clicked) {
      setSelectedNode(clicked);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mousePosRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto py-2">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs font-mono text-indigo-300 mb-2">
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            <span>Interactive Multi-Agent Canvas 2.0</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Swarm Coordination Mesh Simulator
          </h1>
          <p className="text-sm text-slate-400">
            Real-time simulation of AWS Bedrock inference, parallel worktree branching, and automated Git merges.
          </p>
        </div>

        {/* Live Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg transition-all ${
              isPlaying
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
            }`}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isPlaying ? 'Pause Simulation' : 'Resume Simulation'}</span>
          </button>

          <button
            onClick={initSwarm}
            className="p-2 rounded-xl text-slate-400 hover:text-white glass-panel hover:bg-slate-800 transition-all text-xs flex items-center gap-1 font-mono"
            title="Reset simulation"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Simulator Workspace: Canvas + Live Inspection HUD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* HTML5 Canvas 2.0 Container */}
        <div className="lg:col-span-2 glass-panel rounded-2xl shimmer-border overflow-hidden relative shadow-2xl">
          <canvas
            ref={canvasRef}
            width={760}
            height={520}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => { mousePosRef.current = null; }}
            className="w-full h-auto cursor-pointer block"
          />

          {/* Interactive Hint */}
          <div className="absolute bottom-3 left-4 text-[11px] font-mono text-slate-400 flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-white/[0.06]">
            <Eye className="h-3.5 w-3.5 text-indigo-400" />
            <span>Click any node (Coordinator, Workers, Bedrock, Git) to inspect live state</span>
          </div>
        </div>

        {/* Node Inspection Sheet & FinOps HUD */}
        <div className="glass-panel rounded-2xl p-6 space-y-6 flex flex-col justify-between border border-white/[0.08]">
          {selectedNode ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                <div className="flex items-center gap-3">
                  <span
                    className="w-4 h-4 rounded-full inline-block shadow-md"
                    style={{ backgroundColor: selectedNode.color }}
                  ></span>
                  <div>
                    <h3 className="text-base font-bold text-white">{selectedNode.label}</h3>
                    <p className="text-[11px] font-mono text-slate-400">{selectedNode.role}</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ACTIVE
                </span>
              </div>

              {/* Node Metrics */}
              <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-white/[0.06]">
                  <span className="text-slate-500 text-[10px] uppercase block mb-1">Model Assigned</span>
                  <span className="text-slate-200 font-semibold">{selectedNode.model}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-white/[0.06]">
                  <span className="text-slate-500 text-[10px] uppercase block mb-1">Tokens Generated</span>
                  <span className="text-indigo-300 font-semibold">{selectedNode.tokens.toLocaleString()}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-white/[0.06]">
                  <span className="text-slate-500 text-[10px] uppercase block mb-1">Task Cost</span>
                  <span className="text-emerald-400 font-semibold">${selectedNode.cost.toFixed(4)}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-white/[0.06]">
                  <span className="text-slate-500 text-[10px] uppercase block mb-1">Worktree Status</span>
                  <span className="text-cyan-400 font-semibold">Isolated Git</span>
                </div>
              </div>

              {/* Live Streaming Logs */}
              <div className="space-y-2">
                <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5 font-semibold">
                  <Code2 className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Agent Stream Transcript</span>
                </span>
                <div className="p-3 rounded-xl bg-[#06080E] border border-white/[0.06] font-mono text-xs space-y-1.5 max-h-48 overflow-y-auto">
                  {selectedNode.logs.map((log, i) => (
                    <div key={i} className="text-slate-300 flex items-start gap-2">
                      <span className="text-indigo-400 font-bold">›</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 font-mono text-xs">
              Click any node on the canvas to inspect its live Bedrock state.
            </div>
          )}

          {/* Swarm Throttle Settings */}
          <div className="pt-4 border-t border-white/[0.08] space-y-3">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-slate-400">Packet Traffic Rate:</span>
              <span className="text-indigo-400 font-semibold">{packetFrequency}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.5"
              value={packetFrequency}
              onChange={(e) => setPacketFrequency(parseFloat(e.target.value))}
              className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
            />
          </div>
        </div>

      </div>

    </div>
  );
};

export default Simulator;
