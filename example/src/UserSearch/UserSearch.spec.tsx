import { composeStories } from '@storybook/react-vite';
import { act, render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { USERS } from './fakeUsers';
import * as stories from './UserSearch.stories';
import type { User } from './UserSearch';

const { Default, Slow, Failing, SearchedForAda } = composeStories(stories);

const [ADA, GRACE] = USERS as [User, User];

const searchbox = () => screen.getByRole('searchbox', { name: 'Search users' });

describe('UserSearch', () => {
  it('shows a spinner while searching, then the results', async () => {
    // The slow story answers after 1.5 s, so the spinner is there long enough to see it
    render(<Slow />);

    await userEvent.type(searchbox(), 'example');

    expect(await screen.findByRole('progressbar', { name: 'Loading users' })).toBeInTheDocument();
    await waitForElementToBeRemoved(() => screen.queryByRole('progressbar'), { timeout: 3000 });
    const results = within(screen.getByRole('list', { name: 'Results' }));
    expect(results.getAllByRole('button')).toHaveLength(USERS.length);
  });

  it('waits for two letters, and for the typing to stop', async () => {
    const search = vi.fn(async (_query: string): Promise<User[]> => []);
    render(<Default search={search} />);

    await userEvent.type(searchbox(), 'a');
    await userEvent.type(searchbox(), 'da');

    expect(await screen.findByText('No users match “ada”')).toBeInTheDocument();
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith('ada');
  });

  it('shows an error when the server is down', async () => {
    render(<Failing />);

    await userEvent.type(searchbox(), 'ada');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load users');
    expect(screen.queryByRole('list', { name: 'Results' })).not.toBeInTheDocument();
  });

  it('searches again when you try again', async () => {
    const search = vi.fn<(query: string) => Promise<User[]>>();
    search.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([ADA]);
    render(<Default search={search} />);
    await userEvent.type(searchbox(), 'ada');
    const alert = await screen.findByRole('alert');

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('shows the answer to the latest query, even when an earlier one arrives later', async () => {
    // Every search waits until the test answers it
    const answers = new Map<string, (users: User[]) => void>();
    const search = vi.fn((query: string) => new Promise<User[]>(resolve => answers.set(query, resolve)));
    render(<Default search={search} debounceMs={0} />);

    await userEvent.type(searchbox(), 'gr');
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('gr'));
    await userEvent.type(searchbox(), 'a');
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('gra'));

    // The answers arrive in the wrong order
    await act(async () => answers.get('gra')?.([GRACE]));
    await act(async () => answers.get('gr')?.(USERS));

    const results = within(screen.getByRole('list', { name: 'Results' }));
    expect(results.getAllByRole('button')).toHaveLength(1);
    expect(results.getByRole('button', { name: /Grace Hopper/ })).toBeInTheDocument();
  });

  it('continues from the story’s play function', async () => {
    // Runs the story's play function, which searches for Ada and waits for the result
    await SearchedForAda.run();

    await userEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));

    expect(screen.getByText('Selected: Ada Lovelace')).toBeInTheDocument();
    expect(searchbox()).toHaveValue('');
    expect(SearchedForAda.args.onSelect).toHaveBeenLastCalledWith(ADA);
  });
});
