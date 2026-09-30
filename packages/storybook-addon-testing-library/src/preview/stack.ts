/**
 * Stack traces mapped back to the source files. Chrome reports positions in the code Vite serves, which is
 * transformed; each module carries an inline source map with the original source, so a frame can be mapped
 * and shown with the lines around it.
 */
import {
  generatedPositionFor,
  LEAST_UPPER_BOUND,
  originalPositionFor,
  sourceContentFor,
  TraceMap,
} from '@jridgewell/trace-mapping';

import type { CodeFrame, ServedPosition, StackFrame } from '../shared/types.ts';

type RawFrame = { fn?: string; url: string; line: number; column: number };

// "    at fn (http://…/file.tsx?query:12:5)" or "    at http://…/file.tsx:12:5"
const FRAME = /^\s*at (?:(.+?) \()?((?:https?|file):\/\/.+?):(\d+):(\d+)\)?\s*$/;

const MAX_MAPPED_FRAMES = 12;
const CONTEXT_LINES = 2;

export const parseStack = (stack: string): RawFrame[] =>
  stack.split('\n').flatMap(line => {
    const match = FRAME.exec(line);
    return match
      ? [{ fn: match[1]?.replace(/^async /, ''), url: match[2]!, line: Number(match[3]), column: Number(match[4]) }]
      : [];
  });

/** node_modules (which holds Vite's prebundled dependencies too) and the addon itself */
const isLibrary = (url: string) => /\/node_modules\/|\/storybook-addon-testing-library\/(dist|src)\//.test(url);

let projectRoot: string | undefined;

/** The absolute path Storybook runs in, so files can be shown relative to it */
export const setProjectRoot = (root: string | undefined) => {
  projectRoot = root;
};

const displayPath = (url: string) => {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
  if (path.startsWith('/@fs/')) {
    path = path.slice('/@fs'.length);
    return projectRoot && path.startsWith(`${projectRoot}/`) ? `.${path.slice(projectRoot.length)}` : path;
  }
  // Served from Vite's root, which is where Storybook runs
  return `.${path}`;
};

const maps = new Map<string, Promise<TraceMap | undefined>>();

const loadMap = (url: string) => {
  let map = maps.get(url);
  if (!map) {
    map = fetch(url)
      .then(response => (response.ok ? response.text() : ''))
      .then(code => {
        const inline =
          /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
        return inline
          ? new TraceMap(new TextDecoder().decode(Uint8Array.from(atob(inline[1]!), c => c.charCodeAt(0))))
          : undefined;
      })
      .catch(() => undefined);
    maps.set(url, map);
  }
  return map;
};

const codeFrameFrom = (map: TraceMap, source: string, frame: StackFrame): CodeFrame | undefined => {
  const content = sourceContentFor(map, source);
  if (!content) {
    return undefined;
  }
  const all = content.split('\n');
  const first = Math.max(1, frame.line - CONTEXT_LINES);
  const last = Math.min(all.length, frame.line + CONTEXT_LINES);
  const lines = [];
  for (let number = first; number <= last; number++) {
    lines.push({ number, text: all[number - 1] ?? '' });
  }
  return { file: frame.file, line: frame.line, column: frame.column, lines, fn: frame.fn, served: frame.served };
};

/** The frames of a stack, mapped to the source, and the code around the first frame in your own code */
export const mapStack = async (stack: string | undefined): Promise<{ frames: StackFrame[]; codeFrame?: CodeFrame }> => {
  const frames: StackFrame[] = [];
  let codeFrame: CodeFrame | undefined;
  for (const [index, raw] of parseStack(stack ?? '').entries()) {
    const library = isLibrary(raw.url);
    const frame: StackFrame = {
      fn: raw.fn,
      file: displayPath(raw.url),
      line: raw.line,
      column: raw.column,
      library,
      served: library ? undefined : { url: raw.url, line: raw.line, column: raw.column },
    };
    const map = !library && index < MAX_MAPPED_FRAMES ? await loadMap(raw.url) : undefined;
    if (map) {
      const original = originalPositionFor(map, { line: raw.line, column: raw.column - 1 });
      if (original.line !== null && original.source !== null) {
        frame.line = original.line;
        frame.column = original.column + 1;
        codeFrame ??= codeFrameFrom(map, original.source, frame);
      }
    }
    frames.push(frame);
  }
  return { frames, codeFrame };
};

/**
 * Logs a frame in the console as an error with only that frame in its stack. DevTools maps the stack with the
 * served code's source map, so the line links to the source file, and a click opens it in Sources.
 */
export const logFrame = ({
  fn,
  file,
  line,
  column,
  served,
  label,
}: {
  fn?: string;
  file: string;
  line: number;
  column: number;
  served: ServedPosition;
  /** Shown before the position, like the name of a test */
  label?: string;
}) => {
  const error = new Error(`${label ? `${label}, ` : ''}${file}:${line}:${column}`);
  error.name = 'storybook-addon-testing-library';
  error.stack = `${error.name}: ${error.message}\n    at ${fn ?? '<anonymous>'} (${served.url}:${served.line}:${served.column})`;
  console.log(error);
};

// Storybook loads hundreds of modules, and the browser stops recording them at 250, before any spec file has run
try {
  performance.setResourceTimingBufferSize(5000);
} catch {
  // Not in every environment (Node in the unit tests has it, older browsers may not)
}

/** The URL a spec file was last imported from in this page, with the query the runtime added (see collectFile) */
const loadedUrl = (importPath: string) =>
  performance
    .getEntriesByType('resource')
    .map(entry => entry.name)
    .filter(url => {
      try {
        const parsed = new URL(url);
        return decodeURIComponent(parsed.pathname) === importPath && parsed.searchParams.has('spec-tests');
      } catch {
        return false;
      }
    })
    .at(-1);

/**
 * Logs where a test is in its spec file, as logFrame does. DevTools only links to code the page has loaded, so the
 * test's file must have run since the page loaded; otherwise the position is logged as text.
 */
export const logTestLocation = async ({
  importPath,
  file,
  line,
  name,
}: {
  importPath: string;
  file: string;
  line: number;
  name: string;
}) => {
  const url = loadedUrl(importPath);
  const map = url ? await loadMap(url) : undefined;
  const baseName = importPath.split('/').at(-1)!;
  // Vite names the source after the URL it served, query included (Counter.spec.tsx?spec-tests=1)
  const source = map?.sources.find(s => {
    const path = s?.split('?')[0];
    return path === baseName || path?.endsWith(`/${baseName}`);
  });
  const served =
    map && source ? generatedPositionFor(map, { source, line, column: 0, bias: LEAST_UPPER_BOUND }) : undefined;
  if (url && served?.line != null) {
    // The column in the source, so the message says what the link opens
    const column = originalPositionFor(map!, { line: served.line, column: served.column }).column ?? 0;
    // The name goes in the message: DevTools reads a frame's function name only up to a space
    logFrame({
      fn: 'test',
      label: name,
      file,
      line,
      column: column + 1,
      served: { url, line: served.line, column: served.column + 1 },
    });
  } else {
    console.log(
      `storybook-addon-testing-library: ${name} is at ${file}:${line}. Run it once to get a link to Sources.`,
    );
  }
};
