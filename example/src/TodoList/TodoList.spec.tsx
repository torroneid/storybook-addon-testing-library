import { composeStories } from '@storybook/react-vite';
import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { vi } from 'vitest';

import * as stories from './TodoList.stories';

const { Empty, WithTodos, AllDone } = composeStories(stories);

const todoList = () => screen.getByRole('list', { name: 'Todos' });
const checkbox = (title: string) => within(todoList()).getByRole('checkbox', { name: title });

describe('TodoList', () => {
  describe('adding', () => {
    let user: UserEvent;

    // The story is rendered in a hook, so every test below is listed under Empty
    beforeEach(() => {
      user = userEvent.setup();
      render(<Empty />);
    });

    it('adds a todo when Enter is pressed', async () => {
      const input = screen.getByRole('textbox', { name: 'New todo' });

      await user.type(input, 'Buy milk{Enter}');

      expect(checkbox('Buy milk')).not.toBeChecked();
      expect(input).toHaveValue('');
      expect(screen.getByRole('status')).toHaveTextContent('1 item left');
    });

    it('adds several todos in order', async () => {
      const input = screen.getByRole('textbox', { name: 'New todo' });

      await user.type(input, 'First{Enter}');
      await user.type(input, 'Second');
      await user.click(screen.getByRole('button', { name: 'Add' }));

      const titles = within(todoList())
        .getAllByRole('listitem')
        .map(item => item.querySelector('label')?.textContent?.trim());
      expect(titles).toEqual(['First', 'Second']);
    });

    it.for(['', '   '])('ignores a title of %j', async title => {
      await user.type(screen.getByRole('textbox', { name: 'New todo' }), `${title}{Enter}`);

      expect(screen.queryByRole('list', { name: 'Todos' })).not.toBeInTheDocument();
      expect(screen.getByText('Nothing to do')).toBeInTheDocument();
    });
  });

  describe('with todos', () => {
    it('counts what is left as todos are checked', async () => {
      render(<WithTodos />);
      expect(screen.getByRole('status')).toHaveTextContent('2 items left');

      await userEvent.click(checkbox('Write specs'));
      expect(screen.getByRole('status')).toHaveTextContent('1 item left');

      await userEvent.click(checkbox('Review PR'));
      expect(screen.getByRole('status')).toHaveTextContent('2 items left');
    });

    describe.each([
      { filter: 'All', visible: ['Write specs', 'Review PR', 'Ship it'] },
      { filter: 'Active', visible: ['Write specs', 'Ship it'] },
      { filter: 'Done', visible: ['Review PR'] },
    ])('the $filter filter', ({ filter, visible }) => {
      it('shows only the matching todos', async () => {
        render(<WithTodos />);

        await userEvent.click(screen.getByRole('button', { name: filter }));

        expect(within(todoList()).getAllByRole('checkbox')).toHaveLength(visible.length);
        for (const title of visible) {
          expect(checkbox(title)).toBeInTheDocument();
        }
      });

      it('is marked as pressed', async () => {
        render(<WithTodos />);
        const filters = within(screen.getByRole('group', { name: 'Filter' }));

        await userEvent.click(filters.getByRole('button', { name: filter }));

        expect(filters.getByRole('button', { name: filter })).toHaveAttribute('aria-pressed', 'true');
        expect(filters.getAllByRole('button', { pressed: true })).toHaveLength(1);
      });
    });

    it('deletes a todo and reports the new list', async () => {
      const onChange = vi.fn();
      render(<WithTodos onChange={onChange} />);

      await userEvent.click(screen.getByRole('button', { name: 'Delete Review PR' }));

      expect(within(todoList()).queryByRole('checkbox', { name: 'Review PR' })).not.toBeInTheDocument();
      expect(onChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ title: 'Write specs' }),
        expect.objectContaining({ title: 'Ship it' }),
      ]);
    });

    it('clears the completed todos', async () => {
      render(<WithTodos />);

      await userEvent.click(screen.getByRole('button', { name: 'Clear completed' }));

      expect(within(todoList()).getAllByRole('checkbox')).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Clear completed' })).not.toBeInTheDocument();
    });
  });

  it('shows an empty state when a filter matches nothing', async () => {
    render(<AllDone />);

    await userEvent.click(screen.getByRole('button', { name: 'Active' }));

    expect(screen.getByText('Nothing to do')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 items left');
  });

  it.todo('reorders todos by dragging');
});
