import { onTestFinished, test, type TestContext } from '../../src/preview/runtime.ts';

// collectFile imports a fresh copy of this module every time, so the test reads what happened from globalThis
const seen: { aborted?: boolean; reason?: unknown } = {};
(globalThis as { timeoutFixture?: typeof seen }).timeoutFixture = seen;

test(
  'never finishes',
  ({ signal }: TestContext) =>
    new Promise(() => {
      signal.addEventListener('abort', () => {
        seen.aborted = true;
        seen.reason = signal.reason;
      });
    }),
  50,
);

test('runs afterwards', () => {
  onTestFinished(() => undefined);
});
