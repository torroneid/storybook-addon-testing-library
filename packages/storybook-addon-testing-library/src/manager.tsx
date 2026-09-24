import React from 'react';
import { addons, type API, experimental_getStatusStore, types } from 'storybook/manager-api';
import { Addon_TypesEnum, type API_HashEntry } from 'storybook/internal/types';

import { ADDON_ID, PANEL_ID, STATUS_TYPE_ID, TEST_PROVIDER_ID } from './shared/types.ts';
import { DEBUG_SHORTCUT, IconButton } from './manager/components.tsx';
import { Panel, PanelTitle } from './manager/Panel.tsx';
import {
  connectToPreview,
  runTests,
  clearResults,
  debugLastFailure,
  useResults,
  useSpecFiles,
} from './manager/store.ts';
import { TestProviderWidget } from './manager/TestProviderWidget.tsx';

const collectStoryIds = (api: API, entry: API_HashEntry): string[] => {
  if (entry.type === 'story') {
    return [entry.id];
  }
  if (entry.type === 'docs') {
    return [];
  }
  return entry.children.flatMap(id => {
    const children = api.getData(id);
    return children ? collectStoryIds(api, children) : [];
  });
};

const ContextMenu = ({ api, entry }: { api: API; entry: API_HashEntry }) => {
  const specFiles = useSpecFiles();
  const { run } = useResults();
  const storyIds = collectStoryIds(api, entry);
  const count = specFiles
    .flatMap(specFile => specFile.tests)
    .filter(test => test.storyIds.some(id => storyIds.includes(id))).length;
  if (count === 0) {
    return null;
  }
  return (
    <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ flex: 1 }}>Tests ({count})</span>
      <IconButton
        title="Run tests in the canvas"
        aria-label="Run tests in the canvas"
        disabled={!!run}
        onClick={() => runTests({ type: 'stories', storyIds })}
      >
        ▶
      </IconButton>
    </div>
  );
};

// Tests are imported through the Vite dev server, so there is nothing to run in a static build.
if ((globalThis as { CONFIG_TYPE?: string }).CONFIG_TYPE === 'DEVELOPMENT') {
  addons.register(ADDON_ID, api => {
    connectToPreview(api);

    // Listed, and can be changed, under Keyboard shortcuts in Storybook's settings
    api.setAddonShortcut(ADDON_ID, {
      label: 'Debug the last failed test in DevTools',
      defaultShortcut: DEBUG_SHORTCUT,
      actionName: 'debugFailedTest',
      showInMenu: false,
      action: () => {
        const story = api.getCurrentStoryData();
        debugLastFailure(story?.type === 'story' ? story.id : undefined);
      },
    });

    experimental_getStatusStore(STATUS_TYPE_ID).onSelect(() => {
      api.setSelectedPanel(PANEL_ID);
      api.togglePanel(true);
    });

    addons.add(PANEL_ID, {
      type: types.PANEL,
      title: () => <PanelTitle />,
      match: ({ viewMode }) => viewMode === 'story',
      render: ({ active }) => (active ? <Panel /> : null),
    });

    addons.add(TEST_PROVIDER_ID, {
      type: Addon_TypesEnum.experimental_TEST_PROVIDER,
      render: () => <TestProviderWidget api={api} />,
      sidebarContextMenu: ({ context }) => <ContextMenu api={api} entry={context} />,
      clear: clearResults,
    });
  });
}
