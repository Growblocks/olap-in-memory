// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['./test/**/*.ts'],
    exclude: ['./test/helpers/**/*.ts',],
    coverage: {
      provider: 'v8'
    }
  },
});
