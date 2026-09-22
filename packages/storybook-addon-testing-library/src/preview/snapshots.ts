/**
 * DOM snapshots for every step, taken with rrweb-snapshot (the library Vitest's trace view uses).
 * They show what the canvas looked like at an earlier step without re-running the test.
 * A new snapshot is only taken when the DOM has changed since the last one.
 */
import { createCache, createMirror, type Mirror, rebuildIntoSandboxedIframe, snapshot } from 'rrweb-snapshot';

type DomSnapshot = NonNullable<ReturnType<typeof snapshot>>;

export const SNAPSHOT_ATTRIBUTE = 'data-testing-library-addon-snapshot';

type Snapshot = {
  node: DomSnapshot;
  bytes: number;
  /** rrweb id of the element the step acts on, used to highlight it during playback */
  elementId?: number;
  scroll: { x: number; y: number };
};

const MAX_SNAPSHOTS = 400;
const MEMORY_BUDGET = 64 * 1024 * 1024;
/** Measuring a snapshot costs about as much as taking it, so a test's size estimate is refreshed only this often */
const MEASURE_EVERY = 10;
const snapshots = new Map<string, Snapshot>();
const sizeEstimates = new Map<string, { bytes: number; age: number }>();
/** Steps that did not change the DOM share one snapshot, which is counted once */
const references = new Map<DomSnapshot, number>();
let usedMemory = 0;

const forget = (key: string) => {
  const stored = snapshots.get(key);
  snapshots.delete(key);
  if (stored) {
    const count = (references.get(stored.node) ?? 1) - 1;
    if (count > 0) {
      references.set(stored.node, count);
    } else {
      references.delete(stored.node);
      usedMemory -= stored.bytes;
    }
  }
};

const snapshotKey = (testKey: string, number: number) => `${testKey}#${number}`;

export const hasSnapshot = (testKey: string, number: number) => snapshots.has(snapshotKey(testKey, number));

// ---------- Changes since the last snapshot ----------

let last: { node: DomSnapshot; mirror: Mirror; bytes: number } | undefined;
let changed = true;
let observer: MutationObserver | undefined;

const markChanged = () => {
  changed = true;
};

const startWatching = () => {
  if (observer) {
    return;
  }
  observer = new MutationObserver(markChanged);
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  // Typing changes the value property, which is not a mutation
  document.addEventListener('input', markChanged, true);
  document.addEventListener('change', markChanged, true);
};

const hasChanged = () => {
  // The observer reports in a microtask, so a change made in the same task is still queued
  if (observer && observer.takeRecords().length > 0) {
    changed = true;
  }
  return changed;
};

const measure = (testKey: string, node: DomSnapshot) => {
  const estimate = sizeEstimates.get(testKey);
  if (estimate && estimate.age < MEASURE_EVERY) {
    estimate.age++;
    return estimate.bytes;
  }
  const bytes = JSON.stringify(node).length;
  sizeEstimates.set(testKey, { bytes, age: 1 });
  return bytes;
};

export const takeSnapshot = (testKey: string, number: number, element: Element | undefined) => {
  try {
    startWatching();
    if (!last || hasChanged()) {
      const mirror = createMirror();
      const node = snapshot(document, {
        mirror,
        blockSelector: `[${SNAPSHOT_ATTRIBUTE}]`,
        inlineStylesheet: true,
        // Scripts never run during playback, and their content would only show up as noise
        slimDOM: { script: true, comment: true },
        // Test data is shown as it is, including password fields (an empty object means no masking)
        maskAllInputs: {},
      });
      // rrweb adds and removes a node in <body> while it works; those are not changes to the page
      observer?.takeRecords();
      if (!node) {
        return false;
      }
      last = { node, mirror, bytes: measure(testKey, node) };
      changed = false;
    }
    const elementId = element ? last.mirror.getId(element) : undefined;
    const key = snapshotKey(testKey, number);
    forget(key);
    snapshots.set(key, {
      node: last.node,
      bytes: last.bytes,
      elementId: elementId && elementId > 0 ? elementId : undefined,
      scroll: { x: window.scrollX, y: window.scrollY },
    });
    const count = references.get(last.node) ?? 0;
    references.set(last.node, count + 1);
    if (count === 0) {
      usedMemory += last.bytes;
    }
    while (snapshots.size > MAX_SNAPSHOTS || (usedMemory > MEMORY_BUDGET && snapshots.size > 1)) {
      forget(snapshots.keys().next().value!);
    }
    return true;
  } catch {
    // Snapshots are a convenience; failing to take one must never fail the test
    return false;
  }
};

export const forgetSnapshotsFor = (testKey: string) => {
  sizeEstimates.delete(testKey);
  for (const key of snapshots.keys()) {
    if (key.startsWith(`${testKey}#`)) {
      forget(key);
    }
  }
};

// ---------- Playback ----------

let frame: HTMLIFrameElement | undefined;

const FRAME_STYLE = [
  'position: fixed',
  'inset: 0',
  'width: 100%',
  'height: 100%',
  'border: none',
  'z-index: 2147483646',
  'background: white',
].join('; ');

const highlightElement = (doc: Document, mirror: Mirror, elementId: number | undefined) => {
  const element = elementId === undefined ? null : mirror.getNode(elementId);
  const view = doc.defaultView;
  if (view && element instanceof view.HTMLElement) {
    element.style.outline = '3px solid #ff4785';
    element.style.outlineOffset = '2px';
    element.scrollIntoView?.({ block: 'nearest' });
  }
};

export const showSnapshot = (testKey: string, number: number) => {
  const stored = snapshots.get(snapshotKey(testKey, number));
  if (!stored) {
    return false;
  }
  hideSnapshot();
  try {
    const mirror = createMirror();
    // rrweb creates the frame itself, sandboxed so scripts in the snapshot cannot run
    const { iframe } = rebuildIntoSandboxedIframe(stored.node, {
      // Outside <body>, so neither the tests nor the DOM cleanup can see the frame
      root: document.documentElement,
      iframeAttributes: { [SNAPSHOT_ATTRIBUTE]: '', title: 'Snapshot of an earlier step', style: FRAME_STYLE },
      cache: createCache(),
      mirror,
    });
    frame = iframe;
    const doc = iframe.contentDocument;
    if (doc) {
      highlightElement(doc, mirror, stored.elementId);
      doc.defaultView?.scrollTo(stored.scroll.x, stored.scroll.y);
    }
    return true;
  } catch {
    hideSnapshot();
    return false;
  }
};

export const hideSnapshot = () => {
  frame?.remove();
  frame = undefined;
};

export const isShowingSnapshot = () => !!frame;
