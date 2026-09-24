/**
 * A small test runner for Vitest/Jest style tests (describe/it/hooks/each) inside the Storybook preview.
 * Assertions and spies come from storybook/test, which builds on the same @vitest/expect and @vitest/spy as Vitest.
 */
import { cleanup, configure, prettyDOM } from '@testing-library/react';
import {
  clearAllMocks,
  expect,
  fn,
  isMockFunction,
  mocked,
  resetAllMocks,
  restoreAllMocks,
  spyOn,
} from 'storybook/test';

import type { ErrorInfo, ErrorOrigin, TestStatus } from '../shared/types.ts';
import { formatName, stripAnsi, display } from './formatName.ts';
import { createLoggingExpect } from './loggingExpect.ts';
import { mapStack } from './stack.ts';
import { CancelledError, endTestSteps, lastStep, pauseBeforeTest, startTestSteps, waitsForUser } from './steps.ts';

type Hook = (context: TestContext) => unknown;
type Mode = 'run' | 'skip' | 'only' | 'todo';

export type TestContext = {
  task: { name: string; meta: Record<string, unknown> };
  expect: typeof expect;
  signal: AbortSignal;
  onTestFinished: (hook: Hook) => void;
  onTestFailed: (hook: Hook) => void;
  skip: (note?: string) => never;
};

type Test = {
  type: 'test';
  name: string;
  fn?: (context: TestContext) => unknown;
  mode: Mode;
  timeout?: number;
  parent: Suite;
};

type Suite = {
  type: 'suite';
  name: string;
  mode: Mode;
  children: Array<Test | Suite>;
  beforeAll: Hook[];
  afterAll: Hook[];
  beforeEach: Hook[];
  afterEach: Hook[];
  parent?: Suite;
};

export type Reporter = {
  testStarted: (name: string[]) => void;
  testFinished: (
    name: string[],
    status: TestStatus,
    durationMs: number,
    errors: ErrorInfo[],
    consoleErrors: string[],
  ) => void;
};

const DEFAULT_TIMEOUT = 20_000;
const SKIP = Symbol('skip');

const createSuite = (name: string, mode: Mode, parent?: Suite): Suite => ({
  type: 'suite',
  name,
  mode,
  children: [],
  beforeAll: [],
  afterAll: [],
  beforeEach: [],
  afterEach: [],
  parent,
});

/** Hooks and tests from setup files. Every spec file is nested under this suite. */
const globalSuite = createSuite('', 'run');
let collector: Suite | undefined;
const currentSuite = () => collector ?? globalSuite;

// ---------- Registration ----------

const toName = (name: unknown) =>
  typeof name === 'function' ? name.name : typeof name === 'string' ? name : String(name);

type Args = [unknown, unknown?, unknown?];
type Register = (mode: Mode) => (name: unknown, a?: unknown, b?: unknown) => void;

const splitArgs = ([, a, b]: Args) => ({
  fn: (typeof a === 'function' ? a : typeof b === 'function' ? b : undefined) as
    ((...args: unknown[]) => unknown) | undefined,
  timeout:
    typeof b === 'number'
      ? b
      : typeof a === 'number'
        ? a
        : ((typeof a === 'object' ? a : typeof b === 'object' ? b : undefined) as { timeout?: number } | undefined)
            ?.timeout,
});

const createApi = (register: Register) => {
  const withMode = (mode: Mode) =>
    Object.assign(register(mode), {
      each:
        (table: unknown[]) =>
        (...argument: Args) => {
          const { fn, timeout } = splitArgs(argument);
          table.forEach((row, index) => {
            const args = Array.isArray(row) ? row : [row];
            register(mode)(formatName(toName(argument[0]), args, index), fn && (() => fn(...args)), timeout);
          });
        },
      for:
        (table: unknown[]) =>
        (...argument: Args) => {
          const { fn, timeout } = splitArgs(argument);
          table.forEach((row, index) => {
            register(mode)(
              formatName(toName(argument[0]), Array.isArray(row) ? row : [row], index),
              fn && ((context: TestContext) => fn(row, context)),
              timeout,
            );
          });
        },
    });
  const base = withMode('run');
  return Object.assign(base, {
    skip: withMode('skip'),
    only: withMode('only'),
    todo: withMode('todo'),
    concurrent: base,
    sequential: base,
    skipIf: (condition: unknown) => (condition ? withMode('skip') : base),
    runIf: (condition: unknown) => (condition ? base : withMode('skip')),
  });
};

export const describe = createApi(mode => (name, a, b) => {
  const { fn } = splitArgs([name, a, b]);
  const parent = currentSuite();
  const suite = createSuite(toName(name), mode, parent);
  parent.children.push(suite);
  if (!fn) {
    return;
  }
  const previous = collector;
  collector = suite;
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error(`describe('${suite.name}') is async, which is not supported when running specs in Storybook.`);
    }
  } finally {
    collector = previous;
  }
});

