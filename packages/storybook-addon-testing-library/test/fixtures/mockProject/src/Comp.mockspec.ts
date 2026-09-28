import { vi } from 'vitest';

vi.mock('./useThing.ts', () => ({ useThing: () => 'mocked' }));
