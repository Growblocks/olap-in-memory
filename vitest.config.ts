// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['./test/**/*.{ts,js}'],
    exclude: ['./test/helpers/**/*.{ts,js}'],
    coverage: {
      provider: 'v8'
    }
  },
});
