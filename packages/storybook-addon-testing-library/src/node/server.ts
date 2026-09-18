import fs from 'node:fs';
import path from 'node:path';
import { experimental_UniversalStore } from 'storybook/internal/core-server';
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
      const utan = state.specFiles.filter(specFile => specFile.file !== file);
      return { specFiles: created ? [...utan, created].sort((a, b) => a.file.localeCompare(b.file)) : utan };
    });
  };

  const watchSpecFiles = (packageRoots: string[]) => {
    for (const packageRoot of packageRoots.filter(root => !watchers.has(root))) {
      const ventande = new Map<string, NodeJS.Timeout>();
      const vaktar = fs.watch(packageRoot, { recursive: true }, (_hending, fileName) => {
        if (!fileName || fileName.includes('node_modules') || !specPatterns.some(m => path.matchesGlob(fileName, m))) {
          return;
        }
        const absoluteFile = path.join(packageRoot, fileName);
        clearTimeout(ventande.get(absoluteFile));
        ventande.set(
          absoluteFile,
          setTimeout(() => {
            ventande.delete(absoluteFile);
            updateSpecFile(absoluteFile);
          }, 200),
        );
      });
      vaktar.on('error', () => watchers.delete(packageRoot));
      watchers.set(packageRoot, vaktar);
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

  let indexTimeout: NodeJS.Timeout | undefined;
  storyIndexGenerator.onInvalidated(() => {
    clearTimeout(indexTimeout);
    indexTimeout = setTimeout(() => buildIndex().catch(() => undefined), 500);
  });

  await buildIndex();
};
