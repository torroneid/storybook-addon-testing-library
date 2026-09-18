/**
 * Used instead of @testing-library/react when a spec file imports it in Storybook.
 * render and fireEvent are logged as steps, and async calls (findBy*, waitFor) can be paused.
 */
import * as original from '@testing-library/react';

import { logStep, pausableStep, describeValue } from '../steps.ts';

type AnyFunction = (...args: unknown[]) => unknown;

const componentName = (ui: unknown) => {
  const type = (ui as { type?: unknown } | null)?.type;
  if (typeof type === 'string') {
    return type;
  }
  if (typeof type === 'function') {
    const komponent = type as { storyName?: string; displayName?: string; name: string };
    return komponent.storyName ?? komponent.displayName ?? (komponent.name || 'Komponent');
  }
  return '…';
};

const formatArgs = (args: unknown[]) => args.map(describeValue).join(', ');

export * from '@testing-library/react';

export const render = ((ui: Parameters<typeof original.render>[0], options?: object) =>
  logStep(
    () => `render(<${componentName(ui)} />)`,
    () => original.render(ui, options),
  )) as typeof original.render;

const wrappedFireEvent = ((element: Element, event: Event) =>
  logStep(
    () => `fireEvent(${describeValue(element)}, ${event.type})`,
    () => original.fireEvent(element, event),
  )) as unknown as Record<string, unknown>;
for (const [name, value] of Object.entries(original.fireEvent)) {
  if (typeof value === 'function') {
    wrappedFireEvent[name] = (...args: unknown[]) =>
      logStep(
        () => `fireEvent.${name}(${describeValue(args[0])})`,
        () => (value as AnyFunction)(...args),
      );
  }
}
export const fireEvent = wrappedFireEvent as unknown as typeof original.fireEvent;

export const waitFor = ((...args: Parameters<typeof original.waitFor>) =>
  pausableStep(
    () => 'waitFor(…)',
    undefined,
    () => original.waitFor(...args),
  )) as typeof original.waitFor;

export const waitForElementToBeRemoved = ((...args: Parameters<typeof original.waitForElementToBeRemoved>) =>
  pausableStep(
    () => 'waitForElementToBeRemoved(…)',
    undefined,
    () => original.waitForElementToBeRemoved(...args),
  )) as typeof original.waitForElementToBeRemoved;

const wrapQueries = <T extends object>(queries: T, prefix: string): T =>
  new Proxy(queries, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property === 'string' && /^find(All)?By/.test(property) && typeof value === 'function') {
        return (...args: unknown[]) =>
          pausableStep(
            () => `${prefix}.${property}(${formatArgs(args)})`,
            undefined,
            async () => (value as AnyFunction)(...args),
          );
      }
      return value;
    },
  });

export const screen = wrapQueries(original.screen, 'screen');

export const within = ((element: Parameters<typeof original.within>[0], queries?: undefined) =>
  wrapQueries(original.within(element, queries), `within(${describeValue(element)})`)) as typeof original.within;
