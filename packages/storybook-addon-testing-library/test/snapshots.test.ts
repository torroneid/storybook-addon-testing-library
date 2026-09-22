// @vitest-environment jsdom
import * as rrweb from 'rrweb-snapshot';
import { describe, expect, it, vi } from 'vitest';

import { hasSnapshot, takeSnapshot } from '../src/preview/snapshots.ts';

vi.mock('rrweb-snapshot', async importOriginal => {
  const original = await importOriginal<typeof import('rrweb-snapshot')>();
  return { ...original, snapshot: vi.fn(original.snapshot) };
});

describe('takeSnapshot', () => {
  it('takes a new snapshot only when the DOM has changed', () => {
    const snapshot = vi.mocked(rrweb.snapshot);
    const input = document.createElement('input');

    takeSnapshot('test', 1, undefined);
    takeSnapshot('test', 2, undefined);
    expect(snapshot).toHaveBeenCalledTimes(1);

    // In the same task, before the MutationObserver has reported it
    document.body.append(input);
    takeSnapshot('test', 3, input);
    expect(snapshot).toHaveBeenCalledTimes(2);

    // Typing changes the value property, not an attribute
    input.value = 'ada';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    takeSnapshot('test', 4, input);
    expect(snapshot).toHaveBeenCalledTimes(3);

    expect([1, 2, 3, 4].map(number => hasSnapshot('test', number))).toEqual([true, true, true, true]);
  });
});
