import { useSyncExternalStore } from 'react';
import {
  type API,
  experimental_getStatusStore,
  experimental_UniversalStore,
  experimental_useUniversalStore,
} from 'storybook/manager-api';
import type { Status, StatusValue } from 'storybook/internal/types';

import {
  ADDON_ID,
  CANCEL,
  DEBUG_PAUSED,
  EXIT_TEST_VIEW,
  type ErrorInfo,
  FILE_ERROR,
  RUN,
  type RunRequest,
  type RunSelection,
  RUN_FINISHED,
  type RunFinished,
  RUN_STARTED,
  type SpecFile,
  type SpecIndexState,
  type SnapshotShown,
  SNAPSHOT_SHOWN,
  STATUS_TYPE_ID,
  type StaticTest,
  STEP,
  STEP_CONTINUE,
  STEP_NEXT,
  type StepInfo,
  TEST_FINISHED,
  TEST_STARTED,
  type TestResultFromPreview,
  type TestStarted,
  TEST_VIEW_EXITED,
  SHOW_SNAPSHOT,
} from '../shared/types.ts';

// ---------- Index from the Storybook server ----------

const indexStore = experimental_UniversalStore.create<SpecIndexState>({
  id: ADDON_ID,
  leader: false,
  initialState: { specFiles: [] },
});

export const useSpecFiles = () => experimental_useUniversalStore(indexStore)[0].specFiles;

// ---------- Results from the preview ----------

export type TestResult = TestResultFromPreview & { storyIds: string[] };

export type ResultState = {
  results: Record<string, TestResult>;
  fileErrors: Record<string, ErrorInfo[]>;
  run?: { runId: number; selection: RunSelection; started: boolean; currentTest?: TestStarted; completed: number };
  lastRun?: RunFinished & { finishedAt: number };
  /** The canvas shows what the tests rendered instead of the story */
  testView?: { storyId?: string; lastTest?: RunFinished['lastTest'] };
  /** The steps (interactions and assertions) from the latest run of each test */
  steps: Record<string, StepInfo[]>;
  stepByStep?: { selection: SingleTestSelection; key?: string };
  /** The canvas is showing a DOM snapshot from an earlier step instead of the live DOM */
  snapshot?: { key: string; number: number };
  /** A run that stops in DevTools before the step that failed. `paused` is known once it got there or ended */
  debug?: { runId: number; testName: string[]; step: number; paused?: boolean; label?: string };
};

type SingleTestSelection = Extract<RunSelection, { type: 'test' }>;

let state: ResultState = { results: {}, fileErrors: {}, steps: {} };
const listeners = new Set<() => void>();

const setState = (change: (s: ResultState) => ResultState) => {
  state = change(state);
  listeners.forEach(listener => listener());
};

export const useResults = () =>
  useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );

export const isTestInSelection = (selection: RunSelection, specFile: SpecFile, test: StaticTest) => {
  switch (selection.type) {
    case 'all':
      return true;
    case 'file':
      return selection.file === specFile.file;
    case 'test':
      return selection.file === specFile.file && selection.testId === test.id;
    case 'stories':
      return test.storyIds.some(id => selection.storyIds.includes(id));
  }
};

export const testsInSelection = (specFiles: SpecFile[], selection: RunSelection) =>
  specFiles
    .map(specFile => ({ specFile, tests: specFile.tests.filter(test => isTestInSelection(selection, specFile, test)) }))
    .filter(
      ({ specFile, tests }) => tests.length > 0 || (selection.type === 'file' && selection.file === specFile.file),
    );

export const isTestPending = (s: ResultState, specFile: SpecFile, test: StaticTest, result: TestResult[]) =>
  !!s.run && isTestInSelection(s.run.selection, specFile, test) && !result.some(r => r.runId === s.run?.runId);

export const summarize = (result: TestResult[]) => ({
  ok: result.filter(r => r.status === 'passed').length,
  failed: result.filter(r => r.status === 'failed').length,
  skipped: result.filter(r => r.status === 'skipped').length,
});

// ---------- Statuses in the sidebar ----------

const statusStore = experimental_getStatusStore(STATUS_TYPE_ID);

