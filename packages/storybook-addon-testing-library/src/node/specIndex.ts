import fs from 'node:fs';
import path from 'node:path';

import type { SpecFile } from '../shared/types.ts';
import { analyzeSpecFile } from './analyzeSpecFile.ts';

type StoryIndexLike = {
  entries: Record<string, { id: string; type: string; importPath: string; exportName?: string }>;
};

const VITE_CONFIG_FILES = ['vitest.config', 'vite.config'].flatMap(name =>
  ['ts', 'mts', 'js', 'mjs'].map(extension => `${name}.${extension}`),
);

export const createStoryLookup = (index: StoryIndexLike, workingDir: string) => {
  const perFil = new Map<string, Map<string, string>>();
  for (const entry of Object.values(index.entries)) {
    if (entry.type !== 'story' || !entry.exportName) {
      continue;
    }
    const file = path.resolve(workingDir, entry.importPath);
    const stories = perFil.get(file) ?? new Map<string, string>();
    stories.set(entry.exportName, entry.id);
    perFil.set(file, stories);
  }
  return {
    findStoryId: (storiesFile: string, exportName: string) => perFil.get(storiesFile)?.get(exportName),
    findStoryIdsInFile: (storiesFile: string) => [...(perFil.get(storiesFile)?.values() ?? [])],
  };
};

export type StoryLookup = ReturnType<typeof createStoryLookup>;

const isInside = (dir: string, root: string) => {
  const relative = path.relative(root, dir);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

const searchRoots = new Map<string, string>();

/**
 * How far up to look for a package root: the repository Storybook runs in, so stories from sibling packages in a
 * monorepo are found. Without a repository, only the working directory.
 */
const findSearchRoot = (workingDir: string) => {
  let root = searchRoots.get(workingDir);
  if (root === undefined) {
    root = workingDir;
    for (let dir = workingDir; ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        root = dir;
        break;
      }
      if (path.dirname(dir) === dir) {
        break;
      }
    }
    searchRoots.set(workingDir, root);
  }
  return root;
};

export const findPackageRoot = (file: string, workingDir: string) => {
  const searchRoot = findSearchRoot(workingDir);
  let dir = path.dirname(file);
  while (isInside(dir, searchRoot)) {
    if (VITE_CONFIG_FILES.some(configFil => fs.existsSync(path.join(dir, configFil)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
};

/** Spec patterns are relative to the package root, like in the index. Files outside one are matched by full path. */
export const isSpecFile = (file: string, specPatterns: string[], workingDir: string) => {
  const packageRoot = findPackageRoot(file, workingDir);
  const relative = packageRoot ? path.relative(packageRoot, file) : file;
  return specPatterns.some(pattern => path.matchesGlob(relative, pattern));
};

const findSiblingStoriesFile = (specFile: string) =>
  ['.tsx', '.ts']
    .map(extension => specFile.replace(/\.(spec|test)\.[jt]sx?$/, `.stories${extension}`))
    .find(file => file !== specFile && fs.existsSync(file));

export const toRelativePath = (file: string, workingDir: string) => `./${path.relative(workingDir, file)}`;

export const analyzeAndLinkSpecFile = (
  absoluteFile: string,
  workingDir: string,
  storyLookup: StoryLookup,
): SpecFile | undefined => {
  const packageRoot = findPackageRoot(absoluteFile, workingDir);
  if (!packageRoot) {
    return undefined;
  }
  const file = toRelativePath(absoluteFile, workingDir);
  const importPath = `/@fs${absoluteFile.split(path.sep).join('/')}`;
  try {
    const analyse = analyzeSpecFile(absoluteFile);
    const storiesFiles = new Set(analyse.storiesFiles);
    const storiesFilMedSameNamn = findSiblingStoriesFile(absoluteFile);
    if (storiesFilMedSameNamn) {
      storiesFiles.add(storiesFilMedSameNamn);
    }
    const storyIds = [...storiesFiles].flatMap(storyLookup.findStoryIdsInFile);
    if (storyIds.length === 0) {
      return undefined;
    }
    return {
      file,
      importPath,
      storyIds,
      tests: analyse.tests.map(test => ({
        id: `${test.line}:${test.name.map(part => part.text).join(' > ')}`,
        name: test.name,
        line: test.line,
        isTemplate: test.isTemplate,
        storyIds: [
          ...new Set(
            test.storyReferences
              .map(ref => storyLookup.findStoryId(ref.storiesFile, ref.exportName))
              .filter(id => id !== undefined),
          ),
        ],
      })),
    };
  } catch (error) {
    return { file, importPath, storyIds: [], tests: [], analysisError: String(error) };
  }
};

export const findSpecFiles = (katalogar: string[], pattern: string[]) =>
  [
    ...new Set(
      katalogar
        .filter(dir => fs.existsSync(dir))
        .flatMap(dir =>
          fs
            .globSync(pattern, { cwd: dir, exclude: ['**/node_modules/**', '**/dist/**'] })
            .map(file => path.resolve(dir, file)),
        ),
    ),
  ].sort();
