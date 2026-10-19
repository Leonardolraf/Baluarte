import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { HttpError } from '@/lib/errors';
import { ACK_REQUIRED_EVENT } from '@/lib/events';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { mockApi } from '@/mocks/api';
import { MOCK_MONITORING_ACKS, MOCK_MONITORING_NOTICE, MOCK_RECIPIENTS, MOCK_USERS } from '@/mocks/data';
import { routes } from '@/routes';
import { notify } from '@/store/uiStore';

// B18 — aviso de monitoramento da estação (RNF-006, LGPD): a página com o texto e o botão de
// ciência, a REAÇÃO AO GATE do servidor (403 CIENCIA_AVISO_PENDENTE, "opção C" de 19/10/2026),
// a lista do Administrador, as regras do mock (espelho da API) e a cópia do texto no mock
// conferida contra o lugar único do texto, o model do backend.
//
// O banner que avisava da ciência pendente foi aposentado: com o gate não existe navegação
// para avisar — enquanto falta a ciência, nenhuma rota autenticada responde.

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
    // O texto de 19/10/2026 traz as frequências nos itens da seção "coletado"; o que não pode
    // é a frequência DESAPARECER, porque ela vem do servidor, do mesmo lugar único do B08.
    const texto = MOCK_MONITORING_NOTICE.sections
      .flatMap((section) => [...section.paragraphs, ...section.items, ...section.notes])
      .join(' ');
    expect(texto).toContain('a cada 15 minutos');
    expect(texto).toContain('a cada 1 hora');
    expect(texto).toContain('a cada 6 horas');
  });

  it('a introdução do servidor aparece no cabeçalho', async () => {
    renderApp('/monitoring', 'collaborator');
    const titulo = await screen.findByRole('heading', { name: MOCK_MONITORING_NOTICE.title }, FIND);
    expect(MOCK_MONITORING_NOTICE.intro.trim()).not.toBe('');
    expect(titulo.closest('header')!.querySelectorAll('p')).toHaveLength(1);
  });

  it('introdução vazia não vira parágrafo vazio', async () => {
    // A introdução vem do servidor e JÁ foi vazia (a versão de 19/10 pela manhã). A guarda da
    // tela precisa de prova própria, forçando o caso aqui, para não depender do texto em vigor:
    // amarrar o teste ao texto atual deixaria a guarda sem cobertura no dia em que ele mudasse.
    const original = mockApi.getMonitoringNotice.bind(mockApi);
    vi.spyOn(mockApi, 'getMonitoringNotice').mockImplementation(async () => ({
      ...(await original()),
      intro: '',
    }));
    renderApp('/monitoring', 'collaborator');
    const titulo = await screen.findByRole('heading', { name: MOCK_MONITORING_NOTICE.title }, FIND);
    expect(titulo.closest('header')!.querySelectorAll('p')).toHaveLength(0);
  });
});

