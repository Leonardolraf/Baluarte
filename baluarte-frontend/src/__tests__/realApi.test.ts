import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpClient, realApi, vulnerabilitySortParams } from '@/services/api';
import type { BackendCampaign, BackendFinding, BackendTraining, BackendUser } from '@/services/adapters';
import { HttpError } from '@/lib/errors';
import { FORBIDDEN_EVENT, UNAUTHORIZED_EVENT } from '@/lib/events';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage } from '@/lib/storage';

// Implementação real da API (axios contra o backend Express), sem rede: um adapter
// falso no `httpClient` responde por rota e guarda cada requisição. Assim os
// interceptadores (JWT, normalização de erro, eventos 401/403), os caminhos, os
// corpos enviados e a conversão dos envelopes `{ status, dados }` são exercitados
// exatamente como em produção.

type Reply = { status: number; data?: unknown } | { network: 'timeout' | 'offline' };
type Handler = (config: InternalAxiosRequestConfig) => Reply;

let routes: Record<string, Handler>;
let calls: InternalAxiosRequestConfig[];
const originalAdapter = httpClient.defaults.adapter;

const ok = (dados: unknown): Reply => ({ status: 200, data: { status: 'sucesso', dados } });
const fail = (status: number, codigoErro: string, mensagem: string): Reply => ({
  status,
  data: { status: 'erro', mensagem, codigoErro },
});

function on(key: string, reply: Reply | Handler): void {
  routes[key] = typeof reply === 'function' ? reply : () => reply;
}

const fakeAdapter: AxiosAdapter = async (config) => {
  calls.push(config);
  const key = `${(config.method ?? 'get').toUpperCase()} ${config.url}`;
  const handler = routes[key];
  if (!handler) throw new Error(`rota não configurada no teste: ${key}`);
  const reply = handler(config);
  if ('network' in reply) {
    throw new AxiosError(
      reply.network === 'timeout' ? 'timeout' : 'Network Error',
      reply.network === 'timeout' ? 'ECONNABORTED' : 'ERR_NETWORK',
      config,
    );
  }
  const response = { data: reply.data, status: reply.status, statusText: '', headers: {}, config };
  if (reply.status >= 400) {
    throw new AxiosError(`HTTP ${reply.status}`, 'ERR_BAD_RESPONSE', config, null, response);
  }
  return response;
};

