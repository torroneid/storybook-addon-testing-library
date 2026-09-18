/**
 * Preview annotation that runs spec tests inside the Storybook canvas.
 * While tests run the story is hidden, and whatever the tests rendered stays in the canvas afterwards.
 */
import { STORY_CHANGED } from 'storybook/internal/core-events';
import { addons } from 'storybook/preview-api';
import { setupFiles } from 'virtual:storybook-addon-testing-library/setup';

import {
  CANCEL,
  EXIT_TEST_VIEW,
  FILE_ERROR,
  type RunRequest,
  RUN_FINISHED,
  type RunFinished,
  RUN,
  RUN_STARTED,
  resultKey,
  matchesStaticTest,
  SNAPSHOT_SHOWN,
  STEP_CONTINUE,
  STEP_NEXT,
  SHOW_SNAPSHOT,
  TEST_FINISHED,
  TEST_STARTED,
  type TestResultFromPreview,
  type TestStarted,
  TEST_VIEW_EXITED,
} from '../shared/types.ts';
import {
  resetTestDom,
  runFile,
  loadSetupFiles,
  markDomBeforeTests,
  collectFile,
  toErrorInfo,
  vitestApi,
} from './runtime.ts';
import { hideSnapshot, showSnapshot } from './snapshots.ts';
import { cancelStep, resumeWithoutPausing, nextStep, startStepRun } from './steps.ts';

type GlobalWithPreview = typeof globalThis & {
  __SPEC_TESTAR_VITEST__?: typeof vitestApi;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  __STORYBOOK_PREVIEW__?: { onForceRemount?: (args: { storyId: string }) => Promise<void> };
};
const g = globalThis as GlobalWithPreview;

// Must be set after @testing-library/react has loaded (through runtime.ts) so that it does not register
// its automatic cleanup after each test. That keeps the last test's DOM in the canvas.
g.__SPEC_TESTAR_VITEST__ = vitestApi;
for (const [name, value] of Object.entries(vitestApi)) {
  if (!(name in g)) {
    Object.defineProperty(g, name, { value: value, configurable: true, writable: true });
  }
}

const channel = addons.getChannel();

let hiddenStoryId: string | undefined;
let abortController: AbortController | undefined;
let setup: Promise<void> | undefined;

const remount = (storyId: string) => g.__STORYBOOK_PREVIEW__?.onForceRemount?.({ storyId });

const hideStory = async (storyId: string | undefined) => {
  if (!storyId || hiddenStoryId === storyId) {
    return;
  }
  hiddenStoryId = storyId;
  await remount(storyId);
};

const cancel = () => {
  abortController?.abort();
  cancelStep();
};

const emitSnapshotShown = (key: string, number?: number) => channel.emit(SNAPSHOT_SHOWN, { key, number });

const exitTestView = async ({ visStory }: { visStory: boolean }) => {
  cancel();
  hideSnapshot();
  emitSnapshotShown('');
  resetTestDom();
  const storyId = hiddenStoryId;
  hiddenStoryId = undefined;
  if (storyId && visStory) {
    await remount(storyId);
  }
  channel.emit(TEST_VIEW_EXITED);
};

let lastRunId = 0;

const run = async ({ runId, storyId, files, stepByStep }: RunRequest) => {
  // The manager repeats the request until the run has started
  if (runId <= lastRunId || (abortController && !abortController.signal.aborted)) {
    return;
  }
  lastRunId = runId;
  const controller = new AbortController();
  abortController = controller;
  const previousActEnvironment = g.IS_REACT_ACT_ENVIRONMENT;
  let lastTest: RunFinished['lastTest'];
  startStepRun(runId, stepByStep);
  channel.emit(RUN_STARTED, { runId });

  try {
    await hideStory(storyId);
    markDomBeforeTests();
    g.IS_REACT_ACT_ENVIRONMENT = true;
    setup ??= loadSetupFiles(setupFiles).catch(error => {
      setup = undefined;
      throw error;
    });
    await setup;

    for (const file of files) {
      if (controller.signal.aborted) {
        break;
      }
      const toTestStarted = (name: string[]): TestStarted => ({
        runId,
        key: resultKey(file.file, name),
        file: file.file,
        staticTestId: file.tests.find(test => matchesStaticTest(test, name))?.id,
        name,
      });
      try {
        const root = await collectFile(file.importPath);
        await runFile(root, {
          signal: controller.signal,
          key: name => resultKey(file.file, name),
          isSelected: name =>
            !file.selectedTestIds || file.selectedTestIds.includes(toTestStarted(name).staticTestId ?? ''),
          reporter: {
            testStarted: name => channel.emit(TEST_STARTED, toTestStarted(name)),
            testFinished: (name, status, durationMs, errors) => {
              const result: TestResultFromPreview = { ...toTestStarted(name), status, durationMs, errors };
              channel.emit(TEST_FINISHED, result);
              if (status !== 'skipped') {
                lastTest = { key: result.key, name };
              }
            },
          },
        });
      } catch (error) {
        channel.emit(FILE_ERROR, { runId, file: file.file, error: [toErrorInfo(error)] });
      }
    }
  } catch (error) {
    channel.emit(FILE_ERROR, { runId, file: '', error: [toErrorInfo(error)] });
  } finally {
    startStepRun(runId, undefined);
    g.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    const finished: RunFinished = { runId, cancelled: controller.signal.aborted, lastTest };
    controller.abort();
    channel.emit(RUN_FINISHED, finished);
  }
};

channel.on(RUN, (request: RunRequest) => {
  run(request).catch(() => undefined);
});
channel.on(CANCEL, cancel);
channel.on(STEP_NEXT, () => {
  hideSnapshot();
  emitSnapshotShown('');
  nextStep();
});
channel.on(SHOW_SNAPSHOT, ({ key, number }: { key: string; number?: number }) => {
  if (number === undefined) {
    hideSnapshot();
    emitSnapshotShown('');
  } else {
    emitSnapshotShown(key, showSnapshot(key, number) ? number : undefined);
  }
});
channel.on(STEP_CONTINUE, () => {
  hideSnapshot();
  emitSnapshotShown('');
  resumeWithoutPausing();
});
channel.on(EXIT_TEST_VIEW, () => {
  exitTestView({ visStory: true }).catch(() => undefined);
});
channel.on(STORY_CHANGED, () => {
  if (hiddenStoryId) {
    exitTestView({ visStory: false }).catch(() => undefined);
  }
});

/** Hides the story while the canvas shows what the tests rendered, so tests cannot match the story's elements */
export const decorators = [
  (Story: () => unknown, context: { id: string; viewMode: string }) =>
    context.viewMode === 'story' && context.id === hiddenStoryId ? null : Story(),
];
