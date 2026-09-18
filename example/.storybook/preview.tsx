import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  decorators: [
    Story => (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
