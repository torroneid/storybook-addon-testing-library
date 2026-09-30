# Changelog

## Unreleased

- Click a file in a failed test's stack, or above the code shown, to open it at that line in your editor. It goes
  through Storybook's own open-in-editor.
- Removed **Debug in DevTools** and its shortcut (Alt+Shift+D). It stopped in DevTools before the step that failed,
  and from there the code that threw was hard to reach. The failures are still logged in the preview's console, where
  DevTools maps the stack to your files and a click opens the line in _Sources_.

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
