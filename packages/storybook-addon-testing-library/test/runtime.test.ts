// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  beforeAll,
  collectFile,
  loadSetupFiles,
  runFile,
  describeFileErrors,
  toErrorInfo,
  type RunOptions,
} from '../src/preview/runtime.ts';

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

// Construct independent suites so each case exercises the runner without sharing setup hooks.
const suiteWithTests = (): Parameters<typeof runFile>[0] => {
  const suite: Parameters<typeof runFile>[0] = {
    type: 'suite',
    name: '',
    mode: 'run',
    children: [],
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: [],
  };
  for (const name of ['first', 'second']) {
    suite.children.push({ type: 'test', name, mode: 'run', fn: () => undefined, parent: suite });
  }
  return suite;
};

describe('teardown failures', () => {
  it.each(['sync', 'async'])('reports %s afterAll failures after running remaining hooks and suites', async mode => {
    const root = suiteWithTests();
    const child = suiteWithTests();
    child.name = 'nested';
    child.parent = root;
    root.children.unshift(child);
    const calls: string[] = [];
    child.afterAll.push(() => {
      calls.push('remaining');
    });
    child.afterAll.push(() => {
      if (mode === 'async') return Promise.reject(new Error('nested teardown failed'));
      throw new Error('nested teardown failed');
    });
    root.afterAll.push(() => {
      calls.push('parent');
    });
    const results: Array<[string, string]> = [];

    await expect(runFile(root, runOptions(results))).rejects.toThrow('nested teardown failed');

    expect(calls).toEqual(['remaining', 'parent']);
    expect(results).toEqual([
      ['nested > first', 'passed'],
      ['nested > second', 'passed'],
      ['first', 'passed'],
      ['second', 'passed'],
    ]);
  });

  it.each(['cleanup', 'afterEach', 'onTestFinished', 'onTestFailed'])(
    'reports a synchronous %s error and continues the file',
    async kind => {
      const root = suiteWithTests();
      const calls: string[] = [];
      const fail = () => {
        throw new Error(`${kind} failed`);
      };
      root.beforeEach.push(context => {
        if (context.task.name !== 'first') return;
        context.onTestFinished(() => {
          calls.push('finished');
        });
        if (kind === 'cleanup') return fail;
        if (kind === 'onTestFinished') context.onTestFinished(fail);
        if (kind === 'onTestFailed') {
          context.onTestFailed(fail);
          throw new Error('test setup failed');
        }
        return undefined;
      });
      root.afterEach.push(() => {
        calls.push('afterEach');
      });
      if (kind === 'afterEach')
        root.afterEach.push(context => {
          if (context.task.name === 'first') fail();
        });
      const results: Array<[string, string]> = [];
      const options = runOptions(results);
      const errors: string[] = [];
      const report = options.reporter.testFinished;
      options.reporter.testFinished = (...args) => {
        errors.push(...args[3].map(error => error.message));
        report(...args);
      };

      await runFile(root, options);

      expect(results).toEqual([
        ['first', 'failed'],
        ['second', 'passed'],
      ]);
      expect(errors).toContain(`${kind} failed`);
      expect(calls).toEqual(['afterEach', 'finished', 'afterEach']);
    },
  );
});

describe('error reports', () => {
  it('keeps the original stacks of aggregated teardown errors', async () => {
    const first = new Error('first cleanup failed');
    const second = new Error('second cleanup failed');
    const errors = await describeFileErrors(
      new AggregateError([first, new AggregateError([second], 'nested')], 'afterAll'),
    );
    expect(errors.map(error => error.message)).toEqual(['first cleanup failed', 'second cleanup failed']);
    expect(errors.map(error => error.stack)).toEqual([first.stack, second.stack]);
  });

  it('sends a comparison without losing undefined or empty values', () => {
    const error = Object.assign(new Error('Values differ'), { actual: undefined, expected: '' });
    expect(toErrorInfo(error).comparison).toEqual({ expected: '', actual: 'undefined' });
    expect(toErrorInfo(Object.assign(error, { showDiff: false })).comparison).toBeUndefined();
  });
});
