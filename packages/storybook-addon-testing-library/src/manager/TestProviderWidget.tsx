import React, { useEffect, useState } from 'react';
import type { API } from 'storybook/manager-api';
import { styled } from 'storybook/theming';

import { IconButton, StatusIcon } from './components.tsx';
import {
  cancel,
  failedTests,
  failingStoryIds,
  nextFailingStory,
  rerunFailed,
  runTests,
  summarize,
  useResults,
  useSpecFiles,
} from './store.ts';

const Container = styled.div(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 2px',
  fontSize: theme.typography.size.s1,
  color: theme.color.defaultText,
}));

const Title = styled.div(({ theme }) => ({
  fontWeight: theme.typography.weight.bold,
  fontSize: theme.typography.size.s2,
}));

const Muted = styled.div(({ theme }) => ({
  color: theme.textMutedColor,
}));

const timeAgo = (time: number) => {
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
};

export const TestProviderWidget = ({ api }: { api: API }) => {
  const state = useResults();
  const specFiles = useSpecFiles();
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const result = Object.values(state.results);
  const summary = summarize(result);
  const testCount = specFiles.reduce((sum, specFile) => sum + specFile.tests.length, 0);
  const fileErrorCount = Object.values(state.fileErrors).filter(error => error.length > 0).length;
  const failedCount = failedTests(state).length;
  // Worked out on click: the widget does not re-render when another story is selected
  const goToNextFailing = () => {
    const current = api.getCurrentStoryData();
    const next = nextFailingStory(state, current?.type === 'story' ? current.id : undefined);
    if (next) {
      api.selectStory(next);
    }
  };

  const statusText = state.run
    ? `Running in the canvas… ${state.run.completed} done`
    : result.length === 0 && fileErrorCount === 0
      ? `${testCount} tests in ${specFiles.length} spec files`
      : [
          `${summary.ok} ok`,
          `${summary.failed} failed`,
          fileErrorCount > 0 && `${fileErrorCount} files with errors`,
          state.lastRun && timeAgo(state.lastRun.finishedAt),
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <Container>
      <StatusIcon
        waiting={!!state.run}
        status={summary.failed > 0 || fileErrorCount > 0 ? 'failed' : summary.ok > 0 ? 'passed' : undefined}
      />
      <div style={{ flex: 1 }}>
        <Title>Spec-tests</Title>
        <Muted>{statusText}</Muted>
      </div>
      {failingStoryIds(state).length > 0 && !state.run && (
        <IconButton
          title="Go to the next story with a failed test"
          aria-label="Go to the next story with a failed test"
          onClick={goToNextFailing}
        >
          ⚠
        </IconButton>
      )}
      {failedCount > 0 && !state.run && (
        <IconButton
          title={`Run the ${failedCount} failed tests again`}
          aria-label="Run the failed tests again"
          onClick={() => rerunFailed()}
        >
          ↻
        </IconButton>
      )}
      {state.run ? (
        <IconButton title="Cancel" aria-label="Cancel" onClick={cancel}>
          ■
        </IconButton>
      ) : (
        <IconButton
          title="Run all tests in the canvas"
          aria-label="Run all tests in the canvas"
          onClick={() => runTests({ type: 'all' })}
        >
          ▶
        </IconButton>
      )}
    </Container>
  );
};
