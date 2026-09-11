import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type { BaluarteApi, MessageResponse } from '@/services/contract';
import type {
  ApiEnvelope,
  Asset,
  AssetInput,
  AuthUser,
  Campaign,
  CampaignFilters,
  CampaignInput,
  CampaignReport,
  ChangePasswordInput,
  DashboardMetrics,
  LoginCredentials,
  LoginResponse,
  NotificationPreferences,
  ScanReport,
  SecurityPolicy,
  Severity,
  Training,
  User,
  UserInput,
  Vulnerability,
  VulnerabilityFilters,
  VulnerabilityListResponse,
  VulnerabilityStatus,
} from '@/types';
import { HttpError, isHttpError } from '@/lib/errors';
import { dispatchAuthEvent, FORBIDDEN_EVENT, UNAUTHORIZED_EVENT } from '@/lib/events';
import { localDayRange } from '@/lib/format';
import { tokenStorage } from '@/lib/storage';
import {
  fromAssetInput,
  fromCampaignInput,
  fromNotificationPreferences,
  fromUserInput,
  toAsset,
  toAuthUser,
  toAuthUserFromLogin,
  toCampaign,
  toCampaignReport,
  toDashboard,
  toNotificationPreferences,
  toScan,
  toSecurityPolicy,
  toTraining,
  toUser,
  toVulnerability,
  VULN_STATUS_TO_LABEL,
  type BackendAsset,
  type BackendCampaign,
  type BackendCampaignReport,
  type BackendDashboard,
  type BackendFinding,
  type BackendLogin,
  type BackendNotificationPreferences,
  type BackendScan,
  type BackendSecurityPolicy,
  type BackendTraining,
  type BackendUser,
} from '@/services/adapters';

// -----------------------------------------------------------------------------
// Service layer: um único ponto de acesso à API.
//  - Em desenvolvimento usa a camada mock (a menos que VITE_USE_MOCKS=false).
//  - Em produção (ou VITE_USE_MOCKS=true) fala com `VITE_API_BASE_URL` via axios,
//    anexando o JWT e normalizando erros para `HttpError`.
// A camada mock entra por `import()` dinâmico: `import.meta.env.*` é substituído
// estaticamente pelo Vite, então um `vite build` sem a flag descarta o módulo de
// mocks (dados fictícios e credenciais de demonstração) do bundle.
// -----------------------------------------------------------------------------

export { UNAUTHORIZED_EVENT, FORBIDDEN_EVENT };

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const MOCKS_FLAG = import.meta.env.VITE_USE_MOCKS;
export const USE_MOCKS: boolean = (import.meta.env.DEV && MOCKS_FLAG !== 'false') || MOCKS_FLAG === 'true';

/**
 * Capacidades da API ativa. O backend Express (`../backend`) expõe todas as rotas que
 * as telas usam, então tudo fica ligado nos dois modos. As flags continuam existindo
 * para que uma tela esconda a ação correspondente (em vez de mostrar um 404 genérico)
 * caso uma implantação desligue alguma capacidade — por exemplo, redefinição de senha
 * por e-mail onde não há serviço de e-mail.
 */
export interface ApiFeatures {
  passwordReset: boolean;
  changePassword: boolean;
  notificationPreferences: boolean;
  completeTraining: boolean;
  userEdit: boolean;
  userDelete: boolean;
  /** Status "Risco aceito" em vulnerabilidades. */
  riskAcceptance: boolean;
  /** Mais de um destinatário por campanha. */
  multiRecipientCampaigns: boolean;
}

export const FEATURES: Readonly<ApiFeatures> = {
  passwordReset: true,
  changePassword: true,
  notificationPreferences: true,
  completeTraining: true,
  userEdit: true,
  userDelete: true,
  riskAcceptance: true,
  multiRecipientCampaigns: true,
};

export const httpClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

httpClient.interceptors.request.use((config) => {
  const token = tokenStorage.get();
  if (token && !config.headers?.Authorization) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

interface BackendErrorBody {
  status?: string;
  mensagem?: string;
  codigoErro?: string;
  message?: string;
  code?: string;
}

httpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<BackendErrorBody>) => {
    if (error.response) {
      const { status, data } = error.response;
      const message = data?.mensagem || data?.message || `Erro ${status}`;
      const code = data?.codigoErro || data?.code || `HTTP_${status}`;
      // Só derruba a sessão se havia uma sessão guardada (um 401 durante o próprio login não conta).
      if (status === 401 && tokenStorage.get())
        dispatchAuthEvent(UNAUTHORIZED_EVENT, { status, code, message });
      if (status === 403) dispatchAuthEvent(FORBIDDEN_EVENT, { status, code, message });
      return Promise.reject(new HttpError(status, code, message));
    }
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new HttpError(0, 'TIMEOUT', 'A API demorou demais para responder.'));
    }
    return Promise.reject(new HttpError(0, 'REDE', 'Não foi possível conectar à API.'));
  },
);

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await httpClient.request<ApiEnvelope<T> | T>(config);
  const body = response.data as ApiEnvelope<T> | T;
  if (body && typeof body === 'object' && 'dados' in (body as object)) {
    return (body as ApiEnvelope<T>).dados;
  }
  return body as T;
}

