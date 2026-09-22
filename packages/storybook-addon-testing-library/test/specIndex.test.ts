import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { findPackageRoot, isSpecFile } from '../src/node/specIndex.ts';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const specFile = path.join(repoRoot, 'example/src/LoginForm/LoginForm.spec.tsx');

describe('isSpecFile', () => {
  it('matches patterns relative to the package root', () => {
    expect(isSpecFile(specFile, ['src/**/*.spec.tsx'], repoRoot)).toBe(true);
    expect(isSpecFile(specFile, ['**/*.spec.{ts,tsx}'], repoRoot)).toBe(true);
    expect(isSpecFile(specFile, ['test/**/*.spec.tsx'], repoRoot)).toBe(false);
  });

  it('matches files outside a package root by their full path', () => {
    expect(isSpecFile('/elsewhere/Foo.spec.tsx', ['**/*.spec.tsx'], repoRoot)).toBe(true);
  });
});

describe('findPackageRoot', () => {
  /** A repository inside a temporary directory, so files can also be put above the repository */
  const createRepo = (files: string[]) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-index-'));
    const repo = path.join(outside, 'repo');
    for (const file of ['repo/.git/HEAD', ...files]) {
      fs.mkdirSync(path.dirname(path.join(outside, file)), { recursive: true });
      fs.writeFileSync(path.join(outside, file), '');
    }
    return repo;
  };

  it('finds packages outside the working directory, in the same repository', () => {
    const repo = createRepo(['repo/packages/ui/vite.config.ts', 'repo/apps/storybook/vite.config.ts']);

    expect(
      findPackageRoot(path.join(repo, 'packages/ui/src/Button.stories.tsx'), path.join(repo, 'apps/storybook')),
    ).toBe(path.join(repo, 'packages/ui'));
  });

  it('does not look outside the repository', () => {
    const repo = createRepo(['vite.config.ts', 'repo/app/src/Button.stories.tsx']);

    expect(findPackageRoot(path.join(repo, 'app/src/Button.stories.tsx'), path.join(repo, 'app'))).toBeUndefined();
  });
});
