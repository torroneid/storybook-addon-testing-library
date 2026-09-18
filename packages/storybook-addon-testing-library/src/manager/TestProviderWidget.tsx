import React, { useEffect, useState } from 'react';
import type { API } from 'storybook/manager-api';
import { styled } from 'storybook/theming';

import { IconButton, StatusIcon } from './components.tsx';
import { cancel, runTests, summarize, useResults, useSpecFiles } from './store.ts';

const Container = styled.div(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 2px',
  fontSize: theme.typography.size.s1,
  color: theme.color.defaultText,
}));

const Tittel = styled.div(({ theme }) => ({
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
  const [, setTikk] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTikk(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const result = Object.values(state.results);
  const summary = summarize(result);
  const testCount = specFiles.reduce((sum, specFile) => sum + specFile.tests.length, 0);
  const fileErrorCount = Object.values(state.fileErrors).filter(error => error.length > 0).length;
  const firstFailed = result.find(r => r.status === 'failed' && r.storyIds.length > 0);

  const statusText = state.run
    ? `Running in the canvas… ${state.run.completed} done`
    : result.length === 0 && fileErrorCount === 0
      ? `${testCount} tests in ${specFiles.length} spec files`
      : [
          `${summary.ok} ok`,
          `${summary.failed} failed`,
          fileErrorCount > 0 && `${fileErrorCount} files with errors`,
          state.lastRun && timeAgo(state.lastRun.ferdigTid),
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
        <Tittel>Spec-tests</Tittel>
        <Muted>{statusText}</Muted>
      </div>
      {firstFailed && !state.run && (
        <IconButton
          title="Go to the first story with a failing test"
          aria-label="Go to the first story with a failing test"
          onClick={() => api.selectStory(firstFailed.storyIds[0])}
        >
          ⚠
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
