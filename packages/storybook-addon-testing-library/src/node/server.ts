import fs from 'node:fs';
import path from 'node:path';
import { experimental_UniversalStore } from 'storybook/internal/core-server';
import { logger } from 'storybook/internal/node-logger';
import type { Options } from 'storybook/internal/types';

import { ADDON_ID, type SpecIndexState } from '../shared/types.ts';
import {
  analyzeAndLinkSpecFile,
  findPackageRoot,
  findSpecFiles,
  createStoryLookup,
  type StoryLookup,
  toRelativePath,
} from './specIndex.ts';

export const DEFAULT_SPEC_PATTERNS = ['**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}'];

type StoryIndexGenerator = {
  getIndex: () => Promise<Parameters<typeof createStoryLookup>[0]>;
  onInvalidated: (listener: () => void) => void;
};

/**
 * Keeps an index of spec files and the stories their tests use, and shares it with the manager.
 */
export const startSpecIndex = async (options: Options, specPatterns: string[]) => {
  const workingDir = process.cwd();
  const storyIndexGenerator = (await options.presets.apply('storyIndexGenerator')) as StoryIndexGenerator;

  const store = experimental_UniversalStore.create<SpecIndexState>({
    id: ADDON_ID,
    leader: true,
    initialState: { specFiles: [] },
  });

  let storyLookup: StoryLookup = createStoryLookup({ entries: {} }, workingDir);
  const watchers = new Map<string, fs.FSWatcher>();

  const updateSpecFile = (absoluteFile: string) => {
    const file = toRelativePath(absoluteFile, workingDir);
    const created = fs.existsSync(absoluteFile)
      ? analyzeAndLinkSpecFile(absoluteFile, workingDir, storyLookup)
      : undefined;
    store.setState(state => {
      const others = state.specFiles.filter(specFile => specFile.file !== file);
      return { specFiles: created ? [...others, created].sort((a, b) => a.file.localeCompare(b.file)) : others };
    });
  };

  const watchSpecFiles = (packageRoots: string[]) => {
    for (const packageRoot of packageRoots.filter(root => !watchers.has(root))) {
      const pending = new Map<string, NodeJS.Timeout>();
      const watcher = fs.watch(packageRoot, { recursive: true }, (_event, fileName) => {
        if (!fileName || fileName.includes('node_modules') || !specPatterns.some(m => path.matchesGlob(fileName, m))) {
          return;
        }
        const absoluteFile = path.join(packageRoot, fileName);
        clearTimeout(pending.get(absoluteFile));
        pending.set(
          absoluteFile,
          setTimeout(() => {
            pending.delete(absoluteFile);
            updateSpecFile(absoluteFile);
          }, 200),
        );
      });
      watcher.on('error', error => {
        logger.warn(`${ADDON_ID}: stopped watching ${packageRoot} for spec files: ${error}`);
        watcher.close();
        watchers.delete(packageRoot);
      });
      watchers.set(packageRoot, watcher);
    }
  };

  const buildIndex = async () => {
    const storyIndex = await storyIndexGenerator.getIndex();
    storyLookup = createStoryLookup(storyIndex, workingDir);
    const packageRoots = [
      ...new Set(
        Object.values(storyIndex.entries)
          .filter(entry => entry.type === 'story')
          .map(entry => findPackageRoot(path.resolve(workingDir, entry.importPath), workingDir))
          .filter(root => root !== undefined),
      ),
    ];
    const specFiles = findSpecFiles(packageRoots, specPatterns)
      .map(file => analyzeAndLinkSpecFile(file, workingDir, storyLookup))
      .filter(specFile => specFile !== undefined);
    store.setState({ specFiles });
    watchSpecFiles(packageRoots);
  };

  // A failed index keeps the previous one; the error is logged, and Storybook itself keeps running
  const tryBuildIndex = () =>
    buildIndex().catch(error => logger.error(`${ADDON_ID}: could not index the spec files: ${error}`));

  let indexTimeout: NodeJS.Timeout | undefined;
  storyIndexGenerator.onInvalidated(() => {
    clearTimeout(indexTimeout);
    indexTimeout = setTimeout(tryBuildIndex, 500);
  });

  await tryBuildIndex();
};
