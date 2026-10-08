import { defineConfig, devices } from '@playwright/test';

// Suíte funcional oficial do produto (B15), em dois modos:
//  - mock (padrão): `npm run test:e2e`. Sobe o dev server na camada mock (porta E2E_PORT,
//    padrão 5173) e roda tudo em `e2e/`, menos `e2e/real/`.
//  - real: `npm run test:e2e:real` (scripts/e2e-real.mjs na raiz do repositório). Sobe banco
//    descartável, API e Vite com VITE_USE_MOCKS=false em portas próprias e roda só `e2e/real/`
//    com E2E_REAL=1 e E2E_BASE_URL apontando para esse Vite.
// Usa o Chrome instalado na máquina (channel "chrome"): não é preciso baixar navegadores.
// Com E2E_BASE_URL o Playwright não sobe servidor nenhum: usa o que estiver nessa URL.
const REAL = process.env.E2E_REAL === '1';
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: REAL ? './e2e/real' : './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: REAL
    ? [
        {
          name: 'real-chrome-desktop',
          use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } },
        },
      ]
    : [
        {
          name: 'chrome-desktop',
          // e2e/real/ só roda em modo real (E2E_REAL=1); o testIgnore do projeto substitui o global.
          testIgnore: [/responsive\.spec\.ts/, /[\\/]real[\\/]/],
          use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } },
        },
        {
          name: 'chrome-mobile',
          testMatch: /responsive\.spec\.ts/,
          use: { ...devices['Pixel 5'], channel: 'chrome' },
        },
      ],
  webServer:
    process.env.E2E_BASE_URL || REAL
      ? undefined
      : {
          command: `npm run dev -- --port ${PORT} --strictPort`,
          url: `${BASE_URL}/login`,
          reuseExistingServer: true,
          timeout: 90_000,
        },
});
