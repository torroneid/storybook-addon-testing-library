import { test } from '../../src/preview/runtime.ts';

test('throws a string', () => {
  throw 'not an error';
});

test('runs afterwards', () => undefined);
