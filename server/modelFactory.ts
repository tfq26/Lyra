import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { Agent, SessionManager } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { LocalFileStorage, S3Storage } from '@strands-agents/sdk/storage';
import type { Model } from '@strands-agents/sdk';
import type { ModelProviderProfile } from './types';
import { loadProviderCredential } from './providerSecrets';
import path from 'path';

export interface ModelRuntimeContext { tenantId: string; region?: string; }

export async function createStrandsModel(profile: ModelProviderProfile): Promise<Model> {
  const secret = await loadProviderCredential(profile);
  if (profile.provider === 'openrouter') {
    if (!secret.apiKey) throw new Error('OpenRouter API credentials are required for this connection.');
    return new OpenAIModel({
      api: 'chat',
      modelId: profile.model,
      apiKey: secret.apiKey,
      maxTokens: 8192,
      temperature: 0.2,
      clientConfig: { baseURL: 'https://openrouter.ai/api/v1' },
    });
  }

  let credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string } | undefined;
  if (profile.roleArn) {
    if (!secret.externalId) throw new Error('The Bedrock connection is missing its Secrets Manager External ID.');
    const sts = new STSClient({ region: profile.region });
    try {
      const result = await sts.send(new AssumeRoleCommand({ RoleArn: profile.roleArn, RoleSessionName: `lyra-${Date.now()}`, ExternalId: secret.externalId, DurationSeconds: 900 }));
      if (!result.Credentials?.AccessKeyId || !result.Credentials.SecretAccessKey || !result.Credentials.SessionToken) throw new Error('AWS STS did not return temporary Bedrock credentials.');
      credentials = { accessKeyId: result.Credentials.AccessKeyId, secretAccessKey: result.Credentials.SecretAccessKey, sessionToken: result.Credentials.SessionToken };
    } finally { sts.destroy(); }
  }
  if (process.env.LYRA_HOSTED === 'true' && profile.credentialMode === 'byo' && !profile.roleArn) throw new Error('Hosted BYO Bedrock connections require a customer IAM role.');
  return new BedrockModel({ modelId: profile.model, region: profile.region || process.env.AWS_REGION || 'us-east-1', maxTokens: 8192, temperature: 0.2, cacheConfig: { strategy: 'auto' }, ...(credentials ? { clientConfig: { credentials } } : {}) });
}

export function createSessionManager(sessionId: string, storagePath: string, tenantId: string): SessionManager {
  const bucket = process.env.LYRA_STRANDS_SESSION_BUCKET;
  if (bucket) {
    if (process.env.LYRA_HOSTED === 'true' && !tenantId) throw new Error('Authenticated tenant context is required for cloud agent snapshots.');
    const storage = new S3Storage(bucket, { prefix: `lyra/strands/${tenantId.replace(/[^a-zA-Z0-9_-]/g, '-')}/` });
    return new SessionManager({ sessionId, storage, saveLatestOn: 'message' });
  }
  if (process.env.LYRA_HOSTED === 'true') throw new Error('LYRA_STRANDS_SESSION_BUCKET must be configured for hosted long-session persistence.');
  return new SessionManager({ sessionId, storage: new LocalFileStorage(path.join(storagePath, 'strands')), saveLatestOn: 'message' });
}

export function getNativeAgent(profile: ModelProviderProfile, sessionId: string, storagePath: string, tenantId: string, tools: NonNullable<ConstructorParameters<typeof Agent>[0]>['tools'], interventions?: NonNullable<ConstructorParameters<typeof Agent>[0]>['interventions']) {
  return createStrandsModel(profile).then((model) => new Agent({
    id: `lyra-${sessionId}`,
    name: 'Lyra',
    description: 'Lyra coding agent',
    systemPrompt: 'You are Lyra. Inspect repo code before editing. Make focused changes with tools and add concise TSDoc/invariants to exports. Verify work with tests. Never claim unverified success.',
    model,
    tools,
    interventions,
    sessionManager: createSessionManager(sessionId, storagePath, tenantId),
  }));
}
