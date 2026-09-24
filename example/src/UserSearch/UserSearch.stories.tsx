import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { createFakeSearch } from './fakeUsers';
import { UserSearch } from './UserSearch';

const meta: Meta<typeof UserSearch> = {
  component: UserSearch,
  args: {
    search: createFakeSearch(),
    onSelect: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Slow enough to see the spinner */
export const Slow: Story = {
  args: { search: createFakeSearch({ delay: 1500 }) },
};

export const Failing: Story = {
  args: { search: createFakeSearch({ fail: true }) },
};

/** A play function that a spec can run with SearchedForAda.run() and then continue from */
export const SearchedForAda: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search users' }), 'ada');
    await expect(await canvas.findByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument();
  },
};
