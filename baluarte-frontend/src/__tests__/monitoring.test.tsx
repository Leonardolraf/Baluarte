import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { HttpError } from '@/lib/errors';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { mockApi } from '@/mocks/api';
import { MOCK_MONITORING_NOTICE, MOCK_USERS } from '@/mocks/data';
import { routes } from '@/routes';
import { notify } from '@/store/uiStore';

// B18 — aviso de monitoramento da estação (RNF-006, LGPD): a página com o texto e o botão de
// ciência, o banner enquanto a ciência da versão atual não foi registrada, a lista do
// Administrador, as regras do mock (espelho da API) e a cópia do texto no mock conferida
// contra o lugar único do texto, o model do backend.

const USER_ID_BY_ROLE: Record<RBACRole, string> = { admin: 'u-000', analyst: 'u-001', collaborator: 'u-002' };

function signIn(role: RBACRole, id = USER_ID_BY_ROLE[role]): AuthUser {
  const found = MOCK_USERS.find((u) => u.id === id)!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  tokenStorage.set(buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role }));
  userStorage.set(user);
  return user;
}

function AppRoutes() {
  return useRoutes(routes);
}

function renderApp(path: string, role: RBACRole) {
  const user = signIn(role);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider
        initialSession={{ status: 'authenticated', token: tokenStorage.get(), user }}
        revalidateOnMount={false}
      >
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const FIND = { timeout: 5000 };

async function waitForIdle() {
  await waitFor(() => expect(screen.queryAllByTestId('loading-spinner')).toHaveLength(0), FIND);
}

describe('cópia do texto no mock', () => {
  // O texto mora em backend/src/models/avisoMonitoramento.model.ts, com a frequência de coleta
  // calculada da configuração do agente; a comparação do conteúdo inteiro fica no backend
  // (tests/aviso-monitoramento.test.ts), que avalia o texto de verdade. Aqui, versão e rascunho.
  const sources = import.meta.glob('../../../backend/src/models/avisoMonitoramento.model.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const source = Object.values(sources)[0];

  it.skipIf(!source)('tem a mesma versão e o mesmo rascunho do backend', () => {
    expect(source).toContain(`export const VERSAO_AVISO = '${MOCK_MONITORING_NOTICE.version}';`);
    expect(source).toContain(`export const AVISO_RASCUNHO = ${MOCK_MONITORING_NOTICE.draft};`);
  });

  it('diz a frequência de cada categoria da coleta (B08)', () => {
    expect(MOCK_MONITORING_NOTICE.intro).toContain('as portas de rede abertas a cada 15 minutos');
    expect(MOCK_MONITORING_NOTICE.intro).toContain('a lista de programas instalados a cada 1 hora');
    expect(MOCK_MONITORING_NOTICE.intro).toContain('a versão do sistema operacional a cada 6 horas');
  });
});

describe('página "Monitoramento da estação"', () => {
  it('mostra o texto vindo da API, a versão, o rascunho e o botão de ciência', async () => {
    renderApp('/monitoring', 'collaborator');
    expect(
      await screen.findByRole('heading', { name: 'Monitoramento da estação', level: 1 }, FIND),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: MOCK_MONITORING_NOTICE.title, level: 2 }, FIND),
    ).toBeInTheDocument();
    for (const section of MOCK_MONITORING_NOTICE.sections) {
      expect(screen.getByRole('heading', { name: section.title, level: 3 })).toBeInTheDocument();
    }
    expect(screen.getByText('arquivos e documentos;')).toBeInTheDocument();
    expect(screen.getByText(/art\. 7º, inciso IX/)).toBeInTheDocument();
    expect(screen.getByText('Rascunho em aprovação')).toBeInTheDocument();
    expect(screen.getByText(MOCK_MONITORING_NOTICE.version)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Li e estou ciente' })).toBeEnabled();
    // Na própria página do aviso o banner não aparece, e o colaborador não vê a lista.
    expect(screen.queryByTestId('monitoring-banner')).not.toBeInTheDocument();
    await waitForIdle();
    expect(screen.queryByText('Ciências registradas')).not.toBeInTheDocument();
  });

  it('"Li e estou ciente" registra a versão lida, avisa e troca o botão pela data', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(notify, 'success');
    const acknowledge = vi.spyOn(mockApi, 'acknowledgeMonitoringNotice');
    renderApp('/monitoring', 'collaborator');
    await user.click(await screen.findByRole('button', { name: 'Li e estou ciente' }, FIND));

    expect(await screen.findByTestId('monitoring-ack-done', {}, FIND)).toHaveTextContent(
      'Você registrou ciência desta versão em',
    );
    expect(acknowledge).toHaveBeenCalledWith(MOCK_MONITORING_NOTICE.version);
    expect(success).toHaveBeenCalledWith('Ciência registrada.');
    expect(screen.queryByRole('button', { name: 'Li e estou ciente' })).not.toBeInTheDocument();
    // A ciência fica gravada (quem, quando, qual versão) e vai para a trilha de auditoria.
    const notice = await mockApi.getMonitoringNotice();
    expect(notice.acknowledged).toBe(true);
    signIn('admin');
    const audit = await mockApi.listAuditLog({ action: 'REGISTRAR_CIENCIA_MONITORAMENTO' });
    expect(audit.items[0]).toMatchObject({
      detail: `versao=${MOCK_MONITORING_NOTICE.version}`,
      user: { id: 'u-002' },
    });
  });

  it('texto mudou desde a leitura (409): mostra o erro e recarrega o aviso', async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(notify, 'error');
    vi.spyOn(mockApi, 'acknowledgeMonitoringNotice').mockRejectedValueOnce(
      new HttpError(409, 'VERSAO_DESATUALIZADA', 'O aviso mudou desde a sua leitura'),
    );
    const load = vi.spyOn(mockApi, 'getMonitoringNotice');
    renderApp('/monitoring', 'collaborator');
    await user.click(await screen.findByRole('button', { name: 'Li e estou ciente' }, FIND));
    await waitFor(() => expect(error).toHaveBeenCalledWith('O aviso mudou desde a sua leitura'), FIND);
    // Página + banner (que não aparece aqui, mas consulta) na abertura, e a página de novo depois do 409.
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(3), FIND);
    expect(screen.getByRole('button', { name: 'Li e estou ciente' })).toBeInTheDocument();
  });

  it('quem já deu ciência vê a data, sem botão', async () => {
    renderApp('/monitoring', 'admin');
    expect(await screen.findByTestId('monitoring-ack-done', {}, FIND)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Li e estou ciente' })).not.toBeInTheDocument();
  });

  it('falha ao carregar o aviso mostra o erro com "Tentar novamente"', async () => {
    vi.spyOn(mockApi, 'getMonitoringNotice').mockRejectedValue(
      new HttpError(503, 'SERVICO_INDISPONIVEL', 'Serviço indisponível'),
    );
    renderApp('/monitoring', 'analyst');
    expect(await screen.findByText('Não foi possível carregar o aviso', {}, FIND)).toBeInTheDocument();
  });
});

