import React from 'react';
import { keyframes, styled } from 'storybook/theming';

import type { ErrorInfo, TestStatus } from '../shared/types.ts';

const snurr = keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } });

export const Button = styled.button<{ primar?: boolean }>(({ theme, primar }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 4,
  border: `1px solid ${primar ? theme.color.secondary : theme.appBorderColor}`,
  background: primar ? theme.color.secondary : 'transparent',
  color: primar ? theme.color.lightest : theme.color.defaultText,
  fontSize: theme.typography.size.s1,
  fontWeight: theme.typography.weight.bold,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
  '&:hover:not(:disabled)': { borderColor: theme.color.secondary },
}));

export const IconButton = styled.button(({ theme }) => ({
  border: 'none',
  background: 'transparent',
  color: theme.textMutedColor,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: theme.typography.size.s2,
  lineHeight: 1,
  '&:hover:not(:disabled)': { color: theme.color.secondary, background: theme.background.hoverable },
  '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
}));

export const Spinner = styled.span(({ theme }) => ({
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: '50%',
  border: `2px solid ${theme.appBorderColor}`,
  borderTopColor: theme.color.secondary,
  animation: `${snurr} 0.8s linear infinite`,
}));

const Dot = styled.span<{ color: string }>(({ color }) => ({
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
}));

export const StatusIcon = ({ status, waiting }: { status?: TestStatus; waiting?: boolean }) => {
  if (waiting) {
    return <Spinner aria-label="Running" />;
  }
  switch (status) {
    case 'passed':
      return <Dot color="#66BF3C" aria-label="Passed" title="Passed" />;
    case 'failed':
      return <Dot color="#FF4400" aria-label="Failed" title="Failed" />;
    case 'skipped':
      return <Dot color="#FFAE00" aria-label="Skipped" title="Skipped" />;
    default:
      return <Dot color="#C9CCCF" aria-label="Not run" title="Not run" />;
  }
};

const Pre = styled.pre(({ theme }) => ({
  margin: '4px 0',
  padding: 8,
  borderRadius: 4,
  background: theme.background.warning,
  color: theme.color.darkest,
  fontSize: theme.typography.size.s1,
  fontFamily: theme.typography.fonts.mono,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 400,
  overflow: 'auto',
}));

export const ErrorView = ({ error }: { error: ErrorInfo[] }) => (
  <>
    {error.map((f, index) => (
      <div key={index}>
        <Pre>{f.message}</Pre>
        {f.diff && <Pre>{f.diff}</Pre>}
        {f.stack && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>Stack</summary>
            <Pre>{f.stack}</Pre>
          </details>
        )}
      </div>
    ))}
  </>
);
