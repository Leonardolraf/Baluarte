import { test, type Page } from '@playwright/test';
import { login, type DemoRole } from './helpers';

// Captura screenshots de referência das telas (revisão visual / documentação do TCC).
// Só roda com E2E_SCREENSHOTS=1; saída em test-results/screenshots/.
const OUT = 'test-results/screenshots';

const SHOTS: Array<{ name: string; path: string; role: DemoRole; theme?: 'light' | 'dark' }> = [
  { name: 'dashboard-admin', path: '/dashboard', role: 'admin' },
  { name: 'dashboard-admin-dark', path: '/dashboard', role: 'admin', theme: 'dark' },
  { name: 'dashboard-colaborador', path: '/dashboard', role: 'collaborator' },
  { name: 'vulnerabilidades', path: '/vulnerabilities', role: 'analyst' },
  { name: 'vulnerabilidade-detalhe', path: '/vulnerabilities/vuln-001', role: 'analyst' },
  { name: 'ativo-novo', path: '/assets/new', role: 'analyst' },
  { name: 'campanhas', path: '/campaigns', role: 'analyst' },
  { name: 'campanha-relatorio', path: '/campaigns/camp-001', role: 'analyst' },
  { name: 'campanha-nova', path: '/campaigns/new', role: 'analyst' },
  { name: 'usuarios', path: '/users', role: 'admin' },
  { name: 'usuario-novo', path: '/users/new', role: 'admin' },
  { name: 'configuracoes', path: '/settings', role: 'admin' },
  { name: 'treinamento', path: '/training/trn-urgency', role: 'collaborator' },
];

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    const raw = window.localStorage.getItem('baluarte.ui');
    const parsed = raw ? (JSON.parse(raw) as { state?: Record<string, unknown>; version?: number }) : {};
    window.localStorage.setItem(
      'baluarte.ui',
      JSON.stringify({
        ...parsed,
        state: { ...(parsed.state ?? {}), theme: value },
        version: parsed.version ?? 0,
      }),
    );
  }, theme);
}

test.describe('Screenshots de referência', () => {
  test.skip(process.env.E2E_SCREENSHOTS !== '1', 'defina E2E_SCREENSHOTS=1');

  for (const shot of SHOTS) {
    test(shot.name, async ({ page }) => {
      await page.goto('/login');
      await page.evaluate(() => window.localStorage.clear());
      await setTheme(page, shot.theme ?? 'light');
      await login(page, shot.role);
      await page.goto(shot.path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: true });
    });
  }

  test('login-publico', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => window.localStorage.clear());
    await setTheme(page, 'light');
    await page.reload();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/login.png`, fullPage: true });
  });
});
