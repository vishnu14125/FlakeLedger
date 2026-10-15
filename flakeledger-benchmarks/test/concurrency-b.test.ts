import { expect, test } from 'vitest';
import { writeResource, readResource } from '../src/shared-resource';

test('resource B', async () => {
  await writeResource('B');
  await new Promise(r => setTimeout(r, 50));
  const val = await readResource();
  expect(val).toBe('B');
});
