import { expect, test } from '@playwright/test';
import { clearSession, login } from './helpers';

// B05/B17/B20 — análise de arquivos na camada mock: envio, veredito, segunda opinião,
// histórico com filtro por resultado, limite de tamanho e o que o colaborador vê.
// O mock reconhece o arquivo de teste EICAR pelo nome: o conteúdo aqui é texto comum, então
// nenhuma assinatura de vírus passa pelo teste (a versão com ClamAV real está em e2e/real/).

const texto = (conteudo: string) => Buffer.from(conteudo, 'utf8');

test.describe('Análise de arquivos', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('analista envia um arquivo limpo e um "EICAR": veredito, SHA-256 e segunda opinião', async ({
    page,
  }) => {
    await login(page, 'analyst');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await nav.getByRole('link', { name: 'Análise de arquivos' }).click();
    await expect(page).toHaveURL(/\/files$/);
    await expect(page.getByTestId('file-privacy')).toContainText('só o hash é consultado no VirusTotal');

    await page
      .getByTestId('file-input')
      .setInputFiles({ name: 'ata-reuniao.txt', mimeType: 'text/plain', buffer: texto('Ata da reunião\n') });
    const verdict = page.getByTestId('file-verdict');
    await expect(verdict).toHaveAttribute('data-result', 'clean');
    await expect(verdict).toContainText('Nenhuma ameaça conhecida encontrada');
    await expect(verdict).not.toContainText(/seguro/i);
    await expect(page.getByRole('button', { name: 'Copiar SHA-256' })).toBeVisible();
    // Hash novo: o mock não conhece, como o VirusTotal faria com um arquivo inédito.
    await expect(page.getByTestId('second-opinion')).toHaveAttribute('data-status', 'unknown');

    await page.getByTestId('file-input').setInputFiles({
      name: 'eicar-teste.com',
      mimeType: 'application/octet-stream',
      buffer: texto('teste'),
    });
    await expect(verdict).toHaveAttribute('data-result', 'threat');
    await expect(verdict).toContainText('Ameaça encontrada');
    await expect(verdict).toContainText('Eicar-Signature');
    await expect(page.getByTestId('second-opinion')).toHaveAttribute('data-status', 'malicious');

    const rows = page.getByTestId('file-history-row');
    await expect(rows.first()).toContainText('eicar-teste.com');
    await expect(rows.filter({ hasText: 'ata-reuniao.txt' })).toContainText('analista@empresa.com');
  });

  test('histórico filtra por resultado e limpa o filtro', async ({ page }) => {
    await login(page, 'analyst');
    await page.goto('/files');
    const rows = page.getByTestId('file-history-row');
    await expect(rows.first()).toBeVisible();

    await page.getByLabel('Resultado').selectOption('threat');
    await expect(rows.first()).toHaveAttribute('data-result', 'threat');
    await expect(rows.and(page.locator('[data-result="clean"]'))).toHaveCount(0);

    await page.getByLabel('Resultado').selectOption('clean');
    await expect(rows.first()).toHaveAttribute('data-result', 'clean');
    await expect(rows.and(page.locator('[data-result="threat"]'))).toHaveCount(0);

    await page.getByLabel('Resultado').selectOption('');
    await expect(rows.and(page.locator('[data-result="threat"]')).first()).toBeVisible();
    await expect(rows.and(page.locator('[data-result="clean"]')).first()).toBeVisible();
  });

  test('arquivo acima de 10 MB é barrado antes do envio', async ({ page }) => {
    await login(page, 'analyst');
    await page.goto('/files');
    await page.getByTestId('file-input').setInputFiles({
      name: 'grande.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await expect(page.getByTestId('form-error')).toContainText('O arquivo passa do limite de 10 MB');
    await expect(page.getByTestId('file-verdict')).toHaveCount(0);
  });

  test('colaborador vê só as próprias análises, sem a coluna de quem enviou', async ({ page }) => {
    await login(page, 'collaborator');
    await page.goto('/files');
    await expect(page.getByText('Suas análises, mais recentes primeiro')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Enviado por' })).toHaveCount(0);
    const rows = page.getByTestId('file-history-row');
    await expect(rows.filter({ hasText: 'proposta-comercial-v3.pdf' })).toHaveCount(1);
    // A análise do EICAR do seed é do analista: não aparece para o colaborador.
    await expect(rows.filter({ hasText: 'eicar.com' })).toHaveCount(0);
  });
});
