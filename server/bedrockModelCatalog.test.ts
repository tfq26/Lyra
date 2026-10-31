import { describe, it, expect } from 'bun:test';
import { BedrockModelCatalog } from './bedrockModelCatalog';

describe('BedrockModelCatalog', () => {
  const catalog = new BedrockModelCatalog();

  it('retrieves active models and strictly excludes legacy models', async () => {
    const result = await catalog.getActiveModels();
    expect(result.models.length).toBeGreaterThan(0);

    // Verify Claude Sonnet 4.5 is NOT in the active list
    const hasSonnet45 = result.models.some((m) => m.modelId.includes('claude-sonnet-4-5'));
    expect(hasSonnet45).toBe(false);

    // Verify all returned models have status ACTIVE
    for (const model of result.models) {
      expect(model.status).toBe('ACTIVE');
      expect(model.isLegacy).toBe(false);
    }
  });

  it('identifies Claude Sonnet 4.5 as a legacy model', () => {
    expect(catalog.isLegacyModel('anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true);
    expect(catalog.isLegacyModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true);
    expect(catalog.isLegacyModel('us.anthropic.claude-sonnet-4-6')).toBe(false);
  });

  it('automatically resolves legacy models to active successors with a warning', () => {
    const resolution = catalog.resolveActiveModel('anthropic.claude-sonnet-4-5-20250929-v1:0');
    expect(resolution.wasLegacy).toBe(true);
    expect(resolution.modelId).toBe('anthropic.claude-sonnet-5');
    expect(resolution.warning).toContain('LEGACY state on Amazon Bedrock');

    const safeResolution = catalog.resolveActiveModel('anthropic.claude-sonnet-5');
    expect(safeResolution.wasLegacy).toBe(false);
    expect(safeResolution.modelId).toBe('anthropic.claude-sonnet-5');
    expect(safeResolution.warning).toBeUndefined();
  });
});
