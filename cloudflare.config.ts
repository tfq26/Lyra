import { bindings, defineConfig, defineContainer, exports, triggers } from 'cf/config';
import * as entrypoint from './worker.ts' with { type: 'cf-worker' };

const lyraContainer = defineContainer({
  name: 'lyra-hub-container',
  image: { dockerfile: './Dockerfile' },
  instanceType: 'standard-1',
  maxInstances: 2,
});

export default defineConfig({
  accountId: 'bdfb4d698ccb82a56a92f8943abe5e47',
  containers: [lyraContainer],
  worker: {
    name: 'lyra-hub',
    entrypoint,
    compatibilityDate: '2026-11-01',
    domains: ['lyra.2helix.org'],
    // Daily model sync at 05:17 UTC (worker.ts `scheduled`). Runs OpenRouter, Bedrock and Foundry through
    // the container's sync endpoint; large price changes are held, not applied.
    triggers: [triggers.scheduled({ schedule: '17 5 * * *' })],
    exports: {
      LyraContainer: exports.durableObject({
        storage: 'sqlite',
        container: lyraContainer,
      }),
    },
    env: {
      LYRA_CONTAINER: bindings.durableObject({
        worker: 'lyra-hub',
        exportName: 'LyraContainer',
      }),
    },
  },
});
