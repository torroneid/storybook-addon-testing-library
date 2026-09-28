// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { beforeAll, collectFile, loadSetupFiles, runFile, type RunOptions } from '../src/preview/runtime.ts';

const fixture = new URL('./fixtures/timeout.fixture.ts', import.meta.url).pathname;
const throwsStringFixture = new URL('./fixtures/throwsString.fixture.ts', import.meta.url).pathname;
const fakeTimersFixture = new URL('./fixtures/fakeTimers.fixture.ts', import.meta.url).pathname;

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

  // An ErrorEvent without an error, such as ResizeObserver's, is reported with its message, a string, too
  it('reports an error that is not an object', async () => {
    const results: Array<[string, string]> = [];
    const root = await collectFile(throwsStringFixture);

    await runFile(root, runOptions(results));

    expect(results).toEqual([
      ['throws a string', 'failed'],
      ['runs afterwards', 'passed'],
    ]);
  });

  it('runs tests with fake timers, and restores the real ones after the file', async () => {
    const nativeSetTimeout = globalThis.setTimeout;
    const nativeDate = globalThis.Date;
    const results: Array<[string, string]> = [];
    const root = await collectFile(fakeTimersFixture);

    await runFile(root, runOptions(results));

    expect(results).toEqual([
      ['advances fake time', 'passed'],
      ['fakes the date', 'passed'],
      ['times out on real time while the timers are fake', 'failed'],
      ['leaves the timers fake', 'passed'],
    ]);
    expect(globalThis.setTimeout).toBe(nativeSetTimeout);
    expect(globalThis.Date).toBe(nativeDate);
  });
});
