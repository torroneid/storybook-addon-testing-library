/**
 * vi.useFakeTimers and the other timer functions, on @sinonjs/fake-timers like in Vitest.
 * The fake clock replaces the timers on the preview's window, so the runtime keeps the real ones it needs.
 */
import { type Config, type FakeMethod, withGlobal } from '@sinonjs/fake-timers';

// Captured before a test can fake them: timeouts, durations and pauses must follow real time
export const realSetTimeout = globalThis.setTimeout.bind(globalThis);
export const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
export const realNow = performance.now.bind(performance);
export const realDateNow = Date.now;

type Clock = ReturnType<ReturnType<typeof withGlobal>['install']>;

export type FakeTimerConfig = Omit<Config, 'target'>;

const fakeTimers = withGlobal(globalThis);

let clock: Clock | undefined;
let fakingTime = false;
// A system time from vi.setSystemTime without fake timers, when only Date is faked
let fakingDate: Date | undefined;
let userConfig: FakeTimerConfig | undefined;

const checkFakeTimers = (clock: Clock | undefined): clock is Clock => {
  if (!fakingTime || !clock) {
    throw new Error(
      'A function to advance timers was called but the timers APIs are not mocked. Call `vi.useFakeTimers()` in the test file first.',
    );
  }
  return true;
};

/** Faked by default, like in Vitest; microtasks stay real so promises keep working */
const defaultToFake = () =>
  (Object.keys(fakeTimers.timers) as FakeMethod[]).filter(timer => timer !== 'nextTick' && timer !== 'queueMicrotask');

export const useFakeTimers = (config?: FakeTimerConfig) => {
  if (config) {
    userConfig = config;
  }
  const now = fakingDate ?? realDateNow();
  clock?.uninstall();
  fakingDate = undefined;
  let { toFake, toNotFake } = userConfig ?? {};
  if (toFake === undefined && toNotFake === undefined) {
    toFake = defaultToFake();
  } else if (toFake === undefined && toNotFake !== undefined) {
    toNotFake = [...new Set([...toNotFake, 'nextTick' as const, 'queueMicrotask' as const])];
  }
  clock = fakeTimers.install({
    now,
    ...userConfig,
    ...(toFake && { toFake }),
    ...(toNotFake && { toNotFake }),
    ignoreMissingTimers: true,
  });
  fakingTime = true;
};

export const useRealTimers = () => {
  clock?.uninstall();
  clock = undefined;
  fakingTime = false;
  fakingDate = undefined;
};

/** After each spec file, so the fake clock never stays in the canvas, and the next file starts like in Vitest */
export const resetTimers = () => {
  useRealTimers();
  userConfig = undefined;
};

export const isFakeTimers = () => fakingTime;

export const advanceTimersByTime = (ms: number) => {
  if (checkFakeTimers(clock)) {
    clock.tick(ms);
  }
};

export const advanceTimersByTimeAsync = async (ms: number) => {
  if (checkFakeTimers(clock)) {
    await clock.tickAsync(ms);
  }
};

export const advanceTimersToNextTimer = (steps = 1) => {
  if (checkFakeTimers(clock)) {
    for (let i = steps; i > 0; i--) {
      clock.next();
      // Fire all timers at this point: https://github.com/sinonjs/fake-timers/issues/250
      clock.tick(0);
      if (clock.countTimers() === 0) {
        break;
      }
    }
  }
};

export const advanceTimersToNextTimerAsync = async (steps = 1) => {
  if (checkFakeTimers(clock)) {
    for (let i = steps; i > 0; i--) {
      await clock.nextAsync();
      clock.tick(0);
      if (clock.countTimers() === 0) {
        break;
      }
    }
  }
};

export const advanceTimersToNextFrame = () => {
  if (checkFakeTimers(clock)) {
    clock.runToFrame();
  }
};

export const runAllTimers = () => {
  if (checkFakeTimers(clock)) {
    clock.runAll();
  }
};

export const runAllTimersAsync = async () => {
  if (checkFakeTimers(clock)) {
    await clock.runAllAsync();
  }
};

export const runOnlyPendingTimers = () => {
  if (checkFakeTimers(clock)) {
    clock.runToLast();
  }
};

export const runOnlyPendingTimersAsync = async () => {
  if (checkFakeTimers(clock)) {
    await clock.runToLastAsync();
  }
};

export const runAllTicks = () => {
  if (checkFakeTimers(clock)) {
    clock.runMicrotasks();
  }
};

export const clearAllTimers = () => {
  if (fakingTime) {
    clock?.reset();
  }
};

export const getTimerCount = () => (checkFakeTimers(clock) ? clock.countTimers() : 0);

export const setTimerTickMode = (mode: 'manual' | 'nextTimerAsync' | 'interval', interval?: number) => {
  if (checkFakeTimers(clock)) {
    if (mode === 'manual') {
      clock.setTickMode({ mode: 'manual' });
    } else if (mode === 'nextTimerAsync') {
      clock.setTickMode({ mode: 'nextAsync' });
    } else if (mode === 'interval') {
      clock.setTickMode({ mode: 'interval', delta: interval });
    } else {
      throw new Error(`Invalid tick mode: ${mode}`);
    }
  }
};

/** Without fake timers, only Date is faked, like in Vitest */
export const setSystemTime = (now?: string | number | Date) => {
  const date = now === undefined || now instanceof Date ? now : new Date(now);
  if (fakingTime) {
    clock?.setSystemTime(date);
    return;
  }
  fakingDate = date ?? new Date(realDateNow());
  if (clock) {
    clock.setSystemTime(fakingDate);
  } else {
    clock = fakeTimers.install({ now: fakingDate, toFake: ['Date', 'Temporal'], ignoreMissingTimers: true });
  }
};

export const getMockedSystemTime = () => (fakingTime && clock ? new Date(clock.now) : (fakingDate ?? null));

export const getRealSystemTime = () => realDateNow();
