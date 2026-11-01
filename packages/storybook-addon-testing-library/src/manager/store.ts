import { useSyncExternalStore } from 'react';
import {
  type API,
  experimental_getStatusStore,
  experimental_UniversalStore,
  experimental_useUniversalStore,
  internal_universalStatusStore,
} from 'storybook/manager-api';
import type { Status, StatusValue } from 'storybook/internal/types';

import {
  ADDON_ID,
  CANCEL,
  EXIT_TEST_VIEW,
  LOG_FRAME,
  LOG_TEST_LOCATION,
  type CodeFrame,
  type ErrorInfo,
  FILE_ERROR,
  FILES_CHANGED,
  type FilesChanged,
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
  type StackFrame,
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
  /** When source files last changed. Results from runs that started before are out of date. */
  codeChangedAt?: number;
  /** Re-run the open story's tests when source files change */
  watch: boolean;
  /** List only the tests that failed */
  onlyFailed: boolean;
};

type SingleTestSelection = Extract<RunSelection, { type: 'test' }>;

// ---------- Kept across reloads of the page ----------

// Results for this tab, so they survive a reload of Storybook. Settings are kept for every tab.
const RESULTS_KEY = `${ADDON_ID}/results`;
const SETTINGS_KEY = `${ADDON_ID}/settings`;

type SavedResults = Pick<ResultState, 'results' | 'fileErrors' | 'steps' | 'lastRun' | 'codeChangedAt'>;
type Settings = Pick<ResultState, 'watch' | 'onlyFailed'>;

const read = <T>(storage: () => Storage, key: string): Partial<T> => {
  try {
    return JSON.parse(storage().getItem(key) ?? '{}') as Partial<T>;
  } catch {
    return {};
  }
};

const write = (storage: () => Storage, key: string, value: unknown) => {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; the results are then only kept until the page reloads
  }
};

const restore = (): ResultState => {
  const saved = read<SavedResults>(() => sessionStorage, RESULTS_KEY);
  const settings = read<Settings>(() => localStorage, SETTINGS_KEY);
  // The preview reloads with the page, so the DOM snapshots it kept are gone
  const steps = Object.fromEntries(
    Object.entries(saved.steps ?? {}).map(([key, list]) => [key, list.map(s => ({ ...s, hasSnapshot: false }))]),
  );
  return {
    results: saved.results ?? {},
    fileErrors: saved.fileErrors ?? {},
    steps,
    lastRun: saved.lastRun,
    codeChangedAt: saved.codeChangedAt,
    watch: settings.watch ?? false,
    onlyFailed: settings.onlyFailed ?? false,
  };
};

let state: ResultState = restore();
const listeners = new Set<() => void>();

let saveTimeout: ReturnType<typeof setTimeout> | undefined;
const save = () => {
  clearTimeout(saveTimeout);
  // Steps arrive one by one during a run, so writes are batched
  saveTimeout = setTimeout(() => {
    const { results, fileErrors, steps, lastRun, codeChangedAt, watch, onlyFailed } = state;
    write(() => sessionStorage, RESULTS_KEY, { results, fileErrors, steps, lastRun, codeChangedAt });
    write(() => localStorage, SETTINGS_KEY, { watch, onlyFailed });
  }, 500);
};

