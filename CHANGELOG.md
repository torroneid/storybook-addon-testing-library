# Changelog

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
