import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  CloudBlobStorageAdapter,
  CloudDatabaseAdapter,
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
import { SqliteCloudDatabaseAdapter } from '../database';

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

  private r2Client?: S3Client;

  private getR2(): { client: S3Client; bucket: string } {
    const bucket = this.config.r2Bucket;
    const accountId = this.config.accountId;
    if (!bucket || !accountId) {
      throw new Error(
        'CloudflareCloudProvider.storage requires CLOUDFLARE_ACCOUNT_ID and LYRA_CF_R2_BUCKET.'
      );
    }
    const accessKeyId = process.env.LYRA_CF_R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey =
      process.env.LYRA_CF_R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
    this.r2Client ||= new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
    return { client: this.r2Client, bucket };
  }

  public readonly storage: CloudBlobStorageAdapter = {
    provider: 'cloudflare',
    putObject: async (key, body, contentType) => {
      const { client, bucket } = this.getR2();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
          ContentType: contentType || 'application/octet-stream',
        })
      );
    },
    getObject: async (key) => {
      const { client, bucket } = this.getR2();
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!res.Body) return null;
        return await res.Body.transformToByteArray();
      } catch (err: any) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    deleteObject: async (key) => {
      const { client, bucket } = this.getR2();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };

  public readonly secrets: CloudSecretAdapter = {
    provider: 'cloudflare',
    getSecret: async (name: string) => process.env[name],
  };

  public readonly database: CloudDatabaseAdapter = new SqliteCloudDatabaseAdapter('cloudflare');

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
