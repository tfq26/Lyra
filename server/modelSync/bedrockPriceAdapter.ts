/**
 * Amazon Bedrock price source (price-only).
 *
 * AWS publishes its Price List as public JSON files, one per service, no credentials needed. Claude,
 * OpenAI and xAI models live in `AmazonBedrockFoundationModels`; Nova, DeepSeek, Qwen and the other
 * models Bedrock hosts itself live in `AmazonBedrock`. Both are read for one region (us-east-1).
 *
 * Bedrock charges more on regional endpoints than on global ones (Anthropic documents a 10% premium), so
 * the price is picked by how the route calls the model: a `global.` profile gets the global price, a
 * regional profile (`us.`) or a plain in-region id gets the regional one. A route is only priced when
 * exactly one standard on-demand input price and one output price match; anything else is left alone.
 */

import { allCatalogModels } from '../unifiedModelCatalog';
import type { DiscoveryContext, ModelSourceAdapter, ProviderListing } from './types';

const BASE = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws';
export const BEDROCK_PRICE_FILES = ['AmazonBedrockFoundationModels', 'AmazonBedrock'] as const;
const MAX_FILE_BYTES = 120 * 1024 * 1024;
/** A price file with fewer products than this is a broken download, not a real price list. */
const MIN_PRODUCTS = 500;

/** AWS model name (normalized) a route's price lives under, when it cannot be derived from the id. */
const NAME_OVERRIDES: Record<string, string> = {
  'mistral.mistral-large-3-675b-instruct': 'mistral-large-3',
  'nvidia.nemotron-super-3-120b': 'nvidia-nemotron-3-super-120b-a12b',
};

const VENDOR_WORDS = ['openai', 'anthropic', 'amazon', 'xai', 'nvidia', 'deepseek', 'qwen', 'mistral', 'minimax', 'moonshotai', 'zai', 'meta', 'google'];
const EXCLUDED_USAGE = /batch|flex|priority|ultrafast|long[_-]?ctx|custom-model|cache/;

export interface BedrockPriceRow {
  model: string;
  direction: 'input' | 'output';
  scope: 'global' | 'regional';
  /** USD per million tokens. */
  perMillion: number;
}

