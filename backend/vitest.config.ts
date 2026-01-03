import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './backend',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      exclude: ['node_modules', '__tests__', 'graphs/nodes/**'],
    },
  },
});