export const test = createApi(mode => (name, a, b) => {
  const { fn, timeout } = splitArgs([name, a, b]);
  const parent = currentSuite();
  parent.children.push({
    type: 'test',
    name: toName(name),
    fn: fn,
    mode: fn ? mode : 'todo',
    timeout,
    parent,
  });
});

const hook = (type: 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach') => (fn: Hook) => {
  currentSuite()[type].push(fn);
};

export const beforeAll = hook('beforeAll');
export const afterAll = hook('afterAll');
export const beforeEach = hook('beforeEach');
export const afterEach = hook('afterEach');

let currentContext: TestContext | undefined;

export const onTestFinished = (fn: Hook) => {
  if (!currentContext) {
    throw new Error('onTestFinished can only be called while a test is running');
  }
  currentContext.onTestFinished(fn);
};

export const onTestFailed = (fn: Hook) => {
  if (!currentContext) {
    throw new Error('onTestFailed can only be called while a test is running');
  }
  currentContext.onTestFailed(fn);
};

// Both the imported and the global expect in spec files should be logged as steps
const loggingExpect = createLoggingExpect(
  expect as unknown as (...args: unknown[]) => unknown,
) as unknown as typeof expect;

const vi = new Proxy(
  { fn, spyOn, mocked, isMockFunction, clearAllMocks, resetAllMocks, restoreAllMocks } as Record<string, unknown>,
  {
    get: (template, property) => {
      if (typeof property === 'string' && !(property in template)) {
        throw new Error(`vi.${property} is not supported when specs run in Storybook`);
      }
      return template[property as string];
    },
  },
);

export const vitestApi = {
  describe,
  suite: describe,
  it: test,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  onTestFinished,
  onTestFailed,
  expect: loggingExpect,
  vi,
  vitest: vi,
};

// ---------- Loading ----------

export const loadSetupFiles = async (importers: Array<() => Promise<unknown>>) => {
  collector = globalSuite;
  try {
    for (const importer of importers) {
      await importer();
    }
  } finally {
    collector = undefined;
  }
};

export const collectFile = async (importPath: string) => {
  const root = createSuite('', 'run', globalSuite);
  collector = root;
  try {
    // A fresh URL for every run, so describe/it register again
    await import(/* @vite-ignore */ `${importPath}?spec-tests=${Date.now()}`);
  } finally {
    collector = undefined;
  }
  return root;
};

// ---------- Running ----------

class TimeoutError extends Error {
  override name = 'TimeoutError';
}

export const toErrorInfo = (error: unknown): ErrorInfo => {
  if (!(error instanceof Error)) {
    return { message: stripAnsi(display(error)) };
  }
  const { actual, expected, showDiff } = error as Error & { actual?: unknown; expected?: unknown; showDiff?: boolean };
  const hasDiff = showDiff !== false && (actual !== undefined || expected !== undefined) && actual !== expected;
  return {
    message: stripAnsi(`${error.name && error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`),
    stack: error.stack && stripAnsi(error.stack),
    diff: hasDiff ? `Expected: ${display(expected)}\nReceived: ${display(actual)}` : undefined,
  };
};

const originOf = (error: unknown): ErrorOrigin => {
  if (error instanceof TimeoutError) {
    return 'timeout';
  }
  const failure = error as { name?: string; matcherResult?: unknown; actual?: unknown; expected?: unknown } | null;
  // Chai throws AssertionError; jest-dom and other matchers throw errors with the actual and expected values
  if (
    failure?.name === 'AssertionError' ||
    failure?.matcherResult !== undefined ||
    (failure && 'actual' in failure && 'expected' in failure)
  ) {
    return 'assertion';
  }
  return failure?.name === 'TestingLibraryElementError' ? 'query' : 'thrown';
};

/** An error with its stack mapped to the source, and where in the test it happened */
export const describeError = async (error: unknown, extra: Pick<ErrorInfo, 'origin' | 'step'> = {}) => {
  const info = toErrorInfo(error);
  const { frames, codeFrame } = await mapStack(info.stack);
  return { ...info, origin: extra.origin ?? originOf(error), step: extra.step, frames, codeFrame };
};

/**
 * A timeout cannot stop the function, which keeps running after the next test has started, like in Vitest.
 * `onTimeout` aborts the test's signal, so code that listens to it can stop.
 */