const toStatusValue = (result: TestResult[], hasFileError: boolean): StatusValue => {
  if (hasFileError || result.some(r => r.status === 'failed')) {
    return 'status-value:error';
  }
  return result.some(r => r.status === 'passed') ? 'status-value:success' : 'status-value:unknown';
};

const updateStatuses = (storyIds: Iterable<string>) => {
  const specFiles = indexStore.getState().specFiles;
  const allResults = Object.values(state.results);
  const statuses: Status[] = [];
  const withoutResults: string[] = [];
  for (const storyId of new Set(storyIds)) {
    const result = allResults.filter(r => r.storyIds.includes(storyId));
    const hasFileError = specFiles.some(
      f => f.storyIds.includes(storyId) && (state.fileErrors[f.file]?.length ?? 0) > 0,
    );
    if (result.length === 0 && !hasFileError) {
      withoutResults.push(storyId);
      continue;
    }
    const { ok, failed } = summarize(result);
    statuses.push({
      storyId,
      typeId: STATUS_TYPE_ID,
      value: toStatusValue(result, hasFileError),
      title: 'Spec-tests',
      description: hasFileError ? 'A spec file could not be run' : `${ok} passed, ${failed} failed`,
      sidebarContextMenu: false,
    });
  }
  if (withoutResults.length > 0) {
    statusStore.unset(withoutResults);
  }
  if (statuses.length > 0) {
    statusStore.set(statuses);
  }
};

// ---------- Communication with the preview ----------

let api: API | undefined;
let lastRunId = 0;

export const runTests = (
  selection: RunSelection,
  stepByStep?: { stopAtStep?: number },
  debug?: { key: string; step: number; testName: string[] },
) => {
  if (!api || state.run) {
    return;
  }
  const specFiles = indexStore.getState().specFiles;
  const selected = testsInSelection(specFiles, selection);
  // Time based, so the id keeps increasing even if the manager reloads while the preview lives on
  const runId = Math.max(Date.now(), lastRunId + 1);
  lastRunId = runId;
  const selectedTestIds = new Set(
    selected.flatMap(({ specFile, tests }) => tests.map(test => `${specFile.file}|${test.id}`)),
  );
  const shouldRemove = (result: TestResult) =>
    selection.type === 'all' ||
    (selection.type === 'file'
      ? result.file === selection.file
      : selectedTestIds.has(`${result.file}|${result.staticTestId}`));
  const filesInSelection = new Set(selected.map(({ specFile }) => specFile.file));
  const affectedStoryIds = selected.flatMap(({ specFile, tests }) =>
    selection.type === 'file' || selection.type === 'all' ? specFile.storyIds : tests.flatMap(test => test.storyIds),
  );

  setState(s => ({
    ...s,
    results: Object.fromEntries(Object.entries(s.results).filter(([, r]) => !shouldRemove(r))),
    fileErrors: Object.fromEntries(Object.entries(s.fileErrors).filter(([file]) => !filesInSelection.has(file))),
    run: { runId, selection, started: false, completed: 0 },
    stepByStep: stepByStep && selection.type === 'test' ? { selection } : undefined,
    debug: debug && selection.type === 'test' ? { runId, testName: debug.testName, step: debug.step } : undefined,
  }));
  statusStore.set(
    [...new Set(affectedStoryIds)].map(storyId => ({
      storyId,
      typeId: STATUS_TYPE_ID,
      value: 'status-value:pending' as const,
      title: 'Spec-tests',
      description: 'Running…',
      sidebarContextMenu: false,
    })),
  );

  const storyData = api.getCurrentStoryData();
  const request: RunRequest = {
    runId,
    storyId: storyData?.type === 'story' ? storyData.id : undefined,
    files: selected.map(({ specFile, tests }) => ({
      file: specFile.file,
      importPath: specFile.importPath,
      tests: specFile.tests.map(({ id, name }) => ({ id, name })),
      selectedTestIds: selection.type === 'all' || selection.type === 'file' ? undefined : tests.map(test => test.id),
    })),
    stepByStep: selection.type === 'test' ? stepByStep : undefined,
    debugAt: debug && selection.type === 'test' ? { key: debug.key, step: debug.step } : undefined,
  };
  // The preview may not have loaded yet, so repeat the request until the run starts (the preview ignores duplicates).
  const managerApi = api;
  managerApi.emit(RUN, request);
  const interval = setInterval(() => {
    if (state.run?.runId === runId && !state.run.started) {
      managerApi.emit(RUN, request);
    } else {
      clearInterval(interval);
    }
  }, 500);
  setTimeout(() => {
    if (!state.run?.started) {
      endRunLocally(runId, 'Could not reach the canvas. Open a story and try again.');
    }
  }, 10_000);
};

