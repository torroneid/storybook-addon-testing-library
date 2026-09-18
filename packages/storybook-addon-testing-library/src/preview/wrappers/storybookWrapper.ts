/**
 * Used instead of @storybook/react-vite when a spec file imports it in Storybook.
 * Story.run() and Story.play() become pausable steps.
 */
import * as original from '@storybook/react-vite';

import { pausableStep } from '../steps.ts';

type AnyFunction = (...args: unknown[]) => unknown;

const wrapStory = <T>(story: T, name: string): T => {
  if (typeof story !== 'function') {
    return story;
  }
  const composed = story as unknown as AnyFunction & Record<string, unknown>;
  const omslag = function (this: unknown, ...args: unknown[]) {
    return composed.apply(this, args);
  } as AnyFunction & Record<string, unknown>;
  Object.assign(omslag, composed);
  Object.defineProperty(omslag, 'name', { value: composed.name });
  for (const method of ['run', 'play'] as const) {
    const fn = composed[method];
    if (typeof fn === 'function') {
      omslag[method] = (...args: unknown[]) =>
        pausableStep(
          () => `${name}.${method}()`,
          undefined,
          async () => (fn as AnyFunction).apply(composed, args),
        );
    }
  }
  return omslag as T;
};

export * from '@storybook/react-vite';

export const composeStories = ((...args: Parameters<typeof original.composeStories>) =>
  Object.fromEntries(
    Object.entries(original.composeStories(...args)).map(([name, story]) => [name, wrapStory(story, name)]),
  )) as typeof original.composeStories;

export const composeStory = ((...args: Parameters<typeof original.composeStory>) => {
  const composed = original.composeStory(...args);
  return wrapStory(composed, args[3] ?? composed.storyName ?? 'story');
}) as typeof original.composeStory;
