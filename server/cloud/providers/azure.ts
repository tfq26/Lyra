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

export interface AzureCloudConfig {
  tenantId?: string;
  subscriptionId?: string;
  serviceBusConnectionString?: string;
  webPubSubConnectionString?: string;
  sessionPoolEndpoint?: string;
  storageAccountUrl?: string;
  keyVaultUrl?: string;
}

export class AzureCloudProvider implements CloudProviderBundle {
  public readonly id = 'azure' as const;
  public readonly name = 'Microsoft Azure';
  public readonly config: AzureCloudConfig;

  constructor(config?: Partial<AzureCloudConfig>) {
    this.config = {
      tenantId: config?.tenantId || process.env.AZURE_TENANT_ID,
      subscriptionId: config?.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID,
      serviceBusConnectionString:
        config?.serviceBusConnectionString || process.env.LYRA_AZURE_SERVICE_BUS_CONNECTION,
      webPubSubConnectionString:
        config?.webPubSubConnectionString || process.env.LYRA_AZURE_WEBPUBSUB_CONNECTION,
      sessionPoolEndpoint:
        config?.sessionPoolEndpoint || process.env.LYRA_AZURE_SESSION_POOL_ENDPOINT,
      storageAccountUrl:
        config?.storageAccountUrl || process.env.LYRA_AZURE_STORAGE_URL,
      keyVaultUrl: config?.keyVaultUrl || process.env.LYRA_AZURE_KEYVAULT_URL,
    };
  }

  public readonly queue: CloudQueueAdapter = {
    provider: 'azure',
    enqueue: async <T>(_queueName: string, _message: Omit<QueueMessage<T>, 'id' | 'enqueuedAt'>) => {
      throw new Error('AzureCloudProvider.queue.enqueue: wire @azure/service-bus (Session FIFO) with LYRA_AZURE_SERVICE_BUS_CONNECTION.');
    },
    receive: async <T>(_queueName: string) => {
      throw new Error('AzureCloudProvider.queue.receive: wire @azure/service-bus.');
    },
    ack: async () => {
      throw new Error('AzureCloudProvider.queue.ack: wire @azure/service-bus.');
    },
  };

  public readonly pubsub: CloudPubSubAdapter = {
    provider: 'azure',
    publish: async () => {
      throw new Error('AzureCloudProvider.pubsub.publish: wire @azure/web-pubsub with LYRA_AZURE_WEBPUBSUB_CONNECTION.');
    },
    subscribe: () => () => {},
  };

  public readonly sandbox: CloudSandboxAdapter = {
    provider: 'azure',
    launch: async (_req: SandboxLaunchRequest): Promise<SandboxHandle> => {
      throw new Error('AzureCloudProvider.sandbox.launch: wire Azure Container Apps Dynamic Sessions with LYRA_AZURE_SESSION_POOL_ENDPOINT.');
    },
    getStatus: async () => null,
    stop: async () => {},
  };

  public readonly storage: CloudBlobStorageAdapter = {
    provider: 'azure',
    putObject: async () => {
      throw new Error('AzureCloudProvider.storage.putObject: wire @azure/storage-blob with LYRA_AZURE_STORAGE_URL.');
    },
    getObject: async () => null,
    deleteObject: async () => {},
  };

  public readonly secrets: CloudSecretAdapter = {
    provider: 'azure',
    getSecret: async (name: string) => process.env[name],
  };

  async healthCheck(): Promise<CloudHealthStatus[]> {
    return [
      {
        provider: 'azure',
        ok: Boolean(this.config.subscriptionId || this.config.serviceBusConnectionString),
        details: {
          hasServiceBus: Boolean(this.config.serviceBusConnectionString),
          hasWebPubSub: Boolean(this.config.webPubSubConnectionString),
          hasSessionPool: Boolean(this.config.sessionPoolEndpoint),
          hasBlobStorage: Boolean(this.config.storageAccountUrl),
        },
      },
    ];
  }
}
