import { composeStories } from '@storybook/react-vite';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { createFakeSearch, USERS } from './fakeUsers';
import * as stories from './UserSearch.stories';
import type { User } from './UserSearch';

const { Default } = composeStories(stories);

const { NEW_USER } = vi.hoisted(() => ({
  NEW_USER: { id: 'barbara', name: 'Barbara Liskov', email: 'barbara@example.com' },
}));

// The component gets its search from the story, so the spec calls the mocked createFakeSearch itself
vi.mock('./fakeUsers', async importOriginal => ({
  ...(await importOriginal<typeof import('./fakeUsers')>()),
  createFakeSearch: () => async () => [NEW_USER],
}));

const searchbox = () => screen.getByRole('searchbox', { name: 'Search users' });

describe('UserSearch with mocks', () => {
  it('searches with the mocked module', async () => {
    render(<Default search={createFakeSearch()} />);

    await userEvent.type(searchbox(), 'barbara');

    expect(await screen.findByRole('button', { name: /Barbara Liskov/ })).toBeInTheDocument();
    // What the factory kept from the original module
    expect(USERS).toHaveLength(5);
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      // Testing Library waits for a setTimeout after each interaction, so the fake clock also follows real time
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('searches once the typing has stopped for the debounce time', async () => {
      const search = vi.fn(async (_query: string): Promise<User[]> => [USERS[0]!]);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<Default search={search} debounceMs={1000} />);

      await user.type(searchbox(), 'ada');
      expect(search).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(1000));

      expect(search).toHaveBeenCalledExactlyOnceWith('ada');
      expect(screen.getByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument();
    });
  });
});
