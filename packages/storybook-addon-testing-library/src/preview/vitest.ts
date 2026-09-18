/**
 * Replaces 'vitest' when spec files and setup files are imported in Storybook (see viteFinal in preset.ts).
 * The API comes from globalThis, so it is always the runtime instance preview.ts set up.
 */
import type { vitestApi } from './runtime.ts';

const api = (globalThis as unknown as { __SPEC_TESTAR_VITEST__?: typeof vitestApi }).__SPEC_TESTAR_VITEST__;

if (!api) {
  throw new Error("storybook-addon-testing-library: 'vitest' was imported before the test runtime was ready");
}

export const {
  describe,
  suite,
  it,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  onTestFinished,
  onTestFailed,
  expect,
  vi,
  vitest,
} = api;
