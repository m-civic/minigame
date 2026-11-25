import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  test: {
    include: ['scripts/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 15000,
    // Preizkusi uporabljajo lokalno shrambo in nikoli zunanjih računov ali baze.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: '',
      DIRECT_URL: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: ''
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'backend/src/**/*.ts'],
      // Tipi in izvozni indeksi nimajo izvedljive aplikacijske logike.
      exclude: ['src/types/**', 'src/**/index.ts'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      reportOnFailure: true
    }
  }
});
