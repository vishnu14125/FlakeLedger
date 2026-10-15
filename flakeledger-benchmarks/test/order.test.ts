import { expect, test, describe } from 'vitest';
import { getItems, addItem } from '../src/store';

describe('Store functionality', () => {
  // If this test runs AFTER 'can add an item', it will fail because state leaked
  test('should be empty initially', () => {
    expect(getItems()).toHaveLength(0);
  });

  test('can add an item', () => {
    addItem('apple');
    expect(getItems()).toContain('apple');
  });
});
