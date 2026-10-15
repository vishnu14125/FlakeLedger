import { expect, test } from 'vitest';

test('async timing race', async () => {
  let counter = 0;
  
  // A simulated async background process that yields to the event loop
  const backgroundWork = async () => {
    for (let i = 0; i < 5; i++) {
      counter++;
      await new Promise(resolve => setImmediate(resolve));
    }
  };

  // Bug: Developer forgot to await the async function
  backgroundWork();

  // Developer adds a flaky "sleep" to wait for the background task to finish
  // Sometimes this wait is long enough, sometimes it's not.
  await new Promise(resolve => setTimeout(resolve, 1));
  
  // Depending on event loop scheduling, counter will be between 1 and 5
  expect(counter).toBe(5);
});
