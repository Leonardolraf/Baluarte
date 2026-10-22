import { expect, test } from '@playwright/test';
import { clearSession, login, toast } from './helpers';

// B18 — aviso de monitoramento da estação (camada mock): o colaborador abre o aviso pelo
// menu e registra a ciência; o administrador vê a lista de ciências. O banner que avisava da
// ciência pendente foi aposentado com o gate do servidor (403 CIENCIA_AVISO_PENDENTE), e a
// camada mock não implementa o gate de propósito — ligá-lo trancaria a demonstração offline
// inteira. A reação da tela ao 403 está provada nos testes de unidade (monitoring.test.tsx).
// O estado do mock vive na página: a navegação é toda pela interface (sem page.goto no meio).

test.describe('Aviso de monitoramento da estação', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('colaborador abre o aviso pelo menu e registra a ciência', async ({ page }) => {
    await login(page, 'collaborator');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await nav.getByRole('link', { name: 'Monitoramento' }).click();
    await expect(page).toHaveURL(/\/monitoring$/);
    await expect(page.getByRole('heading', { name: 'Monitoramento da estação', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '3. Quais informações NÃO são coletadas?' }),
    ).toBeVisible();
    // Quem entra pelo menu não foi barrado: a cobrança do gate não aparece.
    await expect(page.getByTestId('monitoring-ack-required')).toHaveCount(0);

    await page.getByRole('button', { name: 'Li e estou ciente' }).click();
    await expect(toast(page, 'Ciência registrada.')).toBeVisible();
    await expect(page.getByTestId('monitoring-ack-done')).toContainText(
      'Você registrou ciência desta versão',
    );

    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Visão geral de risco' })).toBeVisible();
  });

  test('administrador abre pelo menu e vê quem deu ciência', async ({ page }) => {
    await login(page, 'admin');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await nav.getByRole('link', { name: 'Monitoramento' }).click();
    const list = page.getByTestId('monitoring-ack-list');
    await expect(list.getByTestId('monitoring-ack-row')).toHaveCount(2);
    await expect(list.getByText('admin@empresa.com')).toBeVisible();
  });
});