function body(index = calls.length - 1): unknown {
  const raw = calls[index]?.data;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function authHeader(index: number): unknown {
  return AxiosHeaders.from(calls[index]?.headers ?? {}).get('Authorization');
}

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const err = await promise.then(
    () => {
      throw new Error('esperava falha');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

function finding(overrides: Partial<BackendFinding> = {}): BackendFinding {
  return {
    id: 'f-1',
    ativo: '10.0.0.5',
    ativoNome: 'Portal',
    categoria: 'A03:2021 - Injection',
    cvss: 9.8,
    severidade: 'Crítico',
    status: 'Aberta',
    descricao: 'SQL Injection no login',
    evidencia: "' OR 1=1 --",
    detectadoEm: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

function campaign(overrides: Partial<BackendCampaign> = {}): BackendCampaign {
  return {
    id: 'c-1',
    nome: 'Simulação Q3',
    template: 'urgencia',
    status: 'Ativa',
    destinatarios: 10,
    taxaClique: 20,
    criadoEm: '2026-09-10T12:00:00.000Z',
    ...overrides,
  };
}

const training: BackendTraining = {
  tipoAtaque: 'Urgência',
  titulo: 'Pressa é inimiga',
  codigoModulo: 'US-005',
  duracaoMin: 5,
  progresso: 0,
  campanha: 'Simulação Q3',
  sinaisAlerta: ['Prazo curto'],
  boasPraticas: ['Confirme por outro canal'],
  idCampanha: 'c-1',
  concluidoEm: null,
};

const backendUser = (overrides: Partial<BackendUser> = {}): BackendUser => ({
  id: 'u-1',
  nome: 'Ana Souza',
  email: 'ana@empresa.com',
  perfil: 'Analista',
  status: 'Ativo',
  criadoEm: '2026-09-01T00:00:00.000Z',
  departamento: 'TI',
  ...overrides,
});

beforeEach(() => {
  routes = {};
  calls = [];
  httpClient.defaults.adapter = fakeAdapter;
});

afterEach(() => {
  httpClient.defaults.adapter = originalAdapter;
});

describe('realApi — interceptadores HTTP', () => {
  it('anexa o JWT guardado como Bearer e desembrulha o envelope { dados }', async () => {
    tokenStorage.set('tok-123');
    on('GET /me', ok(backendUser({ perfil: 'Administrador' })));
    const me = await realApi.me();
    expect(authHeader(0)).toBe('Bearer tok-123');
    expect(me).toEqual({ id: 'u-1', name: 'Ana Souza', email: 'ana@empresa.com', role: 'admin' });
  });

  it('não envia Authorization sem sessão e aceita corpo sem envelope', async () => {
    on('GET /assets', { status: 200, data: [] });
    await expect(realApi.listAssets()).resolves.toEqual([]);
    expect(authHeader(0)).toBeFalsy();
  });

  it('normaliza o erro do backend e dispara 401 só quando havia sessão', async () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    on('GET /me', fail(401, 'TOKEN_INVALIDO', 'Sessão expirada'));

    const semSessao = await rejection(realApi.me());
    expect(semSessao).toMatchObject({ status: 401, code: 'TOKEN_INVALIDO', message: 'Sessão expirada' });
    expect(spy).not.toHaveBeenCalled();

    tokenStorage.set('tok-velho');
    await rejection(realApi.me());
    const event = spy.mock.calls[0]?.[0] as CustomEvent;
    expect(event.type).toBe(UNAUTHORIZED_EVENT);
    expect(event.detail).toMatchObject({ status: 401, code: 'TOKEN_INVALIDO' });
  });

  it('403 dispara o evento de ressincronização de perfil', async () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    on('GET /usuarios', fail(403, 'ACESSO_NEGADO', 'Sem permissão'));
    const err = await rejection(realApi.listUsers());
    expect(err.status).toBe(403);
    expect((spy.mock.calls[0]?.[0] as CustomEvent).type).toBe(FORBIDDEN_EVENT);
  });

  it('usa código e mensagem genéricos quando o corpo do erro vem vazio', async () => {
    on('GET /scans', { status: 500 });
    expect(await rejection(realApi.listScans())).toMatchObject({
      status: 500,
      code: 'HTTP_500',
      message: 'Erro 500',
    });
  });

  it('converte tempo esgotado e falha de rede em HttpError status 0', async () => {
    on('GET /assets', { network: 'timeout' });
    expect(await rejection(realApi.listAssets())).toMatchObject({ status: 0, code: 'TIMEOUT' });
    on('GET /assets', { network: 'offline' });
    expect(await rejection(realApi.listAssets())).toMatchObject({ status: 0, code: 'REDE' });
  });
});

describe('realApi — autenticação e conta', () => {
  it('login envia e-mail aparado + senha e busca o nome completo em /me com o token novo', async () => {
    on(
      'POST /login',
      ok({ token: 'jwt-novo', idUsuario: 'u-1', email: 'ana@empresa.com', perfil: 'Analista' }),
    );
    on('GET /me', ok(backendUser()));
    const result = await realApi.login({ email: '  ana@empresa.com ', password: 'Senha@123' });
    expect(body(0)).toEqual({ email: 'ana@empresa.com', senha: 'Senha@123' });
    expect(authHeader(1)).toBe('Bearer jwt-novo');
    expect(result).toEqual({
      token: 'jwt-novo',
      user: { id: 'u-1', name: 'Ana Souza', email: 'ana@empresa.com', role: 'analyst' },
    });
    expect(tokenStorage.get()).toBeNull();
  });

  it('login com /me indisponível usa o perfil do próprio /login', async () => {
    on(
      'POST /login',
      ok({ token: 'jwt', idUsuario: 'u-9', email: 'chefe@empresa.com', perfil: 'Administrador' }),
    );
    on('GET /me', fail(500, 'ERRO_INTERNO', 'falhou'));
    const { user } = await realApi.login({ email: 'chefe@empresa.com', password: 'x' });
    expect(user).toEqual({ id: 'u-9', name: 'chefe', email: 'chefe@empresa.com', role: 'admin' });
  });

  it('pedido de redefinição devolve mensagem genérica, inclusive para e-mail inexistente', async () => {
    on('POST /auth/reset-password', ok({ mensagem: 'ok' }));
    const sucesso = await realApi.requestPasswordReset(' ana@empresa.com ');
    expect(body()).toEqual({ email: 'ana@empresa.com' });

    on('POST /auth/reset-password', fail(404, 'USUARIO_NAO_ENCONTRADO', 'Não existe'));
    const inexistente = await realApi.requestPasswordReset('ninguem@empresa.com');
    expect(inexistente.message).toBe(sucesso.message);
    expect(sucesso.message).toMatch(/Se o e-mail estiver cadastrado/);
  });

  it('pedido de redefinição traduz 429, 400 e rota ausente', async () => {
    on('POST /auth/reset-password', fail(429, 'X', 'x'));
    expect(await rejection(realApi.requestPasswordReset('a@b.com'))).toMatchObject({
      status: 429,
      code: 'MUITAS_TENTATIVAS',
    });
    on('POST /auth/reset-password', fail(400, 'X', 'x'));
    expect(await rejection(realApi.requestPasswordReset('a@b.com'))).toMatchObject({
      status: 400,
      code: 'EMAIL_INVALIDO',
    });
    on('POST /auth/reset-password', fail(404, 'ROTA_NAO_ENCONTRADA', 'Rota não encontrada'));
    expect(await rejection(realApi.requestPasswordReset('a@b.com'))).toMatchObject({
      status: 501,
      code: 'NAO_IMPLEMENTADO',
    });
    on('POST /auth/reset-password', fail(500, 'ERRO_INTERNO', 'Falha'));
    expect((await rejection(realApi.requestPasswordReset('a@b.com'))).code).toBe('ERRO_INTERNO');
  });

  it('confirmação de redefinição envia token aparado e usa a mensagem do servidor ou a padrão', async () => {
    on('POST /auth/reset-password/confirm', ok({ mensagem: 'Senha nova gravada' }));
    await expect(realApi.confirmPasswordReset(' tk ', 'Nova@1234')).resolves.toEqual({
      message: 'Senha nova gravada',
    });
    expect(body()).toEqual({ token: 'tk', novaSenha: 'Nova@1234' });

    on('POST /auth/reset-password/confirm', ok(undefined));
    await expect(realApi.confirmPasswordReset('tk', 'x')).resolves.toEqual({
      message: 'Senha redefinida com sucesso.',
    });

    on('POST /auth/reset-password/confirm', fail(400, 'TOKEN_INVALIDO', 'Link inválido'));
    expect((await rejection(realApi.confirmPasswordReset('tk', 'x'))).code).toBe('TOKEN_INVALIDO');
  });

  it('verifica o link da conta e distingue convite de redefinição', async () => {
    on(
      'POST /auth/link/verificar',
      ok({ tipo: 'convite', nome: 'Ana', email: 'ana@empresa.com', expiraEm: 'x' }),
    );
    await expect(realApi.verifyAccountLink(' abc ')).resolves.toEqual({
      kind: 'invite',
      name: 'Ana',
      email: 'ana@empresa.com',
      expiresAt: 'x',
    });
    expect(body()).toEqual({ token: 'abc' });
    on('POST /auth/link/verificar', ok({ tipo: 'RESET', nome: 'Ana', email: 'a', expiraEm: 'y' }));
    expect((await realApi.verifyAccountLink('abc')).kind).toBe('reset');
  });

  it('troca de senha devolve o token novo e converte rota ausente em 501', async () => {
    on('POST /auth/change-password', ok({ mensagem: 'Trocada', token: 'jwt-2' }));
    await expect(realApi.changePassword({ currentPassword: 'a', newPassword: 'b' })).resolves.toEqual({
      message: 'Trocada',
      token: 'jwt-2',
    });
    expect(body()).toEqual({ senhaAtual: 'a', novaSenha: 'b' });

    on('POST /auth/change-password', ok(undefined));
    await expect(realApi.changePassword({ currentPassword: 'a', newPassword: 'b' })).resolves.toEqual({
      message: 'Senha alterada com sucesso.',
      token: '',
    });

    on('POST /auth/change-password', fail(404, 'ROTA_NAO_ENCONTRADA', 'x'));
    const err = await rejection(realApi.changePassword({ currentPassword: 'a', newPassword: 'b' }));
    expect(err.status).toBe(501);
  });

  it('logout e renovação de sessão chamam as rotas de auth', async () => {
    on('POST /auth/logout', ok(null));
    on('POST /auth/renovar', ok({ token: 'jwt-renovado' }));
    await expect(realApi.logout()).resolves.toBeUndefined();
    await expect(realApi.renewSession()).resolves.toBe('jwt-renovado');
    expect(calls.map((c) => c.url)).toEqual(['/auth/logout', '/auth/renovar']);
  });
});

describe('realApi — dashboard, ativos e varreduras', () => {
  const dashboard = {
    kpis: { vulnerabilidadesAbertas: 3, criticas: 1, resilienciaPhishing: 80, ativosMonitorados: 2 },
    distribuicaoSeveridade: { Crítico: 1, Alto: 2 },
    vulnerabilidadesRecentes: [finding()],
    alertas: [],
    campanhas: [campaign()],
    funil: null,
    campanhaAtiva: null,
  };
  const scan = { id: 's-1', assetId: 'a-1', status: 'CONCLUIDA', criadoEm: '2026-10-01T10:00:00.000Z' };

  it('operador recebe o dashboard junto das varreduras recentes', async () => {
    tokenStorage.set(buildMockToken({ sub: 'u-1', email: 'a@empresa.com', role: 'analyst' }));
    on('GET /dashboard', ok(dashboard));
    on('GET /scans', ok([scan]));
    const metrics = await realApi.getDashboard();
    expect(metrics.kpis.openVulnerabilities).toBe(3);
    expect(metrics.recentScans.map((s) => s.id)).toEqual(['s-1']);
  });

  it('colaborador recebe só a resiliência: KPIs técnicos e de campanha ficam null (RN-006, B10)', async () => {
    tokenStorage.set(buildMockToken({ sub: 'u-2', email: 'c@empresa.com', role: 'collaborator' }));
    on(
      'GET /dashboard',
      ok({
        kpis: {
          vulnerabilidadesAbertas: null,
          criticas: null,
          arquivosMaliciosos: null,
          resilienciaPhishing: 75,
          ativosMonitorados: null,
        },
        distribuicaoSeveridade: null,
        vulnerabilidadesRecentes: [],
        alertas: [],
        campanhas: [],
        funil: null,
        campanhaAtiva: null,
      }),
    );
    const metrics = await realApi.getDashboard();
    expect(metrics.technicalRisk).toBeNull();
    expect(metrics.severityDistribution).toBeNull();
    expect(metrics.kpis).toEqual({
      openVulnerabilities: null,
      criticalVulnerabilities: null,
      maliciousFiles: null,
      phishingResilience: 75,
      monitoredAssets: null,
      activeCampaigns: null,
      trainedCollaborators: null,
    });
    expect(metrics.humanRisk).toBe(63);
  });

  it('colaborador não consulta /scans e falha em /scans não derruba o dashboard', async () => {
    tokenStorage.set(buildMockToken({ sub: 'u-2', email: 'c@empresa.com', role: 'collaborator' }));
    on('GET /dashboard', ok(dashboard));
    const metrics = await realApi.getDashboard();
    expect(calls.map((c) => c.url)).toEqual(['/dashboard']);
    expect(metrics.recentScans).toEqual([]);

    tokenStorage.set(buildMockToken({ sub: 'u-0', email: 'adm@empresa.com', role: 'admin' }));
    on('GET /scans', fail(500, 'ERRO', 'x'));
    await expect(realApi.getDashboard()).resolves.toMatchObject({ recentScans: [] });
  });

  it('lista ativos e cria um ativo com o rótulo de tipo do backend', async () => {
    on(
      'GET /assets',
      ok([{ id: 'a-1', nome: 'Portal', host: '10.0.0.5', tipo: 'Servidor', status: 'Ativo', criadoEm: 'x' }]),
    );
    const [asset] = await realApi.listAssets();
    expect(asset).toMatchObject({ id: 'a-1', type: 'server', ip: '10.0.0.5', status: 'active' });

    on(
      'POST /assets',
      ok({
        id: 'a-2',
        nome: 'API',
        host: 'api.empresa.com',
        tipo: 'Aplicacao',
        status: 'Ativo',
        ip: null,
        descricao: 'Gateway',
      }),
    );
    const created = await realApi.createAsset({
      name: ' API ',
      type: 'application',
      host: ' api.empresa.com ',
      description: ' Gateway ',
    });
    // ip vazio não vai; a descrição vai com o nome em português (B10).
    expect(body()).toEqual({ nome: 'API', tipo: 'Aplicacao', host: 'api.empresa.com', descricao: 'Gateway' });
    expect(created).toMatchObject({ id: 'a-2', type: 'application', description: 'Gateway', ip: null });
    expect(created.createdAt).toBeTruthy();
  });

  it('createAsset envia ip e descrição e lê os dois da resposta da API, não do formulário (B10)', async () => {
    on(
      'POST /assets',
      ok({
        id: 'a-3',
        nome: 'Portal',
        host: 'portal.empresa.com',
        tipo: 'Servidor',
        status: 'Ativo',
        criadoEm: '2026-10-08T10:00:00.000Z',
        ip: '203.0.113.7',
        descricao: 'Salvo pelo servidor',
      }),
    );
    const created = await realApi.createAsset({
      name: 'Portal',
      type: 'server',
      host: 'https://portal.empresa.com/login',
      ip: ' 203.0.113.7 ',
      description: 'Digitado no formulário',
    });
    expect(body()).toEqual({
      nome: 'Portal',
      tipo: 'Servidor',
      host: 'https://portal.empresa.com/login',
      ip: '203.0.113.7',
      descricao: 'Digitado no formulário',
    });
    expect(created).toMatchObject({
      host: 'portal.empresa.com',
      ip: '203.0.113.7',
      description: 'Salvo pelo servidor',
      createdAt: '2026-10-08T10:00:00.000Z',
    });

    on(
      'GET /assets',
      ok([
        {
          id: 'a-3',
          nome: 'Portal',
          host: 'portal.empresa.com',
          tipo: 'Servidor',
          status: 'Ativo',
          criadoEm: 'x',
          ip: '203.0.113.7',
          descricao: 'Salvo pelo servidor',
        },
      ]),
    );
    const [listed] = await realApi.listAssets();
    expect(listed).toMatchObject({ ip: '203.0.113.7', description: 'Salvo pelo servidor' });
  });

  it('inicia uma varredura e devolve o status inicial em fila', async () => {
    on('POST /scans', ok({ scanId: 's-9', ativoId: 'a-1', statusVarredura: 'EM_FILA', criadoEm: 'x' }));
    const report = await realApi.startScan('a-1');
    expect(body()).toEqual({ ativoId: 'a-1' });
    expect(report).toMatchObject({ id: 's-9', assetId: 'a-1', status: 'queued', finishedAt: null });
  });

  it('consulta uma varredura só, com o progresso (B26)', async () => {
    on(
      'GET /scans/s-9',
      ok({
        id: 's-9',
        assetId: 'a-1',
        status: 'EM_ANDAMENTO',
        criadoEm: '2026-10-07T12:00:00.000Z',
        concluidoEm: null,
        asset: { nome: 'Portal', host: '10.0.0.5' },
        _count: { findings: 0 },
        progresso: 37,
        etapa: 'Testando injeção',
        estimativaConclusao: '2026-10-07T12:00:20.000Z',
      }),
    );
    const report = await realApi.getScan('s-9');
    expect(calls.at(-1)?.method).toBe('get');
    expect(report).toMatchObject({
      id: 's-9',
      assetName: 'Portal',
      status: 'running',
      progress: 37,
      stage: 'Testando injeção',
      estimatedCompletionAt: '2026-10-07T12:00:20.000Z',
    });

    on('GET /scans/nao-existe', fail(404, 'VARREDURA_NAO_ENCONTRADA', 'Varredura não encontrada'));
    const err = await rejection(realApi.getScan('nao-existe'));
    expect(err.status).toBe(404);
    expect(err.code).toBe('VARREDURA_NAO_ENCONTRADA');
  });
});

describe('realApi — vulnerabilidades', () => {
  it('manda filtro, ordem e página ao servidor e lê o resumo do filtro inteiro (B25)', async () => {
    on('GET /vulnerabilidades', {
      status: 200,
      data: {
        status: 'sucesso',
        dados: [finding(), finding({ id: 'f-2', severidade: 'Baixo', cvss: 2, ativo: '10.0.0.6' })],
        resumo: {
          total: 45,
          ativos: 7,
          pagina: 3,
          tamanho: 2,
          porSeveridade: { Crítico: 20, Alto: 10, Médio: 10, Baixo: 5 },
          porStatus: { Aberta: 30, 'Em revisão': 5, 'Em remediação': 5, Resolvida: 4, 'Risco aceito': 1 },
        },
      },
    });
    const page = await realApi.listVulnerabilities(
      { query: ' sql ', severity: 'critical', status: 'open' },
      { page: 3, pageSize: 2, sort: { key: 'severity', direction: 'asc' } },
    );
    expect(calls[0]?.params).toEqual({
      q: 'sql',
      severidade: 'Crítico',
      status: 'Aberta',
      ordenar: 'cvss',
      direcao: 'desc',
      pagina: '3',
      tamanho: '2',
    });
    expect(page.items.map((v) => v.id)).toEqual(['f-1', 'f-2']);
    expect(page).toMatchObject({ page: 3, pageSize: 2 });
    // O resumo é do filtro inteiro (45), não da página (2).
    expect(page.summary).toMatchObject({ total: 45, assets: 7 });
    expect(page.summary.bySeverity).toMatchObject({ critical: 20, high: 10, medium: 10, low: 5, info: 0 });
    expect(page.summary.byStatus).toEqual({
      open: 30,
      in_review: 5,
      remediating: 5,
      resolved: 4,
      accepted: 1,
    });
  });

  it('sem opções pede a página 1 de 20, na ordem padrão do servidor', async () => {
    on('GET /vulnerabilidades', ok([finding()]));
    const page = await realApi.listVulnerabilities();
    expect(calls[0]?.params).toEqual({ pagina: '1', tamanho: '20' });
    // Servidor antigo, sem resumo: cai no que a página tem.
    expect(page).toMatchObject({ page: 1, pageSize: 20, summary: { total: 1, assets: 1 } });
  });

  it('mapeia cada coluna para a ordenação do servidor', () => {
    expect(vulnerabilitySortParams(null)).toEqual({});
    expect(vulnerabilitySortParams({ key: 'severity', direction: 'desc' })).toEqual({
      ordenar: 'cvss',
      direcao: 'asc',
    });
    expect(vulnerabilitySortParams({ key: 'cvss', direction: 'asc' })).toEqual({
      ordenar: 'cvss',
      direcao: 'asc',
    });
    expect(vulnerabilitySortParams({ key: 'title', direction: 'desc' })).toEqual({
      ordenar: 'descricao',
      direcao: 'desc',
    });
    expect(vulnerabilitySortParams({ key: 'detectedAt', direction: 'asc' })).toEqual({
      ordenar: 'detectadoEm',
      direcao: 'asc',
    });
  });

  it('severidade "informativo" (inexistente no servidor) devolve página vazia sem chamar a API', async () => {
    const page = await realApi.listVulnerabilities({ severity: 'info' });
    expect(calls).toHaveLength(0);
    expect(page.items).toEqual([]);
    expect(page.summary.total).toBe(0);
  });

  it('o detalhe traz o histórico honesto: detecção, mudanças registradas e se ele está completo', async () => {
    on(
      'GET /vulnerabilidades/f-1',
      ok({
        ...finding({ status: 'Em remediação' }),
        origem: { varreduraId: 's-1', varreduraIniciadaEm: '2026-10-01T09:59:40.000Z', ativoId: 'a-1' },
        historico: {
          eventos: [
            {
              tipo: 'DETECTADO',
              quando: '2026-10-01T10:00:00.000Z',
              varreduraId: 's-1',
              ativo: '10.0.0.5',
              ativoNome: 'Portal',
            },
            {
              tipo: 'STATUS_ALTERADO',
              quando: '2026-10-02T10:00:00.000Z',
              de: 'Em revisão',
              para: 'Em remediação',
              autor: null,
            },
          ],
          statusAtual: 'Em remediação',
          completo: false,
        },
      }),
    );
    const vuln = await realApi.getVulnerability('f-1');
    expect(vuln.history).toEqual([
      {
        id: 'f-1-detectado',
        at: '2026-10-01T10:00:00.000Z',
        action: 'detected',
        note: 'Varredura do ativo Portal (10.0.0.5).',
      },
      {
        id: 'f-1-status-1',
        at: '2026-10-02T10:00:00.000Z',
        action: 'status_changed',
        from: 'in_review',
        to: 'remediating',
        actor: 'Usuário removido',
      },
    ]);
    expect(vuln.historyComplete).toBe(false);
    expect(vuln.origin).toEqual({ scanId: 's-1', scanStartedAt: '2026-10-01T09:59:40.000Z', assetId: 'a-1' });
    expect(vuln.updatedAt).toBe('2026-10-02T10:00:00.000Z');
  });

  it('busca o detalhe e atualiza o status com o rótulo em português', async () => {
    on('GET /vulnerabilidades/f%2F1', ok(finding({ id: 'f/1' })));
    expect((await realApi.getVulnerability('f/1')).id).toBe('f/1');

    on('PATCH /vulnerabilidades/f-1', ok(finding({ status: 'Risco aceito' })));
    const updated = await realApi.updateVulnerabilityStatus('f-1', 'accepted');
    expect(body()).toEqual({ status: 'Risco aceito' });
    expect(updated.status).toBe('accepted');
  });
});

describe('realApi — campanhas e treinamento', () => {
  it('lista campanhas com filtros de status, período e nome', async () => {
    on(
      'GET /campanhas',
      ok([
        campaign(),
        campaign({
          id: 'c-2',
          nome: 'Financeiro',
          status: 'Encerrada',
          criadoEm: '2026-08-01T12:00:00.000Z',
        }),
        campaign({ id: 'c-3', nome: 'RH', criadoEm: '2026-10-05T12:00:00.000Z' }),
      ]),
    );
    expect((await realApi.listCampaigns()).length).toBe(3);
    expect((await realApi.listCampaigns({ status: 'completed' })).map((c) => c.id)).toEqual(['c-2']);
    expect((await realApi.listCampaigns({ from: '2026-09-01', to: '2026-09-30' })).map((c) => c.id)).toEqual([
      'c-1',
    ]);
    expect((await realApi.listCampaigns({ query: '  simul ' })).map((c) => c.id)).toEqual(['c-1']);
  });

  it('busca o relatório da campanha', async () => {
    on(
      'GET /campanhas/c-1',
      ok({
        ...campaign(),
        funil: {
          enviados: { valor: 10, pct: 100 },
          abertos: { valor: 6, pct: 60 },
          clicados: { valor: 2, pct: 20 },
          submeteram: { valor: 0, pct: 0 },
          reportaram: { valor: 1, pct: 10 },
        },
        treinamentos: [{ destinatario: 'ana@empresa.com', concluido: true, token: 'ev-1' }],
      }),
    );
    const report = await realApi.getCampaignReport('c-1');
    expect(report.campaign.metrics).toMatchObject({ sent: 10, clicked: 2, trained: 1, trainedRate: 50 });
    expect(report.recipients[0]?.trainingId).toBe('ev-1');
  });

  it('cria campanha com destinatario + destinatarios[] e mantém grupo e agenda do formulário', async () => {
    on(
      'POST /campaigns',
      ok({
        idCampanha: 'c-9',
        nome: 'Nova',
        destinatario: 'a@empresa.com',
        template: 'autoridade',
        status: 'Agendada',
      }),
    );
    const created = await realApi.createCampaign({
      name: ' Nova ',
      template: 'authority',
      targetGroup: 'TI',
      scheduledAt: '2026-11-01T09:00',
      recipients: ['A@empresa.com', 'b@empresa.com', 'a@empresa.com'],
    });
    expect(body()).toEqual({
      nome: 'Nova',
      destinatario: 'a@empresa.com',
      destinatarios: ['a@empresa.com', 'b@empresa.com'],
      template: 'autoridade',
    });
    expect(created).toMatchObject({
      id: 'c-9',
      template: 'authority',
      status: 'scheduled',
      targetGroup: 'TI',
      scheduledAt: '2026-11-01T09:00',
    });
    expect(created.metrics.recipients).toBe(2);
  });

  it('treinamento interno: lê e conclui pelo id do evento', async () => {
    on('GET /treinamentos/ev-1', ok(training));
    on('POST /treinamentos/ev-1/concluir', ok({}));
    expect(await realApi.getTraining('ev-1')).toMatchObject({
      id: 'ev-1',
      completed: false,
      campaignId: 'c-1',
    });
    const done = await realApi.completeTraining('ev-1');
    expect(done).toMatchObject({ completed: true, progress: 100 });
    expect(done.completedAt).toBeTruthy();

    on('POST /treinamentos/ev-1/concluir', fail(404, 'ROTA_NAO_ENCONTRADA', 'x'));
    expect((await rejection(realApi.completeTraining('ev-1'))).code).toBe('NAO_IMPLEMENTADO');
  });

  it('treinamento pelo link do e-mail: lê, conclui e reporta sem login', async () => {
    on('GET /treinamentos/link/tk', ok(training));
    on('POST /treinamentos/link/tk/concluir', ok({ concluidoEm: '2026-10-08T10:00:00.000Z' }));
    on(
      'POST /treinamentos/link/tk/reportar',
      ok({ reportado: true, reportadoEm: '2026-10-08T09:00:00.000Z' }),
    );
    expect((await realApi.getTrainingByLink('tk')).title).toBe('Pressa é inimiga');
    expect(await realApi.completeTrainingByLink('tk')).toMatchObject({
      completed: true,
      completedAt: '2026-10-08T10:00:00.000Z',
    });
    await expect(realApi.reportPhishing('tk')).resolves.toEqual({
      reported: true,
      reportedAt: '2026-10-08T09:00:00.000Z',
    });
  });

  it('consolidado de treinamentos', async () => {
    on(
      'GET /treinamentos/consolidado',
      ok({
        campanhas: 2,
        conclusoes: 3,
        cliques: 5,
        pendentesAposClique: 2,
        conclusoesNominais: 3,
        colaboradores: [
          {
            nome: 'Ana',
            email: 'ana@empresa.com',
            departamento: 'TI',
            campanhas: [{ id: 'c-1', nome: 'Q3' }],
          },
        ],
        porDepartamento: [{ departamento: 'TI', conclusoes: 3 }],
      }),
    );
    const overview = await realApi.getTrainingOverview();
    expect(overview).toMatchObject({ campaigns: 2, completions: 3, clicked: 5, pendingAfterClick: 2 });
    expect(overview.people[0]).toEqual({
      name: 'Ana',
      email: 'ana@empresa.com',
      department: 'TI',
      campaigns: [{ id: 'c-1', name: 'Q3' }],
    });
    expect(overview.byDepartment).toEqual([{ department: 'TI', completions: 3 }]);
  });
});

describe('realApi — usuários', () => {
  it('lista usuários e busca um pelo id (404 quando não existe)', async () => {
    on(
      'GET /usuarios',
      ok([backendUser(), backendUser({ id: 'u-2', status: 'Pendente', departamento: null })]),
    );
    const users = await realApi.listUsers();
    expect(users.map((u) => [u.id, u.status, u.department])).toEqual([
      ['u-1', 'active', 'TI'],
      ['u-2', 'pending', undefined],
    ]);
    expect((await realApi.getUser('u-2')).id).toBe('u-2');
    expect(await rejection(realApi.getUser('u-404'))).toMatchObject({
      status: 404,
      code: 'USUARIO_NAO_ENCONTRADO',
    });
  });

  it('cria usuário pendente e informa se o convite saiu', async () => {
    on('POST /users', ok({ idUsuario: 'u-5', nome: 'Bia', email: 'bia@empresa.com', perfil: 'Colaborador' }));
    const created = await realApi.createUser({
      name: ' Bia ',
      email: ' BIA@empresa.com ',
      role: 'collaborator',
      department: ' ',
    });
    expect(body()).toEqual({
      nome: 'Bia',
      email: 'bia@empresa.com',
      perfil: 'Colaborador',
      departamento: null,
    });
    expect(created).toMatchObject({ id: 'u-5', role: 'collaborator', status: 'pending', inviteSent: true });

    on(
      'POST /users',
      ok({ idUsuario: 'u-6', nome: 'C', email: 'c@empresa.com', perfil: 'Analista', conviteEnviado: false }),
    );
    expect(
      (await realApi.createUser({ name: 'C', email: 'c@empresa.com', role: 'analyst' })).inviteSent,
    ).toBe(false);
  });

  it('reenvia convite e envia redefinição com mensagem padrão quando o corpo vem vazio', async () => {
    on('POST /users/u-1/convite', ok({ mensagem: 'Convite enviado para ana' }));
    on('POST /users/u-1/redefinir-senha', ok(undefined));
    await expect(realApi.resendInvite('u-1')).resolves.toEqual({ message: 'Convite enviado para ana' });
    await expect(realApi.sendPasswordReset('u-1')).resolves.toEqual({
      message: 'Link de redefinição enviado.',
    });
    on('POST /users/u-1/convite', ok(undefined));
    await expect(realApi.resendInvite('u-1')).resolves.toEqual({ message: 'Convite reenviado.' });
  });

  it('atualiza só os campos informados, com rótulos do backend', async () => {
    on('PATCH /users/u-1', ok(backendUser({ perfil: 'Administrador', status: 'Inativo' })));
    const updated = await realApi.updateUser('u-1', {
      name: ' Ana S. ',
      email: ' ANA@empresa.com ',
      role: 'admin',
      status: 'inactive',
      department: '',
    });
    expect(body()).toEqual({
      nome: 'Ana S.',
      email: 'ana@empresa.com',
      perfil: 'Administrador',
      status: 'Inativo',
      departamento: null,
    });
    expect(updated).toMatchObject({ role: 'admin', status: 'inactive' });

    await realApi.updateUser('u-1', { status: 'active' });
    expect(body()).toEqual({ status: 'Ativo' });
    await realApi.updateUser('u-1', { status: 'pending' });
    expect(body()).toEqual({ status: 'Pendente' });

    on('PATCH /users/u-1', fail(409, 'EMAIL_EM_USO', 'E-mail já cadastrado'));
    expect((await rejection(realApi.updateUser('u-1', { name: 'X' }))).code).toBe('EMAIL_EM_USO');
  });

  it('exclui usuário e propaga o bloqueio por histórico de campanha', async () => {
    on('DELETE /users/u-1', ok(null));
    await expect(realApi.deleteUser('u-1')).resolves.toBeUndefined();
    on('DELETE /users/u-1', fail(409, 'USUARIO_COM_HISTORICO', 'Usuário com histórico'));
    expect((await rejection(realApi.deleteUser('u-1'))).code).toBe('USUARIO_COM_HISTORICO');
  });

  it('lista os nomes dos departamentos', async () => {
    on(
      'GET /departamentos',
      ok([
        { id: 'd-1', nome: 'TI' },
        { id: 'd-2', nome: 'RH' },
      ]),
    );
    await expect(realApi.listDepartments()).resolves.toEqual(['TI', 'RH']);
  });
});

describe('realApi — estações monitoradas (B13)', () => {
  const estacao = {
    id: 'cm-1',
    ativoId: 'cm-a',
    nome: 'dev-ws-02',
    host: 'dev-ws-02.empresa.local',
    identificador: 'uuid-1',
    sistema: 'Ubuntu 22.04.4 LTS',
    soPlataforma: 'ubuntu',
    status: 'Online',
    ultimoContato: '2026-10-08T10:00:00.000Z',
    inscritaEm: '2026-10-01T10:00:00.000Z',
    inventarioEm: '2026-10-08T09:58:00.000Z',
    totalProgramas: 1,
    totalPortas: 1,
  };

  it('lista em GET /estacoes com o resumo do servidor', async () => {
    on('GET /estacoes', {
      status: 200,
      data: {
        status: 'sucesso',
        dados: [estacao, { ...estacao, id: 'cm-2', nome: 'rh-nb-03', status: 'Offline' }],
        resumo: { total: 2, online: 1, offline: 1, janelaOfflineS: 10800 },
      },
    });
    const list = await realApi.listStations();
    expect(list.items.map((s) => [s.name, s.status])).toEqual([
      ['dev-ws-02', 'online'],
      ['rh-nb-03', 'offline'],
    ]);
    expect(list.summary).toEqual({ total: 2, online: 1, offline: 1, offlineAfterSec: 10800 });
  });

  it('busca o detalhe em GET /estacoes/:id e propaga o 403 do servidor', async () => {
    on(
      'GET /estacoes/cm-1',
      ok({
        ...estacao,
        janelaOfflineS: 900,
        programas: [{ nome: 'curl', versao: '7.81.0', fornecedor: 'Ubuntu', fonte: 'deb_packages' }],
        portas: [{ porta: 22, protocolo: 'TCP', endereco: '0.0.0.0', processo: 'sshd' }],
      }),
    );
    const detail = await realApi.getStation('cm-1');
    expect(detail.software).toEqual([
      { name: 'curl', version: '7.81.0', vendor: 'Ubuntu', source: 'deb_packages' },
    ]);
    expect(detail.ports).toEqual([{ port: 22, protocol: 'TCP', address: '0.0.0.0', process: 'sshd' }]);

    on('GET /estacoes', fail(403, 'PERFIL_SEM_PERMISSAO', 'Acesso negado para o seu perfil'));
    const err = await rejection(realApi.listStations());
    expect(err).toMatchObject({ status: 403, code: 'PERFIL_SEM_PERMISSAO' });
  });

  it('verifica em POST /estacoes/:id/verificar e propaga o 409 do servidor (B14)', async () => {
    on(
      'POST /estacoes/cm-1/verificar',
      ok({
        estacaoId: 'cm-1',
        ativoId: 'cm-2',
        host: 'dev-ws-02.empresa.local',
        verificadaEm: '2026-10-08T12:00:00.000Z',
        programasConsultados: 4,
        programasSemCobertura: 0,
        vulnerabilidadesEncontradas: 4,
        achadosNovos: 3,
        achadosExistentes: 0,
        semCvss: 1,
        pendentes: 0,
        falhas: [],
        varreduraId: 'cm-9',
      }),
    );
    expect(await realApi.verifyStation('cm-1')).toMatchObject({ newFindings: 3, noCvss: 1, failures: [] });
    on(
      'POST /estacoes/cm-1/verificar',
      fail(409, 'VERIFICACAO_EM_ANDAMENTO', 'Já existe uma verificação em andamento'),
    );
    expect(await rejection(realApi.verifyStation('cm-1'))).toMatchObject({
      status: 409,
      code: 'VERIFICACAO_EM_ANDAMENTO',
    });
  });
});

describe('realApi — aviso de monitoramento da estação (B18)', () => {
  const aviso = {
    versao: '2026-10-08',
    rascunho: true,
    titulo: 'Aviso sobre o monitoramento da estação de trabalho',
    introducao: 'Introdução.',
    secoes: [
      { id: 'coletado', titulo: 'O que é coletado', paragrafos: [], itens: ['Programas'], observacoes: [] },
      {
        id: 'nao-coletado',
        titulo: 'O que não é coletado',
        paragrafos: ['O agente não lê:'],
        itens: ['e-mails;'],
        observacoes: ['Nota.'],
      },
    ],
    ciencia: { registrada: false, registradaEm: null },
  };

  it('lê o aviso em GET /monitoramento/aviso e converte os campos', async () => {
    on('GET /monitoramento/aviso', ok(aviso));
    const notice = await realApi.getMonitoringNotice();
    expect(notice).toEqual({
      version: '2026-10-08',
      draft: true,
      title: 'Aviso sobre o monitoramento da estação de trabalho',
      intro: 'Introdução.',
      sections: [
        { id: 'coletado', title: 'O que é coletado', paragraphs: [], items: ['Programas'], notes: [] },
        {
          id: 'nao-coletado',
          title: 'O que não é coletado',
          paragraphs: ['O agente não lê:'],
          items: ['e-mails;'],
          notes: ['Nota.'],
        },
      ],
      acknowledged: false,
      acknowledgedAt: null,
    });
  });

  it('registra a ciência em POST /monitoramento/ciencia com a versão lida e propaga o 409', async () => {
    on('POST /monitoramento/ciencia', {
      status: 201,
      data: {
        status: 'sucesso',
        dados: { versao: '2026-10-08', registradaEm: '2026-10-08T15:00:00.000Z', nova: true },
      },
    });
    expect(await realApi.acknowledgeMonitoringNotice('2026-10-08')).toEqual({
      version: '2026-10-08',
      acknowledgedAt: '2026-10-08T15:00:00.000Z',
      created: true,
    });
    expect(body()).toEqual({ versao: '2026-10-08' });

    on('POST /monitoramento/ciencia', fail(409, 'VERSAO_DESATUALIZADA', 'O aviso mudou desde a sua leitura'));
    expect(await rejection(realApi.acknowledgeMonitoringNotice('2026-01-01'))).toMatchObject({
      status: 409,
      code: 'VERSAO_DESATUALIZADA',
    });
  });

  it('lista as ciências em GET /monitoramento/ciencias, paginada e filtrada no servidor', async () => {
    on('GET /monitoramento/ciencias', {
      status: 200,
      data: {
        status: 'sucesso',
        dados: [
          {
            id: 'ack-1',
            versao: '2026-10-08',
            registradaEm: '2026-10-08T15:00:00.000Z',
            usuario: {
              id: 'u-2',
              nome: 'Colaborador',
              email: 'colaborador@empresa.com',
              perfil: 'Colaborador',
              status: 'Ativo',
            },
          },
        ],
        resumo: { total: 7, pagina: 2, tamanho: 5, versaoAtual: '2026-10-08', pendentesVersaoAtual: 3 },
      },
    });
    const list = await realApi.listMonitoringAcknowledgements({
      version: '2026-10-08',
      page: 2,
      pageSize: 5,
    });
    expect(calls.at(-1)?.params).toEqual({ pagina: '2', tamanho: '5', versao: '2026-10-08' });
    expect(list).toEqual({
      items: [
        {
          id: 'ack-1',
          version: '2026-10-08',
          acknowledgedAt: '2026-10-08T15:00:00.000Z',
          user: {
            id: 'u-2',
            name: 'Colaborador',
            email: 'colaborador@empresa.com',
            role: 'collaborator',
            status: 'active',
          },
        },
      ],
      total: 7,
      page: 2,
      pageSize: 5,
      currentVersion: '2026-10-08',
      pendingCurrentVersion: 3,
    });

    await realApi.listMonitoringAcknowledgements();
    expect(calls.at(-1)?.params).toEqual({ pagina: '1', tamanho: '20' });

    on('GET /monitoramento/ciencias', fail(403, 'PERFIL_SEM_PERMISSAO', 'Acesso negado para o seu perfil'));
    expect(await rejection(realApi.listMonitoringAcknowledgements())).toMatchObject({ status: 403 });
  });
});

describe('realApi — configurações', () => {
  const prefs = {
    alertasEmail: true,
    somenteCriticas: false,
    resumoSemanal: true,
    relatoriosCampanha: false,
  };

  it('lê e grava preferências de notificação no formato do backend', async () => {
    on('GET /configuracoes/notificacoes', ok(prefs));
    on('PUT /configuracoes/notificacoes', (config) => ok(JSON.parse(String(config.data))));
    const read = await realApi.getNotificationPreferences();
    expect(read).toEqual({
      emailAlerts: true,
      criticalOnly: false,
      weeklyDigest: true,
      campaignReports: false,
    });
    const saved = await realApi.updateNotificationPreferences({ ...read, criticalOnly: true });
    expect(body()).toEqual({ ...prefs, somenteCriticas: true });
    expect(saved.criticalOnly).toBe(true);
  });

  it('preferências em servidor sem a rota viram 501', async () => {
    on('GET /configuracoes/notificacoes', fail(404, 'ROTA_NAO_ENCONTRADA', 'x'));
    on('PUT /configuracoes/notificacoes', fail(404, 'ROTA_NAO_ENCONTRADA', 'x'));
    expect((await rejection(realApi.getNotificationPreferences())).status).toBe(501);
    const err = await rejection(
      realApi.updateNotificationPreferences({
        emailAlerts: true,
        criticalOnly: true,
        weeklyDigest: true,
        campaignReports: true,
      }),
    );
    expect(err.status).toBe(501);
  });

  it('converte a política de segurança', async () => {
    on(
      'GET /configuracoes/seguranca',
      ok({
        politicaSenha: { comprimentoMinimo: 8, exigirMaiusculaMinuscula: true, exigirNumeroEspecial: true },
        sessao: {
          algoritmoToken: 'HS256',
          expiracaoMinutos: 30,
          sessaoMaximaHoras: 8,
          limiteTentativasLogin: 5,
          doisFatores: false,
        },
        auditoria: { registraAcoes: true, logImutavel: true, retencaoMeses: null },
      }),
    );
    await expect(realApi.getSecurityPolicy()).resolves.toEqual({
      passwordMinLength: 8,
      requireMixedCase: true,
      requireNumberAndSymbol: true,
      tokenAlgorithm: 'HS256',
      sessionExpirationMinutes: 30,
      sessionMaxHours: 8,
      loginAttemptLimit: 5,
      twoFactorEnabled: false,
      auditRegistersActions: true,
      auditLogImmutable: true,
      auditRetentionMonths: null,
    });
  });
});
