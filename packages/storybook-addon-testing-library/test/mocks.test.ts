import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMockFunction } from 'storybook/test';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { proxyModuleCode } from '../src/node/mockPlugin.ts';
import { applyMocks, moduleMocks, recordMocks, restoreModules, settleMocks } from '../src/preview/mocks.ts';
import { MOCK_PATH_MARKER, type MockPath } from '../src/shared/types.ts';

type Thing = { greet: () => string; default: string; count: number };

// Real ES modules on disk: an original, and the proxy the plugin would serve for it
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'addon-mocks-'));
const writeModule = (name: string, code: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, code);
  return pathToFileURL(file).href;
};

const createTarget = (name: string): MockPath => {
  const original = writeModule(
    `${name}.mjs`,
    `export const greet = () => 'real'; export default 'real default'; export let count = 1;`,
  );
  const proxy = writeModule(`${name}.proxy.mjs`, proxyModuleCode(original, name, ['greet', 'default', 'count']));
  return { [MOCK_PATH_MARKER]: true, path: `./${name}`, key: name, load: () => import(proxy) };
};

const loadProxy = async (target: MockPath) => (await target.load()) as Thing;

afterEach(() => restoreModules());
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('vi.mock', () => {
  it('swaps the exports once the file has loaded, and restores them', async () => {
    const target = createTarget('swap');
    const proxy = await loadProxy(target);

    await recordMocks('file', async () => moduleMocks.mock(target, () => ({ greet: () => 'mocked' })));
    expect(proxy.greet()).toBe('real');

    await applyMocks();
    expect(proxy.greet()).toBe('mocked');
    expect(proxy.default).toBeUndefined();

    restoreModules();
    expect(proxy.greet()).toBe('real');
    expect(proxy.default).toBe('real default');
  });

  it('runs the factory after the file, so it can use variables declared below the call', async () => {
    const target = createTarget('hoisted');
    const proxy = await loadProxy(target);

    await recordMocks('file', async () => {
      moduleMocks.mock(target, () => ({ greet: () => message }));
      const message = moduleMocks.hoisted(() => 'declared later');
    });
    await applyMocks();

    expect(proxy.greet()).toBe('declared later');
  });

  it('passes the original to the factory', async () => {
    const target = createTarget('partial');
    const proxy = await loadProxy(target);

    await recordMocks('file', async () =>
      moduleMocks.mock(target, async importOriginal => ({ ...(await importOriginal()), greet: () => 'partly' })),
    );
    await applyMocks();

    expect(proxy.greet()).toBe('partly');
    expect(proxy.default).toBe('real default');
    expect(await moduleMocks.importActual(target)).toMatchObject({ default: 'real default' });
  });

  it('automocks without a factory, and spies with { spy: true }', async () => {
    const automocked = createTarget('automock');
    const spied = createTarget('spy');
    const [automockProxy, spyProxy] = [await loadProxy(automocked), await loadProxy(spied)];

    await recordMocks('file', async () => {
      moduleMocks.mock(automocked);
      moduleMocks.mock(spied, { spy: true });
    });
    await applyMocks();

    expect(isMockFunction(automockProxy.greet)).toBe(true);
    expect(automockProxy.greet()).toBeUndefined();
    expect(automockProxy.count).toBe(1);
    expect(isMockFunction(spyProxy.greet)).toBe(true);
    expect(spyProxy.greet()).toBe('real');
  });

  it('applies vi.doMock in a test at once, and vi.doUnmock undoes it', async () => {
    const target = createTarget('doMock');
    const proxy = await loadProxy(target);

    moduleMocks.doMock(target, () => ({ greet: () => 'now' }));
    expect(proxy.greet()).toBe('now');

    moduleMocks.doUnmock(target);
    expect(proxy.greet()).toBe('real');
  });

  it('loads a module nothing has imported yet', async () => {
    const target = createTarget('notLoaded');

    moduleMocks.doMock(target, () => ({ greet: () => 'loaded' }));
    await settleMocks();

    expect((await loadProxy(target)).greet()).toBe('loaded');
  });

  it('explains that the path must be written in the call', () => {
    expect(() => moduleMocks.mock('./somewhere')).toThrow('must be a string literal');
  });
});
