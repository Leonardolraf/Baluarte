/**
 * Testa a camada de API (cliente + apiRepository) com `fetch` e o armazenamento
 * seguro mockados, e o `config` forçado em modo API. Nenhuma rede real é tocada.
 */
jest.mock('../../lib/config', () => ({
  API_BASE_URL: 'https://vm.test/api',
  IS_API_MODE: true,
}));

const mockSecureStore = {
  getItemAsync: jest.fn(async () => null as string | null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
};
jest.mock('expo-secure-store', () => mockSecureStore);

import { apiAuthRepository, apiCampaignRepository } from '../../lib/api/apiRepository';

type Envelope = Record<string, unknown>;

function reply(status: number, body: Envelope): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  mockSecureStore.getItemAsync.mockResolvedValue(null);
  mockSecureStore.setItemAsync.mockClear();
  mockSecureStore.deleteItemAsync.mockClear();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

describe('apiAuthRepository.signIn', () => {
  it('sucesso: guarda o token e carrega o usuário pelo /me', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(200, {
          status: 'sucesso',
          dados: { token: 'jwt-abc', idUsuario: 'u-1', email: 'ana@baluarte.test', perfil: 'Analista' },
        }),
      )
      .mockResolvedValueOnce(
        reply(200, {
          status: 'sucesso',
          dados: { id: 'u-1', nome: 'Ana Souza', email: 'ana@baluarte.test', perfil: 'Analista', departamento: 'TI' },
        }),
      );

    const result = await apiAuthRepository.signIn('ana@baluarte.test', 'segredo123');

    expect(result).toEqual({
      ok: true,
      user: {
        id: 'u-1',
        name: 'Ana Souza',
        email: 'ana@baluarte.test',
        role: 'analyst',
        department: 'TI',
        noticePending: false,
      },
    });
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('baluarte.token', 'jwt-abc');

    // Primeira chamada: POST /login sem Authorization.
    const [loginUrl, loginInit] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe('https://vm.test/api/login');
    expect(loginInit.method).toBe('POST');
    expect(loginInit.headers.Authorization).toBeUndefined();
    expect(JSON.parse(loginInit.body)).toEqual({ email: 'ana@baluarte.test', senha: 'segredo123' });
  });

  it('credenciais inválidas (401) viram a mensagem genérica', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(401, { status: 'erro', mensagem: 'x', codigoErro: 'CREDENCIAIS_INVALIDAS' }),
    );

    const result = await apiAuthRepository.signIn('x@baluarte.test', 'errada');

    expect(result).toEqual({ ok: false, error: 'E-mail ou senha inválidos.' });
    expect(mockSecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('Colaborador é barrado pelo RBAC e a sessão é encerrada', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(200, {
          status: 'sucesso',
          dados: { token: 'jwt-col', idUsuario: 'u-9', email: 'joao@baluarte.test', perfil: 'Colaborador' },
        }),
      )
      .mockResolvedValueOnce(
        reply(200, {
          status: 'sucesso',
          dados: { id: 'u-9', nome: 'João', email: 'joao@baluarte.test', perfil: 'Colaborador' },
        }),
      )
      .mockResolvedValueOnce(reply(200, { status: 'sucesso' })); // logout

    const result = await apiAuthRepository.signIn('joao@baluarte.test', 'segredo123');

    expect(result).toEqual({
      ok: false,
      error: 'O perfil Colaborador não tem acesso às campanhas neste app.',
    });
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('baluarte.token');
  });

  it('erro de rede vira mensagem amigável, sem lançar', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    const result = await apiAuthRepository.signIn('ana@baluarte.test', 'segredo123');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/conectar/i);
  });

  it('carrega noticePending do /me quando a ciência está pendente', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(200, {
          status: 'sucesso',
          dados: { token: 'jwt-abc', idUsuario: 'u-1', email: 'ana@baluarte.test', perfil: 'Administrador' },
        }),
      )
      .mockResolvedValueOnce(
        reply(200, {
          status: 'sucesso',
          dados: { id: 'u-1', nome: 'Ana', email: 'ana@baluarte.test', perfil: 'Administrador', cienciaAvisoPendente: true },
        }),
      );

    const result = await apiAuthRepository.signIn('ana@baluarte.test', 'segredo123');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.noticePending).toBe(true);
  });

  it('segue com os dados do login quando o /me falha', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(200, {
          status: 'sucesso',
          dados: { token: 'jwt-abc', idUsuario: 'u-1', email: 'ana@baluarte.test', perfil: 'Administrador' },
        }),
      )
      .mockResolvedValueOnce(reply(500, { status: 'erro', mensagem: 'x', codigoErro: 'ERRO_INTERNO' }));

    const result = await apiAuthRepository.signIn('ana@baluarte.test', 'segredo123');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.role).toBe('admin');
      expect(result.user.name).toBe('ana@baluarte.test'); // fallback sem /me
    }
  });
});

describe('apiCampaignRepository', () => {
  it('list: injeta o Bearer e mapeia as campanhas', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue('jwt-abc');
    fetchMock.mockResolvedValueOnce(
      reply(200, {
        status: 'sucesso',
        dados: [
          {
            id: 'camp-1',
            nome: 'Q3',
            template: 'urgencia',
            status: 'ativa',
            destinatarios: 100,
            taxaClique: 10,
            criadoEm: '2026-06-01T09:00:00.000Z',
          },
        ],
      }),
    );

    const list = await apiCampaignRepository.list();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('camp-1');
    expect(list[0].metrics.clicked).toBe(10);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://vm.test/api/campanhas');
    expect(init.headers.Authorization).toBe('Bearer jwt-abc');
  });

  it('list: 403 de ciência pendente propaga o código (a UI trata, não é erro genérico)', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue('jwt-abc');
    fetchMock.mockResolvedValueOnce(
      reply(403, { status: 'erro', mensagem: 'x', codigoErro: 'CIENCIA_AVISO_PENDENTE' }),
    );
    await expect(apiCampaignRepository.list()).rejects.toMatchObject({
      code: 'CIENCIA_AVISO_PENDENTE',
      status: 403,
    });
  });

  it('get: 404 devolve undefined', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(404, { status: 'erro', mensagem: 'x', codigoErro: 'CAMPANHA_NAO_ENCONTRADA' }),
    );
    await expect(apiCampaignRepository.get('camp-x')).resolves.toBeUndefined();
  });

  it('create: usa o idCampanha do POST e marca como agendada', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(201, {
        status: 'sucesso',
        dados: { idCampanha: 'camp-77', nome: 'Nova', template: 'urgencia', status: 'AGENDADA' },
      }),
    );

    const campaign = await apiCampaignRepository.create({
      name: 'Nova',
      template: 'urgency',
      targetGroup: 'Colaboradores internos',
      scheduledAt: new Date('2026-12-01T09:00:00.000Z'),
      recipients: ['a@baluarte.test', 'b@baluarte.test'],
    });

    expect(campaign.id).toBe('camp-77');
    expect(campaign.status).toBe('scheduled');
    expect(campaign.metrics.recipients).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://vm.test/api/campaigns');
    expect(JSON.parse(init.body)).toEqual({
      nome: 'Nova',
      destinatarios: ['a@baluarte.test', 'b@baluarte.test'],
      template: 'urgencia',
    });
  });
});