describe('banner do aviso pendente', () => {
  it('aparece para quem não deu ciência e some depois de registrar', async () => {
    const user = userEvent.setup();
    renderApp('/dashboard', 'collaborator');
    const banner = await screen.findByTestId('monitoring-banner', {}, FIND);
    await user.click(within(banner).getByRole('link', { name: 'Ler o aviso de monitoramento' }));

    await user.click(await screen.findByRole('button', { name: 'Li e estou ciente' }, FIND));
    await screen.findByTestId('monitoring-ack-done', {}, FIND);

    // Volta ao dashboard pelo menu: o banner não volta.
    await user.click(screen.getAllByRole('link', { name: /Dashboard/ })[0]!);
    expect(await screen.findByRole('heading', { name: 'Visão geral de risco' }, FIND)).toBeInTheDocument();
    await waitForIdle();
    expect(screen.queryByTestId('monitoring-banner')).not.toBeInTheDocument();
  });

  it('não aparece para quem já deu ciência da versão atual', async () => {
    renderApp('/dashboard', 'admin');
    expect(await screen.findByRole('heading', { name: 'Visão geral de risco' }, FIND)).toBeInTheDocument();
    await waitForIdle();
    expect(screen.queryByTestId('monitoring-banner')).not.toBeInTheDocument();
  });

  it('não aparece quando o aviso não carrega (o menu continua levando a ele)', async () => {
    vi.spyOn(mockApi, 'getMonitoringNotice').mockRejectedValue(
      new HttpError(503, 'SERVICO_INDISPONIVEL', 'x'),
    );
    renderApp('/dashboard', 'collaborator');
    expect(await screen.findByRole('heading', { name: 'Visão geral de risco' }, FIND)).toBeInTheDocument();
    await waitForIdle();
    expect(screen.queryByTestId('monitoring-banner')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Monitoramento$/ }).length).toBeGreaterThan(0);
  });
});

