import { expect, test } from 'vitest';
import { writeResource, readResource } from '../src/shared-resource';

test('resource A', async () => {
  await writeResource('A');
  // artificial delay to increase chance of collision
  await new Promise(r => setTimeout(r, 50));
  const val = await readResource();
  expect(val).toBe('A');
});
