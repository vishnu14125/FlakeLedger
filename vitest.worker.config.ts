import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Empty exclude so it can run fixtures!
    exclude: []
  }
});
