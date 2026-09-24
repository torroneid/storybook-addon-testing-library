import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { TodoList } from './TodoList';

const meta: Meta<typeof TodoList> = {
  component: TodoList,
  args: {
    onChange: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithTodos: Story = {
  args: {
    initialTodos: [
      { id: 1, title: 'Write specs', done: false },
      { id: 2, title: 'Review PR', done: true },
      { id: 3, title: 'Ship it', done: false },
    ],
  },
};

export const AllDone: Story = {
  args: {
    initialTodos: [
      { id: 1, title: 'Write specs', done: true },
      { id: 2, title: 'Review PR', done: true },
    ],
  },
};
