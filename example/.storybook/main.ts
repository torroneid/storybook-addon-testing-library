import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: [
    {
      name: 'storybook-addon-testing-library',
      options: {
        // The same setup Vitest uses (see vite.config.ts), so composeStories gets the project annotations
        setupFiles: ['vitest-setup.ts'],
      },
    },
  ],
  framework: '@storybook/react-vite',
};

export default config;
