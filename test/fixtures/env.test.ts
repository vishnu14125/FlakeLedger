import { test, expect } from 'vitest';

test('env test', () => {
  expect(process.env.TEST_VAL).toBeDefined();
});
