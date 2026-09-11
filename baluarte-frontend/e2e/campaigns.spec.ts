import { expect, test } from '@playwright/test';
import { clearSession, login, toast } from './helpers';

test.describe('Campanhas de phishing', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
    await login(page, 'analyst');
  });

  test('lista campanhas com métricas e filtra por status', async ({ page }) => {
    await page.goto('/campaigns');
    const rows = page.getByTestId('campaign-row');
    await expect(rows.first()).toBeVisible();
    await expect(rows).toHaveCount(5);
    await expect(page.getByText('Simulação Q3 – Financeiro')).toBeVisible();
    await page.getByLabel('Status').selectOption('completed');
    await expect.poll(async () => rows.count()).toBe(3);
    await page.getByLabel('Status').selectOption('scheduled');
    await expect.poll(async () => rows.count()).toBe(1);
  });

  test('abre o relatório com funil, gauge e destinatários', async ({ page }) => {
    await page.goto('/campaigns/camp-001');
    await expect(page.getByRole('heading', { name: 'Simulação Q3 – Financeiro' })).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Taxa de clique' })).toBeVisible();
    await expect(page.getByText('Funil da campanha')).toBeVisible();
    await expect(page.getByText('Status dos destinatários')).toBeVisible();
    await expect(page.getByText(/156/).first()).toBeVisible();
    const trainingLink = page.getByRole('link', { name: 'Ver material de treinamento' });
    await expect(trainingLink).toHaveAttribute('href', /\/training\/trn-urgency$/);
  });

  test('cria uma campanha e rejeita destinatários externos', async ({ page }) => {
    await page.goto('/campaigns/new');
    await page.locator('#nome').fill('Simulação E2E – TI');
    await page.getByRole('radio', { name: /Autoridade/ }).check();
    await page.locator('#grupo').selectOption({ label: 'TI' });
    await page.locator('#destinatarios').fill('fulano@gmail.com');
    await page.getByRole('button', { name: 'Agendar campanha' }).click();
    await expect(page.getByText(/@empresa\.com|internos|não autorizado/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/campaigns\/new$/);

    await page.locator('#destinatarios').fill('ana.lima@empresa.com\nbruno.souza@empresa.com');
    await expect(page.getByText('2 destinatários válidos')).toBeVisible();
    await page.getByRole('button', { name: 'Agendar campanha' }).click();
    await expect(toast(page, 'Campanha agendada com sucesso')).toBeVisible();
    await expect(page).toHaveURL(/\/campaigns\/camp-\d+$/);
    await expect(page.getByRole('heading', { name: 'Simulação E2E – TI' })).toBeVisible();
  });

  test('relatório inexistente mostra não encontrado', async ({ page }) => {
    await page.goto('/campaigns/nao-existe');
    await expect(page.getByRole('heading', { name: 'Campanha não encontrada' })).toBeVisible();
  });
});
