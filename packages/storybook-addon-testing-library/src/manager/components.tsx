import React, { useState } from 'react';
import { keyframes, styled } from 'storybook/theming';

import type { CodeFrame, ErrorInfo, ErrorOrigin, StackFrame, TestStatus } from '../shared/types.ts';
import { logFrameInConsole, showSnapshot } from './store.ts';

const spin = keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } });

export const Button = styled.button<{ primary?: boolean }>(({ theme, primary }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 4,
  border: `1px solid ${primary ? theme.color.secondary : theme.appBorderColor}`,
  background: primary ? theme.color.secondary : 'transparent',
  color: primary ? theme.color.lightest : theme.color.defaultText,
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
  animation: `${spin} 0.8s linear infinite`,
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

const ORIGINS: Record<ErrorOrigin, string> = {
  assertion: 'Assertion failed',
  query: 'Element not found',
  thrown: 'Error thrown',
  uncaught: 'Error thrown in your code',
  rejection: 'Unhandled promise rejection',
  timeout: 'Timed out',
};

const Headline = styled.div(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 6,
  marginTop: 8,
  fontSize: theme.typography.size.s2,
}));

const Origin = styled.strong({ color: '#FF4400' });

const LinkButton = styled.button(({ theme }) => ({
  border: 'none',
  background: 'transparent',
  padding: 0,
  color: theme.color.secondary,
  fontSize: 'inherit',
  fontFamily: theme.typography.fonts.mono,
  cursor: 'pointer',
  textAlign: 'left',
  '&:hover': { textDecoration: 'underline' },
}));

const Code = styled.div(({ theme }) => ({
  margin: '4px 0',
  borderRadius: 4,
  border: `1px solid ${theme.appBorderColor}`,
  fontFamily: theme.typography.fonts.mono,
  fontSize: theme.typography.size.s1,
  overflow: 'auto',
}));

const CodeHeader = styled.div(({ theme }) => ({
  padding: '4px 8px',
  borderBottom: `1px solid ${theme.appBorderColor}`,
  color: theme.textMutedColor,
}));

const CodeLine = styled.div<{ current: boolean }>(({ theme, current }) => ({
  display: 'flex',
  whiteSpace: 'pre',
  background: current ? 'rgba(255, 68, 0, 0.12)' : 'transparent',
  color: current ? theme.color.defaultText : theme.textMutedColor,
}));

const LineNumber = styled.span(({ theme }) => ({
  minWidth: 44,
  paddingRight: 8,
  textAlign: 'right',
  color: theme.textMutedColor,
  userSelect: 'none',
}));

const position = (frame: { file: string; line: number; column: number }) =>
  `${frame.file}:${frame.line}:${frame.column}`;

/** A position in your own code, as a link that logs it in the browser's console, where it links to the source */
const Position = ({ frame }: { frame: StackFrame | CodeFrame }) => {
  return frame.served ? (
    <LinkButton
      title="Log in the browser's console (DevTools), where a click opens it in Sources"
      onClick={() => logFrameInConsole(frame)}
    >
      {position(frame)}
    </LinkButton>
  ) : (
    <>{position(frame)}</>
  );
};

const CodeFrameView = ({ codeFrame }: { codeFrame: CodeFrame }) => (
  <Code>
    <CodeHeader>
      <Position frame={codeFrame} />
    </CodeHeader>
    {codeFrame.lines.map(line => (
      <React.Fragment key={line.number}>
        <CodeLine current={line.number === codeFrame.line}>
          <LineNumber>{line.number === codeFrame.line ? `> ${line.number}` : line.number}</LineNumber>
          {line.text}
        </CodeLine>
        {line.number === codeFrame.line && (
          <CodeLine current={false}>
            <LineNumber />
            <span style={{ color: '#FF4400' }}>{`${' '.repeat(Math.max(0, codeFrame.column - 1))}^`}</span>
          </CodeLine>
        )}
      </React.Fragment>
    ))}
  </Code>
);

const FrameList = ({ frames }: { frames: StackFrame[] }) => {
  const [showLibrary, setShowLibrary] = useState(false);
  const library = frames.filter(frame => frame.library).length;
  const shown = showLibrary ? frames : frames.filter(frame => !frame.library);
  return (
    <Pre as="div" style={{ background: 'transparent', padding: '4px 8px' }}>
      {shown.map((frame, index) => (
        <div key={index} style={{ opacity: frame.library ? 0.6 : 1 }}>
          at {frame.fn ? `${frame.fn} ` : ''}(
          <Position frame={frame} />)
        </div>
      ))}
      {library > 0 && (
        <LinkButton onClick={() => setShowLibrary(!showLibrary)}>
          {showLibrary ? 'Hide' : 'Show'} {library} frames from libraries
        </LinkButton>
      )}
    </Pre>
  );
};

/** The step an error happened in, as a link to the DOM snapshot from just before it */
const StepLink = ({ error, testKey }: { error: ErrorInfo; testKey?: string }) => {
  const { step, origin } = error;
  if (!step) {
    return <span>before the first step</span>;
  }
  const when = origin === 'uncaught' || origin === 'rejection' ? 'during' : step.failed ? 'at' : 'after';
  return (
    <span>
      {when} step {step.number}:{' '}
      {testKey ? (
        <LinkButton title="Show the DOM from just before this step" onClick={() => showSnapshot(testKey, step.number)}>
          {step.label}
        </LinkButton>
      ) : (
        <code>{step.label}</code>
      )}
    </span>
  );
};

export const ErrorView = ({ error, testKey }: { error: ErrorInfo[]; testKey?: string }) => (
  <>
    {error.map((info, index) => (
      <div key={index}>
        {info.origin && (
          <Headline>
            <Origin>{ORIGINS[info.origin]}</Origin>
            <StepLink error={info} testKey={testKey} />
          </Headline>
        )}
        <Pre>{info.message}</Pre>
        {info.diff && <Pre>{info.diff}</Pre>}
        {info.codeFrame && <CodeFrameView codeFrame={info.codeFrame} />}
        {(info.frames?.length || info.stack) && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>Stack</summary>
            {info.frames?.length ? <FrameList frames={info.frames} /> : <Pre>{info.stack}</Pre>}
          </details>
        )}
      </div>
    ))}
  </>
);

export const ConsoleErrors = ({ messages }: { messages: string[] }) =>
  messages.length === 0 ? null : (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 12 }}>Logged with console.error ({messages.length})</summary>
      {messages.map((message, index) => (
        <Pre key={index} style={{ background: 'transparent' }}>
          {message}
        </Pre>
      ))}
    </details>
  );
