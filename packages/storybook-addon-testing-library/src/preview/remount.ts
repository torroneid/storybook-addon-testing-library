/** The internal fields of Storybook's preview (`window.__STORYBOOK_PREVIEW__`) that remounting uses */
export type StoryPreview = {
  storyRenders?: Array<{ id: string; canvasElement?: unknown; remount: () => Promise<void> }>;
};

/**
 * Remounts the renders of a story that are in the canvas.
 * Storybook's own `onForceRemount` also remounts renders that never got a canvas, and they throw
 * "cannot render when canvasElement is unset". Storybook 10.6 leaves such a render in `storyRenders` when the same
 * story is selected twice in quick succession: the first render is torn down while it prepares, but is still added.
 */
export const remountStory = async (preview: StoryPreview | undefined, storyId: string) => {
  const renders = preview?.storyRenders ?? [];
  await Promise.all(renders.filter(r => r.id === storyId && r.canvasElement).map(r => r.remount()));
};
