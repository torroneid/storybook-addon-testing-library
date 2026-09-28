import { test, vitestApi } from '../../src/preview/runtime.ts';

type Vi = {
  useFakeTimers: () => Vi;
  useRealTimers: () => Vi;
  advanceTimersByTime: (ms: number) => Vi;
  advanceTimersByTimeAsync: (ms: number) => Promise<Vi>;
  setSystemTime: (time: Date) => Vi;
  isFakeTimers: () => boolean;
};
const vi = vitestApi.vi as unknown as Vi;
const { expect } = vitestApi;

test('advances fake time', async () => {
  let fired = 0;
  vi.useFakeTimers();
  setTimeout(() => fired++, 1000);
  vi.advanceTimersByTime(999);
  expect(fired).toBe(0);
  // Resolves to vi, like in Vitest
  expect((await vi.advanceTimersByTimeAsync(1)) === vi).toBe(true);
  expect(fired).toBe(1);
  vi.useRealTimers();
  expect(vi.isFakeTimers()).toBe(false);
});

test('fakes the date', () => {
  vi.useFakeTimers().setSystemTime(new Date('2020-02-02T12:00:00Z'));
  expect(new Date().getUTCFullYear()).toBe(2020);
});

test('times out on real time while the timers are fake', () => {
  vi.useFakeTimers();
  return new Promise(() => undefined);
}, 50);

// The runtime restores the timers after the file
test('leaves the timers fake', () => {
  vi.useFakeTimers();
});
