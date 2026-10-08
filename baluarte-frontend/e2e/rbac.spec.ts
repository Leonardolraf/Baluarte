import { expect, test } from '@playwright/test';
import { clearSession, login } from './helpers';

test.describe('RBAC', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('colaborador não acessa vulnerabilidades, campanhas nem usuários', async ({ page }) => {
    await login(page, 'collaborator');
    for (const path of ['/vulnerabilities', '/campaigns', '/campaigns/new', '/assets/new', '/users']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
    }
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Usuários' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Vulnerabilidades' })).toHaveCount(0);
    await expect(page.getByRole('search')).toHaveCount(0);
  });

  test('analista opera vulnerabilidades e campanhas, mas não gerencia usuários', async ({ page }) => {
    await login(page, 'analyst');
    await page.goto('/vulnerabilities');
    await expect(page.getByRole('heading', { name: 'Vulnerabilidades' })).toBeVisible();
    await page.goto('/campaigns');
    await expect(page.getByRole('heading', { name: 'Campanhas de phishing' })).toBeVisible();
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
    await expect(page.getByText(/restrita ao perfil Administrador/)).toBeVisible();
  });

  test('administrador acessa a gestão de usuários', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Usuários e perfis de acesso' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await expect(nav.getByRole('link', { name: 'Usuários' })).toBeVisible();
  });

  test('evolução do risco (B25b): analista vê o gráfico e percorre os dias pelo teclado; colaborador não vê', async ({
    page,
  }) => {
    await login(page, 'analyst');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Evolução do risco' })).toBeVisible();
    const slider = page.getByRole('slider', { name: /Dia da evolução do risco/ });
    await expect(slider).toHaveAttribute('aria-valuenow', '30');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '29');
    await expect(page.getByTestId('risk-trend-tooltip')).toBeVisible();
    await page.getByText('Ver os 30 dias em tabela').click();
    await expect(page.getByTestId('risk-trend-table').getByRole('row')).toHaveCount(31);

    await clearSession(page);
    await login(page, 'collaborator');
    await page.goto('/dashboard');
    await expect(page.getByRole('meter', { name: 'Risco humano' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Evolução do risco' })).toHaveCount(0);
  });

  test('token adulterado no storage não concede privilégios', async ({ page }) => {
    await login(page, 'collaborator');
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('baluarte.user');
      if (raw) {
        const user = JSON.parse(raw) as Record<string, unknown>;
        user.role = 'admin';
        window.localStorage.setItem('baluarte.user', JSON.stringify(user));
      }
    });
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
  });
});
