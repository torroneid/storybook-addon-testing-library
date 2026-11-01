export const ADDON_ID = 'storybook-addon-testing-library';
export const PANEL_ID = `${ADDON_ID}/panel`;
export const TEST_PROVIDER_ID = `${ADDON_ID}/test-provider`;
export const STATUS_TYPE_ID = `${ADDON_ID}/status`;

/** Manager → preview */
export const RUN = `${ADDON_ID}/run`;
export const CANCEL = `${ADDON_ID}/cancel`;
export const EXIT_TEST_VIEW = `${ADDON_ID}/exit-test-view`;
/** Log a stack frame in the preview's console, where DevTools links it to the source */
export const LOG_FRAME = `${ADDON_ID}/log-frame`;
/** Log where a test is in its spec file in the preview's console */
export const LOG_TEST_LOCATION = `${ADDON_ID}/log-test-location`;

/** Server → manager: source files in the project changed, so earlier results may be out of date */
export const FILES_CHANGED = `${ADDON_ID}/files-changed`;
export type FilesChanged = { files: string[] };

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

/** Where the proxy modules for mocked modules register, so vi.mock can swap their exports (see node/mockPlugin.ts) */
export const MOCKED_MODULES_GLOBAL = '__TESTING_LIBRARY_ADDON_MOCKED_MODULES__';
export const MOCK_PATH_MARKER = '__storybookAddonTestingLibraryMock';

/** What a proxy module registers: its original exports, and how to set the exports it shows */
export type MockedModule = {
  original: Record<string, unknown>;
  mock?: Record<string, unknown>;
  setters: Set<(exports: Record<string, unknown>) => void>;
};

/** The path in a vi.mock call, resolved when the spec file is transformed */
export type MockPath = {
  [MOCK_PATH_MARKER]: true;
  /** As written in the call */
  path: string;
  /** The resolved module, which its proxy module registers under */
  key: string;
  /** Imports the proxy module, so it registers */
  load: () => Promise<unknown>;
  /** A mock in a __mocks__ directory, used by vi.mock without a factory */
  mocksFile?: () => Promise<unknown>;
  /** Why the module cannot be mocked */
  error?: string;
};

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

/** What kind of failure an error is, so the panel can say it in words */
export type ErrorOrigin = 'assertion' | 'query' | 'thrown' | 'uncaught' | 'rejection' | 'timeout';

/** A position in the code the browser runs, as Chrome reports it in a stack: before source maps, 1-based */
export type ServedPosition = { url: string; line: number; column: number };

export type StackFrame = {
  fn?: string;
  /** Relative to where Storybook runs when possible, like ./src/Button.tsx */
  file: string;
  line: number;
  column: number;
  /** Code from node_modules or the addon, which is collapsed in the panel */
  library: boolean;
  /** Where the frame is in the served code, so the preview can log it in the console (your own code only) */
  served?: ServedPosition;
};

export type CodeFrame = {
  file: string;
  line: number;
  column: number;
  lines: Array<{ number: number; text: string }>;
  fn?: string;
  served?: ServedPosition;
};

export type ErrorInfo = {
  message: string;
  stack?: string;
  diff?: string;
  origin?: ErrorOrigin;
  /** The step the error happened during (failed) or after */
  step?: { number: number; label: string; failed: boolean };
  /** The stack, mapped back to the source files */
  frames?: StackFrame[];
  /** The source around the first frame in your own code */
  codeFrame?: CodeFrame;
};

export type TestStatus = 'passed' | 'failed' | 'skipped';

export type RunSelection =
  | { type: 'all' }
  | { type: 'stories'; storyIds: string[] }
  | { type: 'file'; file: string }
  | { type: 'test'; file: string; testId: string }
  | { type: 'tests'; tests: Array<{ file: string; testId: string }> };

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
  /** What the test and the code under test logged with console.error */
  consoleErrors?: string[];
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
