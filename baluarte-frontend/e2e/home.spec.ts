import { expect, test } from '@playwright/test';
import { clearSession, login } from './helpers';

// Melhoria 11 — apresentação pública. A raiz `/` renderiza a HomePage para todo mundo
// (decisão do Leo em 20/10, revendo a de 14/10): é a porta de entrada da demonstração, pública
// com ou sem sessão. `/home` serve a mesma página, para não quebrar links existentes.
test.describe('Homepage pública', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('a raiz abre a apresentação sem login e leva a entrar e a conhecer o projeto', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Risco técnico e risco humano no mesmo painel' }),
    ).toBeVisible();
    // Página pública: a raiz não manda ninguém para o login.
    await expect(page).toHaveURL(/\/$/);

    // O escopo honesto aparece na página, não só na documentação.
    await expect(
      page.getByText(/varredura de vulnerabilidades e o envio de phishing são simulados/i),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Conhecer o projeto' }).click();
    await expect(page).toHaveURL(/\/about$/);

    await page.goto('/');
    await page.getByRole('link', { name: 'Entrar na plataforma' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/home serve a mesma apresentação (link antigo não quebra)', async ({ page }) => {
    await page.goto('/home');
    await expect(
      page.getByRole('heading', { name: 'Risco técnico e risco humano no mesmo painel' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/home$/);
  });

  test('com sessão aberta, a raiz mostra a apresentação e o atalho leva ao dashboard', async ({ page }) => {
    await login(page, 'collaborator');

    // Agora a raiz é pública mesmo com sessão: não quica mais para o dashboard.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('heading', { name: 'Risco técnico e risco humano no mesmo painel' }),
    ).toBeVisible();

    // Quem tem sessão vê o atalho para o dashboard na própria apresentação.
    await page.getByRole('main').getByRole('link', { name: 'Ir ao dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('deep link protegido continua exigindo login', async ({ page }) => {
    // A raiz virar pública não afrouxa as rotas protegidas: /vulnerabilities sem sessão → login.
    await page.goto('/vulnerabilities');
    await expect(page).toHaveURL(/\/login$/);
  });
});
