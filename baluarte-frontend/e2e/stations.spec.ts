import { expect, test } from '@playwright/test';
import { clearSession, login } from './helpers';

// B13 — estações monitoradas pelo agente osquery (camada mock): lista com status
// online/offline, detalhe com programas instalados e portas abertas, e o RBAC da tela.

test.describe('Estações monitoradas', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('analista vê a lista, abre a estação e navega por programas e portas', async ({ page }) => {
    await login(page, 'analyst');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await nav.getByRole('link', { name: 'Estações' }).click();
    await expect(page).toHaveURL(/\/stations$/);
    await expect(page.getByRole('heading', { name: 'Estações monitoradas' })).toBeVisible();

    const rows = page.getByTestId('station-row');
    await expect(rows).toHaveCount(5);
    await expect(page.getByText('4 online · 1 offline')).toBeVisible();
    const offline = rows.filter({ hasText: 'RH-NB-03' });
    await expect(offline).toContainText('Offline');
    await expect(offline).toContainText('Microsoft Windows 10 Pro');
    const linux = rows.filter({ hasText: 'dev-ws-02' });
    await expect(linux).toContainText('Online');
    await expect(linux).toContainText('Ubuntu 22.04.4 LTS');

    await linux.getByRole('link', { name: 'dev-ws-02' }).click();
    await expect(page).toHaveURL(/\/stations\/ws-002$/);
    await expect(page.getByRole('heading', { name: 'dev-ws-02' })).toBeVisible();

    const panel = page.getByRole('tabpanel');
    await expect(page.getByRole('tab', { name: /Programas instalados/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('software-row')).toHaveCount(8);
    await page.getByLabel('Filtrar programas').fill('openssl');
    await expect(page.getByTestId('software-row')).toHaveCount(1);
    await expect(panel).toContainText('3.0.2-0ubuntu1.18');

    await page.getByRole('tab', { name: /Portas abertas/ }).click();
    await expect(page.getByTestId('port-row')).toHaveCount(4);
    const postgres = page.getByTestId('port-row').filter({ hasText: '5432' });
    await expect(postgres).toContainText('127.0.0.1');
    await expect(postgres).toContainText('postgres');

    await page
      .getByRole('navigation', { name: 'Trilha de navegação' })
      .getByRole('link', { name: 'Estações' })
      .click();
    await expect(page).toHaveURL(/\/stations$/);
  });

  test('estação offline e id inexistente', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/stations/ws-003');
    await expect(page.getByRole('heading', { name: 'RH-NB-03' })).toBeVisible();
    await expect(page.getByText('Offline').first()).toBeVisible();
    await page.goto('/stations/nao-existe');
    await expect(page.getByRole('heading', { name: 'Estação não encontrada' })).toBeVisible();
  });

  test('colaborador não vê o item no menu e recebe "Acesso negado"', async ({ page }) => {
    await login(page, 'collaborator');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await expect(nav.getByRole('link', { name: 'Estações' })).toHaveCount(0);
    for (const path of ['/stations', '/stations/ws-001']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
    }
  });
});
