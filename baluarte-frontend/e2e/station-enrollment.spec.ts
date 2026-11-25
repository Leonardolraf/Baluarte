import { expect, test } from '@playwright/test';
import { clearSession, login } from './helpers';

// #9 — "Vincular estação" (camada mock): o Administrador gera o código de uso único do
// instalador do agente a partir da lista de estações, vê o código uma vez e o revoga.

test.describe('Vincular estação', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('administrador gera o código pela tela e revoga', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/stations');
    await page.getByRole('link', { name: 'Vincular estação' }).click();
    await expect(page).toHaveURL(/\/stations\/enroll$/);
    await expect(page.getByRole('heading', { name: 'Vincular estação' })).toBeVisible();

    await page.getByLabel(/Nome da estação/).fill('Notebook da apresentação');
    await page.getByRole('button', { name: 'Gerar código' }).click();

    const code = page.getByTestId('enrollment-code');
    await expect(code).toHaveText(/^BLT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const row = page.getByTestId('enrollment-row').filter({ hasText: 'Notebook da apresentação' });
    await expect(row).toContainText('Aguardando instalação');

    page.once('dialog', (dialog) => void dialog.accept());
    await row.getByRole('button', { name: /Revogar/ }).click();
    await expect(row).toContainText('Encerrado');
    await expect(page.getByTestId('enrollment-issued')).toHaveCount(0);
  });

  test('analista não vê o botão nem abre a tela', async ({ page }) => {
    await login(page, 'analyst');
    await page.goto('/stations');
    await expect(page.getByTestId('station-row').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vincular estação' })).toHaveCount(0);
    await page.goto('/stations/enroll');
    await expect(page.getByRole('heading', { name: 'Vincular estação' })).toHaveCount(0);
  });
});
