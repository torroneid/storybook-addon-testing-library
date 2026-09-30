// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { remountStory, type StoryPreview } from '../src/preview/remount.ts';

const fakeRender = (id: string, canvasElement?: unknown) => ({ id, canvasElement, remount: vi.fn(async () => {}) });

describe('remountStory', () => {
  it('remounts only the renders of the story that have a canvas', async () => {
    const inCanvas = fakeRender('a--story', document.createElement('div'));
    const withoutCanvas = fakeRender('a--story');
    const otherStory = fakeRender('b--story', document.createElement('div'));

    await remountStory({ storyRenders: [inCanvas, withoutCanvas, otherStory] }, 'a--story');

    expect(inCanvas.remount).toHaveBeenCalledTimes(1);
    expect(withoutCanvas.remount).not.toHaveBeenCalled();
    expect(otherStory.remount).not.toHaveBeenCalled();
  });

  it('does nothing without a preview', async () => {
    await expect(remountStory(undefined, 'a--story')).resolves.toBeUndefined();
  });

  // storyRenders, canvasElement and remount are internal to Storybook, so this fails if a Storybook upgrade changes them
  it("finds a rendered story in Storybook's preview", async () => {
    document.body.innerHTML = '<div id="storybook-root"></div><div id="storybook-docs"></div>';
    const index = {
      v: 5,
      entries: {
        'a--story': { type: 'story', id: 'a--story', name: 'Story', title: 'A', importPath: './a.stories.js' },
      },
    };
    // Storybook reads fetch when its module loads
    vi.stubGlobal('fetch', async () => ({ status: 200, json: async () => index }));
    window.history.replaceState({}, '', '/iframe.html?id=a--story&viewMode=story');
    const { PreviewWeb, addons, mockChannel } = await import('storybook/preview-api');
    const { STORY_RENDERED } = await import('storybook/internal/core-events');
    const channel = mockChannel();
    addons.setChannel(channel);
    const rendered = new Promise(resolve => channel.once(STORY_RENDERED, resolve));

    const renderToCanvas = vi.fn(({ showMain }: { showMain: () => void }, canvasElement: HTMLElement) => {
      canvasElement.textContent = 'story';
      showMain();
    });
    const preview = new PreviewWeb(
      async () => ({ default: { title: 'A' }, Story: {} }),
      () => ({ render: () => null, renderToCanvas }),
    ) as unknown as StoryPreview;
    await rendered;

    expect(preview.storyRenders).toEqual([
      expect.objectContaining({ id: 'a--story', canvasElement: document.getElementById('storybook-root') }),
    ]);
    await remountStory(preview, 'a--story');
    expect(renderToCanvas).toHaveBeenCalledTimes(2);
  });
});
