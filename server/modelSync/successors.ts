/**
 * Successor detection: when a newer version of a model exists, the older one should leave the
 * default list, but only if the newer one is actually a replacement.
 *
 * Two models are the same line when they share a family and a "series" (the id with its version
 * numbers removed): `gpt-6.2-astra` and `gpt-6.3-astra` are series `gpt-astra`, versions 6.2 < 6.3.
 * Variant words stay in the series, so `gpt-6.3-astra-pro` is a different line, not a successor.
 *
 * A newer model replaces an older one only if it is at least as capable and not more expensive.
 * If it is better but pricier, the older model is still the cheaper option and stays active.
 */

import type { CanonicalModelProfile } from '../unifiedModelCatalog';

export interface ParsedModelId {
  series: string;
  version: number[];
}

const VERSION_TOKEN = /^v?(\d+(?:\.\d+)*)$/i;

/** Splits an id into its series and version numbers, or null when it carries no version. */
export function parseModelVersion(id: string): ParsedModelId | null {
  const tokens = id.toLowerCase().split('-').filter(Boolean);
  const words: string[] = [];
  const version: number[] = [];
  for (const token of tokens) {
    const match = VERSION_TOKEN.exec(token);
    if (match) version.push(...match[1]!.split('.').map(Number));
    else words.push(token);
  }
  if (version.length === 0 || words.length === 0) return null;
  return { series: words.join('-'), version };
}

/** The version segments of an id exactly as written ("4.20" -> ["4", "20"]), keeping leading and trailing digits. */
function rawVersionParts(id: string): string[] {
  const parts: string[] = [];
  for (const token of id.toLowerCase().split('-').filter(Boolean)) {
    const match = VERSION_TOKEN.exec(token);
    if (match) parts.push(...match[1]!.split('.'));
  }
  return parts;
}

/**
 * True when two ids' order cannot be told from the numbers alone: at the first segment that differs,
 * one is longer and ends in zero ("4.20" vs "4.7"). That may be version 4.20 or a spelling of 4.2, and
 * guessing wrong would hide a newer model behind an older one, so such pairs are never ordered.
 */
export function isAmbiguousOrder(idA: string, idB: string): boolean {
  const a = rawVersionParts(idA);
  const b = rawVersionParts(idB);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? '0';
    const y = b[i] ?? '0';
    if (Number(x) === Number(y)) continue;
    if (i === 0 || x.length === y.length) return false;
    const longer = x.length > y.length ? x : y;
    return longer.endsWith('0');
  }
  return false;
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The model's own quality score for general coding work (same weights the Auto selector uses). */
export function qualityOf(model: CanonicalModelProfile): number {
  const m = model.metrics;
  return m.codingScore * 0.6 + m.reasoningScore * 0.25 + m.toolProficiency * 0.15;
}

/** Blended price per million tokens on the model's primary route (3 input : 1 output). */
export function priceOf(model: CanonicalModelProfile): number {
  const primary = model.routes.slice().sort((a, b) => a.priority - b.priority)[0];
  if (!primary) return Number.POSITIVE_INFINITY;
  return primary.pricing.inputPerMillion * 0.75 + primary.pricing.outputPerMillion * 0.25;
}

/** True if `newer` can replace `older`: at least as capable (within noise) and not pricier (within 5%). */
export function replaces(newer: CanonicalModelProfile, older: CanonicalModelProfile): boolean {
  if (newer.unscored || older.unscored) return false;
  return qualityOf(newer) >= qualityOf(older) - 0.5 && priceOf(newer) <= priceOf(older) * 1.05;
}

function sameLine(a: CanonicalModelProfile, b: CanonicalModelProfile): ParsedModelId | null {
  if (a.family !== b.family) return null;
  const pa = parseModelVersion(a.id);
  const pb = parseModelVersion(b.id);
  return pa && pb && pa.series === pb.series ? pa : null;
}

/** Existing models that `model` is a newer version of (same line, lower version). Status-agnostic. */
export function olderVersionsOf(model: CanonicalModelProfile, catalog: CanonicalModelProfile[]): CanonicalModelProfile[] {
  const mine = parseModelVersion(model.id);
  if (!mine) return [];
  return catalog
    .filter((other) => other.id !== model.id && sameLine(model, other) && !isAmbiguousOrder(model.id, other.id))
    .filter((other) => compareVersions(parseModelVersion(other.id)!.version, mine.version) < 0)
    .sort((a, b) => compareVersions(parseModelVersion(b.id)!.version, parseModelVersion(a.id)!.version));
}

export interface Supersession {
  modelId: string;
  supersededBy: string;
}

/**
 * Among the given (active) models, those that a newer model in the same line replaces. Each is
 * paired with the newest version that replaces it, so a chain 6.1 -> 6.2 -> 6.3 points 6.1 and 6.2
 * at 6.3 when 6.3 replaces both.
 */
export function findSupersessions(active: CanonicalModelProfile[]): Supersession[] {
  const result: Supersession[] = [];
  for (const older of active) {
    const parsed = parseModelVersion(older.id);
    if (!parsed) continue;
    const newer = active
      .filter((m) => m.id !== older.id && sameLine(older, m) && !isAmbiguousOrder(older.id, m.id) && compareVersions(parseModelVersion(m.id)!.version, parsed.version) > 0)
      .sort((a, b) => compareVersions(parseModelVersion(b.id)!.version, parseModelVersion(a.id)!.version))
      .find((m) => replaces(m, older));
    if (newer) result.push({ modelId: older.id, supersededBy: newer.id });
  }
  return result.sort((a, b) => a.modelId.localeCompare(b.modelId));
}
