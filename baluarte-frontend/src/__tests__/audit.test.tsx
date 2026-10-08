import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuditLogPage from '@/pages/Audit/AuditLogPage';
import { configureMocks, mockApi, resetMockState } from '@/mocks/api';
import { MOCK_AUDIT_LOG, MOCK_CREDENTIALS } from '@/mocks/data';
import { httpClient, realApi } from '@/services/api';
import { toAuditEntry, toAuditIntegrity, toAuditList } from '@/services/adapters';
import { auditActionLabel } from '@/lib/audit';
import { localDayRange } from '@/lib/format';
import { HttpError } from '@/lib/errors';
import { tokenStorage, userStorage } from '@/lib/storage';

// B12 — trilha de auditoria: rótulos, adapter, camada mock (RBAC, filtros, paginação),
// chamada real (parâmetros de query) e a tela (filtro por ação, período e paginação).
// B29 — verificação da cadeia de hash: adapter, mock, chamada real e o selo da tela.

async function loginAs(email: string) {
  const cred = MOCK_CREDENTIALS.find((c) => c.email === email)!;
  const response = await mockApi.login({ email: cred.email, password: cred.password });
  tokenStorage.set(response.token);
  userStorage.set(response.user);
}

async function expectHttp(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(
    () => {
      throw new Error('esperava falha');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  expect((err as HttpError).code).toBe(code);
}

beforeEach(() => {
  resetMockState();
  configureMocks({ latencyMs: [0, 0], failureRate: 0 });
});

describe('auditActionLabel', () => {
  it('usa o rótulo conhecido e deriva um legível para ação nova', () => {
    expect(auditActionLabel('CRIAR_ATIVO')).toBe('Ativo cadastrado');
    expect(auditActionLabel('ANALISAR_ARQUIVO')).toBe('Arquivo analisado');
    expect(auditActionLabel('INSCREVER_ESTACAO')).toBe('Estação inscrita');
    expect(auditActionLabel('APLICAR_RETENCAO_AUDITORIA')).toBe('Retenção da auditoria aplicada');
    expect(auditActionLabel('COLETAR_INVENTARIO')).toBe('Coletar inventario');
    expect(auditActionLabel('INSCREVER__ESTACAO')).toBe('Inscrever estacao');
    expect(auditActionLabel('___')).toBe('___');
  });
});

describe('adapters de auditoria', () => {
  it('converte registro e resumo do servidor', () => {
    const entry = toAuditEntry({
      id: 'a1',
      acao: 'LOGIN',
      detalhe: null,
      quando: '2026-10-08T12:00:00.000Z',
      usuario: { id: 'u-1', nome: 'Ana', email: 'ana@empresa.com' },
    });
    expect(entry).toEqual({
      id: 'a1',
      action: 'LOGIN',
      detail: null,
      at: '2026-10-08T12:00:00.000Z',
      user: { id: 'u-1', name: 'Ana', email: 'ana@empresa.com' },
    });
    const list = toAuditList(
      [{ id: 'a2', acao: 'X', detalhe: 'd', quando: '2026-10-08T12:00:00.000Z', usuario: null }],
      { total: 41, pagina: 3, tamanho: 20, acoes: ['LOGIN', 'X'] },
      { page: 1, pageSize: 10 },
    );
    expect(list).toMatchObject({ total: 41, page: 3, pageSize: 20, actions: ['LOGIN', 'X'] });
    expect(list.items[0]!.user).toBeNull();
  });

  it('sem resumo usa os valores pedidos', () => {
    expect(toAuditList([], undefined, { page: 2, pageSize: 50 })).toEqual({
      items: [],
      total: 0,
      page: 2,
      pageSize: 50,
      actions: [],
    });
  });
});

describe('B29: adapter da verificação da cadeia', () => {
  it('cadeia íntegra, com a trava do banco', () => {
    expect(toAuditIntegrity({ integra: true, registrosVerificados: 1234, travaNoBanco: true })).toEqual({
      intact: true,
      verifiedCount: 1234,
      databaseLock: true,
      firstBreak: null,
    });
  });

  it('quebra com motivo conhecido, desconhecido e sem trava', () => {
    const broken = toAuditIntegrity({
      integra: false,
      registrosVerificados: 7,
      travaNoBanco: false,
      primeiraQuebra: { id: 'a7', timestamp: '2026-10-08T12:00:00.000Z', motivo: 'CONTEUDO_ALTERADO' },
    });
    expect(broken).toEqual({
      intact: false,
      verifiedCount: 7,
      databaseLock: false,
      firstBreak: { id: 'a7', at: '2026-10-08T12:00:00.000Z', reason: 'content_altered' },
    });
    expect(
      toAuditIntegrity({
        integra: false,
        registrosVerificados: 1,
        primeiraQuebra: { id: 'x', timestamp: '2026-10-08T12:00:00.000Z', motivo: 'NOVO' },
      }).firstBreak?.reason,
    ).toBe('unknown');
    expect(
      toAuditIntegrity({
        integra: false,
        registrosVerificados: 1,
        primeiraQuebra: { id: 'x', timestamp: '2026-10-08T12:00:00.000Z', motivo: 'ELO_QUEBRADO' },
      }).firstBreak?.reason,
    ).toBe('broken_link');
  });
});

describe('B29: mockApi.verifyAuditIntegrity', () => {
  it('só Administrador verifica; o mock responde cadeia íntegra, sem a trava do banco (como a main)', async () => {
    await loginAs('analista@empresa.com');
    await expectHttp(mockApi.verifyAuditIntegrity(), 403, 'PERFIL_SEM_PERMISSAO');
    await loginAs('admin@empresa.com');
    const result = await mockApi.verifyAuditIntegrity();
    expect(result).toEqual({
      intact: true,
      verifiedCount: MOCK_AUDIT_LOG.length + 2,
      databaseLock: false,
      firstBreak: null,
    });
  });
});

describe('mockApi.listAuditLog', () => {
  it('só Administrador consulta', async () => {
    await loginAs('analista@empresa.com');
    await expectHttp(mockApi.listAuditLog(), 403, 'PERFIL_SEM_PERMISSAO');
    await loginAs('colaborador@empresa.com');
    await expectHttp(mockApi.listAuditLog(), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('pagina no servidor, mais recente primeiro, com as ações distintas', async () => {
    await loginAs('admin@empresa.com');
    const first = await mockApi.listAuditLog({ page: 1, pageSize: 10 });
    const second = await mockApi.listAuditLog({ page: 2, pageSize: 10 });
    // O login acima também entrou na trilha.
    expect(first.total).toBe(MOCK_AUDIT_LOG.length + 1);
    expect(first.items).toHaveLength(10);
    expect(first.items[0]!.action).toBe('LOGIN');
    const times = [...first.items, ...second.items].map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(20);
    expect(first.actions).toEqual([...new Set(first.actions)].sort());
    expect(first.actions).toContain('ALTERAR_STATUS_VULNERABILIDADE');
  });

  it('filtra por ação e por período (dias locais inclusivos)', async () => {
    await loginAs('admin@empresa.com');
    const byAction = await mockApi.listAuditLog({ action: 'CRIAR_ATIVO', pageSize: 100 });
    expect(byAction.items.length).toBeGreaterThan(0);
    expect(byAction.items.every((e) => e.action === 'CRIAR_ATIVO')).toBe(true);

    const oldest = MOCK_AUDIT_LOG[MOCK_AUDIT_LOG.length - 1]!;
    const day = new Date(oldest.at);
    const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const range = localDayRange(ymd)!;
    const expected = MOCK_AUDIT_LOG.filter(
      (e) => Date.parse(e.at) >= range.start && Date.parse(e.at) <= range.end,
    );
    const byDay = await mockApi.listAuditLog({ from: ymd, to: ymd, pageSize: 100 });
    expect(byDay.items.map((e) => e.id).sort()).toEqual(expected.map((e) => e.id).sort());
  });

  it('recusa página, tamanho e período inválidos', async () => {
    await loginAs('admin@empresa.com');
    await expectHttp(mockApi.listAuditLog({ page: 0 }), 400, 'PAGINA_INVALIDA');
    await expectHttp(mockApi.listAuditLog({ pageSize: 101 }), 400, 'TAMANHO_INVALIDO');
    await expectHttp(mockApi.listAuditLog({ from: '2026-05-02', to: '2026-05-01' }), 400, 'PERIODO_INVALIDO');
  });

  it('registra criação de ativo, início de varredura e mudança de status', async () => {
    await loginAs('admin@empresa.com');
    const asset = await mockApi.createAsset({ name: 'b12', type: 'server', host: 'b12.empresa.com' });
    await mockApi.startScan(asset.id);
    const { items } = await mockApi.listVulnerabilities();
    const vuln = items.find((v) => v.status === 'open')!;
    await mockApi.updateVulnerabilityStatus(vuln.id, 'in_review');
    const log = await mockApi.listAuditLog({ pageSize: 5 });
    expect(log.items.slice(0, 3).map((e) => e.action)).toEqual([
      'ALTERAR_STATUS_VULNERABILIDADE',
      'INICIAR_VARREDURA',
      'CRIAR_ATIVO',
    ]);
    expect(log.items[0]!.detail).toMatch(/Aberta → Em revisão/);
    expect(log.items[2]!.detail).toContain('b12.empresa.com');
    expect(log.items[0]!.user?.email).toBe('admin@empresa.com');
  });
});

describe('realApi.listAuditLog', () => {
  const originalAdapter = httpClient.defaults.adapter;
  let calls: InternalAxiosRequestConfig[];

  beforeEach(() => {
    calls = [];
    const adapter: AxiosAdapter = async (config) => {
      calls.push(config);
      if (config.params?.tamanho === '999') {
        const response = {
          data: { status: 'erro', mensagem: 'Tamanho inválido', codigoErro: 'TAMANHO_INVALIDO' },
          status: 400,
          statusText: '',
          headers: {},
          config,
        };
        throw new AxiosError('HTTP 400', 'ERR_BAD_REQUEST', config, null, response);
      }
      return {
        data: {
          status: 'sucesso',
          dados: [
            {
              id: 'a1',
              acao: 'CRIAR_ATIVO',
              detalhe: 'x',
              quando: '2026-10-08T12:00:00.000Z',
              usuario: { id: 'u-1', nome: 'Ana', email: 'ana@empresa.com' },
            },
          ],
          resumo: { total: 1, pagina: 2, tamanho: 10, acoes: ['CRIAR_ATIVO', 'LOGIN'] },
        },
        status: 200,
        statusText: '',
        headers: {},
        config,
      };
    };
    httpClient.defaults.adapter = adapter;
  });
  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
  });

  it('envia filtros e paginação na query e converte o envelope', async () => {
    const result = await realApi.listAuditLog({
      action: 'CRIAR_ATIVO',
      from: '2026-10-01',
      to: '2026-10-08',
      page: 2,
      pageSize: 10,
    });
    expect(calls[0]!.url).toBe('/auditoria');
    expect(calls[0]!.params).toEqual({
      acao: 'CRIAR_ATIVO',
      pagina: '2',
      tamanho: '10',
      de: new Date(localDayRange('2026-10-01')!.start).toISOString(),
      ate: new Date(localDayRange('2026-10-08')!.end).toISOString(),
    });
    expect(result).toMatchObject({ total: 1, page: 2, pageSize: 10, actions: ['CRIAR_ATIVO', 'LOGIN'] });
    expect(result.items[0]!.user?.name).toBe('Ana');
  });

  it('sem filtros manda só a paginação padrão; erro vira HttpError', async () => {
    await realApi.listAuditLog();
    expect(calls[0]!.params).toEqual({ pagina: '1', tamanho: '20' });
    await expectHttp(realApi.listAuditLog({ pageSize: 999 }), 400, 'TAMANHO_INVALIDO');
  });
});

describe('B29: realApi.verifyAuditIntegrity', () => {
  const originalAdapter = httpClient.defaults.adapter;
  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
  });

  it('chama GET /auditoria/integridade e converte o envelope', async () => {
    const calls: InternalAxiosRequestConfig[] = [];
    httpClient.defaults.adapter = async (config) => {
      calls.push(config);
      return {
        data: {
          status: 'sucesso',
          mensagem: 'Cadeia de auditoria violada',
          dados: {
            integra: false,
            registrosVerificados: 3,
            travaNoBanco: true,
            primeiraQuebra: { id: 'a3', timestamp: '2026-10-08T12:00:00.000Z', motivo: 'SEM_HASH' },
          },
        },
        status: 200,
        statusText: '',
        headers: {},
        config,
      };
    };
    const result = await realApi.verifyAuditIntegrity();
    expect(calls[0]!.method).toBe('get');
    expect(calls[0]!.url).toBe('/auditoria/integridade');
    expect(result.firstBreak).toEqual({ id: 'a3', at: '2026-10-08T12:00:00.000Z', reason: 'missing_hash' });
  });
});

describe('AuditLogPage', () => {
  function renderPage() {
    return render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>,
    );
  }

  it('lista a trilha, filtra por ação e pagina no servidor', async () => {
    await loginAs('admin@empresa.com');
    renderPage();
    const table = await screen.findByTestId('audit-table');
    await waitFor(() => expect(within(table).getAllByTestId('audit-row')).toHaveLength(20));
    expect(screen.getByText(`${MOCK_AUDIT_LOG.length + 1} registros`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() =>
      expect(within(table).getAllByTestId('audit-row')).toHaveLength(MOCK_AUDIT_LOG.length + 1 - 20),
    );

    const select = screen.getByLabelText('Ação');
    expect(within(select).getByRole('option', { name: 'Ativo cadastrado' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'CRIAR_ATIVO' } });
    await waitFor(() => {
      const rows = within(table).getAllByTestId('audit-row');
      expect(rows.length).toBe(MOCK_AUDIT_LOG.filter((e) => e.action === 'CRIAR_ATIVO').length);
    });
    expect(screen.getByText(/com os filtros aplicados/)).toBeInTheDocument();
    expect(within(table).getAllByText('CRIAR_ATIVO').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Itens por página'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument());
  });

  it('período sem registros mostra o vazio e limpa os filtros', async () => {
    await loginAs('admin@empresa.com');
    renderPage();
    const table = await screen.findByTestId('audit-table');
    await waitFor(() => expect(within(table).getAllByTestId('audit-row').length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2000-01-01' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2000-01-02' } });
    expect(await screen.findByText('Nenhum registro de auditoria encontrado.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(within(table).getAllByTestId('audit-row')).toHaveLength(20));
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeDisabled();
  });

  it('registro sem autor aparece como "Sem usuário"', async () => {
    await loginAs('admin@empresa.com');
    renderPage();
    const table = await screen.findByTestId('audit-table');
    fireEvent.change(await screen.findByLabelText('Ação'), { target: { value: 'CLIQUE_LINK_PHISHING' } });
    await waitFor(() => expect(within(table).getByText('Sem usuário')).toBeInTheDocument());
  });

  it('B29: mostra o selo "Cadeia íntegra" com a contagem e a trava do banco desligada', async () => {
    await loginAs('admin@empresa.com');
    renderPage();
    const panel = await screen.findByTestId('audit-integrity');
    await waitFor(() => expect(panel).toHaveAttribute('data-state', 'intact'));
    expect(within(panel).getByText('Cadeia íntegra')).toBeInTheDocument();
    expect(within(panel).getByText(/registros verificados/)).toHaveTextContent(/Trava do banco desligada/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('B29: cadeia violada vira alerta com o registro e o motivo da quebra', async () => {
    await loginAs('admin@empresa.com');
    const spy = vi.spyOn(mockApi, 'verifyAuditIntegrity').mockResolvedValue({
      intact: false,
      verifiedCount: 42,
      databaseLock: true,
      firstBreak: { id: 'reg-adulterado', at: '2026-10-08T12:00:00.000Z', reason: 'content_altered' },
    });
    try {
      renderPage();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveAttribute('data-state', 'violated');
      expect(alert).toHaveTextContent('Cadeia violada');
      expect(alert).toHaveTextContent('reg-adulterado');
      expect(alert).toHaveTextContent('registro alterado');
      expect(alert).toHaveTextContent('42 registros verificados até a quebra');
      expect(alert).toHaveTextContent('Trava do banco ativa');
      // A trilha continua visível embaixo do alerta.
      const table = await screen.findByTestId('audit-table');
      await waitFor(() => expect(within(table).getAllByTestId('audit-row').length).toBeGreaterThan(0));
    } finally {
      spy.mockRestore();
    }
  });

  it('B29: falha na verificação não esconde a trilha e permite verificar de novo', async () => {
    await loginAs('admin@empresa.com');
    const spy = vi
      .spyOn(mockApi, 'verifyAuditIntegrity')
      .mockRejectedValueOnce(new HttpError(500, 'ERRO_INTERNO', 'Erro interno no servidor'));
    try {
      renderPage();
      const panel = await screen.findByTestId('audit-integrity');
      await waitFor(() => expect(panel).toHaveAttribute('data-state', 'error'));
      expect(panel).toHaveTextContent(
        'Não foi possível verificar a integridade da trilha: Erro interno no servidor',
      );
      expect(await screen.findByTestId('audit-table')).toBeInTheDocument();
      fireEvent.click(within(panel).getByRole('button', { name: 'Verificar de novo' }));
      await waitFor(() =>
        expect(screen.getByTestId('audit-integrity')).toHaveAttribute('data-state', 'intact'),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('falha na primeira carga mostra o erro com nova tentativa', async () => {
    tokenStorage.clear();
    renderPage();
    expect(await screen.findByText('Não foi possível carregar a trilha de auditoria')).toBeInTheDocument();
  });

  it('falha depois de carregado mantém a tabela e avisa', async () => {
    await loginAs('admin@empresa.com');
    renderPage();
    const table = await screen.findByTestId('audit-table');
    await waitFor(() => expect(within(table).getAllByTestId('audit-row')).toHaveLength(20));
    // Período invertido: o mock responde 400 PERIODO_INVALIDO.
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-05-02' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-05-01' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Período inválido');
    expect(screen.getByTestId('audit-table')).toBeInTheDocument();
  });
});