describe('página "Monitoramento da estação"', () => {
  it('mostra o texto vindo da API, a versão e o botão de ciência (texto aprovado, sem a pílula de rascunho)', async () => {
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
    expect(
      screen.getByText('Arquivos pessoais ou documentos armazenados no computador;'),
    ).toBeInTheDocument();
    expect(screen.getByText(/artigo 7º, inciso IX/)).toBeInTheDocument();
    expect(screen.queryByText('Rascunho em aprovação')).not.toBeInTheDocument();
    expect(screen.getByText(MOCK_MONITORING_NOTICE.version)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Li e estou ciente' })).toBeEnabled();
    // O colaborador não vê a lista de ciências.
    await waitForIdle();
    expect(screen.queryByText('Ciências registradas')).not.toBeInTheDocument();
  });

  it('texto novo ainda não aprovado (rascunho) mostra a pílula "Rascunho em aprovação"', async () => {
    const original = mockApi.getMonitoringNotice.bind(mockApi);
    vi.spyOn(mockApi, 'getMonitoringNotice').mockImplementation(async () => ({
      ...(await original()),
      draft: true,
    }));
    renderApp('/monitoring', 'collaborator');
    expect(await screen.findByText('Rascunho em aprovação', {}, FIND)).toBeInTheDocument();
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
    // A página carrega na abertura e de novo depois do 409, para a pessoa ler a versão nova.
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(2), FIND);
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

describe('gate de ciência do servidor (403 CIENCIA_AVISO_PENDENTE)', () => {
  // A camada mock NAO implementa o gate de proposito: ligar isso no mock trancaria toda a
  // demonstracao offline e todas as suites. O mapeamento do 403 para o evento esta provado
  // contra o cliente HTTP de verdade em realApi.test.ts ('403 CIENCIA_AVISO_PENDENTE dispara
  // o evento do aviso'); aqui o que precisa de prova e a REACAO da tela ao evento.
  function exigirCiencia() {
    window.dispatchEvent(
      new CustomEvent(ACK_REQUIRED_EVENT, {
        detail: {
          status: 403,
          code: 'CIENCIA_AVISO_PENDENTE',
          message: 'Confirme que leu o aviso de monitoramento para usar o Baluarte',
        },
      }),
    );
  }

  it('o 403 do gate leva ao aviso e cobra a ciência, em vez de "acesso negado"', async () => {
    renderApp('/dashboard', 'collaborator');
    await screen.findByRole('heading', { name: 'Visão geral de risco' }, FIND);
    exigirCiencia();
    expect(await screen.findByTestId('monitoring-ack-required', {}, FIND)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Li e estou ciente' }, FIND)).toBeEnabled();
  });

  it('depois da ciência, devolve a pessoa à tela que o gate interrompeu', async () => {
    const user = userEvent.setup();
    renderApp('/dashboard', 'collaborator');
    await screen.findByRole('heading', { name: 'Visão geral de risco' }, FIND);
    exigirCiencia();
    await user.click(await screen.findByRole('button', { name: 'Li e estou ciente' }, FIND));
    // O mesmo token ja vale depois da ciencia: a pessoa volta para onde estava.
    expect(await screen.findByRole('heading', { name: 'Visão geral de risco' }, FIND)).toBeInTheDocument();
  });

  it('quem abre o aviso pelo menu não vê a cobrança do gate', async () => {
    renderApp('/monitoring', 'collaborator');
    await screen.findByRole('button', { name: 'Li e estou ciente' }, FIND);
    expect(screen.queryByTestId('monitoring-ack-required')).not.toBeInTheDocument();
  });

  it('já estando no aviso, o 403 não redireciona em laço', async () => {
    renderApp('/monitoring', 'collaborator');
    await screen.findByRole('button', { name: 'Li e estou ciente' }, FIND);
    exigirCiencia();
    await waitForIdle();
    // Sem origem guardada, nao ha o que cobrar nem para onde voltar.
    expect(screen.queryByTestId('monitoring-ack-required')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Li e estou ciente' })).toBeInTheDocument();
  });
});

describe('sessão sob o gate (revalidação com /me)', () => {
  // O gate responde 403 em TODA rota autenticada, /me inclusive. O AuthContext derrubava a
  // sessao em qualquer 403 da revalidacao, o que criava um laco sem saida: login, 403 no /me,
  // "sua sessao expirou", login de novo. A pessoa nunca alcancava a tela do aviso, que exige
  // estar logada. Medido pela suite real em 19/10/2026 (a tela caiu para o layout publico).
  function renderComRevalidacao(role: RBACRole) {
    const user = signIn(role);
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider
          initialSession={{ status: 'authenticated', token: tokenStorage.get(), user }}
          revalidateOnMount
        >
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it('403 de ciência pendente no /me NÃO encerra a sessão', async () => {
    const sair = vi.spyOn(notify, 'info');
    vi.spyOn(mockApi, 'me').mockRejectedValue(
      new HttpError(
        403,
        'CIENCIA_AVISO_PENDENTE',
        'Confirme que leu o aviso de monitoramento para usar o Baluarte',
      ),
    );
    renderComRevalidacao('collaborator');
    expect(await screen.findByRole('heading', { name: 'Visão geral de risco' }, FIND)).toBeInTheDocument();
    await waitForIdle();
    // Continua logado: nenhum aviso de sessao expirada e o token segue guardado.
    expect(sair).not.toHaveBeenCalledWith(expect.stringContaining('sessão expirou'));
    expect(tokenStorage.get()).not.toBeNull();
    expect(screen.queryByText('Página de login')).not.toBeInTheDocument();
  });

  it('403 de permissão no /me continua encerrando a sessão', async () => {
    vi.spyOn(mockApi, 'me').mockRejectedValue(new HttpError(403, 'USUARIO_REMOVIDO', 'Conta removida'));
    renderComRevalidacao('collaborator');
    await waitFor(() => expect(tokenStorage.get()).toBeNull(), FIND);
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
    // Das duas ciências semeadas, só a do Administrador é da versão em vigor: a antiga não
    // conta como pendência resolvida, do mesmo jeito que não vale para o gate.
    const naVersaoAtual = MOCK_MONITORING_ACKS.filter(
      (ack) => ack.version === MOCK_MONITORING_NOTICE.version,
    ).length;
    expect(naVersaoAtual).toBe(1);
    expect(within(list).getByTestId('monitoring-pending')).toHaveTextContent(
      `${active - naVersaoAtual} contas ativas ainda não deram ciência da versão ${MOCK_MONITORING_NOTICE.version}.`,
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

  it('não exclui a conta que tem ciência (409 USUARIO_COM_CIENCIA, como a API); a ciência fica', async () => {
    signIn('admin');
    await expect(mockApi.deleteUser('u-003')).rejects.toMatchObject({
      status: 409,
      code: 'USUARIO_COM_CIENCIA',
      message: 'Usuário com ciência registrada do aviso de monitoramento: inative a conta em vez de excluir',
    });
    expect((await mockApi.listUsers()).some((u) => u.id === 'u-003')).toBe(true);
    const list = await mockApi.listMonitoringAcknowledgements();
    expect(list.items.map((a) => a.user.id).sort()).toEqual(['u-000', 'u-003']);
  });

  it('não exclui quem tem histórico de campanha (409 USUARIO_COM_HISTORICO, como a API)', async () => {
    signIn('admin');
    const emails = new Set(MOCK_RECIPIENTS.map((r) => r.email.toLowerCase()));
    const destinatario = MOCK_USERS.find(
      (u) => u.role !== 'admin' && u.id !== 'u-003' && emails.has(u.email.toLowerCase()),
    );
    expect(destinatario).toBeDefined();
    await expect(mockApi.deleteUser(destinatario!.id)).rejects.toMatchObject({
      status: 409,
      code: 'USUARIO_COM_HISTORICO',
      message: 'Usuário com histórico em campanhas de phishing: inative a conta em vez de excluir',
    });
    expect((await mockApi.listUsers()).some((u) => u.id === destinatario!.id)).toBe(true);
  });

  it('a conta com ciência pode ser inativada e a conta sem ciência continua podendo ser excluída', async () => {
    signIn('admin');
    await expect(mockApi.updateUser('u-003', { status: 'inactive' })).resolves.toMatchObject({
      status: 'inactive',
    });
    expect((await mockApi.listMonitoringAcknowledgements()).total).toBe(2);
    const comHistorico = new Set(MOCK_RECIPIENTS.map((r) => r.email.toLowerCase()));
    const semCiencia = MOCK_USERS.find(
      (u) =>
        u.id !== 'u-000' &&
        u.id !== 'u-003' &&
        u.role !== 'admin' &&
        !comHistorico.has(u.email.toLowerCase()),
    )!;
    await expect(mockApi.deleteUser(semCiencia.id)).resolves.toBeUndefined();
    expect((await mockApi.listUsers()).some((u) => u.id === semCiencia.id)).toBe(false);
  });
});
