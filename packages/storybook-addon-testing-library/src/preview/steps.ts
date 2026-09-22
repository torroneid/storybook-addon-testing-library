/**
 * Step by step: tests pause before every async interaction (userEvent, findBy, waitFor, story.run()),
 * while sync calls (render, fireEvent, expect) are only logged. The state lives on globalThis so that the
 * wrappers around @testing-library and the 'vitest' replacement always share one controller.
 */
import { addons } from 'storybook/preview-api';

import { STEP, type StepInfo, type StepStatus } from '../shared/types.ts';
import { stripAnsi, display } from './formatName.ts';
import { forgetSnapshotsFor, hasSnapshot, hideSnapshot, takeSnapshot } from './snapshots.ts';

export class CancelledError extends Error {
  constructor() {
    super('The run was cancelled');
    this.name = 'CancelledError';
  }
}

type Controller = {
  active: boolean;
  stopAtStep: number;
  runId: number;
  key: string;
  number: number;
  /** > 0 while a step is running, so nested calls (e.g. expect inside waitFor) do not become steps */
  depth: number;
  waiting?: { resume: () => void; reject: (error: Error) => void };
};

const g = globalThis as typeof globalThis & { __TESTING_LIBRARY_ADDON_STEPS__?: Controller };
const control: Controller = (g.__TESTING_LIBRARY_ADDON_STEPS__ ??= {
  active: false,
  stopAtStep: 1,
  runId: 0,
  key: '',
  number: 0,
  depth: 0,
});

const send = (number: number, label: string, pausable: boolean, status: StepStatus, error?: unknown) => {
  const step: StepInfo = {
    runId: control.runId,
    key: control.key,
    number,
    label,
    pausable,
    status,
    hasSnapshot: hasSnapshot(control.key, number),
    error: error === undefined ? undefined : stripAnsi(error instanceof Error ? error.message : display(error)),
  };
  addons.getChannel().emit(STEP, step);
};

export const stepModeActive = () => control.active;

export const startStepRun = (runId: number, stepByStep: { stopAtStep?: number } | undefined) => {
  hideSnapshot();
  control.active = !!stepByStep;
  control.stopAtStep = stepByStep?.stopAtStep ?? 1;
  control.runId = runId;
  control.key = '';
};

export const cancelStep = () => {
  control.active = false;
  control.waiting?.reject(new CancelledError());
  control.waiting = undefined;
};

export const startTestSteps = (key: string) => {
  forgetSnapshotsFor(key);
  control.key = key;
  control.number = 0;
  control.depth = 0;
};

export const endTestSteps = () => {
  control.key = '';
};

export const nextStep = () => {
  control.waiting?.resume();
};

export const resumeWithoutPausing = () => {
  control.active = false;
  control.waiting?.resume();
};

export const describeValue = (value: unknown): string => {
  if (typeof Element !== 'undefined' && value instanceof Element) {
    const tag = value.tagName.toLowerCase();
    const name =
      value.getAttribute('aria-label') ??
      (value as HTMLInputElement).labels?.[0]?.textContent ??
      value.getAttribute('placeholder') ??
      value.textContent;
    const short = name?.replace(/\s+/g, ' ').trim().slice(0, 40);
    return short ? `${tag} "${short}"` : tag;
  }
  if (typeof value === 'string') {
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  }
  if (typeof value === 'function') {
    return value.name ? `${value.name}` : '() => …';
  }
  if (value !== null && typeof value === 'object') {
    const asymmetric = value as { asymmetricMatch?: unknown; toAsymmetricMatcher?: () => string };
    if (typeof asymmetric.asymmetricMatch === 'function') {
      return asymmetric.toAsymmetricMatcher?.() ?? String(value);
    }
    const text = stripAnsi(display(value));
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }
  return String(value);
};

/** Log a synchronous call as a step. Errors are rethrown. */
export const logStep = <T>(label: () => string, execute: () => T): T => {
  if (control.depth > 0 || !control.key) {
    return execute();
  }
  const number = ++control.number;
  takeSnapshot(control.key, number, undefined);
  try {
    const result = execute();
    send(number, label(), false, 'ok');
    return result;
  } catch (error) {
    send(number, label(), false, 'failed', error);
    throw error;
  }
};

const highlight = (element: Element | undefined) => {
  if (typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) {
    return () => undefined;
  }
  const { outline, outlineOffset } = element.style;
  element.style.outline = '3px solid #ff4785';
  element.style.outlineOffset = '2px';
  element.scrollIntoView?.({ block: 'nearest' });
  return () => {
    element.style.outline = outline;
    element.style.outlineOffset = outlineOffset;
  };
};

/** An async step. In step-by-step mode it waits for the user before running. */
export const pausableStep = async <T>(
  label: () => string,
  element: Element | undefined,
  execute: () => Promise<T>,
): Promise<T> => {
  if (control.depth > 0 || !control.key) {
    return execute();
  }
  const number = ++control.number;
  takeSnapshot(control.key, number, element);
  if (control.active && number >= control.stopAtStep) {
    send(number, label(), true, 'paused');
    // The highlight is removed before the action, so it cannot affect the test
    const removeHighlight = highlight(element);
    try {
      await new Promise<void>((resume, reject) => {
        control.waiting = { resume, reject };
      });
    } finally {
      control.waiting = undefined;
      removeHighlight();
    }
  }
  // If the user is looking at an earlier step, bring the canvas back to the live DOM first
  hideSnapshot();
  send(number, label(), true, 'running');
  control.depth++;
  try {
    const result = await execute();
    send(number, label(), true, 'ok');
    return result;
  } catch (error) {
    send(number, label(), true, 'failed', error);
    throw error;
  } finally {
    control.depth--;
  }
};
