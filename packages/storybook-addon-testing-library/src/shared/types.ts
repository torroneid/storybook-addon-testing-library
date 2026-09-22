export const ADDON_ID = 'storybook-addon-testing-library';
export const PANEL_ID = `${ADDON_ID}/panel`;
export const TEST_PROVIDER_ID = `${ADDON_ID}/test-provider`;
export const STATUS_TYPE_ID = `${ADDON_ID}/status`;

/** Manager → preview */
export const RUN = `${ADDON_ID}/run`;
export const CANCEL = `${ADDON_ID}/cancel`;
export const EXIT_TEST_VIEW = `${ADDON_ID}/exit-test-view`;

/** Preview → manager */
export const RUN_STARTED = `${ADDON_ID}/run-started`;
export const TEST_STARTED = `${ADDON_ID}/test-started`;
export const TEST_FINISHED = `${ADDON_ID}/test-finished`;
export const FILE_ERROR = `${ADDON_ID}/file-error`;
export const RUN_FINISHED = `${ADDON_ID}/run-finished`;
export const TEST_VIEW_EXITED = `${ADDON_ID}/test-view-exited`;

/** Step by step */
export const STEP = `${ADDON_ID}/step`;
export const STEP_NEXT = `${ADDON_ID}/step-next`;
export const STEP_CONTINUE = `${ADDON_ID}/step-continue`;
export const SHOW_SNAPSHOT = `${ADDON_ID}/show-snapshot`;
export const SNAPSHOT_SHOWN = `${ADDON_ID}/snapshot-shown`;

export const VIRTUAL_SETUP_MODULE = 'virtual:storybook-addon-testing-library/setup';

export type StoryReference = {
  /** Absolute path to the stories file */
  storiesFile: string;
  exportName: string;
};

export type NamePart = {
  text: string;
  /** Regex source matching the name as formatted at runtime, or null when it cannot be determined statically */
  pattern: string | null;
};

export type StaticTest = {
  id: string;
  name: NamePart[];
  line: number;
  /** Declared with .each/.for, so it can produce several results */
  isTemplate: boolean;
  storyIds: string[];
};

export type SpecFile = {
  /** Path relative to the working directory, e.g. ./src/LoginForm/LoginForm.spec.tsx */
  file: string;
  /** URL that Storybook's Vite server can import the file from */
  importPath: string;
  tests: StaticTest[];
  /** Every story in the stories files the spec imports, or in the stories file with the same name */
  storyIds: string[];
  analysisError?: string;
};

export type SpecIndexState = {
  specFiles: SpecFile[];
};

export type ErrorInfo = {
  message: string;
  stack?: string;
  diff?: string;
};

export type TestStatus = 'passed' | 'failed' | 'skipped';

export type RunSelection =
  | { type: 'all' }
  | { type: 'stories'; storyIds: string[] }
  | { type: 'file'; file: string }
  | { type: 'test'; file: string; testId: string };

export type RunRequest = {
  runId: number;
  /** The story open in the canvas. It is hidden while the tests render their own content. */
  storyId?: string;
  files: Array<{
    file: string;
    importPath: string;
    tests: Array<Pick<StaticTest, 'id' | 'name'>>;
    /** When set, only tests with these ids are run */
    selectedTestIds?: string[];
  }>;
  /** Run step by step: pause before every interaction, starting at step `stopAtStep` (1-based) */
  stepByStep?: { stopAtStep?: number };
};

export type StepStatus = 'paused' | 'running' | 'ok' | 'failed';

export type StepInfo = {
  runId: number;
  key: string;
  number: number;
  label: string;
  /** Pausable steps are async interactions (userEvent, findBy, waitFor, story.run()). Others are only logged. */
  pausable: boolean;
  status: StepStatus;
  error?: string;
  /** A DOM snapshot from just before the step exists, and can be shown in the canvas */
  hasSnapshot: boolean;
};

export type SnapshotShown = { key: string; number?: number };

export type TestStarted = {
  runId: number;
  key: string;
  file: string;
  staticTestId?: string;
  name: string[];
};

export type TestResultFromPreview = TestStarted & {
  status: TestStatus;
  durationMs: number;
  errors: ErrorInfo[];
};

export type RunFinished = {
  runId: number;
  cancelled: boolean;
  /** The test whose content the canvas is showing */
  lastTest?: { key: string; name: string[] };
};

export const resultKey = (file: string, name: string[]) => `${file}::${name.join(' > ')}`;

export const matchesStaticTest = (test: Pick<StaticTest, 'name'>, name: string[]) =>
  test.name.length === name.length &&
  test.name.every((part, index) =>
    part.pattern === null ? true : new RegExp(`^${part.pattern}$`, 's').test(name[index] ?? ''),
  );

/**
 * The static test a name from a run belongs to. A name that is not a literal (pattern null) matches any name,
 * so the most precise match wins: literal before template before unknown, then the first in the file.
 */
export const findStaticTest = <T extends Pick<StaticTest, 'name'>>(tests: T[], name: string[]) => {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const test of tests) {
    if (!matchesStaticTest(test, name)) {
      continue;
    }
    const score = test.name.reduce(
      (sum, part, index) => sum + (part.text === name[index] ? 0 : part.pattern === null ? 2 : 1),
      0,
    );
    if (score < bestScore) {
      best = test;
      bestScore = score;
    }
  }
  return best;
};
