/**
 * Used instead of @testing-library/user-event when a spec file imports it in Storybook.
 * Every interaction becomes a pausable step.
 */
import * as original from '@testing-library/user-event';

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

export const userEvent = wrap(original.userEvent, 'userEvent');

export default userEvent;
