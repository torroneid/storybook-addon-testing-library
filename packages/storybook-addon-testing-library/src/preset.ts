import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Channel } from 'storybook/internal/channels';
import type { Options } from 'storybook/internal/types';
import type { InlineConfig, Plugin } from 'vite';

import { VIRTUAL_SETUP_MODULE } from './shared/types.ts';
import { DEFAULT_SPEC_PATTERNS, startSpecIndex } from './node/server.ts';
import { isSpecFile } from './node/specIndex.ts';

export type AddonOptions = {
  /** Glob patterns for spec files, relative to each directory with a vite/vitest config that has stories */
  specPatterns?: string[];
  /**
   * Files to run before the tests, like setupFiles in Vitest (relative to the working directory).
   * They can import from 'vitest' and use beforeAll/beforeEach/expect.
   */
  setupFiles?: string[];
};

// Storybook finds the manager (./manager) and the preview annotation (./preview) through exports in package.json.

const VITEST_REPLACEMENT = fileURLToPath(new URL('./preview/vitest.js', import.meta.url));

// Spec files get wrappers around these packages, so interactions become pausable steps.
// Everything else (components, stories, setup files and the wrappers themselves) gets the real packages.
const WRAPPERS: Record<string, string> = {
  '@testing-library/react': fileURLToPath(new URL('./preview/wrappers/reactWrapper.js', import.meta.url)),
  '@testing-library/user-event': fileURLToPath(new URL('./preview/wrappers/userEventWrapper.js', import.meta.url)),
  '@storybook/react-vite': fileURLToPath(new URL('./preview/wrappers/storybookWrapper.js', import.meta.url)),
};

const wrapperPlugin = (specPatterns: string[]): Plugin => ({
  name: 'spec-tests:omslag',
  enforce: 'pre',
  resolveId: (source, importer) => {
    const omslag = WRAPPERS[source];
    const file = importer?.split('?')[0];
    return omslag && file && isSpecFile(file, specPatterns, process.cwd()) ? omslag : undefined;
  },
});

const setupPlugin = (setupFiles: string[]): Plugin => {
  const resolvedId = `\0${VIRTUAL_SETUP_MODULE}`;
  return {
    name: 'spec-tests:setup',
    resolveId: id => (id === VIRTUAL_SETUP_MODULE ? resolvedId : undefined),
    load: id =>
      id === resolvedId
        ? `export const setupFiles = [${setupFiles
            .map(file => `() => import(${JSON.stringify(path.resolve(file))})`)
            .join(', ')}];`
        : undefined,
  };
};

export const viteFinal = (config: InlineConfig, options: Options & AddonOptions): InlineConfig => {
  const specPatterns = options.specPatterns ?? DEFAULT_SPEC_PATTERNS;
  const existingAlias = config.resolve?.alias ?? [];
  const alias = Array.isArray(existingAlias)
    ? existingAlias
    : Object.entries(existingAlias).map(([find, replacement]) => ({ find, replacement }));
  const existingEntries = config.optimizeDeps?.entries;

  return {
    ...config,
    plugins: [...(config.plugins ?? []), wrapperPlugin(specPatterns), setupPlugin(options.setupFiles ?? [])],
    resolve: {
      ...config.resolve,
      // Spec files import describe/it/expect/vi from 'vitest'. In Storybook they come from our own runtime.
      alias: [{ find: /^vitest$/, replacement: VITEST_REPLACEMENT }, ...alias],
    },
    optimizeDeps: {
      ...config.optimizeDeps,
      // Without this, Vite discovers the spec files' dependencies only when they are imported,
      // and then reloads the preview iframe in the middle of a test run.
      entries: [
        ...(Array.isArray(existingEntries) ? existingEntries : existingEntries ? [existingEntries] : []),
        ...specPatterns,
        ...(options.setupFiles ?? []),
      ],
      include: [...(config.optimizeDeps?.include ?? []), '@testing-library/react', '@testing-library/user-event'],
    },
  };
};

export const experimental_serverChannel = async (channel: Channel, options: Options & AddonOptions) => {
  if (options.configType !== 'PRODUCTION') {
    await startSpecIndex(options, options.specPatterns ?? DEFAULT_SPEC_PATTERNS);
  }
  return channel;
};
