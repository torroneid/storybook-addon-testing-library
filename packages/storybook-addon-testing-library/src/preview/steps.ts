/**
 * Step by step: tests pause before every async interaction (userEvent, findBy, waitFor, story.run()),
 * while sync calls (render, fireEvent, expect) are only logged. The state lives on globalThis so that the
 * wrappers around @testing-library and the 'vitest' replacement always share one controller.
 */
import { addons } from 'storybook/preview-api';

import { DEBUG_PAUSED, STEP, type StepInfo, type StepStatus } from '../shared/types.ts';
import { stripAnsi, display } from './formatName.ts';
import { forgetSnapshotsFor, hasSnapshot, hideSnapshot, takeSnapshot } from './snapshots.ts';
import { realNow } from './timers.ts';

export class CancelledError extends Error {
  constructor() {
    super('The run was cancelled');
    this.name = 'CancelledError';
  }
}

type Step = { number: number; label: string; failed: boolean };

type Controller = {
  active: boolean;
  stopAtStep: number;
  runId: number;
  key: string;
  number: number;
  /** > 0 while a step is running, so nested calls (e.g. expect inside waitFor) do not become steps */
  depth: number;
  waiting?: { resume: () => void; reject: (error: Error) => void };
  /** The latest step in the current test, so an error can say where it happened */
  lastStep?: Step;
  /** A debug run: stop in DevTools before this step (0: before the test) of the test with this key, and never time out */
  breakAt?: { key: string; step: number };
  debugging: boolean;
};

const g = globalThis as typeof globalThis & { __TESTING_LIBRARY_ADDON_STEPS__?: Controller };
const control: Controller = (g.__TESTING_LIBRARY_ADDON_STEPS__ ??= {
  active: false,
  stopAtStep: 1,
  runId: 0,
  key: '',
  number: 0,
  depth: 0,
  debugging: false,
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

/** The test waits for the user, in step-by-step mode or in DevTools, so it must not time out */
export const waitsForUser = () => control.active || control.debugging;

export const startStepRun = (
  runId: number,
  stepByStep: { stopAtStep?: number } | undefined,
  debugAt?: { key: string; step: number },
) => {
  hideSnapshot();
  control.active = !!stepByStep;
  control.stopAtStep = stepByStep?.stopAtStep ?? 1;
  control.runId = runId;
  control.key = '';
  control.breakAt = debugAt;
  control.debugging = debugAt !== undefined;
};

export const lastStep = () => control.lastStep;

const breaksAt = (number: number) => control.breakAt?.key === control.key && control.breakAt.step === number;

let pause = () => {
  debugger;
};

/** The preview passes the function from the virtual debugger module (see preset.ts), which DevTools does not skip */
export const setDebuggerStatement = (statement: () => void) => {
  pause = statement;
};

/** Stops in DevTools, if it is open, and tells the manager whether it did */
const pauseInDevTools = (label: string) => {
  control.breakAt = undefined;
  const start = realNow();
  pause();
  // Nothing measurable passes unless DevTools stopped
  const paused = realNow() - start > 100;
  addons.getChannel().emit(DEBUG_PAUSED, { runId: control.runId, paused, label });
};

/** In a debug run that should stop before the first step */
export const pauseBeforeTest = () => {
  if (breaksAt(0)) {
    pauseInDevTools('the start of the test');
  }
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
  control.lastStep = undefined;
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
  const text = label();
  const step: Step = (control.lastStep = { number, label: text, failed: false });
  takeSnapshot(control.key, number, undefined);
  if (breaksAt(number)) {
    pauseInDevTools(text);
  }
  try {
    const result = execute();
    send(number, text, false, 'ok');
    return result;
  } catch (error) {
    step.failed = true;
    send(number, text, false, 'failed', error);
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
  const text = label();
  const step: Step = (control.lastStep = { number, label: text, failed: false });
  takeSnapshot(control.key, number, element);
  if (control.active && number >= control.stopAtStep) {
    send(number, text, true, 'paused');
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
  if (breaksAt(number)) {
    pauseInDevTools(text);
  }
  send(number, text, true, 'running');
  control.depth++;
  try {
    const result = await execute();
    send(number, text, true, 'ok');
    return result;
  } catch (error) {
    step.failed = true;
    send(number, text, true, 'failed', error);
    throw error;
  } finally {
    control.depth--;
  }
};
