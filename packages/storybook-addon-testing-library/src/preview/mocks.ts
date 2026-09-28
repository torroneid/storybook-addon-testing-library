/**
 * vi.mock and the other module mocks, in a preview where the modules are already loaded.
 *
 * Vitest mocks a module before anything imports it. In Storybook the stories and components have long been imported,
 * so the addon routes every import of a mocked module through a proxy module with exports that can be swapped (see
 * node/mockPlugin.ts). vi.mock swaps them while a spec file runs, and the originals come back afterwards.
 */
import { fn } from 'storybook/test';

import { MOCK_PATH_MARKER, type MockPath, MOCKED_MODULES_GLOBAL, type MockedModule } from '../shared/types.ts';

type Exports = Record<string, unknown>;
type Factory = (importOriginal: () => Promise<Exports>) => unknown;
type MockOptions = { spy?: boolean };

const modules = ((globalThis as Record<string, unknown>)[MOCKED_MODULES_GLOBAL] ??= new Map()) as Map<
  string,
  MockedModule
>;

const isMockPath = (value: unknown): value is MockPath =>
  typeof value === 'object' && value !== null && MOCK_PATH_MARKER in value;

const toMockPath = (value: unknown, method: string): MockPath => {
  if (isMockPath(value)) {
    if (value.error) {
      throw new Error(value.error);
    }
    return value;
  }
  throw new Error(
    `vi.${method}(${JSON.stringify(value)}): in Storybook the path must be a string literal written in the call, ` +
      `like vi.${method}('./module'), so the addon can find the module before the stories load`,
  );
};

const load = async (target: MockPath) => {
  if (!modules.has(target.key)) {
    await target.load();
  }
  const module = modules.get(target.key);
  if (!module) {
    throw new Error(
      `vi.mock('${target.path}'): the module was loaded before the addon knew it would be mocked. Restart Storybook.`,
    );
  }
  return module;
};

const swap = (module: MockedModule, exports: Exports | undefined) => {
  module.mock = exports;
  for (const set of module.setters) {
    set(exports ?? module.original);
  }
};

/** Like Vitest's automocker: functions and classes become mocks, objects are mocked deeply, other values are kept */
const automock = (value: unknown, spy: boolean, name: string, seen = new Map<object, unknown>()): unknown => {
  if (typeof value === 'function') {
    return (spy ? fn(value as (...args: unknown[]) => unknown) : fn()).mockName(name);
  }
  if (Array.isArray(value)) {
    return spy ? value : [];
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  const mocked: Exports = {};
  seen.set(value, mocked);
  for (const key of Object.keys(value)) {
    mocked[key] = automock((value as Exports)[key], spy, `${name}.${key}`, seen);
  }
  return mocked;
};

const automockModule = (original: Exports, spy: boolean) =>
  Object.fromEntries(Object.keys(original).map(key => [key, automock(original[key], spy, key)]));

const checkExports = (target: MockPath, exports: unknown) => {
  if (typeof exports !== 'object' || exports === null) {
    throw new Error(`vi.mock("${target.path}", factory?) is not returning an object`);
  }
  return exports as Exports;
};

const mockExports = async (target: MockPath, module: MockedModule, factory?: Factory, options?: MockOptions) => {
  if (factory) {
    return checkExports(target, await factory(async () => module.original));
  }
  if (target.mocksFile && !options?.spy) {
    return (await target.mocksFile()) as Exports;
  }
  return automockModule(module.original, options?.spy ?? false);
};

const mock = async (target: MockPath, factory?: Factory, options?: MockOptions) => {
  const module = await load(target);
  swap(module, await mockExports(target, module, factory, options));
};

/**
 * In a test the mock is in place when vi.doMock returns, if the module is loaded and the factory is synchronous.
 * Otherwise it returns false, and the mock applies asynchronously.
 */
const mockNow = (target: MockPath, factory?: Factory, options?: MockOptions) => {
  const module = modules.get(target.key);
  if (!module || (!factory && target.mocksFile && !options?.spy)) {
    return false;
  }
  const exports = factory ? factory(async () => module.original) : automockModule(module.original, !!options?.spy);
  if (exports instanceof Promise) {
    pending = pending.then(async () => swap(module, checkExports(target, await exports)));
  } else {
    swap(module, checkExports(target, exports));
  }
  return true;
};

const unmock = (target: MockPath) => {
  const module = modules.get(target.key);
  if (module) {
    swap(module, undefined);
  }
};

// ---------- When the mocks apply ----------

type Recorded = () => Promise<void>;

/** From the setup files, applied again for every spec file, like Vitest does with its fresh module graph */
const setupMocks: Recorded[] = [];
let fileMocks: Recorded[] = [];
let recording: Recorded[] | undefined;
/** vi.mock outside the top level, in a test or hook, applies at once; this is what it is waiting for */
let pending: Promise<void> = Promise.resolve();

/**
 * vi.mock at the top level of a file runs its factory after the file has loaded, so it can use variables declared
 * anywhere in the file. Vitest gets the same by hoisting the call above the imports.
 */
export const recordMocks = async (from: 'setup' | 'file', load: () => Promise<unknown>) => {
  if (from === 'file') {
    fileMocks = [];
  }
  recording = from === 'setup' ? setupMocks : fileMocks;
  try {
    await load();
  } finally {
    recording = undefined;
  }
};

const schedule = (apply: Recorded, applyNow: () => boolean) => {
  if (recording) {
    recording.push(apply);
  } else if (!applyNow()) {
    pending = pending.then(apply);
  }
};

/** Before the file's tests run */
export const applyMocks = async () => {
  for (const apply of [...setupMocks, ...fileMocks]) {
    await apply();
  }
};

/** Waits for vi.mock and vi.doMock calls made while the test ran */
export const settleMocks = () => pending;

/** After every spec file, so the stories in the canvas get their real modules back */
export const restoreModules = () => {
  pending = Promise.resolve();
  for (const module of modules.values()) {
    if (module.mock) {
      swap(module, undefined);
    }
  }
};

// ---------- vi ----------

const factoryAndOptions = (factoryOrOptions?: Factory | MockOptions) =>
  typeof factoryOrOptions === 'function'
    ? { factory: factoryOrOptions, options: undefined }
    : { factory: undefined, options: factoryOrOptions };

const mockFunction =
  (method: string) =>
  (path: unknown, factoryOrOptions?: Factory | MockOptions): void => {
    const target = toMockPath(path, method);
    const { factory, options } = factoryAndOptions(factoryOrOptions);
    schedule(
      () => mock(target, factory, options),
      () => mockNow(target, factory, options),
    );
  };

const unmockFunction =
  (method: string) =>
  (path: unknown): void => {
    const target = toMockPath(path, method);
    schedule(
      async () => unmock(target),
      () => {
        unmock(target);
        return true;
      },
    );
  };

export const moduleMocks = {
  mock: mockFunction('mock'),
  doMock: mockFunction('doMock'),
  unmock: unmockFunction('unmock'),
  doUnmock: unmockFunction('doUnmock'),
  hoisted: <T>(factory: () => T): T => factory(),
  importActual: async (path: unknown) => (await load(toMockPath(path, 'importActual'))).original,
  importMock: async (path: unknown) => {
    const target = toMockPath(path, 'importMock');
    return mockExports(target, await load(target));
  },
};
