import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/routes';
import { AuthProvider } from '@/contexts/AuthContext';
import { toCampaignReport, type BackendCampaignReport } from '@/services/adapters';
import { configureMocks, mockApi, resetMockState } from '@/mocks/api';
import { HttpError } from '@/lib/errors';
import { tokenStorage, userStorage } from '@/lib/storage';

// B19: links públicos do e-mail simulado da campanha — /t/:token (treinamento, registra o
// clique) e /t/:token/reportar (confirma o reporte) — e os reportes no relatório da campanha.
// A fachada `api` é um Proxy sobre a camada mock nos testes: os espiões vão no `mockApi`.

const TOKEN = 'camp-001-r-01'; // no modo mock, o token do link é o id do destinatário
const TOKEN_SEM_CLIQUE = 'camp-001-r-10'; // destinatário semeado que ainda não clicou nem treinou

function Routed() {
  return useRoutes(routes);
}

function renderAnonymous(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider
        initialSession={{ status: 'anonymous', token: null, user: null }}
        revalidateOnMount={false}
      >
        <Routed />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMockState();
  configureMocks({ latencyMs: [0, 0], failureRate: 0 });
  tokenStorage.clear();
  userStorage.clear();
  vi.restoreAllMocks();
});

describe('adaptador do relatório da campanha', () => {
  const base: BackendCampaignReport = {
    id: 'c1',
    nome: 'Campanha',
    template: 'urgencia',
    status: 'AGENDADA',
    criadoEm: '2026-10-01T10:00:00.000Z',
    destinatarios: 3,
    funil: {
      enviados: { valor: 3, pct: 100 },
      abertos: { valor: 2, pct: 67 },
      clicados: { valor: 1, pct: 33 },
      submeteram: { valor: 0, pct: 0 },
      reportaram: { valor: 2, pct: 67 },
    },
    treinamentos: [
      {
        destinatario: 'ana@empresa.com',
        token: 'ev-1',
        concluido: false,
        reportouEm: '2026-10-01T11:00:00.000Z',
      },
    ],
    reportes: [
      {
        destinatario: 'bruno@empresa.com',
        departamento: 'TI',
        reportouEm: '2026-10-01T10:30:00.000Z',
        clicou: false,
      },
      { destinatario: 'ana@empresa.com', reportouEm: '2026-10-01T11:00:00.000Z', clicou: true },
    ],
  };

  it('mostra quem reportou: junta ao destinatário que clicou e cria linha para quem só reportou', () => {
    const report = toCampaignReport(base);
    expect(report.campaign.metrics.reported).toBe(2);
    expect(report.recipients).toHaveLength(2);
    const ana = report.recipients.find((r) => r.email === 'ana@empresa.com')!;
    expect(ana.reportedAt).toBe('2026-10-01T11:00:00.000Z');
    expect(ana.clickedAt).not.toBeNull();
    const bruno = report.recipients.find((r) => r.email === 'bruno@empresa.com')!;
    expect(bruno).toMatchObject({
      reportedAt: '2026-10-01T10:30:00.000Z',
      clickedAt: null,
      department: 'TI',
    });
    expect(report.timeline.filter((e) => e.kind === 'reported')).toHaveLength(2);
    expect(report.timeline[0].kind).toBe('reported'); // mais recente primeiro
  });

  it('continua funcionando com backend sem `reportes`', () => {
    const { reportes: _ignorado, ...antigo } = base;
    const report = toCampaignReport(antigo);
    expect(report.recipients).toHaveLength(1);
    expect(report.timeline).toHaveLength(1);
  });
});

describe('mockApi — link do e-mail', () => {
  it('abrir registra o clique sem expor a campanha; reportar é idempotente', async () => {
    const training = await mockApi.getTrainingByLink(TOKEN);
    expect(training.id).toBe(TOKEN);
    expect(training.campaignId).toBeNull();

    const first = await mockApi.reportPhishing(TOKEN);
    const second = await mockApi.reportPhishing(TOKEN);
    expect(second.reportedAt).toBe(first.reportedAt);
  });

  it('token desconhecido dá 404', async () => {
    await expect(mockApi.reportPhishing('nao-existe')).rejects.toMatchObject({
      status: 404,
      code: 'LINK_NAO_ENCONTRADO',
    });
    await expect(mockApi.getTrainingByLink('nao-existe')).rejects.toMatchObject({ status: 404 });
  });
});

describe('/t/:token/reportar', () => {
  it('só registra o reporte depois da confirmação', async () => {
    const spy = vi.spyOn(mockApi, 'reportPhishing');
    renderAnonymous(`/t/${TOKEN}/reportar`);

    expect(await screen.findByRole('heading', { name: 'Reportar e-mail suspeito' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reporte' }));
    expect(await screen.findByRole('heading', { name: 'Reporte registrado' })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole('status')).toHaveTextContent(/simulação de phishing/i);
  });

  it('link inválido mostra aviso, sem erro genérico', async () => {
    vi.spyOn(mockApi, 'reportPhishing').mockRejectedValue(
      new HttpError(404, 'LINK_NAO_ENCONTRADO', 'Link de campanha não encontrado'),
    );
    renderAnonymous('/t/qualquer/reportar');
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar reporte' }));
    expect(await screen.findByRole('heading', { name: 'Link inválido' })).toBeInTheDocument();
  });

  it('falha temporária mostra o erro e deixa tentar de novo', async () => {
    vi.spyOn(mockApi, 'reportPhishing').mockRejectedValueOnce(
      new HttpError(503, 'SERVICO_INDISPONIVEL', 'Fora do ar'),
    );
    renderAnonymous(`/t/${TOKEN}/reportar`);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar reporte' }));
    expect(await screen.findByTestId('form-error')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reporte' }));
    expect(await screen.findByRole('heading', { name: 'Reporte registrado' })).toBeInTheDocument();
  });
});

describe('/t/:token (treinamento pelo link, sem login)', () => {
  it('abre o treinamento do template pelo token e conclui sem sessão', async () => {
    const spy = vi.spyOn(mockApi, 'getTrainingByLink');
    renderAnonymous(`/t/${TOKEN_SEM_CLIQUE}`);
    expect(
      await screen.findByRole('heading', { name: 'Reconhecendo golpes de urgência' }),
    ).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(TOKEN_SEM_CLIQUE);
    expect(screen.queryByRole('link', { name: /Voltar ao dashboard/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar como concluído' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Concluído' })).toBeDisabled());
  });

  it('token desconhecido mostra "Treinamento não encontrado"', async () => {
    renderAnonymous('/t/nao-existe');
    expect(await screen.findByText('Treinamento não encontrado')).toBeInTheDocument();
    expect(screen.getByText(/link é inválido/)).toBeInTheDocument();
  });
});
