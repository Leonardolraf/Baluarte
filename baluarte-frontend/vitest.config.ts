import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Configuração do Vitest (React Testing Library + jsdom).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/__tests__/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      // Meta minima (B03): abaixo disso `npm run test:coverage` falha. Linhas, ramos e funcoes
      // acima dos 70% do RNF-08 (funcoes subiram de 63% para 82% no DT03, com os testes da API real).
      thresholds: { lines: 80, statements: 80, branches: 75, functions: 70 },
    },
  },
});
