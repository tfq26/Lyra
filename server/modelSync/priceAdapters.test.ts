import { beforeEach, describe, expect, test } from 'bun:test';
import { modelRegistry } from '../modelRegistry';
import { getModelLifecycleStatus } from '../unifiedModelCatalog';
import {
  bedrockListings,
  bedrockNameKey,
  bedrockRouteScope,
  createBedrockPriceAdapter,
  parseBedrockPriceFile,
  type BedrockPriceRow,
} from './bedrockPriceAdapter';
import { createFoundryPriceAdapter, foundryListings, foundryModelKey, parseAzureMeter, type AzurePriceItem } from './foundryPriceAdapter';
import { getConfiguredAdapters, runModelSync, type ModelSourceAdapter, type ProviderListing, type SyncOptions } from './index';

// ---- AWS Price List fixtures (shaped like the real files) ----------------------------------------------------------

type AwsRow = { model: string; usagetype: string; inferenceType?: string; usd: number; unit?: string; region?: string; begin?: string };

function awsFile(rows: AwsRow[], filler = 0) {
  const products: Record<string, { attributes: Record<string, string> }> = {};
  const onDemand: Record<string, unknown> = {};
  rows.forEach((r, i) => {
    const sku = `SKU${i}`;
    products[sku] = {
      attributes: { model: r.model, usagetype: r.usagetype, regionCode: r.region ?? 'us-east-1', ...(r.inferenceType !== undefined ? { inferenceType: r.inferenceType } : {}) },
    };
    onDemand[sku] = { [`${sku}.T`]: { priceDimensions: { [`${sku}.D`]: { unit: r.unit ?? '1M tokens', beginRange: r.begin ?? '0', pricePerUnit: { USD: String(r.usd) } } } } };
  });
  for (let i = 0; i < filler; i++) products[`FILL${i}`] = { attributes: { model: 'Filler', regionCode: 'eu-west-1', usagetype: 'x' } };
  return { products, terms: { OnDemand: onDemand } };
}

const claudeRows: AwsRow[] = [
  { model: 'Claude Fable 5.2', inferenceType: 'Input tokens', usagetype: 'USE1-MP:USE1_input_tokens_global_standard-Units', usd: 8 },
  { model: 'Claude Fable 5.2', inferenceType: 'Output tokens', usagetype: 'USE1-MP:USE1_output_tokens_global_standard-Units', usd: 40 },
  { model: 'Claude Fable 5.2', inferenceType: 'Input tokens', usagetype: 'USE1-MP:USE1_input_tokens_standard-Units', usd: 8.8 },
  { model: 'Claude Fable 5.2', inferenceType: 'Output tokens', usagetype: 'USE1-MP:USE1_output_tokens_standard-Units', usd: 44 },
  // Rows that must be ignored: cache, batch, long context, other region, reserved capacity, partial range.
  { model: 'Claude Fable 5.2', inferenceType: 'Prompt cache read input tokens', usagetype: 'USE1-MP:USE1_cache_read_tokens_standard-Units', usd: 0.22 },
  { model: 'Claude Fable 5.2', inferenceType: 'Input tokens', usagetype: 'USE1-MP:USE1_input_tokens_batch_standard-Units', usd: 4 },
  { model: 'Claude Fable 5.2', inferenceType: 'Input tokens', usagetype: 'USE1-MP:USE1_input_tokens_long_ctx_standard-Units', usd: 16 },
  { model: 'Claude Fable 5.2', inferenceType: 'Input tokens', usagetype: 'USE1-MP:USE1_input_tokens_standard-Units', usd: 9.9, region: 'eu-west-1' },
  { model: 'Claude Fable 5.2', inferenceType: 'Input tokens', usagetype: 'USE1-MP:USE1_Reserved_1Month_InputTPM_Geo-Units', usd: 0.33, unit: '1M TPM Hour' },
  { model: 'Claude Fable 5.2', inferenceType: 'Input tokens', usagetype: 'USE1-MP:USE1_input_tokens_standard-Units', usd: 1.1, begin: '200000' },
];