const withTimeout = async (value: unknown, ms: number, label: string, onTimeout?: (error: Error) => void) => {
  // A test paused for the user, step by step or in DevTools, must not time out
  if (!(value instanceof Promise) || waitsForUser()) {
    return value;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      value,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new TimeoutError(`${label} took more than ${ms} ms`);
          onTimeout?.(error);
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const suiteChain = (suite: Suite) => {
  const chain: Suite[] = [];
  for (let s: Suite | undefined = suite; s; s = s.parent) {
    chain.unshift(s);
  }
  return chain;
};

const hasOnly = (suite: Suite): boolean =>
  suite.children.some(children => children.mode === 'only' || (children.type === 'suite' && hasOnly(children)));

export type RunOptions = {
  reporter: Reporter;
  /** The key results and steps are reported under */
  key: (name: string[]) => string;
  isSelected: (name: string[]) => boolean;
  signal: AbortSignal;
};

/** The setup files' beforeAll hooks run once, before the first file. If they fail they run again before the next. */
let globalBeforeAll: Promise<void> | undefined;

const runTest = async (test: Test, name: string[], inheritedErrors: unknown[], skip: boolean, run: RunOptions) => {
  run.reporter.testStarted(name);
  if (skip || test.mode === 'skip' || test.mode === 'todo' || !test.fn) {
    run.reporter.testFinished(name, 'skipped', 0, [], []);
    return;
  }
  cleanTestDom();
  startTestSteps(run.key(name));
  const start = performance.now();
  const errors: unknown[] = [...inheritedErrors];
  // Where each error happened, and whether it escaped the test (thrown in an event handler, say)
  const details = new Map<unknown, Pick<ErrorInfo, 'origin' | 'step'>>();
  const fail = (error: unknown, origin?: ErrorOrigin) => {
    const step = lastStep();
    details.set(error, { origin, step: step && { ...step } });
    errors.push(error);
  };
  const finishedHooks: Hook[] = [];
  const failedHooks: Hook[] = [];
  const cleanups: Array<() => unknown> = [];
  let skipped = false;
  // Aborted when the run is cancelled or the test times out
  const testController = new AbortController();
  const abortTest = (error: Error) => testController.abort(error);
  const context: TestContext = {
    task: { name: test.name, meta: {} },
    expect: loggingExpect,
    signal: AbortSignal.any([run.signal, testController.signal]),
    onTestFinished: hook => finishedHooks.push(hook),
    onTestFailed: hook => failedHooks.push(hook),
    skip: () => {
      skipped = true;
      throw SKIP;
    },
  };
  const timeout = test.timeout ?? DEFAULT_TIMEOUT;
  const chain = suiteChain(test.parent);
  const captureError = (event: ErrorEvent | PromiseRejectionEvent) => {
    fail(
      'reason' in event ? event.reason : (event.error ?? event.message),
      'reason' in event ? 'rejection' : 'uncaught',
    );
  };
  window.addEventListener('error', captureError);
  window.addEventListener('unhandledrejection', captureError);
  const consoleErrors: string[] = [];
  const nativeConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const [first, ...rest] = args;
    consoleErrors.push(
      stripAnsi(
        typeof first === 'string' && /%[sdifjoOc]/.test(first)
          ? formatName(first, rest, 0)
          : args.map(arg => (arg instanceof Error ? (arg.stack ?? arg.message) : display(arg))).join(' '),
      ),
    );
    nativeConsoleError.apply(console, args);
  };
  currentContext = context;
  expect.setState({
    assertionCalls: 0,
    isExpectingAssertions: false,
    isExpectingAssertionsError: null,
    expectedAssertionsNumber: null,
    expectedAssertionsNumberErrorGen: null,
    currentTestName: name.join(' '),
  });

  try {
    if (errors.length === 0) {
      try {
        pauseBeforeTest();
        for (const suite of chain) {
          for (const beforeEachHook of suite.beforeEach) {
            const cleanup = await withTimeout(beforeEachHook(context), timeout, 'beforeEach', abortTest);
            if (typeof cleanup === 'function') {
              cleanups.unshift(cleanup as () => unknown);
            }
          }
        }
        await withTimeout(test.fn(context), timeout, 'The test', abortTest);
        const state = expect.getState();
        if (state.expectedAssertionsNumber !== null && state.assertionCalls !== state.expectedAssertionsNumber) {
          fail(state.expectedAssertionsNumberErrorGen?.());
        }
        if (state.isExpectingAssertions && state.assertionCalls === 0) {
          fail(state.isExpectingAssertionsError);
        }
      } catch (error) {
        if (error instanceof CancelledError) {
          skipped = true;
        } else if (error !== SKIP) {
          fail(error);
        }
      }
      for (const cleanup of cleanups) {
        await Promise.resolve(cleanup()).catch(error => fail(error));
      }
      for (const suite of [...chain].reverse()) {
        for (const afterEachHook of [...suite.afterEach].reverse()) {
          await withTimeout(afterEachHook(context), timeout, 'afterEach', abortTest).catch(error => fail(error));
        }
      }
    }
    if (errors.length > 0) {
      for (const hook of failedHooks) {
        await Promise.resolve(hook(context)).catch(() => undefined);
      }
    }
    for (const hook of [...finishedHooks].reverse()) {
      await Promise.resolve(hook(context)).catch(error => fail(error));
    }
  } finally {
    endTestSteps();
    currentContext = undefined;
    window.removeEventListener('error', captureError);
    window.removeEventListener('unhandledrejection', captureError);
    console.error = nativeConsoleError;
  }

  const durationMs = performance.now() - start;
  const status = skipped ? 'skipped' : errors.length > 0 ? 'failed' : 'passed';
  if (status === 'failed') {
    // In the preview's console, DevTools shows the stacks source-mapped, and a click opens the line in Sources
    console.groupCollapsed(`%c✗ ${name.join(' › ')}`, 'color: #ff4400');
    errors.forEach(error => nativeConsoleError(error));
    console.groupEnd();
  }
  run.reporter.testFinished(
    name,
    status,
    durationMs,
    await Promise.all(errors.map(error => describeError(error, details.get(error)))),
    consoleErrors,
  );
};

const containsSelected = (node: Test | Suite, namePath: string[], isSelected: (name: string[]) => boolean): boolean =>
  node.type === 'test'
    ? isSelected([...namePath, node.name])
    : node.children.some(children => containsSelected(children, [...namePath, node.name], isSelected));

const runSuite = async (
  suite: Suite,
  namePath: string[],
  inheritedErrors: unknown[],
  skip: boolean,
  onlyInFile: boolean,
  run: RunOptions,
) => {
  const children = suite.children.filter(b => containsSelected(b, namePath, run.isSelected));
  if (children.length === 0) {
    return;
  }
  const errors = [...inheritedErrors];
  const shouldSkip = skip || suite.mode === 'skip' || suite.mode === 'todo';
  if (!shouldSkip) {
    for (const beforeAllHook of suite.beforeAll) {
      try {
        await withTimeout(beforeAllHook({} as TestContext), DEFAULT_TIMEOUT, 'beforeAll');
      } catch (error) {
        errors.push(error);
        break;
      }
    }
  }
  for (const node of children) {
    if (run.signal.aborted) {
      break;
    }
    const isOnly = !onlyInFile || node.mode === 'only' || suite.mode === 'only';
    if (node.type === 'suite') {
      await runSuite(
        node,
        [...namePath, node.name],
        errors,
        shouldSkip || !(isOnly || hasOnly(node)),
        onlyInFile && !(node.mode === 'only' || suite.mode === 'only'),
        run,
      );
    } else {
      await runTest(node, [...namePath, node.name], errors, shouldSkip || !isOnly, run);
    }
  }
  if (!shouldSkip) {
    for (const afterAllHook of [...suite.afterAll].reverse()) {
      await withTimeout(afterAllHook({} as TestContext), DEFAULT_TIMEOUT, 'afterAll').catch(() => undefined);
    }
  }
};

export const runFile = async (root: Suite, run: RunOptions) => {
  globalBeforeAll ??= (async () => {
    for (const beforeAllHook of globalSuite.beforeAll) {
      await beforeAllHook({} as TestContext);
    }
  })().catch(error => {
    globalBeforeAll = undefined;
    throw error;
  });
  await globalBeforeAll;
  await runSuite(root, [], [], false, hasOnly(root), run);
};

// ---------- DOM in the canvas ----------

let nodesBeforeTests: Set<Node> | undefined;

/** Remembers what <body> held before the tests, so everything they add can be removed again */
export const markDomBeforeTests = () => {
  nodesBeforeTests ??= new Set(document.body.childNodes);
};

/** What the tests added to <body>, so error messages do not include Storybook's own elements */
const testNodes = () => [...document.body.childNodes].filter(node => !nodesBeforeTests?.has(node));

configure({
  getElementError: (message, container) => {
    const shown =
      container === document.body || container === document.documentElement
        ? testNodes()
            .filter((node): node is Element => node instanceof Element)
            .map(node => prettyDOM(node))
            .join('\n')
        : prettyDOM(container);
    const error = new Error([message, shown].filter(Boolean).join('\n\n'));
    error.name = 'TestingLibraryElementError';
    return error;
  },
});

export const cleanTestDom = () => {
  cleanup();
  if (nodesBeforeTests) {
    for (const node of [...document.body.childNodes]) {
      if (!nodesBeforeTests.has(node)) {
        node.parentNode?.removeChild(node);
      }
    }
  }
};

export const resetTestDom = () => {
  cleanTestDom();
  nodesBeforeTests = undefined;
};
