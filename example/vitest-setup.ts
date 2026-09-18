import { setProjectAnnotations } from '@storybook/react-vite';
import * as matchers from '@testing-library/jest-dom/matchers';
import { beforeAll, expect } from 'vitest';

import * as preview from './.storybook/preview';

expect.extend(matchers);

// composeStories should use the same decorators as Storybook
const annotations = setProjectAnnotations([preview]);

beforeAll(annotations.beforeAll);