const endRunLocally = (runId: number, message: string) => {
  if (state.run?.runId !== runId) {
    return;
  }
  setState(s => ({ ...s, run: undefined, fileErrors: { ...s.fileErrors, '': [{ message }] } }));
};

export const cancel = () => {
  const runId = state.run?.runId;
  api?.emit(CANCEL);
  // If the preview reloaded in the middle of the run, no answer is coming
  if (runId !== undefined) {
    setTimeout(() => endRunLocally(runId, 'The run was cancelled'), 3000);
  }
};

export const showStoryAgain = () => api?.emit(EXIT_TEST_VIEW);

// ---------- Step by step ----------

let pendingRestart: { selection: SingleTestSelection; stopAtStep: number } | undefined;

export const runStepByStep = (selection: SingleTestSelection, stopAtStep = 1) => {
  if (state.run) {
    // A running test cannot be rewound, so it is re-run and paused at that step
    pendingRestart = { selection, stopAtStep };
    api?.emit(CANCEL);
  } else {
    runTests(selection, { stopAtStep });
  }
};

export const showSnapshot = (key: string, number: number) => api?.emit(SHOW_SNAPSHOT, { key, number });

export const hideSnapshot = () => api?.emit(SHOW_SNAPSHOT, { key: '', number: undefined });

/** One step forward: move through the snapshots, and run the steps once we are back at the live DOM */
export const nextStep = () => {
  const { snapshot, steps, stepByStep } = state;
  const key = stepByStep?.key;
  const paused = key ? steps[key]?.find(s => s.status === 'paused') : undefined;
  if (snapshot && paused && snapshot.number < paused.number) {
    const next = (steps[snapshot.key] ?? []).find(
      s => s.number > snapshot.number && s.hasSnapshot && s.number <= paused.number,
    );
    if (next) {
      showSnapshot(next.key, next.number);
      return;
    }
  }
  api?.emit(STEP_NEXT);
};

/** One step back: show the snapshot from the previous step, without re-running the test */
export const previousStep = () => {
  const { snapshot, steps, stepByStep } = state;
  const key = snapshot?.key ?? stepByStep?.key;
  const from = snapshot?.number ?? (key ? steps[key]?.find(s => s.status === 'paused')?.number : undefined);
  const previous = key && from ? (steps[key] ?? []).filter(s => s.number < from && s.hasSnapshot).at(-1) : undefined;
  if (previous) {
    showSnapshot(previous.key, previous.number);
  }
};

export const resumeWithoutPausing = () => api?.emit(STEP_CONTINUE);

export const closeStepByStep = () => {
  hideSnapshot();
  if (state.run && state.stepByStep) {
    api?.emit(STEP_CONTINUE);
  }
  setState(s => ({ ...s, stepByStep: undefined }));
};

// ---------- Debugging in DevTools ----------

/** Runs the test again and stops in DevTools just before the step where it failed */
export const debugTest = (result: TestResult) => {
  if (!result.staticTestId) {
    return;
  }
  const step = result.errors.find(error => error.step)?.step?.number ?? 0;
  runTests({ type: 'test', file: result.file, testId: result.staticTestId }, undefined, {
    key: result.key,
    step,
    testName: result.name,
  });
};

/** The most recent failed test that can be run on its own, preferring those that use the given story */
export const lastFailure = (storyId?: string) => {
  const failed = Object.values(state.results).filter(result => result.status === 'failed' && result.staticTestId);
  return failed.filter(result => storyId && result.storyIds.includes(storyId)).at(-1) ?? failed.at(-1);
};

