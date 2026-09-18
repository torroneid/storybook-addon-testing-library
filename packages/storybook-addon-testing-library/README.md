# storybook-addon-testing-library

Run your existing [Testing Library](https://testing-library.com/) specs **inside the Storybook canvas**, listed under
the stories they use — and step through them one interaction at a time.

![The Tests panel listing the specs that use a story](https://raw.githubusercontent.com/torroneid/storybook-addon-testing-library/main/docs/results.png)

Your `*.spec.tsx` files stay exactly as they are. They keep running in Vitest, in CI, unchanged.

## Why

A failing component test usually sends you to a terminal, a stack trace and a DOM dump. This addon puts the test where
the component already lives:

- **See the test run.** The story is hidden, the test renders into the canvas, and whatever it rendered stays there
  when the test ends. You can click around in the result.
- **Step through it.** Pause before each interaction, with the element the test is about to touch highlighted.
- **Look back.** Every step keeps a DOM snapshot, so you can inspect the DOM at the exact assertion that failed —
  also after an ordinary run.
- **Find the tests.** Each story lists the specs that use it, so a component's tests are one click away.

## Requirements

- Storybook 10.6 or later with Vite (`@storybook/react-vite`)
- React 18 or later
- Specs written with `@testing-library/react` (and optionally `@testing-library/user-event`)

## Install

```sh
npm install --save-dev storybook-addon-testing-library
```

```ts
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: [
    {
      name: 'storybook-addon-testing-library',
      options: {
        // Optional: the same setup files Vitest uses
        setupFiles: ['vitest-setup.ts'],
      },
    },
  ],
  framework: '@storybook/react-vite',
};

export default config;
```

`setupFiles` run once before the first test, exactly like `setupFiles` in Vitest. A typical setup file makes
`composeStories` use the same decorators and parameters as Storybook itself:

```ts
// vitest-setup.ts
import { setProjectAnnotations } from '@storybook/react-vite';
import * as matchers from '@testing-library/jest-dom/matchers';
import { beforeAll, expect } from 'vitest';

import * as preview from './.storybook/preview';

expect.extend(matchers);
const annotations = setProjectAnnotations([preview]);
beforeAll(annotations.beforeAll);
```

### Options

| Option         | Default                                        | Description                                                                                              |
| -------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `setupFiles`   | `[]`                                           | Files to run before the first test, like `setupFiles` in Vitest. Relative to where Storybook is started. |
| `specPatterns` | `['**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}']` | Where to look for specs, relative to each directory with a `vite.config`/`vitest.config` and stories.    |

## Using it

Open a story and select the **Tests** panel.

- **Run this story's tests** runs everything linked to the story. **Run whole file** runs the spec file, and ▶ on a row
  runs a single test.
- The canvas shows what the last test rendered until you press **Show the story again**.
- Stories with results get a pass/fail status in the sidebar, and the testing widget at the bottom can run every spec.
- Right-click a component or story in the sidebar to run its tests from there.

## Step by step

Press ⏯ on a test to walk through it.

![A paused test, with the button it is about to click highlighted](https://raw.githubusercontent.com/torroneid/storybook-addon-testing-library/main/docs/step-by-step.png)

- The test **pauses before every async interaction**: `userEvent.*` (including `userEvent.setup()`), `screen.findBy*`,
  `within(...).findBy*`, `waitFor`, `waitForElementToBeRemoved`, `Story.run()` and `Story.play()`. The element the
  step acts on is highlighted in the canvas.
- `render`, `fireEvent` and `expect` are **logged** in the list. They are synchronous, so the test cannot pause there.
- **Next ▶** runs the step and pauses at the next one. **⏭ Run the rest** finishes the test. Timeouts are disabled
  while a test is paused.

## Snapshots

Before every step the DOM is captured with [rrweb-snapshot](https://www.npmjs.com/package/rrweb-snapshot) — the
library Vitest's trace view uses. Click a step, or press **◀ Previous**, to see the DOM as it was just before it.

![The canvas showing a DOM snapshot from an earlier step](https://raw.githubusercontent.com/torroneid/storybook-addon-testing-library/main/docs/snapshot.png)

- Going back is instant: the test is not re-run, so it works for tests that are not deterministic.
- **Back to live** returns to the running test, and **↻ Re-run to here** re-runs it and pauses at that step if you
  want to continue from there interactively.
- Snapshots are kept for ordinary runs too, so you can open a failing result and look at the DOM at the assertion
  that failed.
- Snapshots live in browser memory only, capped at 400 snapshots and 64 MB, oldest first. In the example project one
  costs about 2 ms and 28 kB; in large apps they are bigger, mostly because of inlined CSS.
- Playback happens in a sandboxed iframe, so scripts in a snapshot never run. Password fields are shown as typed,
  since this is test data.

## How tests are linked to stories

The Storybook server analyzes the spec files (TypeScript AST): `composeStories(stories)` and `composeStory(...)` are
followed to the stories file, and for each `it`/`test` it records which stories are used — including through
top-level helper functions and `beforeEach`/`beforeAll`.

A spec file with the same name as a stories file (`Component.spec.tsx` ↔ `Component.stories.tsx`) is shown under
**Other tests in this file** even when it does not use the stories.

Names from `.each`/`.for` (`%s`, `%d`, `$variable` …) are turned into patterns, so a single row can be run on its own.

## What is supported

- `describe`, `it`, `test`, with `.each`, `.for`, `.skip`, `.only`, `.todo`
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, cleanup functions returned from `beforeEach`,
  `onTestFinished`, `onTestFailed`, `expect.assertions`, `context.skip()`
- `expect` with the jest-dom matchers, and `vi.fn`, `vi.spyOn`, `vi.mocked`, `vi.clearAllMocks`, `vi.resetAllMocks`,
  `vi.restoreAllMocks` — all from `storybook/test`, which builds on the same `@vitest/expect` and `@vitest/spy` as
  Vitest

Not supported, with a clear error when you hit it:

- `vi.mock`, fake timers and other `vi.*` functions
- async `describe` blocks
- Only `storybook dev` — a static build has no dev server to load the specs from

Two more things worth knowing:

- Interactions become steps only when the spec file itself imports `@testing-library/react`,
  `@testing-library/user-event` or `@storybook/react-vite`. Calls inside helper files the spec imports still run, but
  do not appear as steps.
- `expect` comes from `storybook/test`, so assertions also show up in Storybook's Interactions panel.

## Compared to other tools

- [`@storybook/addon-vitest`](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon) runs your
  **stories** as tests in a separate Vitest process, and is the right tool for running a whole suite and for CI.
  This addon runs your **specs**, in the browser you already have open, and lets you stop inside one.
- **Vitest 5's trace view** records a run you inspect afterwards, and captures interactions made through
  `vitest/browser`. Testing Library calls do not show up there. This addon works the other way around: it recognises
  Testing Library calls and lets you pause live.

## How it works

```
src/preset.ts            Server: indexes spec files, configures Vite (aliases 'vitest', optimizeDeps)
src/manager.tsx          UI: panel, test provider, context menu, sidebar statuses
src/preview/preview.ts   Preview: receives runs, hides the story, reports results
src/preview/runtime.ts   Test runner: describe/it/test (+ each/for/skip/only/todo), hooks, onTestFinished
src/preview/steps.ts     Step by step: pausing, logging and element highlighting
src/preview/snapshots.ts DOM snapshots and playback
src/preview/wrappers/    Wrappers around @testing-library and @storybook/react-vite, for spec files only
src/preview/vitest.ts    Stands in for 'vitest' when spec files are imported in Storybook
```

- The spec file is imported through Storybook's own Vite dev server, with a fresh URL for each run.
- While tests run, the story renders `null`, so queries cannot match the story's own elements.
- `@testing-library/react`'s automatic cleanup is disabled. The runtime cleans up _before_ each test instead, which is
  what keeps the last test's DOM in the canvas.

## Development

This package lives in a small monorepo together with an example project. See
[the repository](https://github.com/torroneid/storybook-addon-testing-library) for how to run it.

## License

MIT © Tor Røneid
