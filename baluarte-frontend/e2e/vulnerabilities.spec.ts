import { expect, test } from '@playwright/test';
import { clearSession, login, toast } from './helpers';

test.describe('Vulnerabilidades', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
    await login(page, 'analyst');
  });

  test('lista, filtra por severidade e busca por CVE', async ({ page }) => {
    await page.goto('/vulnerabilities');
    const rows = page.getByTestId('vuln-row');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    expect(total).toBeGreaterThan(5);

    await page.getByLabel('Severidade').selectOption('critical');
    await expect.poll(async () => rows.count()).toBeLessThan(total);
    for (const badge of await rows.locator('[data-testid="severity-badge"][data-severity]').all()) {
      await expect(badge).toHaveAttribute('data-severity', 'critical');
    }

    await page.getByLabel('Severidade').selectOption('all');
    await page.getByLabel('Buscar', { exact: true }).fill('CVE-2021-44228');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('CVE-2021-44228');
  });

  test('busca global do topo leva à lista filtrada', async ({ page }) => {
    await page.goto('/dashboard');
    const search = page.getByRole('search').getByRole('searchbox');
    await search.fill('xz-utils');
    await search.press('Enter');
    await expect(page).toHaveURL(/\/vulnerabilities\?q=xz-utils$/);
    await expect(page.getByTestId('vuln-row')).toHaveCount(1);
  });

  test('abre o detalhe, navega pelas abas e altera o status', async ({ page }) => {
    await page.goto('/vulnerabilities');
    await page.getByLabel('Buscar', { exact: true }).fill('Log4Shell');
    // A busca é debounced (300 ms): espera a lista filtrar antes de clicar.
    await expect(page.getByTestId('vuln-row')).toHaveCount(1);
    await page.getByTestId('vuln-row').first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/vulnerabilities\/vuln-\d+$/);
    await expect(page.getByText('CVE-2021-44228').first()).toBeVisible();

    await page.getByRole('tab', { name: /Evidências/ }).click();
    await expect(page.getByRole('tabpanel')).toContainText(/Evidência|Requisição|Resposta|Log|Hash/);
    await page.getByRole('tab', { name: /Remediação/ }).click();
    await expect(page.getByRole('tabpanel')).toContainText(/2\.17|Atualiz/);
    await page.getByRole('tab', { name: /Histórico/ }).click();
    await expect(page.getByRole('tabpanel')).toContainText(/Detectada pelo scanner/);

    const select = page.locator('#status');
    const current = await select.inputValue();
    const next = current === 'in_review' ? 'remediating' : 'in_review';
    await select.selectOption(next);
    await page.getByRole('button', { name: 'Atualizar status' }).click();
    await expect(toast(page, 'Status atualizado')).toBeVisible();
    await page.getByRole('tab', { name: /Histórico/ }).click();
    await expect(page.getByRole('tabpanel')).toContainText('Status alterado');
  });

  test('id inexistente mostra estado de não encontrado', async ({ page }) => {
    await page.goto('/vulnerabilities/nao-existe');
    await expect(page.getByRole('heading', { name: 'Vulnerabilidade não encontrada' })).toBeVisible();
  });

  test('cadastra um ativo com validações', async ({ page }) => {
    await page.goto('/assets/new');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText(/obrigatório/i).first()).toBeVisible();
    await page.locator('#nome').fill('Servidor de homologação');
    await page.locator('#tipo').selectOption('server');
    await page.locator('#host').fill('host inválido');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText(/nome DNS válido|Host inválido/i).first()).toBeVisible();
    await page.locator('#host').fill('hml.empresa.com');
    await page.locator('#ip').fill('10.0.9.9');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(toast(page, 'Ativo cadastrado com sucesso')).toBeVisible();
    await expect(page).toHaveURL(/\/vulnerabilities$/);
  });
});
