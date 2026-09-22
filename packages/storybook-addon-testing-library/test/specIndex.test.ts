import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isSpecFile } from '../src/node/specIndex.ts';

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
