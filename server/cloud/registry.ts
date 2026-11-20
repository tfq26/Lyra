import type { CloudProviderBundle, CloudProviderId } from './interfaces';
import { LocalCloudProvider } from './providers/local';
import { AwsCloudProvider } from './providers/aws';
import { AzureCloudProvider } from './providers/azure';
import { CloudflareCloudProvider } from './providers/cloudflare';

function normalizeProvider(raw?: string): CloudProviderId {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'aws' || val === 'azure' || val === 'cloudflare' || val === 'local') {
    return val;
  }
  return 'local';
}

function buildProvider(id: CloudProviderId): CloudProviderBundle {
  switch (id) {
    case 'aws':
      return new AwsCloudProvider();
    case 'azure':
      return new AzureCloudProvider();
    case 'cloudflare':
      return new CloudflareCloudProvider();
    case 'local':
    default:
      return new LocalCloudProvider();
  }
}

/**
 * Resolves the active cloud provider bundle from env vars, supporting both a single
 * primary provider (`LYRA_CLOUD_PROVIDER`) and per-capability hybrid overrides
 * (`LYRA_QUEUE_PROVIDER`, `LYRA_PUBSUB_PROVIDER`, `LYRA_SANDBOX_PROVIDER`,
 * `LYRA_STORAGE_PROVIDER`, `LYRA_SECRETS_PROVIDER`).
 */
export function createCloudProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): CloudProviderBundle {
  const primaryId = normalizeProvider(env.LYRA_CLOUD_PROVIDER);
  const cache = new Map<CloudProviderId, CloudProviderBundle>();
  const get = (id: CloudProviderId) => {
    let instance = cache.get(id);
    if (!instance) {
      instance = buildProvider(id);
      cache.set(id, instance);
    }
    return instance;
  };

  const primary = get(primaryId);
  const queue = get(normalizeProvider(env.LYRA_QUEUE_PROVIDER || primaryId)).queue;
  const pubsub = get(normalizeProvider(env.LYRA_PUBSUB_PROVIDER || primaryId)).pubsub;
  const sandbox = get(normalizeProvider(env.LYRA_SANDBOX_PROVIDER || primaryId)).sandbox;
  const storage = get(normalizeProvider(env.LYRA_STORAGE_PROVIDER || primaryId)).storage;
  const secrets = get(normalizeProvider(env.LYRA_SECRETS_PROVIDER || primaryId)).secrets;

  return {
    id: primary.id,
    name: primary.name,
    queue,
    pubsub,
    sandbox,
    storage,
    secrets,
    async healthCheck() {
      const checks = await Promise.all(
        Array.from(cache.values()).map((provider) => provider.healthCheck())
      );
      return checks.flat();
    },
  };
}
