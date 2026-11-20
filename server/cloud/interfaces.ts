/**
 * Cloud-agnostic infrastructure interfaces for Lyra & Gram.
 *
 * Allows swapping or mixing self-hosted, AWS, Azure, and Cloudflare backends
 * via environment/credential configuration without changing runtime or UI code.
 */

export type CloudProviderId = 'local' | 'aws' | 'azure' | 'cloudflare';

export interface CloudHealthStatus {
  provider: CloudProviderId;
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface QueueMessage<T = unknown> {
  id: string;
  groupId: string;
  deduplicationId?: string;
  payload: T;
  enqueuedAt: string;
  receiptHandle?: string;
}

export interface CloudQueueAdapter {
  readonly provider: CloudProviderId;
  enqueue<T = unknown>(
    queueName: string,
    message: Omit<QueueMessage<T>, 'id' | 'enqueuedAt'>
  ): Promise<{ messageId: string }>;
  receive<T = unknown>(
    queueName: string,
    options?: { maxMessages?: number; waitTimeSeconds?: number }
  ): Promise<Array<QueueMessage<T>>>;
  ack(queueName: string, receiptHandle: string): Promise<void>;
}

export interface PubSubEvent<T = unknown> {
  channel: string;
  event: string;
  payload: T;
  timestamp: string;
}

export interface CloudPubSubAdapter {
  readonly provider: CloudProviderId;
  publish<T = unknown>(channel: string, event: string, payload: T): Promise<void>;
  subscribe<T = unknown>(
    channel: string,
    handler: (msg: PubSubEvent<T>) => void
  ): () => void;
}

export interface SandboxLaunchRequest {
  runId: string;
  sessionId: string;
  image?: string;
  command?: string[];
  env?: Record<string, string>;
  cpuCores?: number;
  memoryMb?: number;
  timeoutMs?: number;
}

export interface SandboxHandle {
  sandboxId: string;
  provider: CloudProviderId;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
  endpointUrl?: string;
}

export interface CloudSandboxAdapter {
  readonly provider: CloudProviderId;
  launch(req: SandboxLaunchRequest): Promise<SandboxHandle>;
  getStatus(sandboxId: string): Promise<SandboxHandle | null>;
  stop(sandboxId: string): Promise<void>;
}

export interface CloudBlobStorageAdapter {
  readonly provider: CloudProviderId;
  putObject(key: string, body: string | Uint8Array, contentType?: string): Promise<void>;
  getObject(key: string): Promise<Uint8Array | null>;
  deleteObject(key: string): Promise<void>;
  getSignedUrl?(key: string, expiresInSeconds?: number): Promise<string>;
}

export interface CloudSecretAdapter {
  readonly provider: CloudProviderId;
  getSecret(name: string): Promise<string | undefined>;
}

export interface CloudProviderBundle {
  readonly id: CloudProviderId;
  readonly name: string;
  readonly queue: CloudQueueAdapter;
  readonly pubsub: CloudPubSubAdapter;
  readonly sandbox: CloudSandboxAdapter;
  readonly storage: CloudBlobStorageAdapter;
  readonly secrets: CloudSecretAdapter;
  healthCheck(): Promise<CloudHealthStatus[]>;
}
