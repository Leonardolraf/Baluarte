import { expect, test } from '@playwright/test';
import { clearSession, login } from './helpers';

// Melhoria 11 — apresentação pública em /home. A raiz NÃO foi promovida (decisão do Leo em
// 14/10): quem abre `/` continua caindo no login, ou no dashboard se já tem sessão.
test.describe('Homepage pública', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('abre sem login e leva a entrar e a conhecer o projeto', async ({ page }) => {
    await page.goto('/home');
    await expect(
      page.getByRole('heading', { name: 'Risco técnico e risco humano no mesmo painel' }),
    ).toBeVisible();
    // Página pública: ninguém é mandado para o login.
    await expect(page).toHaveURL(/\/home$/);

    // O escopo honesto aparece na página, não só na documentação.
    await expect(
      page.getByText(/varredura de vulnerabilidades e o envio de phishing são simulados/i),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Conhecer o projeto' }).click();
    await expect(page).toHaveURL(/\/about$/);

    await page.goto('/home');
    await page.getByRole('link', { name: 'Entrar na plataforma' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a raiz continua como antes: anônimo cai no login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('com sessão aberta, /home mostra a apresentação e o atalho leva ao dashboard', async ({ page }) => {
    await login(page, 'collaborator');

    // A raiz segue levando ao dashboard, como antes desta melhoria.
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto('/home');
    await expect(page).toHaveURL(/\/home$/);
    // 'Ir ao dashboard' também existe no cabeçalho público: aqui vale o da apresentação.
    await page.getByRole('main').getByRole('link', { name: 'Ir ao dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
