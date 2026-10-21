import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CampaignFormPage from '@/pages/Campaigns/CampaignFormPage';
import { HttpError } from '@/lib/errors';
import { mockApi, resetMockState, configureMocks } from '@/mocks/api';
import { MOCK_CREDENTIALS } from '@/mocks/data';
import { tokenStorage, userStorage } from '@/lib/storage';

// Melhorias #1 e #2 — formulário de campanha por departamento.
//
// A trava do envio em massa é do SERVIDOR (422 CONFIRMACAO_ENVIO_EM_MASSA). A camada mock
// implementa a mesma regra, mas com os poucos usuários elegíveis do mock ela não dispara —
// por isso o caminho da confirmação é exercido aqui, forçando o erro do servidor, e não no
// Playwright: o que precisa de prova é a REAÇÃO da tela, não o limite do mock.

async function entrarComoAnalista() {
  const cred = MOCK_CREDENTIALS.find((c) => c.email === 'analista@empresa.com')!;
  const resposta = await mockApi.login({ email: cred.email, password: cred.password });
  tokenStorage.set(resposta.token);
  userStorage.set(resposta.user);
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={['/campaigns/new']}>
      <CampaignFormPage />
    </MemoryRouter>,
  );
}

async function preencherCampanhaValida() {
  fireEvent.change(screen.getByLabelText(/Nome da campanha/i), {
    target: { value: 'Simulação de teste' },
  });
  fireEvent.click(screen.getByRole('radio', { name: /Autoridade/ }));
  const grupo = await screen.findByTestId('grupo-alvo');
  // O grupo-alvo virou dropdown (Melhorias #1 e #2): abre pelo botão antes de marcar.
  fireEvent.click(grupo.querySelector('button')!);
  // Marca o primeiro departamento: isso preenche os destinatários sozinho.
  const caixas = grupo.querySelectorAll('input[type="checkbox"]');
  fireEvent.click(caixas[1]!);
  await waitFor(() => expect(screen.getByTestId('resumo-elegiveis')).toHaveTextContent('podem receber'));
}

beforeEach(async () => {
  resetMockState();
  configureMocks({ latencyMs: [0, 0], failureRate: 0 });
  await entrarComoAnalista();
});

afterEach(() => {
  vi.restoreAllMocks();
  tokenStorage.clear();
  userStorage.clear();
});

describe('formulário de campanha por departamento (Melhorias #1 e #2)', () => {
  it('marcar um departamento preenche os destinatários e mostra quem ficou de fora', async () => {
    renderizar();
    await preencherCampanhaValida();

    const destinatarios = screen.getByLabelText(/Destinatários/i) as HTMLTextAreaElement;
    expect(destinatarios.value).toMatch(/@/);
    // A caixa continua editável: a seleção é atalho, não trava.
    expect(destinatarios).not.toBeDisabled();
  });

  it('o 422 do servidor abre a confirmação e NÃO envia; "Revisar antes" fecha sem enviar', async () => {
    const criar = vi
      .spyOn(mockApi, 'createCampaign')
      .mockRejectedValue(
        new HttpError(422, 'CONFIRMACAO_ENVIO_EM_MASSA', 'Envio em massa: confirme com confirmarEnvioTotal'),
      );

    renderizar();
    await preencherCampanhaValida();
    fireEvent.click(screen.getByRole('button', { name: 'Agendar campanha' }));

    const confirmacao = await screen.findByTestId('confirmar-envio-massa');
    expect(confirmacao).toHaveTextContent('não há como cancelar depois do envio');
    // Tentou uma vez (sem confirmação) e parou.
    expect(criar).toHaveBeenCalledTimes(1);
    expect(criar.mock.calls[0]![0]).not.toHaveProperty('confirmMassSend');

    fireEvent.click(screen.getByRole('button', { name: 'Revisar antes' }));
    await waitFor(() => expect(screen.queryByTestId('confirmar-envio-massa')).not.toBeInTheDocument());
    expect(criar).toHaveBeenCalledTimes(1);
  });

  it('confirmar reenvia com confirmMassSend: true (nunca false)', async () => {
    const criar = vi.spyOn(mockApi, 'createCampaign');
    criar.mockRejectedValueOnce(new HttpError(422, 'CONFIRMACAO_ENVIO_EM_MASSA', 'Envio em massa: confirme'));

    renderizar();
    await preencherCampanhaValida();
    fireEvent.click(screen.getByRole('button', { name: 'Agendar campanha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar e enviar' }));

    await waitFor(() => expect(criar).toHaveBeenCalledTimes(2));
    expect(criar.mock.calls[1]![0]).toMatchObject({ confirmMassSend: true });
  });

  it('destinatário com convite pendente aponta para o campo, não para o banner', async () => {
    vi.spyOn(mockApi, 'createCampaign').mockRejectedValue(
      new HttpError(422, 'DESTINATARIO_PENDENTE', 'Destinatário com convite pendente: x@empresa.com'),
    );

    renderizar();
    await preencherCampanhaValida();
    fireEvent.click(screen.getByRole('button', { name: 'Agendar campanha' }));

    await waitFor(() => expect(screen.getByText(/convite pendente/i)).toBeInTheDocument());
    expect(screen.queryByTestId('confirmar-envio-massa')).not.toBeInTheDocument();
  });

  it('envia a um único e-mail sem escolher grupo (o grupo é opcional)', async () => {
    const criar = vi.spyOn(mockApi, 'createCampaign').mockResolvedValue({ id: 'camp-nova' } as never);
    renderizar();
    fireEvent.change(screen.getByLabelText(/Nome da campanha/i), { target: { value: 'Só um e-mail' } });
    fireEvent.click(screen.getByRole('radio', { name: /Autoridade/ }));
    fireEvent.change(screen.getByLabelText(/Destinatários/i), {
      target: { value: 'ana.souza@empresa.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agendar campanha' }));

    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0]![0]).toMatchObject({ recipients: ['ana.souza@empresa.com'] });
    // Nenhuma trava de grupo: não apareceu erro pedindo departamento, e nada bloqueou o envio.
    expect(screen.queryByText(/Selecione ao menos um departamento/i)).not.toBeInTheDocument();
  });

  it('o grupo-alvo é um dropdown: abre pelo botão, marca e fecha com Esc', async () => {
    renderizar();
    const grupo = await screen.findByTestId('grupo-alvo');
    const botao = grupo.querySelector('button')!;

    // Fechado por padrão: as opções não estão no DOM.
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    expect(grupo.querySelector('input[type="checkbox"]')).toBeNull();

    fireEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    // "Todos" + ao menos um departamento aparecem.
    expect(grupo.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(grupo.querySelector('input[type="checkbox"]')).toBeNull());
  });
});
