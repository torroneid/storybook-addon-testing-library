import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { analyzeSpecFile } from '../src/node/analyzeSpecFile.ts';
import { formatName } from '../src/preview/formatName.ts';
import { matchesStaticTest } from '../src/shared/types.ts';

const example = (file: string) =>
  path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../example/src', file);

const summarize = (analysis: ReturnType<typeof analyzeSpecFile>) =>
  analysis.tests.map(test => ({
    name: test.name.map(part => part.text).join(' > '),
    stories: test.storyReferences.map(reference => `${path.basename(reference.storiesFile)}#${reference.exportName}`),
  }));

describe('analyzeSpecFile', () => {
  it('finds stories used through composeStories, render and .run()', () => {
    expect(summarize(analyzeSpecFile(example('Counter/Counter.spec.tsx')))).toEqual([
      { name: 'Counter > increments when clicked', stories: ['Counter.stories.tsx#Default'] },
      { name: 'Counter > shows %s clicks as "%s"', stories: ['Counter.stories.tsx#Default'] },
      { name: 'Counter > stops at the maximum', stories: ['Counter.stories.tsx#NearMax'] },
    ]);
  });

  it('follows helper functions and nested describes', () => {
    expect(summarize(analyzeSpecFile(example('LoginForm/LoginForm.spec.tsx')))).toEqual([
      { name: 'LoginForm > shows errors for an empty form', stories: ['LoginForm.stories.tsx#Default'] },
      { name: 'LoginForm > submits a filled in form', stories: ['LoginForm.stories.tsx#Filled'] },
      { name: 'LoginForm > password > requires at least 8 characters', stories: ['LoginForm.stories.tsx#Default'] },
    ]);
  });

  it('links every test to the stories of a helper that other helpers share', () => {
    const analysis = analyzeSpecFile(
      example('LoginForm/shared-helper.spec.tsx'),
      `
      import * as stories from './LoginForm.stories';
      const { Default } = composeStories(stories);
      const setup = () => render(<Default />);
      const login = async () => { setup(); };
      const logout = async () => { setup(); };
      const recursive = (depth: number) => (depth > 0 ? recursive(depth - 1) : setup());
      it('logs in and out', async () => { await login(); await logout(); });
      it('logs out', async () => { await logout(); });
      it('recurses', () => { recursive(2); });
      `,
    );
    expect(summarize(analysis)).toEqual([
      { name: 'logs in and out', stories: ['LoginForm.stories.tsx#Default'] },
      { name: 'logs out', stories: ['LoginForm.stories.tsx#Default'] },
      { name: 'recurses', stories: ['LoginForm.stories.tsx#Default'] },
    ]);
  });

  it('understands hooks, describe.each and names that are not literals', () => {
    const analysis = analyzeSpecFile(
      '/tmp/x.spec.tsx',
      `
      import { composeStories } from '@storybook/react-vite';
      const stories = {};
      describe.each([['a'], ['b']])('group %s', () => {
        beforeEach(() => {});
        it.skip(Component.name, () => {});
        test.each\`a\${1}\`('template $a', () => {});
      });
      `,
    );
    expect(analysis.tests.map(test => ({ name: test.name, isTemplate: test.isTemplate }))).toEqual([
      {
        name: [
          { text: 'group %s', pattern: 'group .*?' },
          { text: 'Component.name', pattern: null },
        ],
        isTemplate: false,
      },
      {
        name: [
          { text: 'group %s', pattern: 'group .*?' },
          { text: 'template $a', pattern: 'template .*?' },
        ],
        isTemplate: true,
      },
    ]);
  });
});

describe('names from .each', () => {
  it.each([
    { template: 'shows %s clicks as "%s"', args: [2, 'Value: 2'] },
    { template: 'formats $amount as $expected', args: [{ amount: 12345, expected: '12,345' }] },
    { template: 'row %# of %$: %d%%', args: [3.7] },
    { template: 'object %o and %j', args: [{ a: 1 }, [1, 2]] },
  ])('the static pattern for "$template" matches the formatted name', ({ template, args }) => {
    const analysis = analyzeSpecFile('/tmp/x.spec.tsx', `it.each([])(${JSON.stringify(template)}, () => {});`);
    const formatted = formatName(template, args, 0);

    expect(formatted).not.toContain('%s');
    expect(matchesStaticTest(analysis.tests[0]!, [formatted])).toBe(true);
  });

  it('formats names the way Vitest does', () => {
    expect(formatName('shows %s clicks as "%s"', [2, 'Value: 2'], 0)).toBe('shows 2 clicks as "Value: 2"');
    expect(formatName('$amount becomes $expected', [{ amount: 12345, expected: '12,345' }], 0)).toBe(
      '12345 becomes 12,345',
    );
    expect(formatName('%# and %$ and 100%%', [], 4)).toBe('4 and 5 and 100%');
  });
});
