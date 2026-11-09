import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';

export interface ActiveBedrockModel {
  modelId: string;
  modelName: string;
  providerName: string;
  inferenceProfileId?: string;
  supportsPromptCaching?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
  status: 'ACTIVE' | 'LEGACY';
  isLegacy: boolean;
  recommendedSuccessor?: string;
}

export interface CrossRegionInferenceProfile {
  inferenceProfileId: string;
  inferenceProfileName: string;
  status: 'ACTIVE';
  targetModelIds: string[];
  regions: string[];
}

// Known legacy deprecations mapping to active successors
const KNOWN_LEGACY_SUCCESSORS: Record<string, string> = {
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 'anthropic.claude-sonnet-5',
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': 'anthropic.claude-sonnet-5',
  'anthropic.claude-3-5-sonnet': 'anthropic.claude-sonnet-5',
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 'anthropic.claude-sonnet-5',
  'claude-3-5-sonnet': 'anthropic.claude-sonnet-5',
  'anthropic.claude-opus-4-1-20250805-v1:0': 'anthropic.claude-opus-5',
  'anthropic.claude-v2': 'anthropic.claude-sonnet-5',
  'anthropic.claude-v2:1': 'anthropic.claude-sonnet-5',
  'anthropic.claude-instant-v1': 'anthropic.claude-haiku-4-5-20251001-v1:0',
  'twelvelabs.pegasus-1-2-v1:0': 'twelvelabs.pegasus-1-5-v1:0',
  'writer.palmyra-x5-v1:0': 'writer.palmyra-vision-7b',
  'writer.palmyra-x4-v1:0': 'writer.palmyra-vision-7b',
};

// Canonical Cross-Region Inference Profile mappings (US geographic routing for higher quota & HA)
const DEFAULT_CROSS_REGION_PROFILES: Record<string, string> = {
  'anthropic.claude-sonnet-5': 'us.anthropic.claude-sonnet-5',
  'anthropic.claude-sonnet-5-5': 'us.anthropic.claude-sonnet-5-5',
  'anthropic.claude-opus-5-5': 'us.anthropic.claude-opus-5-5',
  'anthropic.claude-opus-5': 'us.anthropic.claude-opus-5',
  'anthropic.claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
  'anthropic.claude-opus-4-6-v1': 'us.anthropic.claude-opus-4-6-v1',
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'anthropic.claude-haiku-5-5': 'us.anthropic.claude-haiku-5-5',
  'deepseek.r1-v1:0': 'us.deepseek.r1-v1:0',
  'us.deepseek.r1-v1:0': 'us.deepseek.r1-v1:0',
  'amazon.nova-pro-v1:0': 'us.amazon.nova-pro-v1:0',
  'us.amazon.nova-pro-v1:0': 'us.amazon.nova-pro-v1:0',
  'amazon.nova-2-pro-v1:0': 'us.amazon.nova-2-pro-v1:0',
  'us.amazon.nova-2-pro-v1:0': 'us.amazon.nova-2-pro-v1:0',
  'amazon.nova-2-lite-v1:0': 'us.amazon.nova-2-lite-v1:0',
  'us.amazon.nova-2-lite-v1:0': 'us.amazon.nova-2-lite-v1:0',
  'amazon.nova-lite-v1:0': 'us.amazon.nova-lite-v1:0',
  'us.amazon.nova-lite-v1:0': 'us.amazon.nova-lite-v1:0',
  'amazon.nova-micro-v1:0': 'us.amazon.nova-micro-v1:0',
  'us.amazon.nova-micro-v1:0': 'us.amazon.nova-micro-v1:0',
  'meta.llama3-3-70b-instruct-v1:0': 'us.meta.llama3-3-70b-instruct-v1:0',
  'us.meta.llama3-3-70b-instruct-v1:0': 'us.meta.llama3-3-70b-instruct-v1:0',
  'meta.llama4-scout-17b-instruct-v1:0': 'us.meta.llama4-scout-17b-instruct-v1:0',
  'meta.llama4-maverick-17b-instruct-v1:0': 'us.meta.llama4-maverick-17b-instruct-v1:0',
};

