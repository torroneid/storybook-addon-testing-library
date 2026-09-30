import { describe, expect, it } from 'vitest';

import { isSourceFile } from '../src/node/server.ts';

describe('isSourceFile', () => {
  it('counts the files a test result can depend on', () => {
    expect(isSourceFile('src/TodoList/TodoList.tsx')).toBe(true);
    expect(isSourceFile('src/TodoList/TodoList.spec.tsx')).toBe(true);
    expect(isSourceFile('src/theme.css')).toBe(true);
    expect(isSourceFile('src/data.json')).toBe(true);
  });

  it('leaves out dependencies, dotfiles and editor swap files', () => {
    expect(isSourceFile('node_modules/react/index.js')).toBe(false);
    expect(isSourceFile('src/TodoList/.TodoList.tsx.swp')).toBe(false);
    expect(isSourceFile('.git/index')).toBe(false);
    expect(isSourceFile('.storybook/main.ts')).toBe(false);
    expect(isSourceFile('README.md')).toBe(false);
  });
});