describe('lista de ciências (Administrador)', () => {
  it('mostra quem deu ciência de qual versão e quantas contas ativas faltam', async () => {
    renderApp('/monitoring', 'admin');
    const list = await screen.findByTestId('monitoring-ack-list', {}, FIND);
    await waitForIdle();
    const rows = within(list).getAllByTestId('monitoring-ack-row');
    expect(rows).toHaveLength(2);
    expect(within(list).getByText('admin@empresa.com')).toBeInTheDocument();
    const active = MOCK_USERS.filter((u) => u.status === 'active').length;
    expect(within(list).getByTestId('monitoring-pending')).toHaveTextContent(
      `${active - 2} contas ativas ainda não deram ciência da versão ${MOCK_MONITORING_NOTICE.version}.`,
    );
  });

  it('filtra pela versão atual no servidor', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(mockApi, 'listMonitoringAcknowledgements');
    renderApp('/monitoring', 'admin');
    await screen.findByTestId('monitoring-ack-list', {}, FIND);
    await waitForIdle();
    await user.selectOptions(screen.getByLabelText('Versão'), 'current');
    await waitFor(
      () =>
        expect(list).toHaveBeenLastCalledWith({
          version: MOCK_MONITORING_NOTICE.version,
          page: 1,
          pageSize: 20,
        }),
      FIND,
    );
  });

  it('Analista não vê a lista', async () => {
    renderApp('/monitoring', 'analyst');
    await screen.findByRole('button', { name: 'Li e estou ciente' }, FIND);
    await waitForIdle();
    expect(screen.queryByTestId('monitoring-ack-list')).not.toBeInTheDocument();
  });
});

describe('mock da API (espelho das regras do servidor)', () => {
  it('ciência idempotente por versão; versão inválida 400; versão antiga 409', async () => {
    signIn('collaborator');
    const first = await mockApi.acknowledgeMonitoringNotice(MOCK_MONITORING_NOTICE.version);
    expect(first.created).toBe(true);
    const again = await mockApi.acknowledgeMonitoringNotice(MOCK_MONITORING_NOTICE.version);
    expect(again).toEqual({ ...first, created: false });
    await expect(mockApi.acknowledgeMonitoringNotice('a b')).rejects.toMatchObject({
      status: 400,
      code: 'VERSAO_INVALIDA',
    });
    await expect(mockApi.acknowledgeMonitoringNotice('2026-01-01')).rejects.toMatchObject({
      status: 409,
      code: 'VERSAO_DESATUALIZADA',
    });
    signIn('admin');
    const audit = await mockApi.listAuditLog({ action: 'REGISTRAR_CIENCIA_MONITORAMENTO' });
    expect(audit.total).toBe(1);
  });

  it('a lista é só do Administrador e pagina', async () => {
    for (const role of ['analyst', 'collaborator'] as const) {
      signIn(role);
      await expect(mockApi.listMonitoringAcknowledgements()).rejects.toMatchObject({
        status: 403,
        code: 'PERFIL_SEM_PERMISSAO',
      });
    }
    signIn('admin');
    const page2 = await mockApi.listMonitoringAcknowledgements({ page: 2, pageSize: 1 });
    expect(page2).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page2.items).toHaveLength(1);
    await expect(mockApi.listMonitoringAcknowledgements({ pageSize: 101 })).rejects.toMatchObject({
      code: 'TAMANHO_INVALIDO',
    });
  });

  it('excluir o usuário leva a ciência dele (como o Cascade do banco)', async () => {
    signIn('admin');
    await mockApi.deleteUser('u-003');
    const list = await mockApi.listMonitoringAcknowledgements();
    expect(list.items.map((a) => a.user.id)).toEqual(['u-000']);
  });
});
