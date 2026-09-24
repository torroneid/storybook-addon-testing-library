/**
 * Used instead of @testing-library/user-event when a spec file imports it in Storybook.
 * Every interaction becomes a pausable step.
 *
 * The interactions go through the copy of user-event in storybook/test, not the spec's own. Storybook sets that copy
 * up in the preview for every story, and user-event makes typing reach React by wrapping each input's value setter.
 * With two copies in one document the wrappers stack, and typing through the inner one no longer reaches React:
 * a play function run from a spec, or any story's play function after the specs have run, would type into nothing.
 */
import type * as original from '@testing-library/user-event';
import { userEvent as storybookUserEvent } from 'storybook/test';

import { pausableStep, describeValue } from '../steps.ts';

type AnyFunction = (...args: unknown[]) => unknown;

const isElement = (value: unknown): value is Element => typeof Element !== 'undefined' && value instanceof Element;

const wrap = <T extends object>(api: T, prefix: string): T => {
  const wrapper: Record<string, unknown> = { ...(api as Record<string, unknown>) };
  for (const [name, value] of Object.entries(api)) {
    if (typeof value !== 'function') {
      continue;
    }
    const fn = value as AnyFunction;
    wrapper[name] =
      name === 'setup'
        ? (...args: unknown[]) => wrap(fn.apply(api, args) as object, 'user')
        : (...args: unknown[]) =>
            pausableStep(
              () => `${prefix}.${name}(${args.map(describeValue).join(', ')})`,
              args.find(isElement),
              async () => fn.apply(api, args),
            );
  }
  return wrapper as T;
};

export * from '@testing-library/user-event';

export const userEvent = wrap(storybookUserEvent as unknown as typeof original.userEvent, 'userEvent');

export default userEvent;
