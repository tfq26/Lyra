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
import { PostgresCloudDatabaseAdapter } from '../database';

export interface AwsCloudConfig {
  region: string;
  sqsQueueUrl?: string;
  s3Bucket?: string;
  ecsCluster?: string;
  ecsTaskDefinition?: string;
  appSyncEventsEndpoint?: string;
  secretPrefix?: string;
}

export class AwsCloudProvider implements CloudProviderBundle {
  public readonly id = 'aws' as const;
  public readonly name = 'Amazon Web Services';
  public readonly config: AwsCloudConfig;

  constructor(config?: Partial<AwsCloudConfig>) {
    this.config = {
      region: config?.region || process.env.AWS_REGION || 'us-east-1',
      sqsQueueUrl: config?.sqsQueueUrl || process.env.LYRA_AWS_SQS_QUEUE_URL,
      s3Bucket: config?.s3Bucket || process.env.LYRA_AWS_S3_BUCKET,
      ecsCluster: config?.ecsCluster || process.env.LYRA_AWS_ECS_CLUSTER,
      ecsTaskDefinition: config?.ecsTaskDefinition || process.env.LYRA_AWS_ECS_TASK_DEF,
      appSyncEventsEndpoint: config?.appSyncEventsEndpoint || process.env.LYRA_AWS_APPSYNC_ENDPOINT,
      secretPrefix: config?.secretPrefix || process.env.LYRA_AWS_SECRET_PREFIX,
    };
  }

  public readonly queue: CloudQueueAdapter = {
    provider: 'aws',
    enqueue: async <T>(_queueName: string, _message: Omit<QueueMessage<T>, 'id' | 'enqueuedAt'>) => {
      throw new Error('AwsCloudProvider.queue.enqueue: wire @aws-sdk/client-sqs (SQS FIFO) with LYRA_AWS_SQS_QUEUE_URL.');
    },
    receive: async <T>(_queueName: string) => {
      throw new Error('AwsCloudProvider.queue.receive: wire @aws-sdk/client-sqs.');
    },
    ack: async () => {
      throw new Error('AwsCloudProvider.queue.ack: wire @aws-sdk/client-sqs.');
    },
  };

  public readonly pubsub: CloudPubSubAdapter = {
    provider: 'aws',
    publish: async () => {
      throw new Error('AwsCloudProvider.pubsub.publish: wire AppSync Events or API Gateway WebSockets.');
    },
    subscribe: () => () => {},
  };

  public readonly sandbox: CloudSandboxAdapter = {
    provider: 'aws',
    launch: async (_req: SandboxLaunchRequest): Promise<SandboxHandle> => {
      throw new Error('AwsCloudProvider.sandbox.launch: wire @aws-sdk/client-ecs (Fargate) with LYRA_AWS_ECS_CLUSTER.');
    },
    getStatus: async () => null,
    stop: async () => {},
  };

  private s3Client?: S3Client;

  private getS3(): { client: S3Client; bucket: string } {
    const bucket = this.config.s3Bucket;
    if (!bucket) {
      throw new Error('AwsCloudProvider.storage requires LYRA_AWS_S3_BUCKET to be configured.');
    }
    this.s3Client ||= new S3Client({ region: this.config.region });
    return { client: this.s3Client, bucket };
  }

  public readonly storage: CloudBlobStorageAdapter = {
    provider: 'aws',
    putObject: async (key, body, contentType) => {
      const { client, bucket } = this.getS3();
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
      const { client, bucket } = this.getS3();
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
      const { client, bucket } = this.getS3();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };

  public readonly secrets: CloudSecretAdapter = {
    provider: 'aws',
    getSecret: async (name: string) => process.env[name],
  };

  public readonly database: CloudDatabaseAdapter = new PostgresCloudDatabaseAdapter('aws');

  async healthCheck(): Promise<CloudHealthStatus[]> {
    return [
      {
        provider: 'aws',
        ok: Boolean(this.config.region),
        details: {
          region: this.config.region,
          hasSqs: Boolean(this.config.sqsQueueUrl),
          hasS3: Boolean(this.config.s3Bucket),
          hasEcs: Boolean(this.config.ecsCluster),
        },
      },
    ];
  }
}
