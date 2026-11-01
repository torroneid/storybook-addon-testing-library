import React, { useEffect, useState } from 'react';
import { useStorybookApi, useStorybookState } from 'storybook/manager-api';
import { styled } from 'storybook/theming';

import type { SpecFile, StaticTest, StepInfo } from '../shared/types.ts';
import { ConsoleErrors, ErrorView, IconButton, Button, Spinner, StatusIcon } from './components.tsx';
import {
  cancel,
  failedTests,
  isStale,
  isTestPending,
  logTestLocation,
  nextFailingStory,
  rerunFailed,
  setOnlyFailed,
  setWatch,
  previousStep,
  resumeWithoutPausing,
  runTests,
  runStepByStep,
  closeStepByStep,
  nextStep,
  summarize,
  hideSnapshot,
  showSnapshot,
  type TestResult,
  useResults,
  useSpecFiles,
  showStoryAgain,
} from './store.ts';

const Container = styled.div(({ theme }) => ({
  fontSize: theme.typography.size.s2,
  color: theme.color.defaultText,
  height: '100%',
  overflow: 'auto',
}));

const Toolbar = styled.div(({ theme }) => ({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderBottom: `1px solid ${theme.appBorderColor}`,
  background: theme.background.app,
}));

const Banner = styled.div(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderBottom: `1px solid ${theme.appBorderColor}`,
  background: theme.background.hoverable,
}));

const Muted = styled.span(({ theme }) => ({
  color: theme.textMutedColor,
  fontSize: theme.typography.size.s1,
}));

