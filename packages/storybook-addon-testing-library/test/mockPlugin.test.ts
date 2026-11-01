import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { exportNames, findMockCalls, mockPlugin } from '../src/node/mockPlugin.ts';
import { MOCK_PATH_MARKER } from '../src/shared/types.ts';

const root = fileURLToPath(new URL('./fixtures/mockProject', import.meta.url));

describe('findMockCalls', () => {
  it('finds the path in the calls that take one', () => {
    const code = [
      `vi.mock('./a', () => ({}));`,
      `vi.mock<typeof import('./b')>("./b");`,
      `vitest.doMock(import('./c'), () => ({}));`,
      `await vi.importActual('d');`,
      `vi.fn('./not-a-path');`,
    ].join('\n');

    const calls = findMockCalls(code);

    expect(calls.map(call => call.path)).toEqual(['./a', './b', './c', 'd']);
    expect(calls.map(call => code.slice(call.start, call.end))).toEqual([`'./a'`, `"./b"`, `import('./c')`, `'d'`]);
  });
  it('ignores mock-like text in strings, comments, regexes and JSX', () => {
    const code = [
      `const message = "vi.mock('./string')";`,
      "const template = `vi.mock('./template')`;",
      `// vi.mock('./comment')`,
      `/* vi.mock('./block') */`,
      `const regex = /vi.mock('regex')/;`,
      `<div title="vi.mock('./attribute')">vi.mock('./text')</div>;`,
      `other.vi.mock('./other');`,
      'vi.mock(`./${dynamic}`);',
    ].join('\n');
    expect(findMockCalls(code)).toEqual([]);
  });

  it('finds calls with comments and nested type arguments and decodes escaped paths', () => {
    const code = String.raw`vi /* comment */ .mock<Promise<Record<string, unknown>>>("./fo\u006f");`;
    const calls = findMockCalls(code, 'spec.ts');
    expect(calls.map(call => call.path)).toEqual(['./foo']);
    expect(code.slice(calls[0].start, calls[0].end)).toBe(String.raw`"./fo\u006f"`);
  });
});

describe('exportNames', () => {
  it('lists the runtime exports and leaves out types', async () => {
    const code = [
      `export const a = 1, { b, c: [d] } = {} as any;`,
      `export function e() {}`,
      `export default class {}`,
      `export enum F {}`,
      `export type G = string;`,
      `export interface H {}`,
      `export declare const i: number;`,
      `const j = 1; export { j as k, type j as l };`,
      `export type { M } from './m';`,
      `export * as n from './n';`,
      `export * from './star';`,
    ].join('\n');

    const names = await exportNames(
      '/virtual/module.ts',
      code,
      async source => (source === './star' ? '/virtual/star.ts' : undefined),
      () => 'export const fromStar = 1; export default 2;',
    );

    expect([...names].sort()).toEqual(['F', 'a', 'b', 'd', 'default', 'e', 'fromStar', 'k', 'n'].sort());
  });
});

describe('mockPlugin', () => {
  let server: ViteDevServer;

  beforeAll(async () => {
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [mockPlugin(['**/*.mockspec.ts'], [])],
    });
  });

  afterAll(() => server.close());

  const transform = async (url: string) => (await server.environments.client.transformRequest(url))?.code ?? '';

  it('routes imports of a mocked module through a proxy with its exports', async () => {
    const component = await transform('/src/Comp.ts');
    const proxyUrl = component.match(/from "(\/@id\/__x00__storybook-addon-testing-library\/mock:[^"]+)"/)?.[1];

    expect(proxyUrl).toContain('useThing.ts');
    const proxy = await transform(proxyUrl!.replace('/@id/__x00__', '\0'));
    expect(proxy).toMatch(/export \{ __e0 as useThing, __e1 as more \}/);
    expect(proxy).toContain('useThing.ts');
  });

  it('gives vi.mock the resolved module in the spec file', async () => {
    const spec = await transform('/src/Comp.mockspec.ts');

    expect(spec).toContain(`${MOCK_PATH_MARKER}: true`);
    expect(spec).toContain(`key: ${JSON.stringify(path.join(root, 'src/useThing.ts'))}`);
  });

  it('leaves modules nothing mocks alone', async () => {
    const more = await transform('/src/useThing.ts');

    expect(more).not.toContain('storybook-addon-testing-library/mock:');
  });
});
