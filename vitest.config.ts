import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/fixtures/**'],
    pool: 'forks', // Use forks for better stability with child_process
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 } // Limit overall suite concurrency to avoid resource exhaustion
    }
  }
});