export const debugLastFailure = (storyId?: string) => {
  const result = lastFailure(storyId);
  if (result && !state.run) {
    debugTest(result);
  }
};

export const closeDebug = () => setState(s => ({ ...s, debug: undefined }));

export const clearResults = () => {
  setState(s => ({ ...s, results: {}, fileErrors: {}, steps: {}, lastRun: undefined }));
  statusStore.unset();
};

export const connectToPreview = (managerApi: API) => {
  api = managerApi;

  managerApi.on(RUN_STARTED, ({ runId }: { runId: number }) => {
    if (state.run?.runId === runId) {
      const storyData = managerApi.getCurrentStoryData();
      setState(s => ({
        ...s,
        run: s.run && { ...s.run, started: true },
        testView: { storyId: storyData?.type === 'story' ? storyData.id : undefined },
      }));
    }
  });

  managerApi.on(TEST_STARTED, (started: TestStarted) => {
    if (state.run?.runId === started.runId) {
      setState(s => ({
        ...s,
        run: s.run && { ...s.run, currentTest: started },
        steps: { ...s.steps, [started.key]: [] },
        stepByStep: s.stepByStep && { ...s.stepByStep, key: started.key },
      }));
    }
  });

  managerApi.on(STEP, (step: StepInfo) => {
    if (state.run?.runId !== step.runId) {
      return;
    }
    setState(s => ({
      ...s,
      steps: {
        ...s.steps,
        [step.key]: [...(s.steps[step.key] ?? []).filter(existing => existing.number !== step.number), step].sort(
          (a, b) => a.number - b.number,
        ),
      },
    }));
  });

  managerApi.on(TEST_FINISHED, (result: TestResultFromPreview) => {
    // A run the manager already ended (after a cancel with no answer) can still report
    if (state.run?.runId !== result.runId) {
      return;
    }
    const specFile = indexStore.getState().specFiles.find(f => f.file === result.file);
    const storyIds = specFile?.tests.find(test => test.id === result.staticTestId)?.storyIds ?? [];
    setState(s => ({
      ...s,
      results: { ...s.results, [result.key]: { ...result, storyIds } },
      run: s.run && { ...s.run, completed: s.run.completed + 1 },
    }));
    updateStatuses(storyIds);
  });

  managerApi.on(FILE_ERROR, ({ runId, file, error }: { runId: number; file: string; error: ErrorInfo[] }) => {
    if (state.run?.runId !== runId) {
      return;
    }
    setState(s => ({ ...s, fileErrors: { ...s.fileErrors, [file]: [...(s.fileErrors[file] ?? []), ...error] } }));
  });

  managerApi.on(RUN_FINISHED, (finished: RunFinished) => {
    const run = state.run;
    if (run?.runId !== finished.runId) {
      return;
    }
    const specFiles = indexStore.getState().specFiles;
    const affectedStoryIds = testsInSelection(specFiles, run.selection).flatMap(({ specFile }) => specFile.storyIds);
    setState(s => ({
      ...s,
      run: undefined,
      lastRun: { ...finished, finishedAt: Date.now() },
      testView: s.testView && { ...s.testView, lastTest: finished.lastTest },
      // A debug run that never reached the step did not stop either
      debug: s.debug?.runId === finished.runId ? { ...s.debug, paused: s.debug.paused ?? false } : s.debug,
    }));
    updateStatuses(affectedStoryIds);
    if (pendingRestart) {
      const { selection, stopAtStep } = pendingRestart;
      pendingRestart = undefined;
      runTests(selection, { stopAtStep });
    }
  });

  managerApi.on(DEBUG_PAUSED, ({ runId, paused, label }: { runId: number; paused: boolean; label: string }) => {
    setState(s => (s.debug?.runId === runId ? { ...s, debug: { ...s.debug, paused, label } } : s));
  });

  managerApi.on(SNAPSHOT_SHOWN, ({ key, number }: SnapshotShown) => {
    setState(s => ({ ...s, snapshot: number === undefined ? undefined : { key, number } }));
  });

  managerApi.on(TEST_VIEW_EXITED, () => {
    setState(s => ({ ...s, testView: undefined }));
  });
};