const setState = (change: (s: ResultState) => ResultState) => {
  state = change(state);
  listeners.forEach(listener => listener());
  save();
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
    case 'tests':
      return selection.tests.some(t => t.file === specFile.file && t.testId === test.id);
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

/** The result is from a run that started before source files last changed */
export const isStale = (s: Pick<ResultState, 'codeChangedAt'>, result: TestResult) =>
  s.codeChangedAt !== undefined && result.runId < s.codeChangedAt;

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

export const runTests = (selection: RunSelection, stepByStep?: { stopAtStep?: number }) => {
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

/** Logs a frame of a stack in the preview's console, where DevTools links it to the source file */
export const logFrameInConsole = (frame: StackFrame | CodeFrame) => api?.emit(LOG_FRAME, frame);

/** Logs where a test is in its spec file in the preview's console, where DevTools links it to Sources */
export const logTestLocation = (specFile: SpecFile, test: StaticTest) =>
  api?.emit(LOG_TEST_LOCATION, {
    importPath: specFile.importPath,
    file: specFile.file,
    line: test.line,
    name: test.name.map(part => part.text).join(' › '),
  });

// ---------- Failures ----------

/** The tests that failed, once each (an it.each gives several results for one test), optionally for one story */
export const failedTests = (s: ResultState, storyId?: string) => {
  const tests = new Map<string, { file: string; testId: string }>();
  for (const result of Object.values(s.results)) {
    if (result.status === 'failed' && result.staticTestId && (!storyId || result.storyIds.includes(storyId))) {
      tests.set(`${result.file}|${result.staticTestId}`, { file: result.file, testId: result.staticTestId });
    }
  }
  return [...tests.values()];
};

export const rerunFailed = (storyId?: string) => {
  const tests = failedTests(state, storyId);
  if (tests.length > 0) {
    runTests({ type: 'tests', tests });
  }
};

/** The stories with failed tests, in the order of the spec files and the tests in them */
export const failingStoryIds = (s: ResultState) => {
  const failed = Object.values(s.results).filter(r => r.status === 'failed');
  const ids: string[] = [];
  for (const specFile of indexStore.getState().specFiles) {
    for (const test of specFile.tests) {
      if (failed.some(r => r.file === specFile.file && r.staticTestId === test.id)) {
        ids.push(...test.storyIds.filter(id => !ids.includes(id)));
      }
    }
  }
  return ids;
};

/** The next story with a failed test after this one, starting over at the first */
export const nextFailingStory = (s: ResultState, currentStoryId?: string) => {
  const ids = failingStoryIds(s);
  const index = currentStoryId ? ids.indexOf(currentStoryId) : -1;
  return ids[(index + 1) % ids.length];
};

// ---------- Settings ----------

export const setWatch = (watch: boolean) => setState(s => ({ ...s, watch }));

export const setOnlyFailed = (onlyFailed: boolean) => setState(s => ({ ...s, onlyFailed }));

// ---------- Re-running when the code changes ----------

let watchTimeout: ReturnType<typeof setTimeout> | undefined;
let watchRunPending = false;

/** Runs the open story's tests again, after a change, once no run is going on */
const runWatched = () => {
  const story = api?.getCurrentStoryData();
  if (!state.watch || story?.type !== 'story') {
    return;
  }
  if (state.run) {
    watchRunPending = true;
    return;
  }
  watchRunPending = false;
  const hasTests = indexStore.getState().specFiles.some(f => f.tests.some(t => t.storyIds.includes(story.id)));
  if (hasTests) {
    runTests({ type: 'stories', storyIds: [story.id] });
  }
};

export const clearResults = () => {
  setState(s => ({ ...s, results: {}, fileErrors: {}, steps: {}, lastRun: undefined }));
  statusStore.unset();
};

export const connectToPreview = (managerApi: API) => {
  api = managerApi;
  // The results kept from before the reload show in the sidebar too, once its status store can take them
  internal_universalStatusStore
    .untilReady()
    .then(() => updateStatuses(Object.values(state.results).flatMap(r => r.storyIds)))
    .catch(() => undefined);

  managerApi.on(FILES_CHANGED, (_changed: FilesChanged) => {
    setState(s => ({ ...s, codeChangedAt: Date.now() }));
    if (state.watch) {
      // The index of spec files updates after a change too, so wait for it
      clearTimeout(watchTimeout);
      watchTimeout = setTimeout(runWatched, 500);
    }
  });

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
    }));
    updateStatuses(affectedStoryIds);
    if (pendingRestart) {
      const { selection, stopAtStep } = pendingRestart;
      pendingRestart = undefined;
      runTests(selection, { stopAtStep });
    } else if (watchRunPending) {
      runWatched();
    }
  });

  managerApi.on(SNAPSHOT_SHOWN, ({ key, number }: SnapshotShown) => {
    setState(s => ({ ...s, snapshot: number === undefined ? undefined : { key, number } }));
  });

  managerApi.on(TEST_VIEW_EXITED, () => {
    setState(s => ({ ...s, testView: undefined }));
  });
};
