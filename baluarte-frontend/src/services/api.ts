import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type {
  AnalyzeFileOptions,
  BaluarteApi,
  ChangePasswordResult,
  MessageResponse,
} from '@/services/contract';
import type {
  AccountLink,
  ApiEnvelope,
  Asset,
  AssetInput,
  AuditFilters,
  AuditIntegrity,
  AuditListResponse,
  AuthUser,
  Campaign,
  CampaignFilters,
  CampaignInput,
  CampaignReport,
  ChangePasswordInput,
  CreatedUser,
  DashboardMetrics,
  FileScanFilters,
  FileScanListResponse,
  FileScanOutcome,
  LoginCredentials,
  LoginResponse,
  MonitoringAcknowledgementFilters,
  MonitoringAcknowledgementListResponse,
  MonitoringAcknowledgementResult,
  MonitoringNotice,
  NotificationPreferences,
  PhishingReportResult,
  ScanReport,
  SecurityPolicy,
  SortState,
  StationDetail,
  StationListResponse,
  StationVerification,
  Training,
  TrainingOverview,
  User,
  UserInput,
  Vulnerability,
  VulnerabilityFilters,
  VulnerabilityListOptions,
  VulnerabilityListResponse,
  VulnerabilitySortKey,
  VulnerabilityReportFile,
  VulnerabilityStatus,
} from '@/types';
import { VULN_PAGE_SIZE } from '@/types';
import { HttpError, isHttpError } from '@/lib/errors';
import { dispatchAuthEvent, FORBIDDEN_EVENT, UNAUTHORIZED_EVENT } from '@/lib/events';
import { fileScanVerdict } from '@/lib/files';
import { localDayRange } from '@/lib/format';
import { filenameFromDisposition, vulnerabilityReportFilename } from '@/lib/download';
import { userFromToken } from '@/lib/jwt';
import { tokenStorage } from '@/lib/storage';
import {
  fromAssetInput,
  fromCampaignInput,
  fromNotificationPreferences,
  fromUserInput,
  toAccountLink,
  toAsset,
  toAuditIntegrity,
  toAuditList,
  toAuthUser,
  toAuthUserFromLogin,
  toCampaign,
  toCampaignReport,
  toDashboard,
  toFileScan,
  toFileScanList,
  toMonitoringAcknowledgementList,
  toMonitoringAcknowledgementResult,
  toMonitoringNotice,
  toNotificationPreferences,
  toScan,
  toSecurityPolicy,
  toStationDetail,
  toStationList,
  toStationVerification,
  toTraining,
  toTrainingOverview,
  toUser,
  toVulnerability,
  toVulnerabilityList,
  SEVERITY_TO_LABEL,
  VULN_STATUS_TO_LABEL,
  type BackendAccountLink,
  type BackendAsset,
  type BackendAuditEntry,
  type BackendAuditIntegrity,
  type BackendAuditSummary,
  type BackendCampaign,
  type BackendCampaignReport,
  type BackendDashboard,
  type BackendFileScan,
  type BackendFileScanSummary,
  type BackendFinding,
  type BackendLogin,
  type BackendMonitoringAcknowledgement,
  type BackendMonitoringAcknowledgementResult,
  type BackendMonitoringAcknowledgementSummary,
  type BackendMonitoringNotice,
  type BackendNotificationPreferences,
  type BackendScan,
  type BackendSecurityPolicy,
  type BackendStation,
  type BackendStationDetail,
  type BackendStationSummary,
  type BackendStationVerification,
  type BackendTraining,
  type BackendTrainingOverview,
  type BackendUser,
  type BackendVulnerabilitySummary,
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

function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Num download (`responseType: 'blob'`) o envelope de erro do backend chega como Blob JSON. */
async function readErrorBody(data: unknown): Promise<BackendErrorBody | undefined> {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      return JSON.parse(await blobText(data)) as BackendErrorBody;
    } catch {
      return undefined;
    }
  }
  return data as BackendErrorBody | undefined;
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<BackendErrorBody>) => {
    if (error.response) {
      const { status } = error.response;
      const data = await readErrorBody(error.response.data);
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

export { VULN_PAGE_SIZE };

/**
 * Coluna da tela → ordenação do servidor (`ordenar`/`direcao`). A severidade sai da nota CVSS,
 * então ordenar por severidade "da mais grave" é ordenar pelo CVSS do maior para o menor.
 */
export function vulnerabilitySortParams(
  sort: SortState<VulnerabilitySortKey> | null | undefined,
): Record<string, string> {
  if (!sort) return {};
  switch (sort.key) {
    case 'severity':
      return { ordenar: 'cvss', direcao: sort.direction === 'asc' ? 'desc' : 'asc' };
    case 'cvss':
      return { ordenar: 'cvss', direcao: sort.direction };
    case 'title':
      return { ordenar: 'descricao', direcao: sort.direction };
    case 'detectedAt':
      return { ordenar: 'detectadoEm', direcao: sort.direction };
  }
}

/** Filtros da tela → query do servidor (lista e relatório usam os mesmos). */
function vulnerabilityFilterParams(filters: VulnerabilityFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.severity && filters.severity !== 'all') {
    const label = SEVERITY_TO_LABEL[filters.severity];
    if (!label) throw new HttpError(400, 'SEVERIDADE_INVALIDA', 'Esta severidade não existe no servidor.');
    params.severidade = label;
  }
  if (filters.status && filters.status !== 'all') params.status = VULN_STATUS_TO_LABEL[filters.status];
  const query = filters.query?.trim();
  if (query) params.q = query;
  return params;
}

/** Rota inexistente no backend atual vira 501 explícito (em vez de "Rota não encontrada"). */
function rethrowAsNotImplemented(error: unknown): never {
  if (isHttpError(error) && error.status === 404 && error.code === 'ROTA_NAO_ENCONTRADA') {
    throw new HttpError(501, 'NAO_IMPLEMENTADO', 'Este recurso ainda não está disponível na API.');
  }
  throw error;
}

/** Tamanho padrão da página da trilha de auditoria (o servidor aceita até 100). */
export const AUDIT_PAGE_SIZE = 20;

/** Tamanho padrão da página da lista de ciências do aviso de monitoramento (o servidor aceita até 100). */
export const MONITORING_ACK_PAGE_SIZE = 20;

/** Tamanho padrão da página do histórico de análises de arquivo (o servidor aceita até 100). */
export const FILE_SCAN_PAGE_SIZE = 20;

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

  async verifyAccountLink(token: string): Promise<AccountLink> {
    return toAccountLink(
      await request<BackendAccountLink>({
        method: 'POST',
        url: '/auth/link/verificar',
        data: { token: token.trim() },
      }),
    );
  },

  // A troca de senha invalida o token anterior (SENHA_REDEFINIDA): quem chama precisa
  // guardar o token devolvido aqui, senao a propria sessao cai na requisicao seguinte.
  async changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
    try {
      const raw = await request<{ mensagem?: string; message?: string; token?: string } | undefined>({
        method: 'POST',
        url: '/auth/change-password',
        data: { senhaAtual: input.currentPassword, novaSenha: input.newPassword },
      });
      return {
        message: raw?.mensagem || raw?.message || 'Senha alterada com sucesso.',
        token: raw?.token ?? '',
      };
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async logout(): Promise<void> {
    await request<unknown>({ method: 'POST', url: '/auth/logout' });
  },

  async renewSession(): Promise<string> {
    const raw = await request<{ token: string }>({ method: 'POST', url: '/auth/renovar' });
    return raw.token;
  },

  async getDashboard(): Promise<DashboardMetrics> {
    // /scans é restrito a Administrador/Analista. Pedir como Colaborador devolveria 403
    // e dispararia a ressincronização com /me a cada visita ao dashboard, à toa.
    const operador = ['admin', 'analyst'].includes(userFromToken(tokenStorage.get() ?? '')?.role ?? '');
    const [dashboard, scans] = await Promise.all([
      request<BackendDashboard>({ method: 'GET', url: '/dashboard' }),
      operador
        ? request<BackendScan[]>({ method: 'GET', url: '/scans' }).catch(() => [] as BackendScan[])
        : Promise.resolve([] as BackendScan[]),
    ]);
    return toDashboard(dashboard, scans.map(toScan));
  },

  async listAssets(): Promise<Asset[]> {
    const raw = await request<BackendAsset[]>({ method: 'GET', url: '/assets' });
    return raw.map(toAsset);
  },

  async createAsset(input: AssetInput): Promise<Asset> {
    const raw = await request<BackendAsset>({ method: 'POST', url: '/assets', data: fromAssetInput(input) });
    // IP e descrição vêm da resposta da API (B10), não do que o formulário mandou.
    return toAsset({ ...raw, criadoEm: raw.criadoEm ?? new Date().toISOString() });
  },

  async listScans(): Promise<ScanReport[]> {
    const raw = await request<BackendScan[]>({ method: 'GET', url: '/scans' });
    return raw.map(toScan);
  },

  async getScan(id: string): Promise<ScanReport> {
    const raw = await request<BackendScan>({ method: 'GET', url: `/scans/${encodeURIComponent(id)}` });
    return toScan(raw);
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

  // Filtro, ordenação e paginação no servidor (B25): chega uma página, e o `resumo` (total,
  // ativos, contagens por severidade e status) descreve o filtro inteiro.
  async listVulnerabilities(
    filters: VulnerabilityFilters = {},
    options: VulnerabilityListOptions = {},
  ): Promise<VulnerabilityListResponse> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? VULN_PAGE_SIZE;
    // "Informativo" não existe no servidor (toda nota CVSS cai numa das quatro faixas).
    if (filters.severity === 'info') {
      return toVulnerabilityList(
        [],
        { total: 0, ativos: 0, pagina: page, tamanho: pageSize },
        { page, pageSize },
      );
    }
    const { dados, resumo } = await requestWithSummary<BackendFinding[]>({
      method: 'GET',
      url: '/vulnerabilidades',
      params: {
        ...vulnerabilityFilterParams(filters),
        ...vulnerabilitySortParams(options.sort),
        pagina: String(page),
        tamanho: String(pageSize),
      },
    });
    return toVulnerabilityList(dados, resumo as BackendVulnerabilitySummary | undefined, { page, pageSize });
  },

  // Relatório em PDF (B24): o servidor aplica os mesmos filtros da lista, gera o arquivo e
  // registra a exportação na auditoria. Blob pelo mesmo cliente (o interceptor põe o token).
  async exportVulnerabilityReport(filters: VulnerabilityFilters = {}): Promise<VulnerabilityReportFile> {
    const params = vulnerabilityFilterParams(filters);
    const response = await httpClient.request<Blob>({
      method: 'GET',
      url: '/vulnerabilidades/relatorio.pdf',
      params,
      responseType: 'blob',
      headers: { Accept: 'application/pdf' },
      // Gerar o PDF leva mais que uma leitura comum.
      timeout: 60_000,
    });
    const disposition = response.headers?.['content-disposition'];
    return {
      blob: response.data,
      filename:
        filenameFromDisposition(typeof disposition === 'string' ? disposition : null) ??
        vulnerabilityReportFilename(),
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

  // Link público do e-mail da campanha: sem login, pelo token aleatório do e-mail.
  async getTrainingByLink(token: string): Promise<Training> {
    const raw = await request<BackendTraining>({
      method: 'GET',
      url: `/treinamentos/link/${encodeURIComponent(token)}`,
    });
    return toTraining(token, raw);
  },

  async completeTrainingByLink(token: string): Promise<Training> {
    const path = `/treinamentos/link/${encodeURIComponent(token)}`;
    const done = await request<{ concluidoEm?: string | null }>({ method: 'POST', url: `${path}/concluir` });
    const training = toTraining(token, await request<BackendTraining>({ method: 'GET', url: path }));
    return {
      ...training,
      completed: true,
      progress: 100,
      completedAt: training.completedAt ?? done.concluidoEm ?? new Date().toISOString(),
    };
  },

  async reportPhishing(token: string): Promise<PhishingReportResult> {
    const raw = await request<{ reportado: boolean; reportadoEm: string }>({
      method: 'POST',
      url: `/treinamentos/link/${encodeURIComponent(token)}/reportar`,
    });
    return { reported: true, reportedAt: raw.reportadoEm };
  },

  async getTrainingOverview(): Promise<TrainingOverview> {
    return toTrainingOverview(
      await request<BackendTrainingOverview>({ method: 'GET', url: '/treinamentos/consolidado' }),
    );
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

  async createUser(input: UserInput): Promise<CreatedUser> {
    const raw = await request<{
      idUsuario: string;
      nome: string;
      email: string;
      perfil: string;
      departamento?: string | null;
      conviteEnviado?: boolean;
    }>({
      method: 'POST',
      url: '/users',
      data: fromUserInput(input),
    });
    // A conta nasce Pendente e so vira Ativo quando a pessoa cria a senha pelo convite.
    return {
      ...toUser({
        id: raw.idUsuario,
        nome: raw.nome,
        email: raw.email,
        perfil: raw.perfil,
        status: 'Pendente',
        criadoEm: new Date().toISOString(),
        departamento: raw.departamento ?? null,
      }),
      inviteSent: raw.conviteEnviado !== false,
    };
  },

  async resendInvite(id: string): Promise<MessageResponse> {
    const raw = await request<{ mensagem?: string } | undefined>({
      method: 'POST',
      url: `/users/${encodeURIComponent(id)}/convite`,
    });
    return { message: raw?.mensagem || 'Convite reenviado.' };
  },

  async sendPasswordReset(id: string): Promise<MessageResponse> {
    const raw = await request<{ mensagem?: string } | undefined>({
      method: 'POST',
      url: `/users/${encodeURIComponent(id)}/redefinir-senha`,
    });
    return { message: raw?.mensagem || 'Link de redefinição enviado.' };
  },

  async updateUser(id: string, input: Partial<UserInput>): Promise<User> {
    const data: Record<string, string | null> = {};
    if (input.name !== undefined) data.nome = input.name.trim();
    if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
    if (input.role !== undefined)
      data.perfil = fromUserInput({ name: '', email: '', role: input.role }).perfil;
    if (input.status !== undefined)
      data.status =
        input.status === 'active' ? 'Ativo' : input.status === 'inactive' ? 'Inativo' : 'Pendente';
    if (input.department !== undefined) data.departamento = input.department.trim() || null;
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

  async listDepartments(): Promise<string[]> {
    const raw = await request<Array<{ id: string; nome: string }>>({ method: 'GET', url: '/departamentos' });
    return raw.map((d) => d.nome);
  },

  // Análise de arquivos (B04). Multipart pelo mesmo cliente HTTP (o interceptor põe o token).
  // O Content-Type multipart impede o axios de serializar o FormData como JSON (o padrão do
  // cliente é application/json); no navegador ele o remove para o boundary sair certo.
  async analyzeFile(file: File, options: AnalyzeFileOptions = {}): Promise<FileScanOutcome> {
    const form = new FormData();
    form.append('arquivo', file, file.name);
    try {
      const response = await httpClient.request<ApiEnvelope<BackendFileScan>>({
        method: 'POST',
        url: '/arquivos/analise',
        data: form,
        headers: { 'Content-Type': 'multipart/form-data' },
        // A varredura do ClamAV leva mais que uma requisição comum.
        timeout: 60_000,
        onUploadProgress: (event) => {
          if (options.onProgress && event.total) {
            options.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
          }
        },
      });
      const scan = toFileScan(response.data.dados);
      return {
        scan,
        message: response.data.mensagem || fileScanVerdict(scan),
      };
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async listFileScans(filters: FileScanFilters = {}): Promise<FileScanListResponse> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? FILE_SCAN_PAGE_SIZE;
    const params: Record<string, string> = { pagina: String(page), tamanho: String(pageSize) };
    if (filters.result) params.resultado = filters.result === 'threat' ? 'AMEACA' : 'LIMPO';
    try {
      const { dados, resumo } = await requestWithSummary<BackendFileScan[]>({
        method: 'GET',
        url: '/arquivos/analises',
        params,
      });
      return toFileScanList(dados, resumo as BackendFileScanSummary | undefined, { page, pageSize });
    } catch (error) {
      rethrowAsNotImplemented(error);
    }
  },

  async listAuditLog(filters: AuditFilters = {}): Promise<AuditListResponse> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? AUDIT_PAGE_SIZE;
    const params: Record<string, string> = { pagina: String(page), tamanho: String(pageSize) };
    if (filters.action) params.acao = filters.action;
    // Dias locais viram instantes ISO: o servidor compara em UTC.
    const from = localDayRange(filters.from);
    if (from) params.de = new Date(from.start).toISOString();
    const to = localDayRange(filters.to);
    if (to) params.ate = new Date(to.end).toISOString();
    const { dados, resumo } = await requestWithSummary<BackendAuditEntry[]>({
      method: 'GET',
      url: '/auditoria',
      params,
    });
    return toAuditList(dados, resumo as BackendAuditSummary | undefined, { page, pageSize });
  },

  async listStations(): Promise<StationListResponse> {
    const { dados, resumo } = await requestWithSummary<BackendStation[]>({ method: 'GET', url: '/estacoes' });
    return toStationList(dados, resumo as BackendStationSummary | undefined);
  },

  async getStation(id: string): Promise<StationDetail> {
    return toStationDetail(
      await request<BackendStationDetail>({ method: 'GET', url: `/estacoes/${encodeURIComponent(id)}` }),
    );
  },

  async verifyStation(id: string): Promise<StationVerification> {
    return toStationVerification(
      await request<BackendStationVerification>({
        method: 'POST',
        url: `/estacoes/${encodeURIComponent(id)}/verificar`,
      }),
    );
  },

  async verifyAuditIntegrity(): Promise<AuditIntegrity> {
    return toAuditIntegrity(
      await request<BackendAuditIntegrity>({ method: 'GET', url: '/auditoria/integridade' }),
    );
  },

  async getMonitoringNotice(): Promise<MonitoringNotice> {
    return toMonitoringNotice(
      await request<BackendMonitoringNotice>({ method: 'GET', url: '/monitoramento/aviso' }),
    );
  },

  async acknowledgeMonitoringNotice(version: string): Promise<MonitoringAcknowledgementResult> {
    return toMonitoringAcknowledgementResult(
      await request<BackendMonitoringAcknowledgementResult>({
        method: 'POST',
        url: '/monitoramento/ciencia',
        data: { versao: version },
      }),
    );
  },

  async listMonitoringAcknowledgements(
    filters: MonitoringAcknowledgementFilters = {},
  ): Promise<MonitoringAcknowledgementListResponse> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? MONITORING_ACK_PAGE_SIZE;
    const params: Record<string, string> = { pagina: String(page), tamanho: String(pageSize) };
    if (filters.version) params.versao = filters.version;
    const { dados, resumo } = await requestWithSummary<BackendMonitoringAcknowledgement[]>({
      method: 'GET',
      url: '/monitoramento/ciencias',
      params,
    });
    return toMonitoringAcknowledgementList(
      dados,
      resumo as BackendMonitoringAcknowledgementSummary | undefined,
      { page, pageSize },
    );
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
