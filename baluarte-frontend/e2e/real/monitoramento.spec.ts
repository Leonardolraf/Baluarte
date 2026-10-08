import { expect, test } from '@playwright/test';
import {
  ADMIN,
  API_URL,
  SENHA_CONTA,
  aceitarConvite,
  apiCreateUser,
  apiToken,
  bearer,
  signIn,
} from './apoio';

// B18 — aviso de monitoramento da estação contra a API real: o texto vem do servidor (com a
// frequência de coleta do agente), a ciência é gravada por versão e o Administrador a vê na
// lista. Conta nova a cada execução, para o banner aparecer (ninguém nasce com ciência).

test.describe('Aviso de monitoramento da estação (API real)', () => {
  test('colaborador novo lê o aviso, registra a ciência e o Administrador a vê', async ({
    page,
    request,
  }) => {
    const admin = await apiToken(request, ADMIN.email, ADMIN.password);
    const conta = await apiCreateUser(request, admin, 'Colaborador');
    await aceitarConvite(request, conta.email);

    await signIn(page, conta.email, SENHA_CONTA);
    const banner = page.getByTestId('monitoring-banner');
    await expect(banner).toBeVisible();
    await banner.getByRole('link', { name: 'Ler o aviso de monitoramento' }).click();

    await expect(page.getByRole('heading', { name: 'Monitoramento da estação', level: 1 })).toBeVisible();
    await expect(page.getByText(/as portas de rede abertas a cada 15 minutos/)).toBeVisible();
    await page.getByRole('button', { name: 'Li e estou ciente' }).click();
    await expect(page.getByTestId('monitoring-ack-done')).toContainText(
      'Você registrou ciência desta versão',
    );

    // Quem, quando e qual versão ficaram no servidor; repetir não duplica (200).
    const aviso = await request.get(`${API_URL}/monitoramento/aviso`, { headers: bearer(admin) });
    const { versao } = ((await aviso.json()) as { dados: { versao: string } }).dados;
    const lista = await request.get(`${API_URL}/monitoramento/ciencias?tamanho=100`, {
      headers: bearer(admin),
    });
    expect(lista.status()).toBe(200);
    const { dados } = (await lista.json()) as {
      dados: Array<{ versao: string; usuario: { id: string } }>;
    };
    expect(dados.filter((c) => c.usuario.id === conta.id)).toEqual([expect.objectContaining({ versao })]);
    const colaborador = await apiToken(request, conta.email, SENHA_CONTA);
    const repetida = await request.post(`${API_URL}/monitoramento/ciencia`, {
      headers: bearer(colaborador),
      data: { versao },
    });
    expect(repetida.status()).toBe(200);

    // De volta ao dashboard, o banner não aparece mais.
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Visão geral de risco' })).toBeVisible();
    await expect(banner).toHaveCount(0);
  });
});