// Curated active fallback catalog matching AWS Bedrock Live Catalog (us-east-2)
const CURATED_ACTIVE_MODELS: ActiveBedrockModel[] = [
  // Anthropic
  {
    modelId: 'anthropic.claude-sonnet-5',
    modelName: 'Claude Sonnet 5',
    providerName: 'Anthropic',
    inferenceProfileId: 'us.anthropic.claude-sonnet-5',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'anthropic.claude-sonnet-5-5',
    modelName: 'Claude Sonnet 5.5',
    providerName: 'Anthropic',
    inferenceProfileId: 'us.anthropic.claude-sonnet-5-5',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'anthropic.claude-opus-5-5',
    modelName: 'Claude Opus 5.5',
    providerName: 'Anthropic',
    inferenceProfileId: 'us.anthropic.claude-opus-5-5',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'anthropic.claude-opus-5',
    modelName: 'Claude Opus 5',
    providerName: 'Anthropic',
    inferenceProfileId: 'us.anthropic.claude-opus-5',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'anthropic.claude-sonnet-4-6',
    modelName: 'Claude Sonnet 4.6',
    providerName: 'Anthropic',
    inferenceProfileId: 'us.anthropic.claude-sonnet-4-6',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'anthropic.claude-opus-4-6-v1',
    modelName: 'Claude Opus 4.6',
    providerName: 'Anthropic',
    inferenceProfileId: 'us.anthropic.claude-opus-4-6-v1',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    modelName: 'Claude Haiku 4.5',
    providerName: 'Anthropic',
    inferenceProfileId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'anthropic.claude-haiku-5-5',
    modelName: 'Claude Haiku 5.5',
    providerName: 'Anthropic',
    inferenceProfileId: 'us.anthropic.claude-haiku-5-5',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  // OpenAI on Bedrock
  {
    modelId: 'openai.gpt-6-astra',
    modelName: 'GPT-6 Astra',
    providerName: 'OpenAI',
    supportsPromptCaching: false,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'openai.gpt-5.6-terra',
    modelName: 'GPT-5.6 Terra',
    providerName: 'OpenAI',
    supportsPromptCaching: false,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  // DeepSeek on Bedrock
  {
    modelId: 'deepseek.v3.2',
    modelName: 'DeepSeek V3.2',
    providerName: 'DeepSeek',
    supportsPromptCaching: false,
    inputModalities: ['TEXT'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'deepseek.r1-v1:0',
    modelName: 'DeepSeek R1',
    providerName: 'DeepSeek',
    inferenceProfileId: 'us.deepseek.r1-v1:0',
    supportsPromptCaching: false,
    inputModalities: ['TEXT'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  // Amazon Nova
  {
    modelId: 'amazon.nova-pro-v1:0',
    modelName: 'Amazon Nova Pro',
    providerName: 'Amazon',
    inferenceProfileId: 'us.amazon.nova-pro-v1:0',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE', 'VIDEO'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'amazon.nova-2-pro-v1:0',
    modelName: 'Amazon Nova 2 Pro',
    providerName: 'Amazon',
    inferenceProfileId: 'us.amazon.nova-2-pro-v1:0',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE', 'VIDEO'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'amazon.nova-2-lite-v1:0',
    modelName: 'Amazon Nova 2 Lite',
    providerName: 'Amazon',
    inferenceProfileId: 'us.amazon.nova-2-lite-v1:0',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE', 'VIDEO'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'amazon.nova-lite-v1:0',
    modelName: 'Amazon Nova Lite',
    providerName: 'Amazon',
    inferenceProfileId: 'us.amazon.nova-lite-v1:0',
    supportsPromptCaching: true,
    inputModalities: ['TEXT', 'IMAGE', 'VIDEO'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  // Meta Llama 4 & 3.3
  {
    modelId: 'meta.llama4-scout-17b-instruct-v1:0',
    modelName: 'Llama 4 Scout 17B Instruct',
    providerName: 'Meta',
    inferenceProfileId: 'us.meta.llama4-scout-17b-instruct-v1:0',
    supportsPromptCaching: false,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'meta.llama4-maverick-17b-instruct-v1:0',
    modelName: 'Llama 4 Maverick 17B Instruct',
    providerName: 'Meta',
    inferenceProfileId: 'us.meta.llama4-maverick-17b-instruct-v1:0',
    supportsPromptCaching: false,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  {
    modelId: 'meta.llama3-3-70b-instruct-v1:0',
    modelName: 'Llama 3.3 70B Instruct',
    providerName: 'Meta',
    inferenceProfileId: 'us.meta.llama3-3-70b-instruct-v1:0',
    supportsPromptCaching: false,
    inputModalities: ['TEXT'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  // xAI Grok
  {
    modelId: 'xai.grok-4.7',
    modelName: 'Grok 4.7',
    providerName: 'xAI',
    supportsPromptCaching: false,
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
  // Qwen
  {
    modelId: 'qwen.qwen3-coder-480b-a35b-v1:0',
    modelName: 'Qwen3 Coder 480B Instruct',
    providerName: 'Qwen',
    supportsPromptCaching: false,
    inputModalities: ['TEXT'],
    outputModalities: ['TEXT'],
    status: 'ACTIVE',
    isLegacy: false,
  },
];

export class BedrockModelCatalog {
  private client?: BedrockClient;
  private cache: { models: ActiveBedrockModel[]; fetchedAt: number } | null = null;
  private profileCache: { profiles: CrossRegionInferenceProfile[]; fetchedAt: number } | null = null;
  private cacheTtlMs = 60 * 60 * 1000; // 1 hour TTL

  constructor(options?: { region?: string }) {
    const region = options?.region || process.env.AWS_REGION || 'us-east-2';
    try {
      this.client = new BedrockClient({ region });
    } catch {
      this.client = undefined;
    }
  }

  /**
   * Retrieves an up-to-date list of all foundation models on Amazon Bedrock
   * strictly filtering OUT models in the LEGACY state.
   */
  public async getActiveModels(options?: { forceRefresh?: boolean }): Promise<{
    models: ActiveBedrockModel[];
    source: 'bedrock_api' | 'curated_catalog';
    syncedAt: string;
  }> {
    const now = Date.now();

    if (!options?.forceRefresh && this.cache && now - this.cache.fetchedAt < this.cacheTtlMs) {
      return {
        models: this.cache.models,
        source: 'bedrock_api',
        syncedAt: new Date(this.cache.fetchedAt).toISOString(),
      };
    }

    if (this.client) {
      try {
        const response = await this.client.send(
          new ListFoundationModelsCommand({
            byInferenceType: 'ON_DEMAND',
          })
        );

        if (response.modelSummaries && response.modelSummaries.length > 0) {
          const active = response.modelSummaries
            .filter((m) => {
              const status = m.modelLifecycle?.status;
              const isKnownLegacy = Boolean(m.modelId && KNOWN_LEGACY_SUCCESSORS[m.modelId]);
              return status !== 'LEGACY' && !isKnownLegacy && !m.modelId?.includes('claude-sonnet-4-5');
            })
            .map((m): ActiveBedrockModel => {
              const id = m.modelId || '';
              return {
                modelId: id,
                modelName: m.modelName || id,
                providerName: m.providerName || '',
                inferenceProfileId: DEFAULT_CROSS_REGION_PROFILES[id],
                supportsPromptCaching: id.includes('claude') || id.includes('nova'),
                inputModalities: m.inputModalities as string[] | undefined,
                outputModalities: m.outputModalities as string[] | undefined,
                status: 'ACTIVE',
                isLegacy: false,
              };
            });

          this.cache = { models: active, fetchedAt: now };

          return {
            models: active,
            source: 'bedrock_api',
            syncedAt: new Date(now).toISOString(),
          };
        }
      } catch (err) {
        console.warn('[BedrockModelCatalog] Cloud ListFoundationModels query unavailable; falling back to verified active catalog:', err);
      }
    }

    return {
      models: CURATED_ACTIVE_MODELS,
      source: 'curated_catalog',
      syncedAt: new Date(now).toISOString(),
    };
  }

  /**
   * Discovers AWS Bedrock System-Defined Cross-Region Inference Profiles (`us.*`)
   * for automatic multi-region quota aggregation and high availability.
   */
  public async getCrossRegionInferenceProfiles(options?: { forceRefresh?: boolean }): Promise<{
    profiles: CrossRegionInferenceProfile[];
    source: 'bedrock_api' | 'curated_profiles';
  }> {
    const now = Date.now();
    if (!options?.forceRefresh && this.profileCache && now - this.profileCache.fetchedAt < this.cacheTtlMs) {
      return { profiles: this.profileCache.profiles, source: 'bedrock_api' };
    }

    if (this.client) {
      try {
        const res = await this.client.send(
          new ListInferenceProfilesCommand({
            typeEquals: 'SYSTEM_DEFINED',
          })
        );
        if (res.inferenceProfileSummaries && res.inferenceProfileSummaries.length > 0) {
          const profiles: CrossRegionInferenceProfile[] = res.inferenceProfileSummaries
            .filter((p) => p.status === 'ACTIVE' && p.inferenceProfileId)
            .map((p) => ({
              inferenceProfileId: p.inferenceProfileId!,
              inferenceProfileName: p.inferenceProfileName || p.inferenceProfileId!,
              status: 'ACTIVE',
              targetModelIds: (p.models || []).map((m) => m.modelArn || '').filter(Boolean),
              regions: ['us-east-1', 'us-east-2', 'us-west-2'],
            }));
          this.profileCache = { profiles, fetchedAt: now };
          return { profiles, source: 'bedrock_api' };
        }
      } catch {
        // Fallback cleanly when offline or without IAM ListInferenceProfiles permission
      }
    }

    const fallbackProfiles: CrossRegionInferenceProfile[] = Object.entries(DEFAULT_CROSS_REGION_PROFILES).map(
      ([baseModelId, profileId]) => ({
        inferenceProfileId: profileId,
        inferenceProfileName: `US Cross-Region (${baseModelId})`,
        status: 'ACTIVE',
        targetModelIds: [baseModelId],
        regions: ['us-east-1', 'us-east-2', 'us-west-2'],
      })
    );
    return { profiles: fallbackProfiles, source: 'curated_profiles' };
  }

  /**
   * Resolves a base foundation model ID to its Cross-Region Inference Profile ID
   * when invoking Bedrock Converse / ConverseStream for maximum throughput & resiliency.
   */
  public resolveCrossRegionProfileId(modelId: string): string {
    const active = this.resolveActiveModel(modelId).modelId;
    if (DEFAULT_CROSS_REGION_PROFILES[active]) {
      return DEFAULT_CROSS_REGION_PROFILES[active];
    }
    if (active.startsWith('us.') || active.startsWith('eu.') || active.startsWith('apac.')) {
      return active;
    }
    return `us.${active}`;
  }

  /**
   * Checks whether a model supports Amazon Bedrock Prompt Caching (`cachePoint`).
   */
  public supportsPromptCaching(modelId: string): boolean {
    const normalized = modelId.toLowerCase();
    return normalized.includes('claude-sonnet') ||
      normalized.includes('claude-opus') ||
      normalized.includes('claude-haiku') ||
      normalized.includes('nova');
  }

  /**
   * Checks if a model ID is in the legacy state.
   */
  public isLegacyModel(modelId: string): boolean {
    if (KNOWN_LEGACY_SUCCESSORS[modelId]) return true;
    if (modelId.includes('claude-sonnet-4-5')) return true;
    return false;
  }

  /**
   * Automatically resolves any requested model ID. If a legacy model is requested,
   * it auto-upgrades to the active successor and emits a warning.
   */
  public resolveActiveModel(requestedModelId: string): {
    modelId: string;
    wasLegacy: boolean;
    warning?: string;
  } {
    if (this.isLegacyModel(requestedModelId)) {
      const successor = KNOWN_LEGACY_SUCCESSORS[requestedModelId] || 'anthropic.claude-sonnet-5';
      return {
        modelId: successor,
        wasLegacy: true,
        warning: `Model '${requestedModelId}' is in LEGACY state on Amazon Bedrock. Automatically upgraded to active non-legacy model '${successor}'.`,
      };
    }

    return {
      modelId: requestedModelId,
      wasLegacy: false,
    };
  }
}
