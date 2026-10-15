import { expect, test, describe } from 'vitest';
import { isStartOfDay } from '../src/timezone';

describe('Timezone boundaries', () => {
  test('2024-01-01T00:00:00Z should be parsed as start of day', () => {
    // This assumes the local timezone is UTC. If TZ=America/New_York, 
    // new Date('2024-01-01T00:00:00Z') will be 19:00:00 local time, so getHours() === 19.
    const result = isStartOfDay('2024-01-01T00:00:00Z');
    expect(result).toBe(true);
  });
});
