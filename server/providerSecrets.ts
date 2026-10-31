import { CreateSecretCommand, GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { ModelProviderProfile } from './types';

export interface ProviderCredential { apiKey?: string; externalId?: string; }

const hosted = process.env.LYRA_HOSTED === 'true';
const secretsClient = hosted ? new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' }) : undefined;

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
}

export async function saveProviderCredential(profileId: string, credential: ProviderCredential): Promise<string | undefined> {
  if (!hosted) {
    if (credential.apiKey || credential.externalId) throw new Error('Local development does not persist provider secrets. Use OPENROUTER_API_KEY or AWS credentials in the environment.');
    return undefined;
  }
  if (!secretsClient) throw new Error('AWS Secrets Manager is not configured.');
  const tenant = process.env.LYRA_TENANT_ID;
  if (!tenant) throw new Error('An authenticated tenant ID is required before saving provider credentials.');
  const name = `lyra/tenants/${safeSegment(tenant)}/providers/${safeSegment(profileId)}`;
  const secretString = JSON.stringify(credential);
  try {
    const created = await secretsClient.send(new CreateSecretCommand({ Name: name, SecretString: secretString }));
    if (!created.ARN) throw new Error('AWS did not return the provider secret ARN.');
    return created.ARN;
  } catch (error) {
    if ((error as { name?: string }).name !== 'ResourceExistsException') throw error;
    const updated = await secretsClient.send(new PutSecretValueCommand({ SecretId: name, SecretString: secretString }));
    if (!updated.ARN) throw new Error('AWS did not return the provider secret ARN.');
    return updated.ARN;
  }
}

export async function loadProviderCredential(profile: ModelProviderProfile): Promise<ProviderCredential> {
  const managedSecret = profile.provider === 'openrouter'
    ? process.env.LYRA_MANAGED_OPENROUTER_SECRET_ARN
    : process.env.LYRA_MANAGED_BEDROCK_SECRET_ARN;
  const secretId = profile.credentialMode === 'managed' ? managedSecret : profile.secretRef;
  if (secretId) {
    if (!secretsClient) throw new Error('Secrets Manager credentials are only available in hosted Lyra.');
    const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!result.SecretString) throw new Error('The provider secret is empty or unavailable.');
    return JSON.parse(result.SecretString) as ProviderCredential;
  }

  if (profile.provider === 'openrouter') {
    const apiKey = profile.credentialMode === 'managed' ? process.env.LYRA_MANAGED_OPENROUTER_API_KEY : process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error(profile.credentialMode === 'managed' ? 'Lyra-managed OpenRouter credentials are not configured.' : 'Set OPENROUTER_API_KEY or save an OpenRouter credential in hosted Lyra.');
    return { apiKey };
  }
  return {};
}
