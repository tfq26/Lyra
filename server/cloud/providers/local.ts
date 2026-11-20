import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type {
  CloudBlobStorageAdapter,
  CloudHealthStatus,
  CloudProviderBundle,
  CloudPubSubAdapter,
  CloudQueueAdapter,
  CloudSecretAdapter,
  CloudSandboxAdapter,
  PubSubEvent,
  QueueMessage,
  SandboxHandle,
  SandboxLaunchRequest,
} from '../interfaces';

class LocalMemoryQueueAdapter implements CloudQueueAdapter {
  public readonly provider = 'local' as const;
  private queues = new Map<string, Array<QueueMessage<any>>>();
  private seenDedup = new Set<string>();

  async enqueue<T>(
    queueName: string,
    message: Omit<QueueMessage<T>, 'id' | 'enqueuedAt'>
  ): Promise<{ messageId: string }> {
    if (message.deduplicationId) {
      const dedupKey = `${queueName}:${message.deduplicationId}`;
      if (this.seenDedup.has(dedupKey)) {
        return { messageId: `dedup-${message.deduplicationId}` };
      }
      this.seenDedup.add(dedupKey);
    }
    const id = `msg-${crypto.randomUUID()}`;
    const list = this.queues.get(queueName) || [];
    list.push({
      ...message,
      id,
      receiptHandle: id,
      enqueuedAt: new Date().toISOString(),
    });
    this.queues.set(queueName, list);
    return { messageId: id };
  }

  async receive<T>(
    queueName: string,
    options?: { maxMessages?: number }
  ): Promise<Array<QueueMessage<T>>> {
    const list = this.queues.get(queueName) || [];
    const count = Math.max(1, options?.maxMessages ?? 10);
    return list.slice(0, count);
  }

  async ack(queueName: string, receiptHandle: string): Promise<void> {
    const list = this.queues.get(queueName) || [];
    this.queues.set(
      queueName,
      list.filter((m) => m.receiptHandle !== receiptHandle && m.id !== receiptHandle)
    );
  }
}

class LocalPubSubAdapter implements CloudPubSubAdapter {
  public readonly provider = 'local' as const;
  private listeners = new Map<string, Set<(msg: PubSubEvent<any>) => void>>();

  async publish<T>(channel: string, event: string, payload: T): Promise<void> {
    const subs = this.listeners.get(channel);
    if (!subs || subs.size === 0) return;
    const msg: PubSubEvent<T> = {
      channel,
      event,
      payload,
      timestamp: new Date().toISOString(),
    };
    for (const fn of subs) fn(msg);
  }

  subscribe<T>(channel: string, handler: (msg: PubSubEvent<T>) => void): () => void {
    let subs = this.listeners.get(channel);
    if (!subs) {
      subs = new Set();
      this.listeners.set(channel, subs);
    }
    subs.add(handler as (msg: PubSubEvent<any>) => void);
    return () => {
      subs?.delete(handler as (msg: PubSubEvent<any>) => void);
    };
  }
}

class LocalSandboxAdapter implements CloudSandboxAdapter {
  public readonly provider = 'local' as const;
  private sandboxes = new Map<string, SandboxHandle>();

  async launch(req: SandboxLaunchRequest): Promise<SandboxHandle> {
    const handle: SandboxHandle = {
      sandboxId: `local-sb-${req.runId}`,
      provider: 'local',
      status: 'running',
    };
    this.sandboxes.set(handle.sandboxId, handle);
    return handle;
  }

  async getStatus(sandboxId: string): Promise<SandboxHandle | null> {
    return this.sandboxes.get(sandboxId) || null;
  }

  async stop(sandboxId: string): Promise<void> {
    const existing = this.sandboxes.get(sandboxId);
    if (existing) {
      this.sandboxes.set(sandboxId, { ...existing, status: 'stopped' });
    }
  }
}

class LocalBlobStorageAdapter implements CloudBlobStorageAdapter {
  public readonly provider = 'local' as const;
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir || path.join(os.tmpdir(), 'lyra-cloud-blobs');
  }

  private resolveKey(key: string): string {
    const safe = key.replace(/^\/+/, '').replace(/\.\./g, '_');
    return path.resolve(this.rootDir, safe);
  }

  async putObject(key: string, body: string | Uint8Array): Promise<void> {
    const target = this.resolveKey(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const target = this.resolveKey(key);
    if (!fs.existsSync(target)) return null;
    return new Uint8Array(fs.readFileSync(target));
  }

  async deleteObject(key: string): Promise<void> {
    const target = this.resolveKey(key);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

class LocalEnvSecretAdapter implements CloudSecretAdapter {
  public readonly provider = 'local' as const;

  async getSecret(name: string): Promise<string | undefined> {
    return process.env[name];
  }
}

export class LocalCloudProvider implements CloudProviderBundle {
  public readonly id = 'local' as const;
  public readonly name = 'Local / Self-Hosted';
  public readonly queue: CloudQueueAdapter;
  public readonly pubsub: CloudPubSubAdapter;
  public readonly sandbox: CloudSandboxAdapter;
  public readonly storage: CloudBlobStorageAdapter;
  public readonly secrets: CloudSecretAdapter;

  constructor(options?: { blobDir?: string }) {
    this.queue = new LocalMemoryQueueAdapter();
    this.pubsub = new LocalPubSubAdapter();
    this.sandbox = new LocalSandboxAdapter();
    this.storage = new LocalBlobStorageAdapter(options?.blobDir);
    this.secrets = new LocalEnvSecretAdapter();
  }

  async healthCheck(): Promise<CloudHealthStatus[]> {
    return [{ provider: 'local', ok: true, details: { mode: 'self-hosted' } }];
  }
}
