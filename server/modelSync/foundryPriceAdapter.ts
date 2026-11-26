/**
 * Microsoft Foundry price source (price-only).
 *
 * Azure publishes a public Retail Prices API (no credentials). Its meter names are abbreviated and
 * differ by model family ("6.2-astra ShCo Inp Std Gl", "4.7 Inp glbl", "V4 Pro Outp glbl", "Large 4 Inp
 * Glbl"), and units vary between 1K and 1M tokens. Each row is read as: model key + direction + tier +
 * deployment scope. A route is only priced when exactly one standard input price and one output price
 * match its model key; anything cached, flex, provisioned, fine-tuned, long-context or ambiguous is
 * ignored, and unrecognized models are simply left unpriced.
 *
 * Deployment scope defaults to Global (Foundry's default deployment type); Data Zone costs about 10%
 * more. Set `LYRA_AZURE_PRICE_SCOPE=datazone` if the routes are deployed to a data zone.
 */

import { allCatalogModels } from '../unifiedModelCatalog';
import type { DiscoveryContext, ModelSourceAdapter, ProviderListing } from './types';

const DEFAULT_URL = 'https://prices.azure.com/api/retail/prices';
const MAX_PAGES = 60;
const MIN_ITEMS = 200;

export type FoundryScope = 'global' | 'datazone';

/** Words that start the meter description; everything before the first one is the model name. */
const METER_WORDS = new Set([
  'inp', 'input', 'in', 'opt', 'outp', 'output', 'out', 'cd', 'cached', 'cchd', 'cdwr', 'cdwr12h', 'wr', 'shco', 'shortco', 'loco', 'longco',
  'std', 'flex', 'fl', 'pp', 'gl', 'glbl', 'global', 'dz', 'dzone', 'dzn', 'regnl', 'rgnl', 'regional', 'ft', 'sp', 'rt', 'l', '12hr',
]);
const INPUT_WORDS = new Set(['inp', 'input', 'in']);
const OUTPUT_WORDS = new Set(['opt', 'outp', 'output', 'out']);
const GLOBAL_WORDS = new Set(['gl', 'glbl', 'global']);
const DATAZONE_WORDS = new Set(['dz', 'dzone', 'dzn']);
/** Meters that are not plain pay-as-you-go token prices. */
const EXCLUDED_WORDS = new Set(['cd', 'cached', 'cchd', 'cdwr', 'cdwr12h', 'wr', 'flex', 'fl', 'pp', 'ft', 'sp', 'rt', 'l', 'loco', 'longco', '12hr']);

export interface AzurePriceItem {
  productName?: string;
  skuName?: string;
  retailPrice?: number;
  unitOfMeasure?: string;
  type?: string;
  tierMinimumUnits?: number;
}

interface ParsedMeter {
  product: string;
  /** Squashed model name with a leading vendor word removed: "6.2 astra" -> "62astra". */
  key: string;
  direction: 'input' | 'output';
  scope: 'global' | 'datazone' | 'other';
  /** USD per million tokens. */
  perMillion: number;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^(gpt|grok|mai|phi|deepseek|mistral)/, '');

/** Product-name pattern for the Azure family a Lyra Foundry route belongs to, or null if unsupported. */
function productFor(upstreamModelId: string): RegExp | null {
  const id = upstreamModelId.toLowerCase();
  if (/^gpt-(5\.6|6)/.test(id)) return /^Azure OpenAI GPT[56]$/i;
  if (id.startsWith('grok-')) return /Grok/i;
  if (id.startsWith('deepseek-')) return /Deepseek/i;
  if (id.startsWith('mistral-')) return /Mistral/i;
  if (id.startsWith('mai-')) return /^MAI/i;
  if (id.startsWith('phi-')) return /Phi/i;
  return null;
}

/** Squashed model key for a Foundry deployment name: `gpt-6.2-astra` -> `62astra`. */
export function foundryModelKey(upstreamModelId: string): string {
  return squash(upstreamModelId);
}