describe('Bedrock price adapter', () => {
  test('reads standard on-demand token prices only, in USD per million tokens', () => {
    const rows = parseBedrockPriceFile(awsFile([...claudeRows], 600));
    expect(rows.map((r) => `${r.direction}/${r.scope}/${r.perMillion}`).sort()).toEqual(['input/global/8', 'input/regional/8.8', 'output/global/40', 'output/regional/44']);
  });

  test('converts per-1K prices and reads models that have no inferenceType from the usage type', () => {
    const rows = parseBedrockPriceFile(
      awsFile(
        [
          { model: 'DeepSeek V3.2', inferenceType: 'Input tokens', usagetype: 'USE1-deepseek.v3.2-input-tokens', usd: 0.00062, unit: '1K tokens' },
          { model: 'xAI Grok 4.6', usagetype: 'USE1-xai.grok-4.6-mantle-input-tokens-standard', usd: 0.0022, unit: '1K tokens' },
          { model: 'xAI Grok 4.6', usagetype: 'USE1-xai.grok-4.6-mantle-output-tokens-standard', usd: 0.0066, unit: '1K tokens' },
          { model: 'xAI Grok 4.6', usagetype: 'USE1-xai.grok-4.6-mantle-input-tokens-flex', usd: 0.0011, unit: '1K tokens' },
        ],
        600
      )
    );
    expect(rows).toEqual([
      { model: 'deepseek-v3-2', direction: 'input', scope: 'regional', perMillion: 0.62 },
      { model: 'xai-grok-4-6', direction: 'input', scope: 'regional', perMillion: 2.2 },
      { model: 'xai-grok-4-6', direction: 'output', scope: 'regional', perMillion: 6.6 },
    ]);
  });

  test('rejects a price file that is too small to be real', () => {
    expect(() => parseBedrockPriceFile(awsFile(claudeRows, 0))).toThrow(/unreliable/);
    expect(() => parseBedrockPriceFile({})).toThrow(/no "products"/);
  });

  test('derives the AWS model name from a route id', () => {
    expect(bedrockNameKey('us.anthropic.claude-fable-5-2-v1:0')).toBe('claude-fable-5-2');
    expect(bedrockNameKey('us.anthropic.claude-opus-4-6-v1')).toBe('claude-opus-4-6');
    expect(bedrockNameKey('us.openai.gpt-6.1-sol')).toBe('gpt-6-1-sol');
    expect(bedrockNameKey('deepseek.v3.2')).toBe('v3-2');
    expect(bedrockNameKey('us.amazon.nova-2-lite-v1:0')).toBe('nova-2-lite');
    expect(bedrockNameKey('mistral.mistral-large-3-675b-instruct')).toBe('mistral-large-3');
  });

  test('prices a regional profile at the regional rate and a global profile at the global rate', () => {
    const rows = parseBedrockPriceFile(awsFile(claudeRows, 600));
    expect(bedrockRouteScope('us.anthropic.claude-fable-5-2-v1:0')).toBe('regional');
    expect(bedrockRouteScope('global.anthropic.claude-fable-5-2-v1:0')).toBe('global');
    const { listings } = bedrockListings(rows, ['us.anthropic.claude-fable-5-2-v1:0', 'global.anthropic.claude-fable-5-2-v1:0']);
    expect(listings.map((l) => [l.upstreamModelId, l.pricing])).toEqual([
      ['us.anthropic.claude-fable-5-2-v1:0', { inputPerMillion: 8.8, outputPerMillion: 44 }],
      ['global.anthropic.claude-fable-5-2-v1:0', { inputPerMillion: 8, outputPerMillion: 40 }],
    ]);
  });

  test('leaves a route unpriced when the model is unknown or its price is ambiguous', () => {
    const rows: BedrockPriceRow[] = [
      { model: 'claude-x', direction: 'input', scope: 'regional', perMillion: 3 },
      { model: 'claude-x', direction: 'input', scope: 'regional', perMillion: 4 }, // two different standard prices: do not guess
      { model: 'claude-x', direction: 'output', scope: 'regional', perMillion: 15 },
      { model: 'claude-y', direction: 'input', scope: 'regional', perMillion: 1 }, // no output price
    ];
    const { listings, unmatched } = bedrockListings(rows, ['us.anthropic.claude-x', 'us.anthropic.claude-y', 'us.anthropic.claude-unknown']);
    expect(listings).toEqual([]);
    expect(unmatched).toHaveLength(3);
  });

  test('fetches both price files and prices only the routes it is given', async () => {
    const urls: string[] = [];
    const adapter = createBedrockPriceAdapter({
      baseUrl: 'https://aws.test',
      routeIds: () => ['us.anthropic.claude-fable-5-2-v1:0', 'us.anthropic.claude-unknown'],
      fetchImpl: (async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(awsFile(url.includes('FoundationModels') ? claudeRows : [], 600)), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(adapter.pricesOnly).toBe(true);
    const listing = await adapter.fetchListing();
    expect(urls).toEqual(['https://aws.test/AmazonBedrockFoundationModels/current/index.json', 'https://aws.test/AmazonBedrock/current/index.json']);
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({ provider: 'bedrock', pricing: { inputPerMillion: 8.8, outputPerMillion: 44 } });
    expect(adapter.toCandidate(listing[0]!, {} as never)).toEqual({ skip: 'prices_only_source' });
  });

  test('a failed download is an error, never an empty price list', async () => {
    const adapter = createBedrockPriceAdapter({ fetchImpl: (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch });
    await expect(adapter.fetchListing()).rejects.toThrow(/HTTP 503/);
  });
});

// ---- Azure Retail Prices fixtures (real meter names) ----------------------------------------------------------------

const az = (productName: string, skuName: string, retailPrice: number, unitOfMeasure = '1M'): AzurePriceItem => ({
  productName,
  skuName,
  retailPrice,
  unitOfMeasure,
  type: 'Consumption',
  tierMinimumUnits: 0,
});

const azureItems: AzurePriceItem[] = [
  az('Azure OpenAI GPT6', '6.2-astra ShCo Inp Std Gl', 8),
  az('Azure OpenAI GPT6', '6.2-astra ShCo Opt Std Gl', 40),
  az('Azure OpenAI GPT6', '6.2-astra ShCo Inp Std DZ', 8.8),
  az('Azure OpenAI GPT6', '6.2-astra ShCo Opt Std DZ', 44),
  // Not the plain price: cached, flex, long context, other model ("6-astra" is GPT-6, not 6.2).
  az('Azure OpenAI GPT6', '6.2-astra ShCo Cd Inp Std Gl', 0.4),
  az('Azure OpenAI GPT6', '6.2-astra ShCo Inp Flex Gl', 4),
  az('Azure OpenAI GPT6', '6.2-astra LoCo Opt Std Gl', 60),
  az('Azure OpenAI GPT6', '6-astra ShortCo Opt Std DZ', 55),
  az('Azure Grok Models', '4.7 Inp glbl', 2),
  az('Azure Grok Models', '4.7 Outp glbl', 6),
  az('Azure Grok Models', '4.7 Inp glbl L', 4), // long context
  az('Azure Grok Models', 'Grok 4.1 Inp Glbl', 0.0002, '1K'),
  az('Azure Deepseek Models', 'V4 Pro Inp glbl', 0.00174, '1K'),
  az('Azure Deepseek Models', 'V4 Pro Outp glbl', 0.00348, '1K'),
  az('Azure Deepseek Models', 'V4 Pro cached glbl', 0.000145, '1K'),
  az('Azure Mistral Models', 'Large 3 Inp glbl', 0.0005, '1K'),
  az('Azure Mistral Models', 'Large 3 Outp glbl', 0.0015, '1K'),
  az('Azure Phi Models', 'Phi-4-reasoning-Input', 0.000125, '1K'), // no scope word: a single price
  az('Azure Phi Models', 'Phi-4-reasoning-Output', 0.0005, '1K'),
  az('Azure Phi Models', 'Phi-4-reasoning-plus-input', 0.000125, '1K'),
  az('Azure Phi Models', 'Phi-4-reasoning-plus-output', 0.0005, '1K'),
];

describe('Foundry price adapter', () => {
  test('reads Azure meter names into model, direction, scope and USD per million tokens', () => {
    expect(parseAzureMeter(az('Azure OpenAI GPT6', '6.2 astra ShCo Inp Std Gl', 8))).toMatchObject({ key: '62astra', direction: 'input', scope: 'global', perMillion: 8 });
    expect(parseAzureMeter(az('Azure Grok Models', '4.7 Outp DZ', 6.6))).toMatchObject({ key: '47', direction: 'output', scope: 'datazone' });
    expect(parseAzureMeter(az('Azure Deepseek Models', 'V4 Pro Inp glbl', 0.00174, '1K'))).toMatchObject({ key: 'v4pro', perMillion: 1.74 });
    expect(parseAzureMeter(az('MAI Models', 'MAI-Thinking-1 Opt glbl', 8))).toMatchObject({ key: 'thinking1', direction: 'output' });
  });

  test('ignores cached, flex, provisioned, fine-tuned, long-context and non-token meters', () => {
    for (const [product, sku] of [
      ['Azure OpenAI GPT6', '6.2-astra ShCo Cd Inp Std Gl'],
      ['Azure OpenAI GPT6', '6.2-astra ShCo Inp Flex Gl'],
      ['Azure OpenAI GPT6', '6.2-astra LoCo Opt Std Gl'],
      ['Azure OpenAI GPT6', '6.2-astra Inp Gl'], // GPT meters must say standard, short context
      ['Azure Grok Models', '4.7 Inp glbl L'],
      ['MAI Models', 'MAI code flash 11 Inp FT Gl'],
    ] as const) {
      expect(parseAzureMeter(az(product, sku, 5))).toBeNull();
    }
    expect(parseAzureMeter({ ...az('Azure Phi Models', 'Phi-3-Mini Inp', 5), type: 'Reservation' })).toBeNull();
    expect(parseAzureMeter(az('Azure Phi Models', 'Phi-3 Hosting', 5, '1/Hour'))).toBeNull();
  });

  test('derives the model key from a deployment name', () => {
    expect(foundryModelKey('gpt-6.2-astra')).toBe('62astra');
    expect(foundryModelKey('gpt-5.6-sol')).toBe('56sol');
    expect(foundryModelKey('grok-4.7')).toBe('47');
    expect(foundryModelKey('DeepSeek-V4-Pro')).toBe('v4pro');
    expect(foundryModelKey('Mistral-Large-3')).toBe('large3');
    expect(foundryModelKey('Phi-4-reasoning')).toBe('4reasoning');
  });

  test('prices routes at Global rates by default and Data Zone rates when asked', () => {
    const ids = ['gpt-6.2-astra', 'grok-4.7', 'DeepSeek-V4-Pro', 'Mistral-Large-3', 'Phi-4-reasoning'];
    const global = foundryListings(azureItems, ids).listings;
    expect(Object.fromEntries(global.map((l) => [l.upstreamModelId, l.pricing]))).toEqual({
      'gpt-6.2-astra': { inputPerMillion: 8, outputPerMillion: 40 },
      'grok-4.7': { inputPerMillion: 2, outputPerMillion: 6 },
      'DeepSeek-V4-Pro': { inputPerMillion: 1.74, outputPerMillion: 3.48 },
      'Mistral-Large-3': { inputPerMillion: 0.5, outputPerMillion: 1.5 },
      'Phi-4-reasoning': { inputPerMillion: 0.125, outputPerMillion: 0.5 },
    });
    const zone = foundryListings(azureItems, ['gpt-6.2-astra', 'grok-4.7'], 'datazone');
    expect(zone.listings.map((l) => l.upstreamModelId)).toEqual(['gpt-6.2-astra']); // no Data Zone Grok meter in the fixture
    expect(zone.listings[0]!.pricing).toEqual({ inputPerMillion: 8.8, outputPerMillion: 44 });
  });

  test('leaves unknown models and ambiguous prices unpriced', () => {
    const items = [az('Azure Grok Models', '4.6 Inp glbl', 2), az('Azure Grok Models', '4.6 Inp Glbl', 3), az('Azure Grok Models', '4.6 Outp glbl', 6)];
    const { listings, unmatched } = foundryListings(items, ['grok-4.6', 'gpt-4o', 'MAI-1']);
    expect(listings).toEqual([]);
    expect(unmatched).toEqual(['grok-4.6', 'gpt-4o', 'MAI-1']);
  });

  test('pages through the API, honours the scope setting and refuses a partial list', async () => {
    const filler = Array.from({ length: 220 }, (_, i) => az('Azure Phi Models', `Filler-${i}-Input`, 1));
    const pages = [{ Items: [...azureItems.slice(0, 5), ...filler], NextPageLink: 'https://azure.test/page2' }, { Items: azureItems.slice(5), NextPageLink: null }];
    let call = 0;
    const adapter = createFoundryPriceAdapter(
      { url: 'https://azure.test/prices', routeIds: () => ['gpt-6.2-astra', 'grok-4.7'], fetchImpl: (async () => new Response(JSON.stringify(pages[call++]), { status: 200 })) as unknown as typeof fetch },
      { LYRA_AZURE_PRICE_SCOPE: 'datazone' } as NodeJS.ProcessEnv
    );
    expect(adapter.pricesOnly).toBe(true);
    const listing = await adapter.fetchListing();
    expect(call).toBe(2);
    expect(listing.map((l) => [l.upstreamModelId, l.pricing!.inputPerMillion])).toEqual([['gpt-6.2-astra', 8.8]]);

    const endless = createFoundryPriceAdapter({ routeIds: () => [], fetchImpl: (async () => new Response(JSON.stringify({ Items: filler, NextPageLink: 'https://azure.test/more' }), { status: 200 })) as unknown as typeof fetch });
    await expect(endless.fetchListing()).rejects.toThrow(/refusing a partial price list/);
    const tiny = createFoundryPriceAdapter({ routeIds: () => [], fetchImpl: (async () => new Response(JSON.stringify({ Items: azureItems }), { status: 200 })) as unknown as typeof fetch });
    await expect(tiny.fetchListing()).rejects.toThrow(/unreliable/);
  });
});

// ---- Engine: price-only sources ------------------------------------------------------------------------------------

const NOW = new Date('2026-11-25T00:00:00Z');
const base: Partial<SyncOptions> = { now: NOW, apply: true, actor: 'test', supersede: false };

function fakeBedrock(listings: ProviderListing[]): ModelSourceAdapter {
  return {
    provider: 'bedrock',
    pricesOnly: true,
    fetchListing: async () => listings,
    toCandidate: () => ({ skip: 'prices_only_source' }),
  };
}

describe('price-only sources in the sync engine', () => {
  beforeEach(async () => {
    await modelRegistry.reset();
  });

  const fable = (input: number, output: number): ProviderListing => ({ provider: 'bedrock', upstreamModelId: 'us.anthropic.claude-fable-5-2-v1:0', name: 'Claude Fable 5.2', pricing: { inputPerMillion: input, outputPerMillion: output } });

  test('updates route prices, with the usual hold on large changes', async () => {
    const report = await runModelSync([fakeBedrock([fable(8.8, 44)])], base);
    expect(report.providers[0]!.priceChanges).toMatchObject([{ modelId: 'claude-fable-5-2', provider: 'bedrock', status: 'applied', to: { inputPerMillion: 8.8, outputPerMillion: 44 } }]);
    expect(modelRegistry.getRecord('claude-fable-5-2')?.priceOverrides?.bedrock).toMatchObject({ inputPerMillion: 8.8, outputPerMillion: 44, source: 'bedrock-sync' });

    const big = await runModelSync([fakeBedrock([fable(40, 200)])], base);
    expect(big.providers[0]!.priceChanges[0]).toMatchObject({ status: 'held' });
  });

  test('a short price list never counts models as missing, retires nothing and registers nothing', async () => {
    for (let run = 0; run < 3; run++) {
      const report = await runModelSync([fakeBedrock([fable(8, 40)])], base); // every other Bedrock model is absent
      expect(report.providers[0]).toMatchObject({ ok: true, missing: [], expiring: [], newCandidates: [], reappeared: [] });
    }
    expect(modelRegistry.getRecord('claude-opus-5-5')?.missedSyncs).toBeUndefined();
    expect(getModelLifecycleStatus('claude-opus-5-5')).toBe('active');
  });

  test('an empty price list is ignored instead of being treated as a broken big listing', async () => {
    const report = await runModelSync([fakeBedrock([])], base);
    expect(report.providers[0]).toMatchObject({ ok: false, aborted: expect.stringContaining('no route') });
  });

  test('bedrock and foundry are selectable providers', () => {
    const { adapters, unsupported } = getConfiguredAdapters({} as NodeJS.ProcessEnv, ['bedrock', 'Foundry', 'nope']);
    expect(adapters.map((a) => a.provider)).toEqual(['bedrock', 'foundry']);
    expect(adapters.every((a) => a.pricesOnly)).toBe(true);
    expect(unsupported).toEqual(['nope']);
    expect(getConfiguredAdapters({} as NodeJS.ProcessEnv).adapters.map((a) => a.provider)).toEqual(['openrouter']);
  });
});
