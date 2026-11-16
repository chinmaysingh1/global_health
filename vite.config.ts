import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const SERVER = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': SERVER, '/mock-intelehealth': SERVER },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
  },
});
