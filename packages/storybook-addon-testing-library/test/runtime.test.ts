// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { beforeAll, collectFile, loadSetupFiles, runFile, type RunOptions } from '../src/preview/runtime.ts';

const fixture = new URL('./fixtures/timeout.fixture.ts', import.meta.url).pathname;

const runOptions = (results: Array<[string, string]>): RunOptions => ({
  signal: new AbortController().signal,
  key: name => name.join(' > '),
  isSelected: () => true,
  reporter: {
    testStarted: () => undefined,
    testFinished: (name, status) => results.push([name.join(' > '), status]),
  },
});

describe('runtime', () => {
  it('runs the setup files’ beforeAll again after it failed', async () => {
    let calls = 0;
    await loadSetupFiles([
      async () =>
        beforeAll(() => {
          calls++;
          if (calls === 1) {
            throw new Error('not ready');
          }
        }),
    ]);
    const root = await collectFile(fixture);

    await expect(runFile(root, { ...runOptions([]), isSelected: () => false })).rejects.toThrow('not ready');
    await runFile(root, { ...runOptions([]), isSelected: () => false });

    expect(calls).toBe(2);
  });

  it('aborts the test’s signal when it times out', async () => {
    const results: Array<[string, string]> = [];
    const root = await collectFile(fixture);

    await runFile(root, runOptions(results));

    expect(results).toEqual([
      ['never finishes', 'failed'],
      ['runs afterwards', 'passed'],
    ]);
    const seen = (globalThis as { timeoutFixture?: { aborted?: boolean; reason?: unknown } }).timeoutFixture;
    expect(seen?.aborted).toBe(true);
    expect(String(seen?.reason)).toContain('50 ms');
  });
});
