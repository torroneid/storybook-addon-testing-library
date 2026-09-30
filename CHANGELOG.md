# Changelog

## Unreleased

- Debug in DevTools now shows where the error was thrown. Before it stops, the debug run logs the errors from the
  test's last run in the Console, where DevTools maps the stacks to your source files: click the line in your code, set
  a breakpoint and resume (F8), and the test stops there. Before, it only stopped ahead of the step that failed, and
  getting from there to an error in a component meant stepping through the addon and all of user-event.

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