function norm(name: string): string {
  return name.toLowerCase().replace(/(\d+)\.0\b/g, '$1').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Normalized AWS model name for a Lyra route id: `us.anthropic.claude-fable-5-2-v1:0` -> `claude-fable-5-2`. */
export function bedrockNameKey(upstreamModelId: string): string {
  const override = NAME_OVERRIDES[upstreamModelId];
  if (override) return override;
  const id = upstreamModelId
    .replace(/^(us|eu|apac|jp|au|ca|global)\./, '')
    .replace(/^[a-z0-9]+\./, '')
    .replace(/-v\d+(:\d+)?$/, '')
    .replace(/-\d+:\d+$/, '');
  return norm(id);
}

export function bedrockRouteScope(upstreamModelId: string): 'global' | 'regional' {
  return upstreamModelId.startsWith('global.') ? 'global' : 'regional';
}

/** Standard on-demand input/output token prices from one AWS Price List file, for one region. */
export function parseBedrockPriceFile(payload: unknown, region = 'us-east-1'): BedrockPriceRow[] {
  const file = payload as { products?: Record<string, { attributes?: Record<string, string> }>; terms?: { OnDemand?: Record<string, unknown> } };
  const products = file?.products;
  if (!products || typeof products !== 'object') throw new Error('Bedrock price file has no "products"');
  if (Object.keys(products).length < MIN_PRODUCTS) throw new Error(`Bedrock price file has only ${Object.keys(products).length} products; ignored as unreliable`);

  const rows: BedrockPriceRow[] = [];
  for (const [sku, product] of Object.entries(products)) {
    const a = product.attributes ?? {};
    if (a.regionCode !== region || !a.model) continue;
    const inference = (a.inferenceType ?? '').toLowerCase().trim();
    const usage = (a.usagetype ?? '').toLowerCase();
    let direction: 'input' | 'output' | null = null;
    if (inference === 'input tokens' || inference === 'text input tokens') direction = 'input';
    else if (inference === 'output tokens' || inference === 'text output tokens') direction = 'output';
    else if (!inference) direction = /input[-_]tokens/.test(usage) ? 'input' : /output[-_]tokens/.test(usage) ? 'output' : null; // some models carry no inferenceType
    if (!direction) continue;
    if (EXCLUDED_USAGE.test(usage)) continue;

    const term = Object.values((file.terms?.OnDemand?.[sku] ?? {}) as Record<string, { priceDimensions?: Record<string, { unit?: string; beginRange?: string; pricePerUnit?: { USD?: string } }> }>)[0];
    const dimension = term?.priceDimensions ? Object.values(term.priceDimensions)[0] : undefined;
    const usd = Number(dimension?.pricePerUnit?.USD);
    if (!dimension || !Number.isFinite(usd) || usd <= 0 || (dimension.beginRange && dimension.beginRange !== '0')) continue;
    const unit = dimension.unit ?? '';
    // Only per-token prices: reserved capacity rows are "1M TPM Hour", not tokens.
    const perMillion = /^1K\s*tokens$/i.test(unit) ? usd * 1000 : /^1M\s*tokens$/i.test(unit) ? usd : NaN;
    if (!Number.isFinite(perMillion)) continue;

    rows.push({ model: norm(a.model), direction, scope: /global/.test(usage) ? 'global' : 'regional', perMillion: Math.round(perMillion * 1e6) / 1e6 });
  }
  return rows;
}

function matchingNames(rows: BedrockPriceRow[], key: string): Set<string> {
  const names = new Set<string>();
  for (const r of rows) {
    if (r.model === key || VENDOR_WORDS.some((v) => r.model === `${v}-${key}`)) names.add(r.model);
  }
  return names;
}

/** Listings for the given route ids that have exactly one matching input and output price. */
export function bedrockListings(rows: BedrockPriceRow[], upstreamModelIds: string[]): { listings: ProviderListing[]; unmatched: string[] } {
  const listings: ProviderListing[] = [];
  const unmatched: string[] = [];
  for (const id of upstreamModelIds) {
    const names = matchingNames(rows, bedrockNameKey(id));
    const scope = bedrockRouteScope(id);
    const prices = (direction: 'input' | 'output') =>
      new Set(rows.filter((r) => names.has(r.model) && r.direction === direction && r.scope === scope).map((r) => r.perMillion));
    const input = prices('input');
    const output = prices('output');
    if (names.size === 0 || input.size !== 1 || output.size !== 1) {
      unmatched.push(id);
      continue;
    }
    listings.push({
      provider: 'bedrock',
      upstreamModelId: id,
      name: [...names][0]!,
      pricing: { inputPerMillion: [...input][0]!, outputPerMillion: [...output][0]! },
    });
  }
  return { listings, unmatched };
}

export interface BedrockPriceAdapterOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  region?: string;
  /** Route ids to price. Defaults to every Bedrock route in the catalog. */
  routeIds?: () => string[];
}

export function createBedrockPriceAdapter(options: BedrockPriceAdapterOptions = {}): ModelSourceAdapter {
  const doFetch = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? BASE;
  const routeIds = options.routeIds ?? (() => allCatalogModels().flatMap((m) => m.routes.filter((r) => r.provider === 'bedrock').map((r) => r.upstreamModelId)));

  return {
    provider: 'bedrock',
    pricesOnly: true,
    async fetchListing({ signal } = {}) {
      const rows: BedrockPriceRow[] = [];
      for (const file of BEDROCK_PRICE_FILES) {
        const res = await doFetch(`${base}/${file}/current/index.json`, { signal });
        if (!res.ok) throw new Error(`AWS price list ${file} returned HTTP ${res.status}`);
        if (Number(res.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error(`AWS price list ${file} is too large`);
        rows.push(...parseBedrockPriceFile(await res.json(), options.region));
      }
      return bedrockListings(rows, [...new Set(routeIds())]).listings;
    },
    toCandidate(_listing: ProviderListing, _context: DiscoveryContext) {
      return { skip: 'prices_only_source' };
    },
  };
}