export function parseAzureMeter(item: AzurePriceItem): ParsedMeter | null {
  if (item.type && item.type !== 'Consumption') return null;
  if (item.tierMinimumUnits && item.tierMinimumUnits > 0) return null;
  const price = Number(item.retailPrice);
  if (!item.skuName || !item.productName || !Number.isFinite(price) || price <= 0) return null;
  const unit = (item.unitOfMeasure ?? '').trim().toUpperCase();
  const perMillion = unit === '1K' ? price * 1000 : unit === '1M' ? price : NaN;
  if (!Number.isFinite(perMillion)) return null;

  const tokens = item.skuName.toLowerCase().split(/[\s_/-]+/).filter(Boolean);
  const cut = tokens.findIndex((t) => METER_WORDS.has(t));
  if (cut <= 0) return null;
  const rest = tokens.slice(cut);
  if (rest.some((t) => EXCLUDED_WORDS.has(t))) return null;

  const isInput = rest.some((t) => INPUT_WORDS.has(t));
  const isOutput = rest.some((t) => OUTPUT_WORDS.has(t));
  if (isInput === isOutput) return null;

  // OpenAI GPT-5/6 meters carry an explicit tier and context; only standard, short context is the plain price.
  if (/GPT[56]/i.test(item.productName) && !(rest.includes('std') && (rest.includes('shco') || rest.includes('shortco')))) return null;

  const scope = rest.some((t) => GLOBAL_WORDS.has(t)) ? 'global' : rest.some((t) => DATAZONE_WORDS.has(t)) ? 'datazone' : 'other';
  return {
    product: item.productName,
    key: squash(tokens.slice(0, cut).join('')),
    direction: isInput ? 'input' : 'output',
    scope,
    perMillion: Math.round(perMillion * 1e6) / 1e6,
  };
}

/** Listings for the given Foundry route ids that have exactly one matching input and output price. */
export function foundryListings(items: AzurePriceItem[], upstreamModelIds: string[], scope: FoundryScope = 'global'): { listings: ProviderListing[]; unmatched: string[] } {
  const parsed = items.map(parseAzureMeter).filter((m): m is ParsedMeter => m !== null);
  const listings: ProviderListing[] = [];
  const unmatched: string[] = [];
  for (const id of upstreamModelIds) {
    const product = productFor(id);
    const key = foundryModelKey(id);
    const prices = (direction: 'input' | 'output') => {
      const mine = parsed.filter((m) => product && product.test(m.product) && m.key === key && m.direction === direction);
      // Some models have a single price with no deployment-scope word; use it only when the scope has none.
      const scoped = mine.filter((m) => m.scope === scope);
      return new Set((scoped.length > 0 ? scoped : mine.filter((m) => m.scope === 'other')).map((m) => m.perMillion));
    };
    const input = prices('input');
    const output = prices('output');
    if (!product || input.size !== 1 || output.size !== 1) {
      unmatched.push(id);
      continue;
    }
    listings.push({
      provider: 'foundry',
      upstreamModelId: id,
      name: id,
      pricing: { inputPerMillion: [...input][0]!, outputPerMillion: [...output][0]! },
    });
  }
  return { listings, unmatched };
}

export interface FoundryPriceAdapterOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  region?: string;
  scope?: FoundryScope;
  /** Route ids to price. Defaults to every Foundry route in the catalog. */
  routeIds?: () => string[];
}

export function createFoundryPriceAdapter(options: FoundryPriceAdapterOptions = {}, env: NodeJS.ProcessEnv = process.env): ModelSourceAdapter {
  const doFetch = options.fetchImpl ?? fetch;
  const scope: FoundryScope = options.scope ?? (env.LYRA_AZURE_PRICE_SCOPE?.toLowerCase() === 'datazone' ? 'datazone' : 'global');
  const routeIds = options.routeIds ?? (() => allCatalogModels().flatMap((m) => m.routes.filter((r) => r.provider === 'foundry').map((r) => r.upstreamModelId)));

  return {
    provider: 'foundry',
    pricesOnly: true,
    async fetchListing({ signal } = {}) {
      const filter = `serviceName eq 'Foundry Models' and armRegionName eq '${options.region ?? 'eastus2'}'`;
      let next: string | null = `${options.url ?? DEFAULT_URL}?$filter=${encodeURIComponent(filter)}`;
      const items: AzurePriceItem[] = [];
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const res: Response = await doFetch(next, { signal });
        if (!res.ok) throw new Error(`Azure Retail Prices returned HTTP ${res.status}`);
        const body = (await res.json()) as { Items?: AzurePriceItem[]; NextPageLink?: string | null };
        if (!Array.isArray(body.Items)) throw new Error('Azure Retail Prices response has no "Items"');
        items.push(...body.Items);
        next = body.NextPageLink ?? null;
      }
      if (next) throw new Error(`Azure Retail Prices has more than ${MAX_PAGES} pages; refusing a partial price list`);
      if (items.length < MIN_ITEMS) throw new Error(`Azure Retail Prices returned only ${items.length} items; ignored as unreliable`);
      return foundryListings(items, [...new Set(routeIds())], scope).listings;
    },
    toCandidate(_listing: ProviderListing, _context: DiscoveryContext) {
      return { skip: 'prices_only_source' };
    },
  };
}
