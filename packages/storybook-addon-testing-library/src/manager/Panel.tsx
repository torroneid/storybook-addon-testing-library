import React, { useState } from 'react';
import { useStorybookState } from 'storybook/manager-api';
import { styled } from 'storybook/theming';

import type { SpecFile, StaticTest, StepInfo } from '../shared/types.ts';
import { ErrorView, IconButton, Button, Spinner, StatusIcon } from './components.tsx';
import {
  cancel,
  isTestPending,
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

const Row = styled.div(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px 6px 20px',
  borderBottom: `1px solid ${theme.appBorderColor}`,
  cursor: 'pointer',
  '&:hover': { background: theme.background.hoverable },
}));

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

const StepRow = styled.div<{ paused: boolean; clickable: boolean }>(({ theme, paused, clickable }) => ({
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '3px 8px',
  borderRadius: 4,
  background: paused ? theme.background.hoverable : 'transparent',
  outline: paused ? `1px solid ${theme.color.secondary}` : 'none',
  cursor: clickable ? 'pointer' : 'default',
  '&:hover': clickable ? { background: theme.background.hoverable } : {},
}));

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

const StepList = ({ steps }: { steps: StepInfo[] }) => {
  const { snapshot } = useResults();
  return (
    <div>
      {steps.map(s => {
        const isShown = snapshot?.key === s.key && snapshot.number === s.number;
        const clickable = s.hasSnapshot && !isShown;
        return (
          <StepRow
            key={s.number}
            paused={s.status === 'paused' || isShown}
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
  const [open, setOpen] = useState(false);
  const { steps: allSteps } = useResults();
  const steps = allSteps[result.key] ?? [];
  const canExpand = result.errors.length > 0 || steps.length > 0;
  return (
    <>
      <Row onClick={() => setOpen(!open)} style={{ paddingLeft: onlyLastName ? 38 : 20 }}>
        <StatusIcon status={result.status} />
        <span style={{ flex: 1 }}>{onlyLastName ? result.name.at(-1) : formatName(result.name)}</span>
        <Muted>{Math.round(result.durationMs)} ms</Muted>
        {handling}
        {canExpand && <Muted>{open ? '▾' : '▸'}</Muted>}
      </Row>
      {(open || result.status === 'failed') && canExpand && (
        <Details>
          <ErrorView error={result.errors} />
          {steps.length > 0 && <StepList steps={steps} />}
        </Details>
      )}
    </>
  );
};

const TestRow = ({ specFile, test, result }: { specFile: SpecFile; test: StaticTest; result: TestResult[] }) => {
  const state = useResults();
  const waiting = isTestPending(state, specFile, test, result);
  const isRunning = !!state.run;
  const [open, setOpen] = useState(false);
  const runButtons = <TestButtons specFile={specFile} test={test} disabled={isRunning} />;

  // A test in the source gives one result, unless it is declared with .each/.for
  if (result.length === 1 && !test.isTemplate && !waiting) {
    return <TestResultRow result={result[0]!} onlyLastName={false} handling={runButtons} />;
  }

  const summary = summarize(result);
  const status = summary.failed > 0 ? 'failed' : summary.ok > 0 ? 'passed' : result.length > 0 ? 'skipped' : undefined;
  return (
    <>
      <Row onClick={() => setOpen(!open)}>
        <StatusIcon status={status} waiting={waiting} />
        <span style={{ flex: 1 }}>{formatName(test.name.map(part => part.text))}</span>
        {result.length > 0 && (
          <Muted>
            {summary.ok}/{result.length} ok
          </Muted>
        )}
        {runButtons}
        {result.length > 0 && <Muted>{open ? '▾' : '▸'}</Muted>}
      </Row>
      {(open || summary.failed > 0) && result.map(r => <TestResultRow key={r.key} result={r} onlyLastName />)}
    </>
  );
};

const SpecFileView = ({ specFile, storyId }: { specFile: SpecFile; storyId: string }) => {
  const state = useResults();
  const [showOther, setShowOther] = useState<boolean>();
  const resultsInFile = Object.values(state.results).filter(r => r.file === specFile.file);
  const resultsForTest = (test: StaticTest) => resultsInFile.filter(r => r.staticTestId === test.id);
  const linked = specFile.tests.filter(test => test.storyIds.includes(storyId));
  const other = specFile.tests.filter(test => !test.storyIds.includes(storyId));
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
        <EmptyState style={{ padding: '8px 20px' }}>No tests in this file use this story.</EmptyState>
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
      {unlinked.map(r => (
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
          ◀ Previous
        </Button>
        <Button
          primary
          title={snapshot ? 'Show the next step' : 'Run this step and pause at the next one'}
          disabled={!paused}
          onClick={nextStep}
        >
          Next ▶
        </Button>
        <Button disabled={!paused} onClick={resumeWithoutPausing}>
          ⏭ Run the rest
        </Button>
        <IconButton title="Close step by step" aria-label="Close step by step" onClick={closeStepByStep}>
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
      {result && !state.run && result.errors.length > 0 && <ErrorView error={result.errors} />}
      <Muted>
        The test pauses before every async interaction (userEvent, findBy, waitFor, Story.run()) and highlights the
        element in the canvas. render, fireEvent and expect are logged. Click a step to see the DOM as it was just
        before that step.
      </Muted>
    </Details>
  );
};

export const Panel = () => {
  const { storyId } = useStorybookState();
  const specFileIndex = useSpecFiles();
  const state = useResults();
  const specFiles = specFileIndex.filter(specFile => specFile.storyIds.includes(storyId));
  const testsForStory = specFiles.flatMap(specFile => specFile.tests.filter(test => test.storyIds.includes(storyId)));
  const resultsForStory = Object.values(state.results).filter(r => r.storyIds.includes(storyId));
  const summary = summarize(resultsForStory);
  const generalErrors = state.fileErrors[''] ?? [];

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
        {resultsForStory.length > 0 && (
          <Muted>
            {summary.ok} passed · {summary.failed} failed{summary.skipped > 0 && ` · ${summary.skipped} skipped`}
          </Muted>
        )}
      </Toolbar>
      <TestViewBanner />
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
