import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

// Suíte funcional oficial do produto (B15), em dois modos:
//  - mock (padrão): `npm run test:e2e`. Sobe o dev server na camada mock (porta E2E_PORT,
//    padrão 5173) e roda tudo em `e2e/`, menos `e2e/real/`.
//  - real: `npm run test:e2e:real` (scripts/e2e-real.mjs na raiz do repositório). Sobe banco
//    descartável, API e Vite com VITE_USE_MOCKS=false em portas próprias e roda só `e2e/real/`
//    com E2E_REAL=1 e E2E_BASE_URL apontando para esse Vite.
// Usa o Chrome instalado na máquina (channel "chrome"): não é preciso baixar navegadores.
// Com E2E_BASE_URL o Playwright não sobe servidor nenhum: usa o que estiver nessa URL.
//
// Outros navegadores (B30, RNF-007): `npm run test:e2e:navegadores` (E2E_NAVEGADORES=1) roda a
// suíte mock no Firefox e no WebKit do Playwright (`npx playwright install firefox webkit`) e no
// Edge instalado na máquina (channel "msedge"), em 1366×768, a menor resolução do RNF-007. O
// WebKit do Playwright é o motor do Safari, não o Safari da Apple. Sem o Edge, o projeto dele
// fica de fora (com aviso). A suíte padrão continua só no Chrome.
const REAL = process.env.E2E_REAL === '1';
const NAVEGADORES = process.env.E2E_NAVEGADORES === '1';
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

const RESOLUCAO_MINIMA = { width: 1366, height: 768 };
// Os projetos dos outros navegadores cobrem as telas de desktop (RNF-007): sem o layout mobile
// (é do Pixel 5 no Chrome), sem as capturas de referência e sem o modo real.
const SO_DESKTOP = [/responsive\.spec\.ts/, /screenshots\.spec\.ts/, /[\\/]real[\\/]/];

/** Edge instalado (o channel "msedge" do Playwright usa o da máquina, não baixa nada). */
function edgeInstalado(): boolean {
  const candidatos =
    process.platform === 'win32'
      ? [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA]
          .filter((base): base is string => Boolean(base))
          .map((base) => join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      : process.platform === 'darwin'
        ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/opt/microsoft/msedge/msedge'];
  return candidatos.some((caminho) => existsSync(caminho));
}

function projetosNavegadores(): NonNullable<PlaywrightTestConfig['projects']> {
  const projetos: NonNullable<PlaywrightTestConfig['projects']> = [
    {
      name: 'firefox-desktop',
      testIgnore: SO_DESKTOP,
      use: { ...devices['Desktop Firefox'], viewport: RESOLUCAO_MINIMA },
    },
    {
      name: 'webkit-desktop',
      testIgnore: SO_DESKTOP,
      use: { ...devices['Desktop Safari'], viewport: RESOLUCAO_MINIMA },
    },
  ];
  if (edgeInstalado()) {
    projetos.push({
      name: 'edge-desktop',
      testIgnore: SO_DESKTOP,
      use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: RESOLUCAO_MINIMA },
    });
  } else {
    console.warn(
      '[playwright] Microsoft Edge não encontrado nesta máquina: o projeto edge-desktop fica de fora.',
    );
  }
  return projetos;
}

function projetosMock(): NonNullable<PlaywrightTestConfig['projects']> {
  if (NAVEGADORES) return projetosNavegadores();
  return [
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
  ];
}

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
    : projetosMock(),
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
