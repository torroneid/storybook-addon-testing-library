// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, convert, themes } from 'storybook/theming';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorView } from '../src/manager/components.tsx';
import { showSnapshot } from '../src/manager/store.ts';
import type { ErrorInfo } from '../src/shared/types.ts';

vi.mock('../src/manager/store.ts', () => ({ showSnapshot: vi.fn() }));

const error: ErrorInfo = {
  message: 'Values differ\nFull diagnostic details',
  origin: 'assertion',
  comparison: { expected: '3', actual: '2' },
  step: { number: 4, label: 'expect(count).toBe(3)', failed: true },
  codeFrame: {
    file: './Counter.spec.ts',
    line: 10,
    column: 3,
    lines: [{ number: 10, text: '  expect(count).toBe(3);' }],
  },
  frames: [{ file: './Counter.spec.ts', line: 10, column: 3, library: false }],
};

const show = () =>
  render(
    React.createElement(ThemeProvider, {
      theme: convert(themes.light),
      children: React.createElement(ErrorView, { error: [error], testKey: 'counter', testName: 'increments' }),
    }),
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('error details', () => {
  it('shows comparison and source while keeping full diagnostics collapsed', () => {
    show();
    expect(screen.getByText('Expected')).toBeTruthy();
    expect(screen.getByText('Received')).toBeTruthy();
    expect(screen.getByText('./Counter.spec.ts:10:3')).toBeTruthy();
    expect(screen.getByText('Full error message').closest('details')?.open).toBe(false);
    expect(screen.getByText('Stack trace').closest('details')?.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'expect(count).toBe(3)' }));
    expect(showSnapshot).toHaveBeenCalledWith('counter', 4);
  });

  it('copies a report with the test, full message, comparison, step and source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Copy error report' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    const report = writeText.mock.calls[0][0];
    for (const text of [
      'Test: increments',
      error.message,
      'Expected:\n3',
      'Received:\n2',
      'Step 4:',
      './Counter.spec.ts:10:3',
    ]) {
      expect(report).toContain(text);
    }
  });

  it('offers selectable text when clipboard access is denied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Copy error report' }));
    const text = (await screen.findByRole('textbox', { name: 'Error report' })) as HTMLTextAreaElement;
    expect(text.value).toContain(error.message);
    expect(text.readOnly).toBe(true);
  });
});