async function requestWithSummary<T>(
  config: AxiosRequestConfig,
): Promise<{ dados: T; resumo?: Record<string, unknown> }> {
  const response = await httpClient.request<ApiEnvelope<T>>(config);
  return { dados: response.data.dados, resumo: response.data.resumo };
}

function emptySeverityMap(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

/** Rota inexistente no backend atual vira 501 explícito (em vez de "Rota não encontrada"). */
function rethrowAsNotImplemented(error: unknown): never {
  if (isHttpError(error) && error.status === 404 && error.code === 'ROTA_NAO_ENCONTRADA') {
    throw new HttpError(501, 'NAO_IMPLEMENTADO', 'Este recurso ainda não está disponível na API.');
  }
  throw error;
}

const GENERIC_RESET_MESSAGE =
  'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.';

// ---- Implementação real (backend Express em /api) ---------------------------

export const realApi: BaluarteApi = {
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const raw = await request<BackendLogin>({
      method: 'POST',
      url: '/login',
      data: { email: credentials.email.trim(), senha: credentials.password },
    });
    // O nome completo vem de /me. O token vai no cabeçalho desta chamada, sem
    // tocar no storage: quem persiste a sessão é o AuthContext, depois do sucesso.
    let user: AuthUser;
    try {
      user = toAuthUser(
        await request<BackendUser>({
          method: 'GET',
          url: '/me',
          headers: { Authorization: `Bearer ${raw.token}` },
        }),
      );
    } catch {
      // /me indisponível: o perfil vem do próprio /login (nunca rebaixa para colaborador).
      user = toAuthUserFromLogin(raw);
    }
    return { token: raw.token, user };
  },

  async me(): Promise<AuthUser> {
    return toAuthUser(await request<BackendUser>({ method: 'GET', url: '/me' }));
  },

  async requestPasswordReset(email: string): Promise<MessageResponse> {
    try {
      await request<unknown>({ method: 'POST', url: '/auth/reset-password', data: { email: email.trim() } });
    } catch (error) {
      if (isHttpError(error)) {
        if (error.status === 404 && error.code === 'ROTA_NAO_ENCONTRADA') rethrowAsNotImplemented(error);
        // Não revelar se o e-mail existe: respostas "usuário não encontrado" viram a mensagem genérica.
        if ([403, 404, 409, 410, 422].includes(error.status)) return { message: GENERIC_RESET_MESSAGE };
        if (error.status === 429)
          throw new HttpError(429, 'MUITAS_TENTATIVAS', 'Muitas solicitações. Aguarde alguns minutos.');
        if (error.status === 400) throw new HttpError(400, 'EMAIL_INVALIDO', 'Formato de e-mail inválido');
      }
      throw error;
    }
    return { message: GENERIC_RESET_MESSAGE };
  },

  async confirmPasswordReset(token: string, newPassword: string): Promise<MessageResponse> {
    try {
      const raw = await request<{ mensagem?: string; message?: string } | undefined>({
        method: 'POST',
        url: '/auth/reset-password/confirm',
        data: { token: token.trim(), novaSenha: newPassword },
      });
      return { message: raw?.mensagem || raw?.message || 'Senha redefinida com sucesso.' };
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async changePassword(input: ChangePasswordInput): Promise<MessageResponse> {
    try {
      const raw = await request<{ mensagem?: string; message?: string } | undefined>({
        method: 'POST',
        url: '/auth/change-password',
        data: { senhaAtual: input.currentPassword, novaSenha: input.newPassword },
      });
      return { message: raw?.mensagem || raw?.message || 'Senha alterada com sucesso.' };
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async getDashboard(): Promise<DashboardMetrics> {
    const [dashboard, scans] = await Promise.all([
      request<BackendDashboard>({ method: 'GET', url: '/dashboard' }),
      request<BackendScan[]>({ method: 'GET', url: '/scans' }).catch(() => [] as BackendScan[]),
    ]);
    return toDashboard(dashboard, scans.map(toScan));
  },

  async listAssets(): Promise<Asset[]> {
    const raw = await request<BackendAsset[]>({ method: 'GET', url: '/assets' });
    return raw.map(toAsset);
  },

  async createAsset(input: AssetInput): Promise<Asset> {
    const raw = await request<BackendAsset>({ method: 'POST', url: '/assets', data: fromAssetInput(input) });
    return {
      ...toAsset({ ...raw, criadoEm: raw.criadoEm ?? new Date().toISOString() }),
      description: input.description ?? null,
      ip: input.ip ?? null,
    };
  },

  async listScans(): Promise<ScanReport[]> {
    const raw = await request<BackendScan[]>({ method: 'GET', url: '/scans' });
    return raw.map(toScan);
  },

  async startScan(assetId: string): Promise<ScanReport> {
    const raw = await request<{ scanId: string; ativoId: string; statusVarredura: string; criadoEm: string }>(
      {
        method: 'POST',
        url: '/scans',
        data: { ativoId: assetId },
      },
    );
    return toScan({
      id: raw.scanId,
      assetId: raw.ativoId,
      status: raw.statusVarredura,
      criadoEm: raw.criadoEm,
    });
  },

  async listVulnerabilities(filters: VulnerabilityFilters = {}): Promise<VulnerabilityListResponse> {
    const params: Record<string, string> = {};
    if (filters.query) params.q = filters.query;
    const { dados } = await requestWithSummary<BackendFinding[]>({
      method: 'GET',
      url: '/vulnerabilidades',
      params,
    });
    let items = dados.map(toVulnerability);
    if (filters.severity && filters.severity !== 'all')
      items = items.filter((v) => v.severity === filters.severity);
    if (filters.status && filters.status !== 'all') items = items.filter((v) => v.status === filters.status);
    const bySeverity = emptySeverityMap();
    const byStatus: Record<VulnerabilityStatus, number> = {
      open: 0,
      in_review: 0,
      remediating: 0,
      resolved: 0,
      accepted: 0,
    };
    for (const v of items) {
      bySeverity[v.severity] += 1;
      byStatus[v.status] += 1;
    }
    return {
      items,
      summary: {
        total: items.length,
        bySeverity,
        byStatus,
        assets: new Set(items.map((v) => v.assetId)).size,
      },
    };
  },

  async getVulnerability(id: string): Promise<Vulnerability> {
    return toVulnerability(
      await request<BackendFinding>({ method: 'GET', url: `/vulnerabilidades/${encodeURIComponent(id)}` }),
    );
  },

  async updateVulnerabilityStatus(id: string, status: VulnerabilityStatus): Promise<Vulnerability> {
    if (status === 'accepted' && !FEATURES.riskAcceptance) {
      throw new HttpError(422, 'STATUS_NAO_SUPORTADO', 'Esta API ainda não registra "Risco aceito".');
    }
    const raw = await request<BackendFinding>({
      method: 'PATCH',
      url: `/vulnerabilidades/${encodeURIComponent(id)}`,
      data: { status: VULN_STATUS_TO_LABEL[status] },
    });
    return toVulnerability(raw);
  },

  async listCampaigns(filters: CampaignFilters = {}): Promise<Campaign[]> {
    const raw = await request<BackendCampaign[]>({ method: 'GET', url: '/campanhas' });
    let items = raw.map(toCampaign);
    if (filters.status && filters.status !== 'all') items = items.filter((c) => c.status === filters.status);
    const from = localDayRange(filters.from);
    if (from) items = items.filter((c) => new Date(c.scheduledAt).getTime() >= from.start);
    const to = localDayRange(filters.to);
    if (to) items = items.filter((c) => new Date(c.scheduledAt).getTime() <= to.end);
    const q = filters.query?.trim().toLowerCase();
    if (q) items = items.filter((c) => c.name.toLowerCase().includes(q));
    return items;
  },

  async getCampaignReport(id: string): Promise<CampaignReport> {
    return toCampaignReport(
      await request<BackendCampaignReport>({ method: 'GET', url: `/campanhas/${encodeURIComponent(id)}` }),
    );
  },

  async createCampaign(input: CampaignInput): Promise<Campaign> {
    if (input.recipients.length > 1 && !FEATURES.multiRecipientCampaigns) {
      throw new HttpError(
        422,
        'MULTIPLOS_DESTINATARIOS',
        'A API atual aceita um destinatário por campanha. Informe um único e-mail.',
      );
    }
    const payload = fromCampaignInput(input);
    const raw = await request<{
      idCampanha: string;
      nome: string;
      destinatario: string;
      destinatarios?: string[];
      template: string;
      status: string;
    }>({
      method: 'POST',
      url: '/campaigns',
      data: payload,
    });
    return {
      ...toCampaign({
        id: raw.idCampanha,
        nome: raw.nome,
        template: raw.template,
        status: raw.status,
        destinatarios: raw.destinatarios?.length ?? payload.destinatarios.length,
        taxaClique: 0,
        criadoEm: new Date().toISOString(),
      }),
      targetGroup: input.targetGroup,
      scheduledAt: input.scheduledAt,
    };
  },

  async getTraining(id: string): Promise<Training> {
    const raw = await request<BackendTraining>({
      method: 'GET',
      url: `/treinamentos/${encodeURIComponent(id)}`,
    });
    return toTraining(id, raw);
  },

  async completeTraining(id: string): Promise<Training> {
    try {
      await request<unknown>({ method: 'POST', url: `/treinamentos/${encodeURIComponent(id)}/concluir` });
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
    const training = toTraining(
      id,
      await request<BackendTraining>({ method: 'GET', url: `/treinamentos/${encodeURIComponent(id)}` }),
    );
    return {
      ...training,
      completed: true,
      progress: 100,
      completedAt: training.completedAt ?? new Date().toISOString(),
    };
  },

  async listUsers(): Promise<User[]> {
    const raw = await request<BackendUser[]>({ method: 'GET', url: '/usuarios' });
    return raw.map(toUser);
  },

  async getUser(id: string): Promise<User> {
    const users = await this.listUsers();
    const found = users.find((u) => u.id === id);
    if (!found) throw new HttpError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado');
    return found;
  },

  async createUser(input: UserInput): Promise<User> {
    const raw = await request<{ idUsuario: string; nome: string; email: string; perfil: string }>({
      method: 'POST',
      url: '/users',
      data: fromUserInput(input),
    });
    return toUser({
      id: raw.idUsuario,
      nome: raw.nome,
      email: raw.email,
      perfil: raw.perfil,
      status: 'Pendente',
      criadoEm: new Date().toISOString(),
    });
  },

  async updateUser(id: string, input: Partial<UserInput>): Promise<User> {
    const data: Record<string, string> = {};
    if (input.name !== undefined) data.nome = input.name.trim();
    if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
    if (input.role !== undefined)
      data.perfil = fromUserInput({ name: '', email: '', role: input.role }).perfil;
    if (input.status !== undefined)
      data.status =
        input.status === 'active' ? 'Ativo' : input.status === 'inactive' ? 'Inativo' : 'Pendente';
    try {
      const raw = await request<BackendUser>({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(id)}`,
        data,
      });
      return toUser(raw);
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async deleteUser(id: string): Promise<void> {
    try {
      await request<unknown>({ method: 'DELETE', url: `/users/${encodeURIComponent(id)}` });
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    try {
      return toNotificationPreferences(
        await request<BackendNotificationPreferences>({ method: 'GET', url: '/configuracoes/notificacoes' }),
      );
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async updateNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    try {
      return toNotificationPreferences(
        await request<BackendNotificationPreferences>({
          method: 'PUT',
          url: '/configuracoes/notificacoes',
          data: fromNotificationPreferences(prefs),
        }),
      );
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async getSecurityPolicy(): Promise<SecurityPolicy> {
    return toSecurityPolicy(
      await request<BackendSecurityPolicy>({ method: 'GET', url: '/configuracoes/seguranca' }),
    );
  },
};

// ---- Seleção da implementação -----------------------------------------------

const implementation: Promise<BaluarteApi> = USE_MOCKS
  ? import('@/mocks/api').then((module) => module.mockApi)
  : Promise.resolve(realApi);

type ApiMethod = (...args: unknown[]) => Promise<unknown>;

/**
 * Fachada que resolve a implementação sob demanda. Cada método devolve uma Promise,
 * exatamente como o contrato `BaluarteApi`, então as telas não percebem a diferença.
 */
function createLazyApi(): BaluarteApi {
  const cache = new Map<PropertyKey, ApiMethod>();
  return new Proxy({} as BaluarteApi, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      let method = cache.get(property);
      if (!method) {
        method = async (...args: unknown[]) => {
          const impl = await implementation;
          const fn = impl[property as keyof BaluarteApi] as unknown as ApiMethod | undefined;
          if (typeof fn !== 'function') throw new Error(`Método de API desconhecido: ${property}`);
          return fn.apply(impl, args);
        };
        cache.set(property, method);
      }
      return method;
    },
  });
}

/** API usada pelas telas. Troque a implementação via `VITE_USE_MOCKS`. */
export const api: BaluarteApi = createLazyApi();

export type { BaluarteApi } from '@/services/contract';
