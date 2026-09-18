import type { Meta, StoryObj } from '@storybook/react-vite';

import { Amount } from './Amount';

const meta = {
  component: Amount,
  args: { amount: 1234567.89 },
} satisfies Meta<typeof Amount>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithCurrency: Story = {
  args: { currency: true },
};
