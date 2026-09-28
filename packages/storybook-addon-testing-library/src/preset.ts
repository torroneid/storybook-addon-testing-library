import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Channel } from 'storybook/internal/channels';
import type { Options } from 'storybook/internal/types';
import type { InlineConfig, Plugin } from 'vite';

import { VIRTUAL_DEBUGGER_MODULE, VIRTUAL_SETUP_MODULE } from './shared/types.ts';
import { mockPlugin } from './node/mockPlugin.ts';
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
  name: 'storybook-addon-testing-library:wrappers',
  enforce: 'pre',
  resolveId: (source, importer) => {
    const wrapper = WRAPPERS[source];
    const file = importer?.split('?')[0];
    return wrapper && file && isSpecFile(file, specPatterns, process.cwd()) ? wrapper : undefined;
  },
});

const setupPlugin = (setupFiles: string[]): Plugin => {
  const resolvedId = `\0${VIRTUAL_SETUP_MODULE}`;
  return {
    name: 'storybook-addon-testing-library:setup',
    resolveId: id => (id === VIRTUAL_SETUP_MODULE ? resolvedId : undefined),
    load: id =>
      id === resolvedId
        ? `export const setupFiles = [${setupFiles
            .map(file => `() => import(${JSON.stringify(path.resolve(file))})`)
            .join(', ')}];`
        : undefined,
  };
};

/**
 * DevTools skips debugger statements in ignore-listed code, and node_modules, where the addon is installed, is on
 * that list by default. Served as a virtual module the statement is not, and DevTools hides the addon's frames in
 * the Call Stack, so stepping out lands in the spec.
 */
const DEBUGGER_SOURCE = `// storybook-addon-testing-library stopped here, just before the step that failed.
// Step out (Shift+F11) to get to that step in your spec. From there, step into (F11) the call to follow it into
// your code, or step over (F10) until the error is thrown.
export const pause = () => {
  debugger;
};
`;

const debuggerPlugin = (): Plugin => {
  const resolvedId = `\0${VIRTUAL_DEBUGGER_MODULE}`;
  return {
    name: 'storybook-addon-testing-library:debugger',
    resolveId: id => (id === VIRTUAL_DEBUGGER_MODULE ? resolvedId : undefined),
    load: id => (id === resolvedId ? DEBUGGER_SOURCE : undefined),
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
    plugins: [
      ...(config.plugins ?? []),
      wrapperPlugin(specPatterns),
      setupPlugin(options.setupFiles ?? []),
      debuggerPlugin(),
      mockPlugin(specPatterns, options.setupFiles ?? []),
    ],
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
      include: [
        ...(config.optimizeDeps?.include ?? []),
        '@testing-library/react',
        '@testing-library/user-event',
        // CommonJS, which the browser can only import once Vite has bundled it
        'storybook-addon-testing-library > @sinonjs/fake-timers',
      ],
    },
  };
};

export const experimental_serverChannel = async (channel: Channel, options: Options & AddonOptions) => {
  if (options.configType !== 'PRODUCTION') {
    await startSpecIndex(options, options.specPatterns ?? DEFAULT_SPEC_PATTERNS);
  }
  return channel;
};
