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
