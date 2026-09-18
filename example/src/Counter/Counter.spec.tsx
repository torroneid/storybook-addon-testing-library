import { composeStories } from '@storybook/react-vite';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as stories from './Counter.stories';

const { Default, NearMax } = composeStories(stories);

describe('Counter', () => {
  it('increments when clicked', async () => {
    render(<Default />);

    await userEvent.click(screen.getByRole('button', { name: 'Add one' }));

    expect(screen.getByText('Value: 1')).toBeInTheDocument();
  });

  it.each([
    [2, 'Value: 2'],
    [5, 'Value: 5'],
  ])('shows %s clicks as "%s"', async (clicks, expected) => {
    render(<Default />);

    for (let i = 0; i < clicks; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Add one' }));
    }

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('stops at the maximum', async () => {
    await NearMax.run();

    await userEvent.click(screen.getByRole('button', { name: 'Add one' }));

    expect(screen.getByRole('button', { name: 'Add one' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Maximum reached');
  });
});
