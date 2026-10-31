import { EventEmitter } from 'events';
import type { AgentType, HarnessCapabilities, UsageMetrics } from './types';
import type { RunAgentParams, RunAgentResult } from './processManager';

export interface HarnessAdapter {
  readonly type: AgentType | string;
  getCapabilities(): Promise<HarnessCapabilities>;
  getModels(): Promise<Array<{ id: string; label: string }>>;
  runAgent(params: RunAgentParams): Promise<RunAgentResult>;
  cancel(runId: string): boolean;
}

export class HarnessRegistry extends EventEmitter {
  private static instance: HarnessRegistry;
  private adapters: Map<string, HarnessAdapter> = new Map();

  public static getInstance(): HarnessRegistry {
    if (!HarnessRegistry.instance) {
      HarnessRegistry.instance = new HarnessRegistry();
    }
    return HarnessRegistry.instance;
  }

  public register(adapter: HarnessAdapter): void {
    this.adapters.set(adapter.type, adapter);
    this.emit('adapter_registered', adapter.type);
  }

  public unregister(type: string): boolean {
    const existed = this.adapters.delete(type);
    if (existed) {
      this.emit('adapter_unregistered', type);
    }
    return existed;
  }

  public get(type: string): HarnessAdapter | undefined {
    return this.adapters.get(type);
  }

  public has(type: string): boolean {
    return this.adapters.has(type);
  }

  public listAdapters(): HarnessAdapter[] {
    return Array.from(this.adapters.values());
  }

  public async getAllCapabilities(): Promise<Record<string, HarnessCapabilities>> {
    const result: Record<string, HarnessCapabilities> = {};
    for (const [type, adapter] of this.adapters.entries()) {
      try {
        result[type] = await adapter.getCapabilities();
      } catch {
        result[type] = {
          name: type,
          label: type,
          installed: false,
          authenticated: false,
          ready: false,
          supportedModes: ['solo'],
          supportedOptions: [],
        };
      }
    }
    return result;
  }

  public async getAllModels(): Promise<Record<string, Array<{ id: string; label: string }>>> {
    const result: Record<string, Array<{ id: string; label: string }>> = {};
    for (const [type, adapter] of this.adapters.entries()) {
      try {
        result[type] = await adapter.getModels();
      } catch {
        result[type] = [];
      }
    }
    return result;
  }
}
