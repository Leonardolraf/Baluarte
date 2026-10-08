import { expect, test } from '@playwright/test';
import { clearSession, login, toast } from './helpers';

// B18 — aviso de monitoramento da estação (camada mock): o colaborador vê o banner, lê o
// aviso pelo menu e registra a ciência; o banner some. O administrador vê a lista de ciências.
// O estado do mock vive na página: a navegação é toda pela interface (sem page.goto no meio).

test.describe('Aviso de monitoramento da estação', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('colaborador lê o aviso, registra a ciência e o banner some', async ({ page }) => {
    await login(page, 'collaborator');
    const banner = page.getByTestId('monitoring-banner');
    await expect(banner).toBeVisible();

    await banner.getByRole('link', { name: 'Ler o aviso de monitoramento' }).click();
    await expect(page).toHaveURL(/\/monitoring$/);
    await expect(page.getByRole('heading', { name: 'Monitoramento da estação', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'O que não é coletado' })).toBeVisible();
    await expect(banner).toHaveCount(0);

    await page.getByRole('button', { name: 'Li e estou ciente' }).click();
    await expect(toast(page, 'Ciência registrada.')).toBeVisible();
    await expect(page.getByTestId('monitoring-ack-done')).toContainText(
      'Você registrou ciência desta versão',
    );

    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Visão geral de risco' })).toBeVisible();
    await expect(banner).toHaveCount(0);
  });

  test('administrador abre pelo menu e vê quem deu ciência', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByTestId('monitoring-banner')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await nav.getByRole('link', { name: 'Monitoramento' }).click();
    const list = page.getByTestId('monitoring-ack-list');
    await expect(list.getByTestId('monitoring-ack-row')).toHaveCount(2);
    await expect(list.getByText('admin@empresa.com')).toBeVisible();
  });
});
