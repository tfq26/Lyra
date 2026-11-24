/**
 * OpenRouter model source. Its public listing (`GET /api/v1/models`, no key needed) carries ids,
 * prices (USD per token as strings), context length, supported parameters, a creation date and an
 * optional expiration date, which is enough to discover models, track prices and spot removals.
 *
 * It says nothing about model quality, so discovered models are registered unscored.
 */

import { cleanText } from '../modelRegistry';
import type { CanonicalModelProfile } from '../unifiedModelCatalog';
import type { DiscoveryContext, ModelSourceAdapter, ProviderListing } from './types';

const DEFAULT_URL = 'https://openrouter.ai/api/v1/models';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MIN_CONTEXT_TOKENS = 32_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;

/** OpenRouter vendor prefix -> Lyra model family. Vendors not listed here are not discovered. */
const VENDOR_FAMILY: Record<string, CanonicalModelProfile['family']> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'gemini',
  'meta-llama': 'meta',
  meta: 'meta',
  deepseek: 'deepseek',
  qwen: 'qwen',
  mistralai: 'mistral',
  'x-ai': 'xai',
  moonshotai: 'kimi',
  'z-ai': 'glm',
  minimax: 'minimax',
  nvidia: 'nvidia',
  cohere: 'cohere',
  amazon: 'amazon',
  microsoft: 'microsoft',
};

function perMillion(perToken: unknown): number | undefined {
  const n = Number(perToken);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

function isoFromSeconds(seconds: unknown): string | undefined {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined;
}

function isoFromDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const t = Date.parse(value.length === 10 ? `${value}T23:59:59Z` : value);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Converts OpenRouter's raw model entries, skipping anything malformed. Exported for tests. */
export function parseOpenRouterListing(payload: unknown): ProviderListing[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('OpenRouter response has no "data" array');

  const listings: ProviderListing[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) continue;
    const input = perMillion(raw.pricing?.prompt);
    const output = perMillion(raw.pricing?.completion);
    const outputModalities: unknown[] = Array.isArray(raw.architecture?.output_modalities) ? raw.architecture.output_modalities : [];
    const supported: unknown[] = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];

    listings.push({
      provider: 'openrouter',
      upstreamModelId: raw.id,
      name: cleanText(raw.name, 120) ?? raw.id,
      contextWindow: Number.isFinite(Number(raw.context_length)) ? Number(raw.context_length) : undefined,
      pricing: input !== undefined && output !== undefined ? { inputPerMillion: input, outputPerMillion: output } : undefined,
      supportsTools: supported.includes('tools'),
      textOnly: outputModalities.length > 0 && outputModalities.every((m) => m === 'text'),
      supportsPromptCaching: raw.pricing?.input_cache_read !== undefined,
      createdAt: isoFromSeconds(raw.created),
      expiresAt: isoFromDate(raw.expiration_date),
    });
  }
  return listings;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 80);
}

function tierFromOutputPrice(outputPerMillion: number): CanonicalModelProfile['tier'] {
  if (outputPerMillion <= 1) return 1;
  if (outputPerMillion <= 6) return 2;
  if (outputPerMillion <= 25) return 3;
  return 4;
}

export interface OpenRouterAdapterOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createOpenRouterAdapter(options: OpenRouterAdapterOptions = {}): ModelSourceAdapter {
  const url = options.url ?? process.env.LYRA_OPENROUTER_MODELS_URL ?? DEFAULT_URL;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    provider: 'openrouter',

    async fetchListing(fetchOptions) {
      const signal = fetchOptions?.signal ?? AbortSignal.timeout(options.timeoutMs ?? 20_000);
      const res = await doFetch(url, { headers: { Accept: 'application/json' }, signal });
      if (!res.ok) throw new Error(`OpenRouter returned HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('OpenRouter response is unexpectedly large');
      return parseOpenRouterListing(JSON.parse(text));
    },

    toCandidate(listing: ProviderListing, context: DiscoveryContext) {
      const [vendor = '', namePart = ''] = listing.upstreamModelId.split('/');
      // Variants (":free", ":batch", ":thinking"), aliases ("~latest") and odd ids are not new models.
      if (listing.upstreamModelId.includes(':') || listing.upstreamModelId.startsWith('~') || !ID_PATTERN.test(listing.upstreamModelId)) {
        return { skip: 'variant_or_unusual_id' };
      }
      const family = VENDOR_FAMILY[vendor.toLowerCase()];
      if (!family) return { skip: 'vendor_not_tracked' };
      if (!listing.supportsTools) return { skip: 'no_tool_support' };
      if (!listing.textOnly) return { skip: 'not_text_output' };
      if ((listing.contextWindow ?? 0) < MIN_CONTEXT_TOKENS) return { skip: 'context_too_small' };
      if (!listing.pricing || listing.pricing.inputPerMillion <= 0 || listing.pricing.outputPerMillion <= 0) {
        return { skip: 'free_or_unpriced' };
      }
      if (!listing.createdAt) return { skip: 'no_created_date' };
      const ageDays = (context.now.getTime() - Date.parse(listing.createdAt)) / 86_400_000;
      if (ageDays > context.windowDays) return { skip: 'outside_discovery_window' };

      let id = slug(namePart);
      if (!id) return { skip: 'variant_or_unusual_id' };
      if (context.matchesExistingModel(id)) return { skip: 'matches_existing_model' };
      // Same name from another vendor earlier in this run: disambiguate with the vendor prefix.
      if (context.isIdTaken(id)) id = slug(`${vendor}-${namePart}`);
      if (!id || context.isIdTaken(id) || context.matchesExistingModel(id)) return { skip: 'id_collision' };

      return {
        id,
        name: cleanText(listing.name, 120) ?? id,
        family,
        tier: tierFromOutputPrice(listing.pricing.outputPerMillion),
        workflowGroups: [],
        // Quality is unknown. These are placeholders, hidden from clients while `unscored` is set.
        metrics: {
          reasoningScore: 0,
          codingScore: 0,
          toolProficiency: 0,
          contextWindowTokens: listing.contextWindow!,
          avgTtftMs: 0,
          tokensPerSecond: 0,
        },
        strengths: ['Discovered via OpenRouter; not yet scored'],
        routes: [
          {
            provider: 'openrouter',
            upstreamModelId: listing.upstreamModelId,
            priority: 1,
            apiStyle: 'openai-chat',
            pricing: { ...listing.pricing },
            supportsPromptCaching: Boolean(listing.supportsPromptCaching),
            // OpenRouter's listing does not say whether a model's endpoints retain data. Fail closed:
            // treated as not zero-data-retention until someone verifies it.
            contributorWarning: 'Zero-data-retention status not verified for this discovered model.',
          },
        ],
        unscored: true,
      } satisfies CanonicalModelProfile;
    },
  };
}
