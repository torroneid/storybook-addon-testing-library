# Changelog

## Unreleased

- Click a file in a failed test's stack, or above the code shown, to log that line in the browser's console. DevTools
  links it to the source file there, and a click opens it in _Sources_.
- Removed **Debug in DevTools** and its shortcut (Alt+Shift+D). It stopped in DevTools before the step that failed,
  and from there the code that threw was hard to reach. The failures are still logged in the preview's console, where
  DevTools maps the stack to your files and a click opens the line in _Sources_.

- **↻ Re-run failed** in the panel and in the widget, to run only the tests that failed.
- **Only failed**, to list just the tests that failed, and **Next failing story ›**, to go through the failures story
  by story. ⚠ in the widget goes to the next failing story each time, not always the first.
- **</>** on a test logs where it is in the spec file in the browser's console, where a click opens it in _Sources_.
- Results from before a file in the project was saved are marked outdated. **Re-run on save** runs the story's tests
  again on every save.
- Results are kept when Storybook reloads, for as long as the tab is open.
- A failed test can be closed; before, its details always stayed open. Rows work with the keyboard.
- Expected and received values in green and red, a **Copy** button on errors, and the step that failed highlighted,
  with the steps well before it folded away.
- The number of `console.error` calls shows on the test's row, and skipped tests say "skipped" instead of "0 ms".
- Step by step: <kbd>→</kbd> for the next step, <kbd>←</kbd> for the previous one and <kbd>Esc</kbd> to close.

## 0.2.1

- Fix "cannot render when canvasElement is unset" when running tests after the same story was selected twice in quick
  succession. Storybook 10.6 can keep a render of the story that never got a canvas, and the addon remounted it when it
  hid the story. The addon now remounts only the renders that are in the canvas.
- Keep `userEvent.upload` from opening the browser's file picker. When a component clicks its file input itself, like
  a dropzone does, the click from the upload opened the file picker in the middle of the run. While tests run,
  `click()` and `showPicker()` on a file input now do nothing, as in jsdom.
- Fix `expect.any(...)` inside `expect.objectContaining(...)`, which never matched and showed `Any<sample>`.
  Storybook instruments the `expect` in `storybook/test` for the Interactions panel, and that replaced the `String` in
  `expect.any(String)` with a wrapper. The addon now uses the `expect` underneath, since it logs its own steps.

## 0.2.0

- `vi.mock`, `vi.doMock`, `vi.unmock`, `vi.hoisted`, `vi.importActual` and `vi.importMock` in specs and setup files.
  Imports of mocked modules go through proxy modules whose exports are swapped while the spec file runs.
- Fake timers: `vi.useFakeTimers`, `vi.useRealTimers`, `vi.advanceTimersByTime`, `vi.runAllTimers`,
  `vi.setSystemTime` and the rest, on `@sinonjs/fake-timers` like in Vitest

## 0.1.1-0

Prerelease that checks publishing to npm through trusted publishing. No changes to the addon.

## 0.1.0

First release.

- Run Testing Library specs in the Storybook canvas, listed under the stories they use
- Step through a test, with the element it acts on highlighted in the canvas
- DOM snapshots per step, so you can look at earlier steps without re-running the test
