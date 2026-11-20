import type {
  CloudBlobStorageAdapter,
  CloudHealthStatus,
  CloudProviderBundle,
  CloudPubSubAdapter,
  CloudQueueAdapter,
  CloudSecretAdapter,
  CloudSandboxAdapter,
  QueueMessage,
  SandboxHandle,
  SandboxLaunchRequest,
} from '../interfaces';

export interface CloudflareCloudConfig {
  accountId?: string;
  apiToken?: string;
  r2Bucket?: string;
  containerAppId?: string;
  queueName?: string;
}

export class CloudflareCloudProvider implements CloudProviderBundle {
  public readonly id = 'cloudflare' as const;
  public readonly name = 'Cloudflare';
  public readonly config: CloudflareCloudConfig;

  constructor(config?: Partial<CloudflareCloudConfig>) {
    this.config = {
      accountId: config?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: config?.apiToken || process.env.CLOUDFLARE_API_TOKEN,
      r2Bucket: config?.r2Bucket || process.env.LYRA_CF_R2_BUCKET,
      containerAppId: config?.containerAppId || process.env.LYRA_CF_CONTAINER_APP_ID,
      queueName: config?.queueName || process.env.LYRA_CF_QUEUE_NAME,
    };
  }

  public readonly queue: CloudQueueAdapter = {
    provider: 'cloudflare',
    enqueue: async <T>(_queueName: string, _message: Omit<QueueMessage<T>, 'id' | 'enqueuedAt'>) => {
      throw new Error('CloudflareCloudProvider.queue.enqueue: wire Cloudflare Queues binding or REST API.');
    },
    receive: async <T>(_queueName: string) => {
      throw new Error('CloudflareCloudProvider.queue.receive: wire Cloudflare Queues consumer.');
    },
    ack: async () => {
      throw new Error('CloudflareCloudProvider.queue.ack: wire Cloudflare Queues consumer.');
    },
  };

  public readonly pubsub: CloudPubSubAdapter = {
    provider: 'cloudflare',
    publish: async () => {
      throw new Error('CloudflareCloudProvider.pubsub.publish: wire Cloudflare Durable Objects WebSocket relay.');
    },
    subscribe: () => () => {},
  };

  public readonly sandbox: CloudSandboxAdapter = {
    provider: 'cloudflare',
    launch: async (_req: SandboxLaunchRequest): Promise<SandboxHandle> => {
      throw new Error('CloudflareCloudProvider.sandbox.launch: wire Cloudflare Containers API with LYRA_CF_CONTAINER_APP_ID.');
    },
    getStatus: async () => null,
    stop: async () => {},
  };

  public readonly storage: CloudBlobStorageAdapter = {
    provider: 'cloudflare',
    putObject: async () => {
      throw new Error('CloudflareCloudProvider.storage.putObject: wire Cloudflare R2 S3-compatible binding.');
    },
    getObject: async () => null,
    deleteObject: async () => {},
  };

  public readonly secrets: CloudSecretAdapter = {
    provider: 'cloudflare',
    getSecret: async (name: string) => process.env[name],
  };

  async healthCheck(): Promise<CloudHealthStatus[]> {
    return [
      {
        provider: 'cloudflare',
        ok: Boolean(this.config.accountId || this.config.r2Bucket || this.config.containerAppId),
        details: {
          hasAccountId: Boolean(this.config.accountId),
          hasR2: Boolean(this.config.r2Bucket),
          hasContainerApp: Boolean(this.config.containerAppId),
        },
      },
    ];
  }
}
