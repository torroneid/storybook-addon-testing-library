import type { ErrorInfo } from '../shared/types.ts';

export const errorReport = (error: ErrorInfo, testName?: string) =>
  [
    testName && `Test: ${testName}`,
    error.message,
    error.step && `Step ${error.step.number}: ${error.step.label}`,
    error.comparison ? `Expected:\n${error.comparison.expected}\n\nReceived:\n${error.comparison.actual}` : error.diff,
    error.codeFrame &&
      `${error.codeFrame.file}:${error.codeFrame.line}:${error.codeFrame.column}\n${error.codeFrame.lines
        .map(line => `${line.number === error.codeFrame!.line ? '>' : ' '} ${line.number} | ${line.text}`)
        .join('\n')}`,
    error.frames?.length
      ? error.frames
          .map(frame => `at ${frame.fn ? `${frame.fn} ` : ''}(${frame.file}:${frame.line}:${frame.column})`)
          .join('\n')
      : error.stack,
  ]
    .filter(Boolean)
    .join('\n\n');
