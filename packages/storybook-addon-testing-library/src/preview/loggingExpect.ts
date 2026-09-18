import { logStep, describeValue } from './steps.ts';

type AnyFunction = (...args: unknown[]) => unknown;

/** Log every assertion (e.g. expect(button).not.toBeDisabled()) as a step */
const wrapAssertion = (assertion: unknown, path: string): unknown => {
  if (assertion === null || typeof assertion !== 'object') {
    return assertion;
  }
  const ctor = assertion.constructor;
  return new Proxy(assertion, {
    get(target, property) {
      const value = Reflect.get(target, property);
      // resolves/rejects return promises; errors from them surface as ordinary test failures
      if (typeof property !== 'string' || property === 'resolves' || property === 'rejects') {
        return value;
      }
      if (typeof value === 'function') {
        return (...args: unknown[]) =>
          logStep(
            () => `${path}.${property}(${args.map(describeValue).join(', ')})`,
            () => (value as AnyFunction).apply(target, args),
          );
      }
      if (value !== null && typeof value === 'object' && value.constructor === ctor) {
        return wrapAssertion(value, `${path}.${property}`);
      }
      return value;
    },
  });
};

export const createLoggingExpect = <T extends (...args: unknown[]) => unknown>(expect: T): T =>
  new Proxy(expect, {
    apply(target, thisArg, args: unknown[]) {
      return wrapAssertion(Reflect.apply(target, thisArg, args), `expect(${describeValue(args[0])})`);
    },
  });
