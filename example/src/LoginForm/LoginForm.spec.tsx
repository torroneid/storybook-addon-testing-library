import { composeStories } from '@storybook/react-vite';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vitest';

import type { Credentials } from './LoginForm';
import * as stories from './LoginForm.stories';

const { Default, Filled } = composeStories(stories);

const renderFilled = (onSubmit: (credentials: Credentials) => void = vi.fn()) => {
  render(<Filled onSubmit={onSubmit} />);
  return onSubmit;
};

describe('LoginForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows errors for an empty form', async () => {
    const onSubmit = vi.fn();
    render(<Default onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Username is required');
    expect(screen.getByRole('alert')).toHaveTextContent('The password needs at least 8 characters');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a filled in form', async () => {
    const onSubmit = renderFilled();

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ username: 'ada' }));
  });

  describe('password', () => {
    it('requires at least 8 characters', async () => {
      render(<Default onSubmit={vi.fn()} />);

      await userEvent.type(screen.getByLabelText('Username'), 'ada');
      await userEvent.type(screen.getByLabelText('Password'), 'short');
      await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

      expect(screen.getByRole('alert')).toHaveTextContent('The password needs at least 8 characters');
      // The username was typed, so only the password is wrong
      expect(screen.getByRole('alert')).not.toHaveTextContent('Username is required');
    });
  });
});
