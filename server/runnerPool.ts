import { WebSocket } from 'ws';
import type { RunnerNode } from './types';

export interface PickNodeOptions {
  preferredNodeId?: string;
  nodeType?: 'homelab' | 'local' | 'cloud';
  capability?: string;
}

export interface PickedRunner {
  node: RunnerNode;
  socket: any;
}

export interface HeartbeatLoadUpdate {
  activeTasks?: number;
  maxConcurrency?: number;
  capabilities?: string[];
}

function isSocketOpen(socket: any): boolean {
  if (!socket) return false;
  return socket.readyState === WebSocket.OPEN || socket.readyState === 1;
}

export class RunnerPool {
  private readonly nodes = new Map<string, RunnerNode>();
  private readonly sockets = new Map<string, any>();

  constructor(initialNodes: RunnerNode[] = []) {
    for (const node of initialNodes) {
      this.nodes.set(node.id, { ...node });
    }
  }

  public register(node: RunnerNode, socket?: any): RunnerNode {
    const maxConcurrency = Math.max(1, node.maxConcurrency ?? node.cpus ?? 2);
    const activeTasks = Math.max(0, node.activeTasks ?? 0);
    const normalized: RunnerNode = {
      ...node,
      activeTasks,
      maxConcurrency,
      capabilities: node.capabilities ?? ['native', 'swarm', 'verify'],
      status: activeTasks >= maxConcurrency ? 'busy' : 'online',
      lastSeen: new Date().toISOString(),
    };
    this.nodes.set(normalized.id, normalized);
    if (socket) {
      this.sockets.set(normalized.id, socket);
    }
    return normalized;
  }

  public heartbeat(nodeId: string, update?: HeartbeatLoadUpdate): RunnerNode | undefined {
    const node = this.nodes.get(nodeId);
    if (!node) return undefined;

    if (typeof update?.maxConcurrency === 'number' && update.maxConcurrency > 0) {
      node.maxConcurrency = update.maxConcurrency;
    }
    if (typeof update?.activeTasks === 'number' && update.activeTasks >= 0) {
      node.activeTasks = update.activeTasks;
    }
    if (Array.isArray(update?.capabilities)) {
      node.capabilities = update.capabilities;
    }

    const max = Math.max(1, node.maxConcurrency ?? node.cpus ?? 2);
    const active = Math.max(0, node.activeTasks ?? 0);
    node.status = active >= max ? 'busy' : 'online';
    node.lastSeen = new Date().toISOString();
    return node;
  }

  public removeSocket(socket: any): string | null {
    for (const [nodeId, existingSocket] of this.sockets.entries()) {
      if (existingSocket === socket) {
        this.sockets.delete(nodeId);
        const node = this.nodes.get(nodeId);
        if (node) {
          node.status = 'offline';
          node.activeTasks = 0;
        }
        return nodeId;
      }
    }
    return null;
  }

  public getNode(nodeId: string): RunnerNode | undefined {
    return this.nodes.get(nodeId);
  }

  public getSocket(nodeId: string): any | undefined {
    return this.sockets.get(nodeId);
  }

  public hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  public listNodes(): RunnerNode[] {
    return Array.from(this.nodes.values());
  }

  public pruneStale(staleAfterMs = 45_000, nowMs = Date.now()): string[] {
    const offlined: string[] = [];
    for (const [id, node] of this.nodes.entries()) {
      if (node.type === 'local' || node.status === 'offline') continue;
      const lastSeenMs = new Date(node.lastSeen).getTime();
      if (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs > staleAfterMs) {
        node.status = 'offline';
        node.activeTasks = 0;
        this.sockets.delete(id);
        offlined.push(id);
      }
    }
    return offlined;
  }

  public pickNode(options: PickNodeOptions = {}): PickedRunner | null {
    const { preferredNodeId, nodeType, capability } = options;

    if (preferredNodeId && preferredNodeId !== 'auto' && preferredNodeId !== 'homelab-pool' && preferredNodeId !== 'local') {
      const node = this.nodes.get(preferredNodeId);
      const socket = this.sockets.get(preferredNodeId);
      if (node && node.status !== 'offline' && isSocketOpen(socket)) {
        return { node, socket };
      }
      return null;
    }

    const candidates: PickedRunner[] = [];
    for (const node of this.nodes.values()) {
      if (node.status === 'offline') continue;
      if (nodeType && node.type !== nodeType) continue;
      if (capability && node.capabilities && !node.capabilities.includes(capability)) continue;

      const socket = this.sockets.get(node.id);
      if (!isSocketOpen(socket)) continue;

      const active = Math.max(0, node.activeTasks ?? 0);
      const max = Math.max(1, node.maxConcurrency ?? node.cpus ?? 2);
      if (active >= max) continue;

      candidates.push({ node, socket });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const loadA = (a.node.activeTasks ?? 0) / Math.max(1, a.node.maxConcurrency ?? a.node.cpus ?? 2);
      const loadB = (b.node.activeTasks ?? 0) / Math.max(1, b.node.maxConcurrency ?? b.node.cpus ?? 2);
      if (loadA !== loadB) return loadA - loadB;

      const cpusA = a.node.cpus ?? 1;
      const cpusB = b.node.cpus ?? 1;
      if (cpusA !== cpusB) return cpusB - cpusA;

      return new Date(b.node.lastSeen).getTime() - new Date(a.node.lastSeen).getTime();
    });

    return candidates[0] ?? null;
  }

  public recordTaskStart(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const max = Math.max(1, node.maxConcurrency ?? node.cpus ?? 2);
    node.activeTasks = (node.activeTasks ?? 0) + 1;
    node.status = node.activeTasks >= max ? 'busy' : 'online';
    node.lastSeen = new Date().toISOString();
  }

  public recordTaskEnd(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const max = Math.max(1, node.maxConcurrency ?? node.cpus ?? 2);
    node.activeTasks = Math.max(0, (node.activeTasks ?? 0) - 1);
    if (node.status !== 'offline') {
      node.status = node.activeTasks >= max ? 'busy' : 'online';
    }
    node.lastSeen = new Date().toISOString();
  }
}
