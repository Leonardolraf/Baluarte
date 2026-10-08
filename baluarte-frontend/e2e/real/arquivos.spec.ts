import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ANALYST, API_URL, COLLABORATOR, apiToken, bearer, signIn, unique } from './apoio';

// B04/B05/B17/B20 — análise de arquivos contra a API real.
// E2E_CLAMAV diz como a API desta rodada foi configurada (o orquestrador define):
//  - 1: com ClamAV (clamd real) → arquivo limpo, EICAR, histórico com filtro e segunda opinião;
//  - 0: sem CLAMAV_HOST → a rota responde 503 e a tela explica (teste @sem-antivirus).
// Sem a variável, nada daqui roda: não dá para saber o que a API tem.
// A segunda opinião está sempre desligada (a API de teste roda sem VIRUSTOTAL_API_KEY).

const CLAMAV = process.env.E2E_CLAMAV;

/**
 * Arquivo de teste EICAR montado EM MEMÓRIA, a partir de partes: o fonte não contém a
 * assinatura inteira (o antivírus da máquina não marca este arquivo) e nada é gravado em disco.
 * O Playwright entrega o Buffer direto ao <input type="file">.
 */
function eicar(): Buffer {
  const partes = ['X5O!P%@AP[4\\PZX5', '4(P^)7CC)7}$EIC', 'AR-STANDARD-ANTIV', 'IRUS-TEST-FILE!$H+H*'];
  return Buffer.from(partes.join(''), 'ascii');
}

function arquivoLimpo(nome: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name: nome, mimeType: 'text/plain', buffer: Buffer.from(`Relatório E2E ${nome}\n`, 'utf8') };
}

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/** Envia pelo campo de arquivo da tela e devolve a resposta da API à análise. */
async function enviar(page: Page, arquivo: { name: string; mimeType: string; buffer: Buffer }) {
  const resposta = page.waitForResponse(
    (r) => r.url().includes('/api/arquivos/analise') && r.request().method() === 'POST',
  );
  await page.getByTestId('file-input').setInputFiles(arquivo);
  return resposta;
}

