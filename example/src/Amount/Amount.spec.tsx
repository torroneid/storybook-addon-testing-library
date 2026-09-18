import { render, screen } from '@testing-library/react';

import { Amount } from './Amount';

// No composeStories here. The file is still listed under "Other tests in this file"
// because it has the same name as the stories file.
describe('Amount', () => {
  it.each([
    { amount: 12345, expected: '12,345' },
    { amount: 1234567.89, expected: '1,234,568' },
    { amount: 0, expected: '0' },
  ])('formats $amount as $expected', ({ amount, expected }) => {
    render(<Amount amount={amount} />);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('can show a currency', () => {
    render(<Amount amount={100} currency />);

    expect(screen.getByText('100 USD')).toBeInTheDocument();
  });
});
