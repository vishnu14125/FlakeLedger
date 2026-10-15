import { expect, test } from 'vitest';

export function add(a: number, b: number) {
  return a + b;
}

test('stable control test', () => {
  expect(add(1, 2)).toBe(3);
  expect(add(-1, 1)).toBe(0);
});
