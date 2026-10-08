import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ADMIN,
  ANALYST,
  API_URL,
  MAILPIT_URL,
  SENHA_CONTA,
  aceitarConvite,
  apiCreateUser,
  apiToken,
  bearer,
  signIn,
  unique,
} from './apoio';

// B23 — anexo suspeito recebido numa campanha de phishing simulado, contra a API real:
// do link de reporte do e-mail (Mailpit) ao login, à análise com a campanha pré-selecionada e
// ao relatório da campanha visto pelo analista. Precisa de ClamAV (E2E_CLAMAV=1). Com as regras
// YARA do Baluarte carregadas no clamd (E2E_CLAMAV_REGRAS=1, o orquestrador confere), o marcador
// de teste sai como YARA.BaluarteMarcadorTeste.UNOFFICIAL com o rótulo "regra própria do Baluarte".
// O marcador é inofensivo, montado em partes e entregue em memória (nada vai para disco).

const CLAMAV = process.env.E2E_CLAMAV;
const REGRAS = process.env.E2E_CLAMAV_REGRAS === '1';
const MARCADOR = ['BALUARTE', 'TESTE', 'AMEACA', '0001', 'ARQUIVO', 'INOFENSIVO'].join('-');

/** Token do link /t/<token> do e-mail simulado da campanha que chegou no Mailpit. */
async function linkDaCampanha(request: APIRequestContext, email: string): Promise<string> {
  const buscar = async (): Promise<string | undefined> => {
    const busca = await request.get(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (!busca.ok()) return undefined;
    const { messages } = (await busca.json()) as { messages: Array<{ ID: string }> };
    for (const { ID } of messages) {
      const msg = await request.get(`${MAILPIT_URL}/api/v1/message/${ID}`);
      const { Text } = (await msg.json()) as { Text: string };
      const token = /\/t\/([0-9a-f]{64})/.exec(Text)?.[1];
      if (token) return token;
    }
    return undefined;
  };
  await expect.poll(buscar, { message: `e-mail da campanha para ${email} no Mailpit` }).toBeTruthy();
  return (await buscar())!;
}

test.describe('Anexo suspeito de campanha (API real, B23)', () => {
  test.skip(CLAMAV !== '1', 'só com a API ligada a um clamd (E2E_CLAMAV=1)');

  test('do link de reporte ao login, à análise ligada à campanha e ao relatório do analista', async ({
    page,
    request,
  }) => {
    const admin = await apiToken(request, ADMIN.email, ADMIN.password);
    const conta = await apiCreateUser(request, admin, 'Colaborador');
    await aceitarConvite(request, conta.email);
    const analista = await apiToken(request, ANALYST.email, ANALYST.password);
    const nome = unique('Fatura B23');
    const criada = await request.post(`${API_URL}/campaigns`, {
      headers: bearer(analista),
      data: { nome, destinatarios: [conta.email], template: 'urgencia' },
    });
    expect(criada.status()).toBe(201);
    const idCampanha = ((await criada.json()) as { dados: { idCampanha: string } }).dados.idCampanha;
    const token = await linkDaCampanha(request, conta.email);

    // Sem sessão: a página pública do reporte leva ao login e, depois dele, à análise.
    await page.goto('/login');
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`/t/${token}/reportar`);
    await page.getByTestId('send-attachment').click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('#email').fill(conta.email);
    await page.locator('#senha').fill(SENHA_CONTA);
    await page.locator('#btnEntrar').click();

    // A campanha do link vem pré-selecionada e o token sai da barra de endereço.
    const seletor = page.getByTestId('file-campaign');
    await expect(seletor.locator('option:checked')).toContainText(nome);
    await expect(page).toHaveURL(/\/files$/);

    const arquivo = `${unique('comprovante')}.txt`;
    const resposta = page.waitForResponse(
      (r) => r.url().includes('/api/arquivos/analise') && r.request().method() === 'POST',
    );
    await page.getByTestId('file-input').setInputFiles({
      name: arquivo,
      mimeType: 'text/plain',
      buffer: Buffer.from(`Comprovante\n${MARCADOR}\n`, 'utf8'),
    });
    const r = await resposta;
    expect(r.status()).toBe(201);
    expect(new URL(r.url()).searchParams.get('eventoCampanha')).toBeTruthy();
    const { dados } = (await r.json()) as {
      dados: { ameaca: string | null; regraPropria: boolean; campanha: { id: string; nome: string } };
    };
    expect(dados.campanha).toEqual({ id: idCampanha, nome });
    await expect(page.getByTestId('result-campaign')).toHaveText(nome);
    if (REGRAS) {
      expect(dados.ameaca).toBe('YARA.BaluarteMarcadorTeste.UNOFFICIAL');
      expect(dados.regraPropria).toBe(true);
      const verdict = page.getByTestId('file-verdict');
      await expect(verdict).toHaveAttribute('data-result', 'threat');
      await expect(verdict.getByTestId('own-rule-label')).toHaveText('regra própria do Baluarte');
    }

    // O analista vê o anexo no relatório da campanha, com quem enviou e o veredito.
    await signIn(page, ANALYST.email, ANALYST.password);
    await page.goto(`/campaigns/${idCampanha}`);
    const card = page.getByTestId('campaign-attachments');
    await expect(card).toContainText('1 anexo reportado');
    const linha = card.getByTestId('campaign-attachment-row').filter({ hasText: arquivo });
    await expect(linha).toContainText(conta.email);
    if (REGRAS) {
      await expect(linha).toHaveAttribute('data-result', 'threat');
      await expect(linha.getByTestId('own-rule-label')).toBeVisible();
      await expect(card).toContainText('1 com ameaça · 1 por regra própria do Baluarte');
    }
  });
});