test.describe('Análise de arquivos (API real)', () => {
  test('sem ClamAV a API responde 503 e a tela explica que o antivírus não está ativo @sem-antivirus', async ({
    page,
  }) => {
    test.skip(CLAMAV !== '0', 'só com a API sem CLAMAV_HOST (E2E_CLAMAV=0)');
    await signIn(page, ANALYST.email, ANALYST.password);
    await page.goto('/files');
    await expect(page.getByRole('heading', { name: 'Análise de arquivos' })).toBeVisible();

    const resposta = await enviar(page, arquivoLimpo(`${unique('sem-av')}.txt`));
    expect(resposta.status()).toBe(503);
    expect(((await resposta.json()) as { codigoErro: string }).codigoErro).toBe('ANTIVIRUS_INDISPONIVEL');
    await expect(page.getByTestId('form-error')).toContainText(
      'A análise de arquivos não está disponível neste ambiente: o antivírus não está ativo',
    );
    await expect(page.getByTestId('file-verdict')).toHaveCount(0);
    await expect(page.getByTestId('file-upload-progress')).toHaveCount(0);
  });

  test.describe('com ClamAV', () => {
    test.skip(CLAMAV !== '1', 'só com a API ligada a um clamd (E2E_CLAMAV=1)');

    test('arquivo limpo: "Nenhuma ameaça conhecida", SHA-256 conferido e segunda opinião desligada (B20)', async ({
      page,
    }) => {
      await signIn(page, ANALYST.email, ANALYST.password);
      await page.goto('/files');
      const arquivo = arquivoLimpo(`${unique('limpo')}.txt`);
      const resposta = await enviar(page, arquivo);
      expect(resposta.status()).toBe(201);
      const { dados } = (await resposta.json()) as {
        dados: { resultado: string; sha256: string; segundaOpiniao: { situacao: string } };
      };
      expect(dados.resultado).toBe('LIMPO');
      expect(dados.sha256).toBe(sha256(arquivo.buffer));
      expect(dados.segundaOpiniao.situacao).toBe('DESLIGADO');

      const verdict = page.getByTestId('file-verdict');
      await expect(verdict).toHaveAttribute('data-result', 'clean');
      await expect(verdict).toContainText('Nenhuma ameaça conhecida encontrada');
      await expect(page.getByText(sha256(arquivo.buffer))).toBeVisible();

      const opiniao = page.getByTestId('second-opinion');
      await expect(opiniao).toHaveAttribute('data-status', 'disabled');
      await expect(opiniao).toContainText('Segunda opinião desligada neste ambiente');
      await expect(opiniao.getByRole('link', { name: /VirusTotal/ })).toHaveCount(0);

      // Entra no topo do histórico, com quem enviou (operador vê a coluna).
      const linha = page.getByTestId('file-history-row').filter({ hasText: arquivo.name });
      await expect(linha).toHaveAttribute('data-result', 'clean');
      await expect(linha).toContainText('Desligada');
      await expect(linha).toContainText(ANALYST.email);
    });

    test('EICAR gerado em memória: o ClamAV real aponta a ameaça', async ({ page }) => {
      await signIn(page, ANALYST.email, ANALYST.password);
      await page.goto('/files');
      const nome = `${unique('amostra')}.com`;
      const resposta = await enviar(page, {
        name: nome,
        mimeType: 'application/octet-stream',
        buffer: eicar(),
      });
      expect(resposta.status()).toBe(201);
      const { dados } = (await resposta.json()) as { dados: { resultado: string; ameaca: string } };
      expect(dados.resultado).toBe('AMEACA');
      expect(dados.ameaca).toMatch(/eicar/i);

      const verdict = page.getByTestId('file-verdict');
      await expect(verdict).toHaveAttribute('data-result', 'threat');
      await expect(verdict).toContainText('Ameaça encontrada');
      await expect(verdict).toContainText(dados.ameaca);
      await expect(page.getByTestId('file-history-row').filter({ hasText: nome })).toHaveAttribute(
        'data-result',
        'threat',
      );
    });

    test('histórico filtra por resultado no servidor (B17)', async ({ page, request }) => {
      await signIn(page, ANALYST.email, ANALYST.password);
      await page.goto('/files');
      const limpo = arquivoLimpo(`${unique('filtro-limpo')}.txt`);
      const ameaca = `${unique('filtro-ameaca')}.com`;
      expect((await enviar(page, limpo)).status()).toBe(201);
      await expect(page.getByTestId('file-verdict')).toHaveAttribute('data-result', 'clean');
      expect(
        (
          await enviar(page, { name: ameaca, mimeType: 'application/octet-stream', buffer: eicar() })
        ).status(),
      ).toBe(201);
      await expect(page.getByTestId('file-verdict')).toHaveAttribute('data-result', 'threat');

      const rows = page.getByTestId('file-history-row');
      const filtro = page.getByLabel('Resultado');

      let consulta = page.waitForResponse((r) => r.url().includes('/api/arquivos/analises?'));
      await filtro.selectOption('threat');
      expect(new URL((await consulta).url()).searchParams.get('resultado')).toBe('AMEACA');
      await expect(rows.filter({ hasText: ameaca })).toHaveCount(1);
      await expect(rows.filter({ hasText: limpo.name })).toHaveCount(0);
      await expect(rows.and(page.locator('[data-result="clean"]'))).toHaveCount(0);

      consulta = page.waitForResponse((r) => r.url().includes('/api/arquivos/analises?'));
      await filtro.selectOption('clean');
      expect(new URL((await consulta).url()).searchParams.get('resultado')).toBe('LIMPO');
      await expect(rows.filter({ hasText: limpo.name })).toHaveCount(1);
      await expect(rows.filter({ hasText: ameaca })).toHaveCount(0);
      await expect(rows.and(page.locator('[data-result="threat"]'))).toHaveCount(0);

      // O total do filtro é do servidor (resumo), não da página.
      const token = await apiToken(request, ANALYST.email, ANALYST.password);
      const api = await request.get(`${API_URL}/arquivos/analises?resultado=AMEACA&tamanho=100`, {
        headers: bearer(token),
      });
      expect(api.ok()).toBeTruthy();
      const body = (await api.json()) as { dados: Array<{ resultado: string }>; resumo: { total: number } };
      expect(body.dados.every((d) => d.resultado === 'AMEACA')).toBeTruthy();
      expect(body.resumo.total).toBeGreaterThanOrEqual(1);

      await filtro.selectOption('');
      await expect(rows.filter({ hasText: ameaca })).toHaveCount(1);
      await expect(rows.filter({ hasText: limpo.name })).toHaveCount(1);
    });

    test('colaborador analisa e vê só as próprias análises', async ({ page, request }) => {
      await signIn(page, COLLABORATOR.email, COLLABORATOR.password);
      await page.goto('/files');
      await expect(page.getByRole('heading', { name: 'Análise de arquivos' })).toBeVisible();
      const arquivo = arquivoLimpo(`${unique('colab')}.txt`);
      expect((await enviar(page, arquivo)).status()).toBe(201);
      await expect(page.getByTestId('file-verdict')).toHaveAttribute('data-result', 'clean');
      await expect(page.getByText('Suas análises, mais recentes primeiro')).toBeVisible();
      await expect(page.getByTestId('file-history-row').filter({ hasText: arquivo.name })).toHaveCount(1);
      // Sem a coluna "Enviado por" e sem análises de outras pessoas.
      await expect(page.getByRole('columnheader', { name: 'Enviado por' })).toHaveCount(0);

      const token = await apiToken(request, COLLABORATOR.email, COLLABORATOR.password);
      const api = await request.get(`${API_URL}/arquivos/analises?tamanho=100`, { headers: bearer(token) });
      const body = (await api.json()) as { dados: Array<{ nome: string; usuario?: unknown }> };
      expect(body.dados.some((d) => d.nome === arquivo.name)).toBeTruthy();
      expect(body.dados.some((d) => d.nome.startsWith('limpo.') || d.nome.startsWith('filtro-'))).toBeFalsy();
    });
  });
});
