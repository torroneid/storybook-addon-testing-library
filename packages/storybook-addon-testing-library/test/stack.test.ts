import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapStack, parseStack, setProjectRoot } from '../src/preview/stack.ts';

const SOURCE = `type Price = number;

export const parsePrice = (text: string): Price => {
  const value = Number(text);
  if (Number.isNaN(value)) {
    throw new Error('Not a price');
  }
  return value;
};
`;

/** The code as Vite would serve it: transformed, with an inline source map that includes the source */
const served = ts.transpileModule(SOURCE, {
  fileName: 'Price.ts',
  compilerOptions: { inlineSourceMap: true, inlineSources: true, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Where `throw` is in the served code, as Chrome reports it (1-based) */
const servedLines = served.split('\n');
const throwLine = servedLines.findIndex(line => line.includes('throw')) + 1;
const throwColumn = servedLines[throwLine - 1]!.indexOf('throw') + 1;

afterEach(() => {
  vi.unstubAllGlobals();
  setProjectRoot(undefined);
});

describe('parseStack', () => {
  it('reads the frames Chrome writes', () => {
    expect(
      parseStack(
        [
          'Error: Not a price',
          '    at parsePrice (http://localhost:6006/src/Price.ts?t=1:6:11)',
          '    at async Object.fn (http://localhost:6006/@fs/home/me/app/src/Price.spec.ts?spec-tests=2:14:17)',
          '    at http://localhost:6006/node_modules/.cache/sb-vite/deps/client.js?v=1:9906:5',
        ].join('\n'),
      ),
    ).toEqual([
      { fn: 'parsePrice', url: 'http://localhost:6006/src/Price.ts?t=1', line: 6, column: 11 },
      {
        fn: 'Object.fn',
        url: 'http://localhost:6006/@fs/home/me/app/src/Price.spec.ts?spec-tests=2',
        line: 14,
        column: 17,
      },
      {
        fn: undefined,
        url: 'http://localhost:6006/node_modules/.cache/sb-vite/deps/client.js?v=1',
        line: 9906,
        column: 5,
      },
    ]);
  });
});

describe('mapStack', () => {
  it('maps a frame back to the source and shows the code around it', async () => {
    const fetch = vi.fn(async () => new Response(served));
    vi.stubGlobal('fetch', fetch);

    const { frames, codeFrame } = await mapStack(
      [
        'Error: Not a price',
        `    at parsePrice (http://localhost:6006/src/Price.ts?t=1:${throwLine}:${throwColumn})`,
        '    at dispatch (http://localhost:6006/node_modules/.cache/sb-vite/deps/client.js?v=1:10:5)',
      ].join('\n'),
    );

    expect(frames).toEqual([
      {
        fn: 'parsePrice',
        file: './src/Price.ts',
        line: 6,
        column: 5,
        library: false,
        served: { url: 'http://localhost:6006/src/Price.ts?t=1', line: throwLine, column: throwColumn },
      },
      { fn: 'dispatch', file: './node_modules/.cache/sb-vite/deps/client.js', line: 10, column: 5, library: true },
    ]);
    expect(codeFrame?.line).toBe(6);
    expect(codeFrame?.lines.map(line => line.number)).toEqual([4, 5, 6, 7, 8]);
    expect(codeFrame?.lines.find(line => line.number === 6)?.text).toBe("    throw new Error('Not a price');");
    // Libraries are neither fetched nor mapped
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('shows files outside the Vite root relative to where Storybook runs', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    setProjectRoot('/home/me/app');

    const { frames } = await mapStack(
      '    at Object.fn (http://localhost:6006/@fs/home/me/app/src/Price.spec.ts?spec-tests=2:14:17)',
    );

    expect(frames[0]?.file).toBe('./src/Price.spec.ts');
  });

  it('keeps where your own frames are in the served code, so they can be logged in the console', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));

    const { frames } = await mapStack(
      [
        '    at parsePrice (http://localhost:6006/src/Price.ts?t=1:6:11)',
        '    at dispatch (http://localhost:6006/node_modules/.cache/sb-vite/deps/client.js?v=1:10:5)',
      ].join('\n'),
    );

    expect(frames.map(frame => frame.served)).toEqual([
      { url: 'http://localhost:6006/src/Price.ts?t=1', line: 6, column: 11 },
      undefined,
    ]);
  });

  it('treats a deps folder in the project as the project’s code', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));

    const { frames } = await mapStack('    at parsePrice (http://localhost:6006/src/deps/Price.ts?t=1:6:11)');

    expect(frames[0]?.library).toBe(false);
  });
});
