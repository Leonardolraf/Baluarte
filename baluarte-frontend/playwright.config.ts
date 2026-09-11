import { defineConfig, devices } from '@playwright/test';

// Testes ponta a ponta contra o servidor de desenvolvimento (camada mock).
// Usa o Chrome instalado na máquina (channel "chrome"): não é preciso baixar navegadores.
// Rode `npm run test:e2e`; com `E2E_BASE_URL` é possível apontar para outro servidor.
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome-desktop',
      testIgnore: /responsive\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chrome-mobile',
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices['Pixel 5'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/login',
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