const FileHeader = styled.div(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.appBorderColor}`,
  background: theme.background.hoverable,
  fontWeight: theme.typography.weight.bold,
}));

const RowBase = styled.div<{ stale?: boolean }>(({ theme, stale }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px 6px 20px',
  borderBottom: `1px solid ${theme.appBorderColor}`,
  cursor: 'pointer',
  opacity: stale ? 0.6 : 1,
  '&:hover': { background: theme.background.hoverable },
  '&:focus-visible': { outline: `2px solid ${theme.color.secondary}`, outlineOffset: -2 },
}));

/** A row that opens and closes its details, with the mouse or with Enter and Space */
const Row = ({
  open,
  onToggle,
  children,
  style,
  stale,
}: {
  open?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
  stale?: boolean;
}) => (
  <RowBase
    role="button"
    tabIndex={0}
    aria-expanded={open}
    stale={stale}
    style={style}
    onClick={onToggle}
    onKeyDown={event => {
      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onToggle();
      }
    }}
  >
    {children}
  </RowBase>
);

/**
 * Whether details are open: failed results open by themselves, but the user's choice wins until the next run
 * (`runId`), so a failed test can be closed
 */
const useOpen = (runId: number | undefined, openByDefault: boolean) => {
  const [choice, setChoice] = useState<{ runId?: number; open: boolean }>();
  const open = choice && choice.runId === runId ? choice.open : openByDefault;
  return [open, () => setChoice({ runId, open: !open })] as const;
};

const StaleMark = () => (
  <Muted title="The code changed after this test ran. Run it again to see the result for the current code.">
    outdated
  </Muted>
);

const Details = styled.div(({ theme }) => ({
  padding: '8px 12px 12px 38px',
  borderBottom: `1px solid ${theme.appBorderColor}`,
}));

const EmptyState = styled.div(({ theme }) => ({
  padding: 24,
  color: theme.textMutedColor,
  lineHeight: 1.6,
}));

const SectionTitle = styled.button(({ theme }) => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 12px 6px 20px',
  border: 'none',
  borderBottom: `1px solid ${theme.appBorderColor}`,
  background: 'transparent',
  color: theme.textMutedColor,
  fontSize: theme.typography.size.s1,
  cursor: 'pointer',
}));

const formatName = (name: string[]) => name.join(' › ');

const TestButtons = ({ specFile, test, disabled }: { specFile: SpecFile; test: StaticTest; disabled: boolean }) => (
  <>
    <IconButton
      title="Show this test in Sources: logs it in the browser's console (DevTools), where a click opens it"
      aria-label="Show this test in Sources"
      style={{ fontFamily: 'monospace', fontSize: 11 }}
      onClick={event => {
        event.stopPropagation();
        logTestLocation(specFile, test);
      }}
    >
      {'</>'}
    </IconButton>
    <IconButton
      title="Run this test step by step"
      aria-label="Run this test step by step"
      disabled={disabled}
      onClick={event => {
        event.stopPropagation();
        runStepByStep({ type: 'test', file: specFile.file, testId: test.id });
      }}
    >
      ⏯
    </IconButton>
    <IconButton
      title="Run this test and show it in the canvas"
      aria-label="Run this test and show it in the canvas"
      disabled={disabled}
      onClick={event => {
        event.stopPropagation();
        runTests({ type: 'test', file: specFile.file, testId: test.id });
      }}
    >
      ▶
    </IconButton>
  </>
);

const StepRow = styled.div<{ paused: boolean; clickable: boolean; failed: boolean }>(
  ({ theme, paused, clickable, failed }) => ({
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    padding: '3px 8px',
    borderRadius: 4,
    background: paused ? theme.background.hoverable : failed ? 'rgba(255, 68, 0, 0.1)' : 'transparent',
    outline: paused ? `1px solid ${theme.color.secondary}` : 'none',
    cursor: clickable ? 'pointer' : 'default',
    '&:hover': clickable ? { background: theme.background.hoverable } : {},
  }),
);

const LinkText = styled.button(({ theme }) => ({
  border: 'none',
  background: 'transparent',
  padding: '3px 8px',
  color: theme.color.secondary,
  fontSize: theme.typography.size.s1,
  cursor: 'pointer',
  '&:hover': { textDecoration: 'underline' },
}));

/** Steps kept in view before the one that failed, when the earlier ones are folded away */
const STEPS_BEFORE_FAILURE = 2;

const Code = styled.code<{ muted: boolean }>(({ theme, muted }) => ({
  flex: 1,
  fontFamily: theme.typography.fonts.mono,
  fontSize: theme.typography.size.s1,
  color: muted ? theme.textMutedColor : theme.color.defaultText,
  wordBreak: 'break-word',
}));

const StepIcon = ({ status }: { status: StepInfo['status'] }) => {
  switch (status) {
    case 'paused':
      return <span title="Paused">⏸</span>;
    case 'running':
      return <Spinner />;
    case 'ok':
      return <span style={{ color: '#66BF3C' }}>✓</span>;
    case 'failed':
      return <span style={{ color: '#FF4400' }}>✗</span>;
  }
};

const StepList = ({ steps, foldBeforeFailure = false }: { steps: StepInfo[]; foldBeforeFailure?: boolean }) => {
  const { snapshot } = useResults();
  const [showAll, setShowAll] = useState(false);
  const failedIndex = steps.findIndex(s => s.status === 'failed');
  // In a long test the step that failed would be far down, so the steps well before it are folded away
  const hidden = foldBeforeFailure && !showAll && failedIndex > 0 ? Math.max(0, failedIndex - STEPS_BEFORE_FAILURE) : 0;
  return (
    <div>
      {hidden > 0 && (
        <LinkText onClick={() => setShowAll(true)}>
          Show {hidden} earlier {hidden === 1 ? 'step' : 'steps'}
        </LinkText>
      )}
      {steps.slice(hidden).map(s => {
        const isShown = snapshot?.key === s.key && snapshot.number === s.number;
        const clickable = s.hasSnapshot && !isShown;
        return (
          <StepRow
            key={s.number}
            paused={s.status === 'paused' || isShown}
            failed={s.status === 'failed'}
            clickable={clickable}
            title={clickable ? 'Show what the canvas looked like before this step' : undefined}
            onClick={clickable ? () => showSnapshot(s.key, s.number) : undefined}
          >
            <Muted style={{ minWidth: 20, textAlign: 'right' }}>{s.number}</Muted>
            <span style={{ minWidth: 14 }}>
              <StepIcon status={s.status} />
            </span>
            <Code muted={!s.pausable}>
              {s.label}
              {s.error && <span style={{ display: 'block', color: '#FF4400' }}>{s.error.split('\n')[0]}</span>}
            </Code>
            {isShown && <Muted>shown in canvas</Muted>}
          </StepRow>
        );
      })}
    </div>
  );
};

const TestResultRow = ({
  result,
  onlyLastName,
  handling,
}: {
  result: TestResult;
  onlyLastName: boolean;
  handling?: React.ReactNode;
}) => {
  const state = useResults();
  const [open, toggle] = useOpen(result.runId, result.status === 'failed');
  const steps = state.steps[result.key] ?? [];
  const consoleErrors = result.consoleErrors ?? [];
  const canExpand = result.errors.length > 0 || steps.length > 0 || consoleErrors.length > 0;
  const stale = isStale(state, result);
  return (
    <>
      <Row
        open={canExpand ? open : undefined}
        onToggle={toggle}
        stale={stale}
        style={{ paddingLeft: onlyLastName ? 38 : 20 }}
      >
        <StatusIcon status={result.status} />
        <span style={{ flex: 1 }}>{onlyLastName ? result.name.at(-1) : formatName(result.name)}</span>
        {stale && <StaleMark />}
        {consoleErrors.length > 0 && (
          <Muted title={`Logged ${consoleErrors.length} times with console.error`}>
            ⚠ {consoleErrors.length} console.error
          </Muted>
        )}
        <Muted>{result.status === 'skipped' ? 'skipped' : `${Math.round(result.durationMs)} ms`}</Muted>
        {handling}
        {canExpand && <Muted>{open ? '▾' : '▸'}</Muted>}
      </Row>
      {open && canExpand && (
        <Details>
          <ErrorView error={result.errors} testKey={result.key} />
          <ConsoleErrors messages={consoleErrors} />
          {steps.length > 0 && <StepList steps={steps} foldBeforeFailure={result.status === 'failed'} />}
        </Details>
      )}
    </>
  );
};

const TestRow = ({ specFile, test, result }: { specFile: SpecFile; test: StaticTest; result: TestResult[] }) => {
  const state = useResults();
  const waiting = isTestPending(state, specFile, test, result);
  const isRunning = !!state.run;
  const runButtons = <TestButtons specFile={specFile} test={test} disabled={isRunning} />;
  const summary = summarize(result);
  const latestRunId = result.reduce<number | undefined>((max, r) => Math.max(max ?? 0, r.runId), undefined);
  const [open, toggle] = useOpen(latestRunId, summary.failed > 0);

  // A test in the source gives one result, unless it is declared with .each/.for
  if (result.length === 1 && !test.isTemplate && !waiting) {
    return <TestResultRow result={result[0]!} onlyLastName={false} handling={runButtons} />;
  }

  const status = summary.failed > 0 ? 'failed' : summary.ok > 0 ? 'passed' : result.length > 0 ? 'skipped' : undefined;
  const stale = result.some(r => isStale(state, r));
  return (
    <>
      <Row open={result.length > 0 ? open : undefined} onToggle={toggle} stale={stale}>
        <StatusIcon status={status} waiting={waiting} />
        <span style={{ flex: 1 }}>{formatName(test.name.map(part => part.text))}</span>
        {stale && <StaleMark />}
        {result.length > 0 && (
          <Muted>
            {summary.ok}/{result.length} ok
          </Muted>
        )}
        {runButtons}
        {result.length > 0 && <Muted>{open ? '▾' : '▸'}</Muted>}
      </Row>
      {open && result.map(r => <TestResultRow key={r.key} result={r} onlyLastName />)}
    </>
  );
};

const SpecFileView = ({ specFile, storyId }: { specFile: SpecFile; storyId: string }) => {
  const state = useResults();
  const [showOther, setShowOther] = useState<boolean>();
  const resultsInFile = Object.values(state.results).filter(r => r.file === specFile.file);
  const resultsForTest = (test: StaticTest) => resultsInFile.filter(r => r.staticTestId === test.id);
  const hasFailed = (test: StaticTest) => resultsForTest(test).some(r => r.status === 'failed');
  const shown = state.onlyFailed ? specFile.tests.filter(hasFailed) : specFile.tests;
  const linked = shown.filter(test => test.storyIds.includes(storyId));
  const other = shown.filter(test => !test.storyIds.includes(storyId));
  const unlinked = resultsInFile.filter(r => !r.staticTestId);
  const otherResults = summarize(resultsInFile.filter(r => other.some(test => test.id === r.staticTestId)));
  // Open the section automatically when one of those tests fails, but let the user control it afterwards
  const otherOpen = showOther ?? otherResults.failed > 0;
  const fileErrors = state.fileErrors[specFile.file] ?? [];
  const fileName = specFile.file.split('/').at(-1) ?? specFile.file;
  const dir = specFile.file.slice(2, -fileName.length - 1);

  return (
    <div>
      <FileHeader>
        <span style={{ flex: 1 }}>
          {fileName} <Muted>{dir}</Muted>
        </span>
        <Button disabled={!!state.run} onClick={() => runTests({ type: 'file', file: specFile.file })}>
          ▶ Run whole file
        </Button>
      </FileHeader>
      {specFile.analysisError && (
        <Details>
          <ErrorView error={[{ message: `Could not analyze the file: ${specFile.analysisError}` }]} />
        </Details>
      )}
      {fileErrors.length > 0 && (
        <Details>
          <ErrorView error={fileErrors} />
        </Details>
      )}
      {linked.map(test => (
        <TestRow key={test.id} specFile={specFile} test={test} result={resultsForTest(test)} />
      ))}
      {linked.length === 0 && (
        <EmptyState style={{ padding: '8px 20px' }}>
          {state.onlyFailed ? 'No failed tests for this story in this file.' : 'No tests in this file use this story.'}
        </EmptyState>
      )}
      {other.length > 0 && (
        <>
          <SectionTitle onClick={() => setShowOther(!otherOpen)}>
            {otherOpen ? '▾' : '▸'} Other tests in this file ({other.length})
            {otherResults.ok + otherResults.failed > 0 &&
              ` · ${otherResults.ok} passed · ${otherResults.failed} failed`}
          </SectionTitle>
          {otherOpen &&
            other.map(test => <TestRow key={test.id} specFile={specFile} test={test} result={resultsForTest(test)} />)}
        </>
      )}
      {unlinked
        .filter(r => !state.onlyFailed || r.status === 'failed')
        .map(r => (
          <TestResultRow key={r.key} result={r} onlyLastName={false} />
        ))}
    </div>
  );
};

const TestViewBanner = () => {
  const { run, testView, lastRun } = useResults();
  if (run) {
    return (
      <Banner>
        <Spinner />
        <span style={{ flex: 1 }}>
          Running in the canvas: {run.currentTest ? formatName(run.currentTest.name) : 'loading tests…'}
        </span>
        <Button onClick={cancel}>■ Cancel</Button>
      </Banner>
    );
  }
  if (!testView) {
    return null;
  }
  return (
    <Banner>
      <span style={{ flex: 1 }}>
        {testView.lastTest
          ? `The canvas shows the DOM after “${formatName(testView.lastTest.name)}”.`
          : 'The canvas shows content rendered by the tests.'}{' '}
        {lastRun?.cancelled && <Muted>(cancelled)</Muted>}
      </span>
      <Button onClick={showStoryAgain}>Show the story again</Button>
    </Banner>
  );
};

/** → runs the next step, ← shows the previous one, Esc closes step by step. Only while the manager has focus. */
const useStepShortcuts = ({ canGoForward, canGoBack }: { canGoForward: boolean; canGoBack: boolean }) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (event.key === 'ArrowRight' && canGoForward) {
        nextStep();
      } else if (event.key === 'ArrowLeft' && canGoBack) {
        previousStep();
      } else if (event.key === 'Escape') {
        closeStepByStep();
      } else {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [canGoForward, canGoBack]);
};

const StepPanel = () => {
  const state = useResults();
  const specFiles = useSpecFiles();
  const session = state.stepByStep;
  if (!session) {
    return null;
  }
  const { selection } = session;
  const steps = session.key ? (state.steps[session.key] ?? []) : [];
  const result = session.key ? state.results[session.key] : undefined;
  const paused = state.run ? steps.find(s => s.status === 'paused') : undefined;
  const test = specFiles.find(f => f.file === selection.file)?.tests.find(t => t.id === selection.testId);
  const snapshot = state.snapshot;
  const canGoBack = steps.some(
    s => s.hasSnapshot && s.number < (snapshot?.number ?? paused?.number ?? Number.MAX_SAFE_INTEGER),
  );
  useStepShortcuts({ canGoForward: !!paused, canGoBack });

  const status = snapshot
    ? `Showing the snapshot from step ${snapshot.number}`
    : paused
      ? `Paused before step ${paused.number}`
      : state.run
        ? 'Running…'
        : result?.status === 'passed'
          ? 'Test finished ✓'
          : result?.status === 'failed'
            ? 'Test failed'
            : 'Cancelled';

  return (
    <Details style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1 }}>
          Step by step: {test ? formatName(test.name.map(part => part.text)) : selection.testId}
          <Muted> · {status}</Muted>
        </strong>
        <Button title="Re-run the test from the start" onClick={() => runStepByStep(selection, 1)}>
          ⏮ From start
        </Button>
        <Button title="Show the snapshot from the previous step" disabled={!canGoBack} onClick={previousStep}>
          ◀ Previous <Muted>←</Muted>
        </Button>
        <Button
          primary
          title={snapshot ? 'Show the next step' : 'Run this step and pause at the next one'}
          disabled={!paused}
          onClick={nextStep}
        >
          Next ▶ <span style={{ opacity: 0.7, fontWeight: 'normal' }}>→</span>
        </Button>
        <Button disabled={!paused} onClick={resumeWithoutPausing}>
          ⏭ Run the rest
        </Button>
        <IconButton title="Close step by step (Esc)" aria-label="Close step by step" onClick={closeStepByStep}>
          ✕
        </IconButton>
      </div>
      {snapshot && (
        <Banner style={{ margin: 0, border: 'none', borderRadius: 4 }}>
          <span style={{ flex: 1 }}>The canvas shows a snapshot from step {snapshot.number}, not the live test.</span>
          <Button title="Re-run the test and pause here" onClick={() => runStepByStep(selection, snapshot.number)}>
            ↻ Re-run to here
          </Button>
          <Button onClick={hideSnapshot}>Back to live</Button>
        </Banner>
      )}
      {steps.length === 0 ? <Muted>Waiting for the first step…</Muted> : <StepList steps={steps} />}
      {result && !state.run && result.errors.length > 0 && <ErrorView error={result.errors} testKey={result.key} />}
      <Muted>
        The test pauses before every async interaction (userEvent, findBy, waitFor, Story.run()) and highlights the
        element in the canvas. render, fireEvent and expect are logged. Click a step to see the DOM as it was just
        before that step.
      </Muted>
    </Details>
  );
};

const Toggle = ({
  checked,
  onChange,
  title,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  children: React.ReactNode;
}) => (
  <label title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    <Muted>{children}</Muted>
  </label>
);

/** The results for this story are from before the code last changed */
const StaleBanner = ({ storyId, stale }: { storyId: string; stale: boolean }) => {
  const { run, watch } = useResults();
  if (!stale || run) {
    return null;
  }
  return (
    <Banner>
      <span style={{ flex: 1 }}>The code changed after these tests ran, so the results may be out of date.</span>
      <Button onClick={() => runTests({ type: 'stories', storyIds: [storyId] })}>▶ Run again</Button>
      {!watch && (
        <Button title="Run this story's tests every time you save a file" onClick={() => setWatch(true)}>
          Re-run on save
        </Button>
      )}
    </Banner>
  );
};

export const Panel = () => {
  const { storyId } = useStorybookState();
  const api = useStorybookApi();
  const specFileIndex = useSpecFiles();
  const state = useResults();
  const specFiles = specFileIndex.filter(specFile => specFile.storyIds.includes(storyId));
  const testsForStory = specFiles.flatMap(specFile => specFile.tests.filter(test => test.storyIds.includes(storyId)));
  const resultsForStory = Object.values(state.results).filter(r => r.storyIds.includes(storyId));
  const summary = summarize(resultsForStory);
  const generalErrors = state.fileErrors[''] ?? [];
  const failedHere = failedTests(state, storyId).length;
  const nextFailing = nextFailingStory(state, storyId);
  const failingElsewhere = nextFailing !== undefined && nextFailing !== storyId;
  const stale = resultsForStory.some(r => isStale(state, r));

  if (specFiles.length === 0) {
    return (
      <Container>
        <EmptyState>
          No tests found for this story.
          <br />A test is linked to a story when the spec file uses it through <code>composeStories</code>, or when the
          spec file has the same name as the stories file (for example <code>Component.spec.tsx</code> and{' '}
          <code>Component.stories.tsx</code>).
        </EmptyState>
      </Container>
    );
  }

  return (
    <Container>
      <Toolbar>
        <Button
          primary
          disabled={!!state.run || testsForStory.length === 0}
          onClick={() => runTests({ type: 'stories', storyIds: [storyId] })}
        >
          ▶ Run this story’s tests ({testsForStory.length})
        </Button>
        {failedHere > 0 && (
          <Button disabled={!!state.run} onClick={() => rerunFailed(storyId)}>
            ↻ Re-run failed ({failedHere})
          </Button>
        )}
        {resultsForStory.length > 0 && (
          <Muted>
            {summary.ok} passed · {summary.failed} failed{summary.skipped > 0 && ` · ${summary.skipped} skipped`}
          </Muted>
        )}
        <span style={{ flex: 1 }} />
        {failingElsewhere && (
          <Button title="Go to the next story with a failed test" onClick={() => api.selectStory(nextFailing)}>
            Next failing story ›
          </Button>
        )}
        <Toggle checked={state.onlyFailed} onChange={setOnlyFailed} title="List only the tests that failed">
          Only failed
        </Toggle>
        <Toggle
          checked={state.watch}
          onChange={setWatch}
          title="Run this story's tests again every time you save a file in the project"
        >
          Re-run on save
        </Toggle>
      </Toolbar>
      <TestViewBanner />
      <StaleBanner storyId={storyId} stale={stale} />
      <StepPanel />
      {generalErrors.length > 0 && (
        <Details style={{ paddingLeft: 12 }}>
          <ErrorView error={generalErrors} />
        </Details>
      )}
      {specFiles.map(specFile => (
        <SpecFileView key={specFile.file} specFile={specFile} storyId={storyId} />
      ))}
    </Container>
  );
};

export const PanelTitle = () => {
  const { storyId } = useStorybookState();
  const specFiles = useSpecFiles();
  const state = useResults();
  const { failed } = summarize(Object.values(state.results).filter(r => r.storyIds.includes(storyId)));
  const count = specFiles.flatMap(specFile => specFile.tests.filter(test => test.storyIds.includes(storyId))).length;
  return (
    <span>
      Tests{count > 0 && ` (${count})`}
      {failed > 0 && <span style={{ color: '#FF4400' }}> · {failed} failed</span>}
    </span>
  );
};
