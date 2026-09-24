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

## What you need

**In your project**

- Storybook 10.6 or later with Vite (`@storybook/react-vite`)
- React 18 or later
- Specs written with `@testing-library/react`, and `@testing-library/user-event` if you use it

**In a spec file, to have its tests listed under a story**

Use the story through `composeStories` (or `composeStory`). That is what links a test to a story:

```tsx
import { composeStories } from '@storybook/react-vite';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as stories from './Counter.stories';

const { Default } = composeStories(stories);

describe('Counter', () => {
  it('increments when clicked', async () => {
    render(<Default />); // or: await Default.run()

    await userEvent.click(screen.getByRole('button', { name: 'Add one' }));

    expect(screen.getByText('Value: 1')).toBeInTheDocument();
  });
});
```

A spec file named after a stories file (`Counter.spec.tsx` ↔ `Counter.stories.tsx`) is also listed on those stories,
under **Other tests in this file**, even without `composeStories`.

**What you do not need**

- **Vitest browser mode, Playwright or a browser install.** The addon runs the specs itself, in the browser that is
  already showing your Storybook. Specs that run in Vitest with jsdom work as they are.
- **Vitest running at all** while you use the addon.
- **Changes to your tests.** Nothing in a spec file has to be rewritten, and nothing addon-specific is imported.

**What cannot be used in a spec the addon runs**

- Browser-mode APIs from `vitest/browser`: `page`, `userEvent` from that package, locators, `commands`, `server`.
  Those need Vitest's own browser runner. Testing Library covers the same ground here.
- `vi.mock`, fake timers and other `vi.*` functions beyond the spy helpers, and async `describe` blocks. You get a
  clear error instead of a silent difference.
- Node-only APIs such as `node:fs`, since the tests run in the browser.

Such a spec still runs in Vitest as before. It just cannot be run from the panel.

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

### The setup file

Point `setupFiles` at the setup file your Vitest config already uses. Nothing in it is specific to this addon — it is
run as it is, once before the first test, the same way Vitest runs it:

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

What matters here is `setProjectAnnotations`. It is what gives `composeStories` the decorators, parameters, globals
and loaders from `.storybook/preview`. Leave it out and the tests still run, but a composed story renders without
your preview decorators — so it can look different from the story right next to it, and a test that depends on a
decorator (a theme or a form provider, say) will fail.

`expect.extend(matchers)` is not needed for this addon: `expect` comes from `storybook/test`, which already has the
jest-dom matchers. It does no harm, and Vitest still needs it.

Two things to keep in mind:

- The file runs in the browser, through Storybook's Vite server. Imports from `vitest` are served by the addon, so
  `beforeAll`, `beforeEach`, `expect` and the `vi` spy helpers work. Node-only code, `vi.mock` and fake timers do not.
  If your Vitest setup has such parts (a jsdom workaround, for example), guard them or move them to a separate file.
- Paths are resolved from the directory you start Storybook in, like the `stories` globs in `main.ts`.

Leaving `setupFiles` out entirely is fine if you have no setup file: assertions, spies and Testing Library all work
without one.

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

See [What you need](#what-you-need) for what a spec cannot use. The addon is only active in `storybook dev`; a static
build has no dev server to load the specs from.

Two more things worth knowing:

- Interactions become steps only when the spec file itself imports `@testing-library/react`,
  `@testing-library/user-event` or `@storybook/react-vite`. Calls inside helper files the spec imports still run, but
  do not appear as steps.
- `expect` and `userEvent` come from `storybook/test`, so assertions and interactions also show up in Storybook's
  Interactions panel. For `userEvent` this is needed, not just convenient: Storybook sets up its own copy of
  user-event for every story, and two copies in one page stop typing from reaching React.

## Compared to Storybook play functions

Storybook cannot run an ordinary Testing Library spec. To get one of your tests into Storybook today, you have to
rewrite it as a `play` function on a story:

- The test moves into the stories file, as **one flow per story**. There is no `describe`/`it`, no hooks, no `.each`
  and nowhere to put the mocks and edge cases that make up most of a spec suite.
- There is no `render(...)`: the story renders itself, and you query `canvasElement`.
- Interactions have to go through **`storybook/test`** (`userEvent`, `expect`, `within`) rather than Testing Library.
  Plain Testing Library calls do run inside a play function, but they are not instrumented, so they never reach the
  Interactions panel and cannot be stepped through.

In other words, the price of stepping through a test in Storybook is rewriting it against Storybook's own wrappers,
and keeping it in the stories file. This addon runs the spec file as it is instead, and turns your Testing Library
calls into the steps.

|                   | Play functions                                                   | This addon                                                                |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The test lives    | In the stories file, one flow per story                          | In your spec files, any number per story                                  |
| Written with      | `storybook/test`                                                 | `@testing-library/react`, `@testing-library/user-event`, `composeStories` |
| Test structure    | A single play function                                           | `describe`/`it`, hooks, `.each`, spies                                    |
| Going back a step | Remounts the story and replays the play function up to that call | Shows a stored DOM snapshot, without re-running                           |

Play functions are still the better choice when the interaction _is_ the story: a flow everyone looking at the story
should see. The two work side by side — because assertions in specs go through `storybook/test` under the hood, they
also show up in the Interactions panel.

## Compared to Vitest browser mode

Vitest browser mode runs tests in a real browser it launches, in its own UI, and is a proper test runner: real events
through the browser driver, CI support, coverage and retries. Keep using it — this addon does not replace it.

For **debugging a Testing Library spec**, though, it gives you little:

- There is no pause or step API. You are left with `debugger` and devtools in a headed browser.
- The closest thing to stepping is the trace view in Vitest 5, which you inspect after the run. It only records
  interactions made through `vitest/browser` — `page`, locators and its own `userEvent`. A spec written with Testing
  Library produces a trace with nothing in it but the start and end of the test.
- To get a trace worth stepping through, you would have to **replace Testing Library with the browser-mode APIs**,
  which ties those tests to browser mode.

|                 | Vitest browser mode                                                 | This addon                                                  |
| --------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| Runs in         | A browser it launches, in its own UI                                | The Storybook tab you already have open                     |
| Events          | Real events from the browser driver (`page`, locators)              | Testing Library events, dispatched from JavaScript          |
| Stepping        | None; trace view after the run, and only for `vitest/browser` calls | Pause before each interaction, with the element highlighted |
| Testing Library | Runs, but is invisible to the trace                                 | Is what the steps are made of                               |
| Good for        | Running the suite, CI, real browser behaviour                       | Working on one failing test next to the component           |

You do not need browser mode to use this addon, and the addon does not give you browser-mode APIs. Specs that use
`page` or locators from `vitest/browser` belong in Vitest.

## Compared to @storybook/addon-vitest

[`@storybook/addon-vitest`](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon) is Storybook's own
test addon, and it runs your **stories** as tests in a separate Vitest process, with results in the sidebar. It is the
right tool for running the suite from Storybook and in CI.

It does not read your spec files. The Vitest project it sets up includes the stories globs and nothing else, so an
existing Testing Library spec is neither listed nor runnable there — the same wall as with play functions: the test
has to become a story with a play function first.

This addon indexes the spec files instead, lists them under the stories they use, runs them in the canvas and lets you
stop inside one. The two can be installed together.

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
