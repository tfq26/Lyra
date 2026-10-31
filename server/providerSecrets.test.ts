import { afterEach, describe, expect, it } from 'bun:test';
import type { ModelProviderProfile } from './types';
import { loadProviderCredential, saveProviderCredential } from './providerSecrets';

const priorOpenRouterKey = process.env.OPENROUTER_API_KEY;
const priorManagedKey = process.env.LYRA_MANAGED_OPENROUTER_API_KEY;
afterEach(() => {
  if (priorOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = priorOpenRouterKey;
  if (priorManagedKey === undefined) delete process.env.LYRA_MANAGED_OPENROUTER_API_KEY;
  else process.env.LYRA_MANAGED_OPENROUTER_API_KEY = priorManagedKey;
});

const profile = (credentialMode: 'byo' | 'managed'): ModelProviderProfile => ({ id: 'openrouter-local', name: 'OpenRouter', provider: 'openrouter', credentialMode, model: 'anthropic/claude-sonnet', createdAt: '', updatedAt: '' });

describe('provider secret boundaries', () => {
  it('does not persist plaintext keys in local development', async () => {
    await expect(saveProviderCredential('profile', { apiKey: 'secret-value' })).rejects.toThrow('does not persist');
  });

  it('resolves local BYO and managed OpenRouter keys from environment without profile data', async () => {
    process.env.OPENROUTER_API_KEY = 'local-user-key';
    process.env.LYRA_MANAGED_OPENROUTER_API_KEY = 'managed-key';
    expect(await loadProviderCredential(profile('byo'))).toEqual({ apiKey: 'local-user-key' });
    expect(await loadProviderCredential(profile('managed'))).toEqual({ apiKey: 'managed-key' });
  });
});
