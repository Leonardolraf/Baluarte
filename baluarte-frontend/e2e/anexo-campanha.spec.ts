import { expect, test } from '@playwright/test';
import { CREDENTIALS, clearSession, login } from './helpers';

// B23 — regra YARA própria do Baluarte e anexo suspeito de campanha, na camada mock.
// No mock o token do link é o id do destinatário: `camp-002-r-colab` é o colaborador de
// demonstração na campanha de junho (seed). O marcador de teste é inofensivo e montado em partes.

const LINK = 'camp-002-r-colab';
const MARCADOR = ['BALUARTE', 'TESTE', 'AMEACA', '0001', 'ARQUIVO', 'INOFENSIVO'].join('-');

test.describe('Anexo suspeito de campanha (B23)', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('do reporte público ao login e à análise com a campanha pré-selecionada e o rótulo da regra própria', async ({
    page,
  }) => {
    await page.goto(`/t/${LINK}/reportar`);
    await page.getByTestId('send-attachment').click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('#email').fill(CREDENTIALS.collaborator.email);
    await page.locator('#senha').fill(CREDENTIALS.collaborator.password);
    await page.locator('#btnEntrar').click();

    const seletor = page.getByTestId('file-campaign');
    await expect(seletor).toHaveValue(LINK);
    await expect(seletor.locator('option:checked')).toContainText('Campanha Junho 2026 – Urgência');
    await expect(page).toHaveURL(/\/files$/);

    await page.getByTestId('file-input').setInputFiles({
      name: 'comprovante.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`Comprovante\n${MARCADOR}\n`, 'utf8'),
    });
    const verdict = page.getByTestId('file-verdict');
    await expect(verdict).toHaveAttribute('data-result', 'threat');
    await expect(verdict).toContainText('YARA.BaluarteMarcadorTeste.UNOFFICIAL');
    await expect(verdict.getByTestId('own-rule-label')).toHaveText('regra própria do Baluarte');
    await expect(page.getByTestId('result-campaign')).toHaveText('Campanha Junho 2026 – Urgência');

    const linha = page.getByTestId('file-history-row').filter({ hasText: 'comprovante.txt' });
    await expect(linha.getByTestId('own-rule-label')).toBeVisible();
    await expect(linha.getByTestId('history-campaign')).toContainText('Campanha Junho 2026 – Urgência');
  });

  test('o treinamento pelo link do e-mail também oferece o envio do anexo', async ({ page }) => {
    await page.goto(`/t/${LINK}`);
    await expect(page.getByTestId('send-attachment')).toHaveAttribute('href', `/files?link=${LINK}`);
  });

  test('o analista vê os anexos reportados e os vereditos no relatório da campanha', async ({ page }) => {
    await login(page, 'analyst');
    await page.goto('/campaigns/camp-002');
    const card = page.getByTestId('campaign-attachments');
    await expect(card).toContainText('1 anexo reportado');
    const linha = card.getByTestId('campaign-attachment-row').first();
    await expect(linha).toContainText('fatura-junho.pdf');
    await expect(linha).toContainText(CREDENTIALS.collaborator.email);
    await expect(linha).toContainText('Sem ameaça conhecida');
  });
});
