// @vitest-environment jsdom
import { expect, it } from 'vitest';

// Storybook instruments storybook/test's expect for the Interactions panel in the preview iframe, or with ?instrument=true
it('matches expect.any inside expect.objectContaining when storybook/test is instrumented', async () => {
  window.history.replaceState({}, '', '/iframe.html?instrument=true');
  const { vitestApi } = await import('../src/preview/runtime.ts');
  const specExpect = vitestApi.expect;

  specExpect({ id: 'x', file: {} }).toEqual(
    specExpect.objectContaining({ id: specExpect.any(String), file: specExpect.any(Object) }),
  );
  expect(() => specExpect({ id: 1 }).toEqual(specExpect.objectContaining({ id: specExpect.any(String) }))).toThrow();
});
