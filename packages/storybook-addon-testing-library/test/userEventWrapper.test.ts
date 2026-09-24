// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { userEvent as storybookUserEvent } from 'storybook/test';
import { afterEach, describe, expect, it } from 'vitest';

import { userEvent } from '../src/preview/wrappers/userEventWrapper.ts';

const Field = ({ name }: { name: string }) => {
  const [value, setValue] = useState('');
  return React.createElement(
    'label',
    null,
    name,
    React.createElement('input', { value, onChange: event => setValue(event.target.value) }),
    React.createElement('output', null, value),
  );
};

afterEach(cleanup);

describe('userEvent in spec files', () => {
  it('lets a play function type after the spec has typed', async () => {
    // Storybook sets up its copy of user-event in the preview document for every story it renders
    storybookUserEvent.setup();

    render(React.createElement(Field, { name: 'Spec' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Spec' }), 'from the spec');
    expect(screen.getByRole('status').textContent).toBe('from the spec');
    cleanup();

    // What a play function does, with the copy of user-event in storybook/test
    render(React.createElement(Field, { name: 'Play' }));
    await storybookUserEvent.type(screen.getByRole('textbox', { name: 'Play' }), 'from the play function');

    expect(screen.getByRole('status').textContent).toBe('from the play function');
  });
});
