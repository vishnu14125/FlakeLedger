import { test } from 'vitest';

test('hanging test', async () => {
  await new Promise(resolve => setTimeout(resolve, 10000));
});
