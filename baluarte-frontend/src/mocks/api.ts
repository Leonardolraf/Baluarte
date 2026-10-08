import type {
  AnalyzeFileOptions,
  BaluarteApi,
  ChangePasswordResult,
  MessageResponse,
} from '@/services/contract';
import type {
  AccountLink,
  Asset,
  AssetInput,
  AuditEntry,
  AuditFilters,
  AuditListResponse,
  AuthUser,
  Campaign,
  CampaignFilters,
  CampaignInput,
  CampaignMetrics,
  CampaignRecipient,
  CampaignReport,
  CampaignTimelineEvent,
  ChangePasswordInput,
  CreatedUser,
  DashboardMetrics,
  FileScan,
  FileScanOutcome,
  FunnelStage,
  LoginCredentials,
  LoginResponse,
  NotificationPreferences,
  PhishingReportResult,
  RBACRole,
  ScanReport,
  SecurityPolicy,
  Severity,
  TimelineEvent,
  Training,
  TrainingOverview,
  User,
  UserInput,
  Vulnerability,
  VulnerabilityFilters,
  VulnerabilityHistoryEntry,
  VulnerabilityListResponse,
  VulnerabilityStatus,
} from '@/types';
import { HttpError } from '@/lib/errors';
import { dispatchAuthEvent, FORBIDDEN_EVENT, UNAUTHORIZED_EVENT } from '@/lib/events';
import { fileScanVerdict, MAX_FILE_SIZE_BYTES } from '@/lib/files';
import { localDayRange } from '@/lib/format';
import { buildMockToken, decodeToken } from '@/lib/jwt';
import { tokenStorage } from '@/lib/storage';
import { FUNNEL_STAGE_LABEL, SEVERITY_RANK, severityFromCvss, VULN_STATUS_LABEL } from '@/lib/severity';
import {
  MOCK_ASSETS,
  MOCK_AUDIT_LOG,
  MOCK_CAMPAIGNS,
  MOCK_CREDENTIALS,
  MOCK_FILE_SCANS,
  MOCK_NOTIFICATION_PREFERENCES,
  MOCK_RECIPIENTS,
  MOCK_SCANS,
  MOCK_SECURITY_POLICY,
  MOCK_TIMELINE,
  MOCK_TRAININGS,
  MOCK_USERS,
  MOCK_VULNERABILITIES,
  type MockFileScan,
} from '@/mocks/data';

// -----------------------------------------------------------------------------
// Camada mock: simula a API REST com latência, falhas aleatórias em leituras e
// estado em memória (criações/edições persistem durante a sessão do navegador).
// Substituível pelo backend real via `VITE_USE_MOCKS=false` (ver services/api.ts).
// -----------------------------------------------------------------------------

export interface MockConfig {
  /** Intervalo [min, max] de latência simulada em ms. */
  latencyMs: [number, number];
  /** Probabilidade (0–1) de uma LEITURA falhar com 503. Escritas nunca falham aleatoriamente. */
  failureRate: number;
}

const IS_TEST = import.meta.env.MODE === 'test';

/** Chave opcional no localStorage para ajustar latência/falhas (usada pelos testes E2E e em demonstrações). */
export const MOCK_CONFIG_STORAGE_KEY = 'baluarte.mock';

function readStoredConfig(): Partial<MockConfig> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(MOCK_CONFIG_STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<MockConfig>;
    const override: Partial<MockConfig> = {};
    if (typeof parsed.failureRate === 'number' && parsed.failureRate >= 0 && parsed.failureRate <= 1) {
      override.failureRate = parsed.failureRate;
    }
    if (
      Array.isArray(parsed.latencyMs) &&
      parsed.latencyMs.length === 2 &&
      parsed.latencyMs.every((n) => typeof n === 'number' && n >= 0)
    ) {
      override.latencyMs = [parsed.latencyMs[0]!, parsed.latencyMs[1]!];
    }
    return override;
  } catch {
    return {};
  }
}

let config: MockConfig = {
  latencyMs: IS_TEST ? [0, 0] : [180, 520],
  failureRate: IS_TEST ? 0 : 0.04,
  ...readStoredConfig(),
};

export function configureMocks(partial: Partial<MockConfig>): void {
  config = { ...config, ...partial };
}

export function getMockConfig(): MockConfig {
  return { ...config };
}

interface MockState {
  users: User[];
  passwords: Map<string, string>;
  assets: Asset[];
  vulnerabilities: Vulnerability[];
  scans: ScanReport[];
  campaigns: Campaign[];
  recipients: CampaignRecipient[];
  trainings: Training[];
  timeline: TimelineEvent[];
  /** Trilha de auditoria, mais recente primeiro (RN-008). */
  auditLog: AuditEntry[];
  notificationPreferences: NotificationPreferences;
  securityPolicy: SecurityPolicy;
  /** Tokens de redefinição de senha emitidos nesta sessão (token -> e-mail). */
  resetTokens: Map<string, string>;
  sequence: number;
  /** Campanhas criadas nesta sessão: só elas têm métricas derivadas dos próprios destinatários. */
  runtimeCampaigns: Set<string>;
  /** Varreduras iniciadas nesta sessão: só elas avançam de status pelo tempo (as do seed ficam como estão). */
  runtimeScans: Set<string>;
  /** Análises de arquivo (só hash e resultado; o arquivo nunca é guardado). */
  fileScans: MockFileScan[];
  /** Instantes (ms) das análises feitas nesta sessão, por usuário: base do limite por hora. */
  fileScanTimes: Map<string, number[]>;
  /** Simula o motor ClamAV fora do ar (503 ANTIVIRUS_INDISPONIVEL). */
  antivirusAvailable: boolean;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createState(): MockState {
  return {
    users: clone(MOCK_USERS),
    passwords: new Map(
      MOCK_CREDENTIALS.map((c: { email: string; password: string }): [string, string] => [
        c.email.toLowerCase(),
        c.password,
      ]),
    ),
    assets: clone(MOCK_ASSETS),
    vulnerabilities: clone(MOCK_VULNERABILITIES),
    scans: clone(MOCK_SCANS),
    campaigns: clone(MOCK_CAMPAIGNS).map((c) => ({ ...c, trainingId: c.trainingId ?? `trn-${c.template}` })),
    recipients: clone(MOCK_RECIPIENTS),
    trainings: clone(MOCK_TRAININGS),
    timeline: clone(MOCK_TIMELINE),
    auditLog: clone(MOCK_AUDIT_LOG),
    notificationPreferences: clone(MOCK_NOTIFICATION_PREFERENCES),
    securityPolicy: clone(MOCK_SECURITY_POLICY),
    // Link de demonstração sempre válido: a tela de criar senha confere o token na API
    // antes de pedir a senha, então sem um token conhecido não há como mostrar o fluxo.
    resetTokens: new Map<string, string>([['demo-reset-1', 'colaborador@empresa.com']]),
    sequence: 1000,
    runtimeCampaigns: new Set<string>(),
    runtimeScans: new Set<string>(),
    fileScans: clone(MOCK_FILE_SCANS),
    fileScanTimes: new Map<string, number[]>(),
    antivirusAvailable: true,
  };
}

let state: MockState = createState();

/** Restaura o estado inicial (usado em testes). */
export function resetMockState(): void {
  state = createState();
}

/** Liga/desliga o antivírus simulado (testes e demonstração do 503). Volta a ligar com `resetMockState`. */
export function setMockAntivirusAvailable(available: boolean): void {
  state.antivirusAvailable = available;
}

// ---- Infra interna ----------------------------------------------------------

function nextId(prefix: string): string {
  state.sequence += 1;
  return `${prefix}-${state.sequence}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function delay(): Promise<void> {
  const [min, max] = config.latencyMs;
  const ms = min + Math.random() * Math.max(0, max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulate<T>(produce: () => T, options: { canFail?: boolean } = {}): Promise<T> {
  await delay();
  const canFail = options.canFail ?? true;
  if (canFail && config.failureRate > 0 && Math.random() < config.failureRate) {
    throw new HttpError(
      503,
      'SERVICO_INDISPONIVEL',
      'Serviço temporariamente indisponível (falha simulada). Tente novamente.',
    );
  }
  return clone(produce());
}

/** Rejeita com 401/403 e emite o mesmo evento global que a camada HTTP real emitiria. */
/** Grava na trilha de auditoria da sessão, como o servidor faz nas rotas de escrita. */
function pushAudit(
  user: Pick<User, 'id' | 'name' | 'email'> | null,
  action: string,
  detail: string | null = null,
): void {
  state.auditLog.unshift({
    id: nextId('aud'),
    action,
    detail,
    at: nowIso(),
    user: user ? { id: user.id, name: user.name, email: user.email } : null,
  });
}

function deny(status: 401 | 403, code: string, message: string): never {
  const error = new HttpError(status, code, message);
  dispatchAuthEvent(status === 401 ? UNAUTHORIZED_EVENT : FORBIDDEN_EVENT, error);
  throw error;
}

function requireUser(): User {
  const payload = decodeToken(tokenStorage.get());
  if (!payload) deny(401, 'TOKEN_AUSENTE', 'Sessão expirada. Faça login novamente.');
  if (payload.exp * 1000 <= Date.now()) deny(401, 'TOKEN_EXPIRADO', 'Sessão expirada. Faça login novamente.');
  const user = state.users.find((u) => u.id === payload.sub);
  if (!user) deny(401, 'TOKEN_INVALIDO', 'Sessão inválida. Faça login novamente.');
  return user;
}

function requireRole(user: User, roles: User['role'][]): void {
  if (!roles.includes(user.role)) deny(403, 'PERFIL_SEM_PERMISSAO', 'Acesso negado para o seu perfil.');
}

function isValidIpv4(value: string): boolean {
  const match = IPV4_RE.exec(value.trim());
  return !!match && match.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERNAL_DOMAIN = '@empresa.com';
const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidHost(host: string): boolean {
  const h = host.trim();
  const m = h.match(IPV4_RE);
  if (m) return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  return HOST_RE.test(h);
}

function passwordMeetsPolicy(password: string, policy: SecurityPolicy): string | null {
  if (password.length < policy.passwordMinLength)
    return `A senha deve ter pelo menos ${policy.passwordMinLength} caracteres.`;
  if (policy.requireMixedCase && !(/[a-z]/.test(password) && /[A-Z]/.test(password)))
    return 'A senha deve conter letras maiúsculas e minúsculas.';
  if (policy.requireNumberAndSymbol && !(/\d/.test(password) && /[^A-Za-z0-9]/.test(password)))
    return 'A senha deve conter número e caractere especial.';
  return null;
}

function emptySeverityMap(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function isOpen(v: Vulnerability): boolean {
  return v.status !== 'resolved' && v.status !== 'accepted';
}

// ---- Varredura simulada (espelha backend/src/varredura.ts) ------------------
// O status sai do tempo decorrido desde o início, avaliado na leitura: em fila nos
// primeiros 5 s, em andamento até 20 s, concluída depois. Os achados nascem na conclusão.
export const SCAN_QUEUE_MS = 5_000;
export const SCAN_DURATION_MS = 20_000;

function scanStatusByTime(startedAt: string, now: number): ScanReport['status'] {
  const elapsed = now - new Date(startedAt).getTime();
  if (elapsed >= SCAN_DURATION_MS) return 'completed';
  if (elapsed >= SCAN_QUEUE_MS) return 'running';
  return 'queued';
}

/** Achados da varredura concluída: 2 ou 3 tipos distintos do catálogo de demonstração, no ativo varrido. */
function generateScanFindings(scan: ScanReport, at: string): Vulnerability[] {
  const pool = MOCK_VULNERABILITIES.filter((v, i, all) => all.findIndex((x) => x.title === v.title) === i);
  const count = Math.min(pool.length, 2 + Math.floor(Math.random() * 2));
  const picked: Vulnerability[] = [];
  for (let i = 0; i < count; i++) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  return picked.map((template) => {
    const id = nextId('vuln');
    return {
      ...clone(template),
      id,
      status: 'open',
      assetId: scan.assetId,
      assetName: scan.assetName,
      assetHost: scan.assetHost,
      detectedAt: at,
      updatedAt: at,
      evidence: template.evidence.map((e, n) => ({ ...clone(e), id: `${id}-e${n}`, capturedAt: at })),
      history: [{ id: `${id}-h1`, at, actor: scan.scanner, action: 'detected' }],
    };
  });
}

/** Grava o status que o tempo já determinou (e os achados de quem concluiu). */
function advanceScans(now = Date.now()): void {
  for (const scan of state.scans) {
    if (!state.runtimeScans.has(scan.id) || scan.status === 'completed') continue;
    const status = scanStatusByTime(scan.startedAt, now);
    if (status !== 'completed') {
      scan.status = status;
      continue;
    }
    const finishedAt = new Date(new Date(scan.startedAt).getTime() + SCAN_DURATION_MS).toISOString();
    const findings = generateScanFindings(scan, finishedAt);
    state.vulnerabilities.unshift(...findings);
    const bySeverity = emptySeverityMap();
    for (const f of findings) bySeverity[f.severity] += 1;
    scan.status = status;
    scan.finishedAt = finishedAt;
    scan.durationSec = SCAN_DURATION_MS / 1000;
    scan.findingsCount = findings.length;
    scan.findingsBySeverity = bySeverity;
    pushTimeline({
      kind: 'scan',
      title: 'Varredura concluída',
      description: `${scan.assetName} (${scan.assetHost}) · ${findings.length} achados`,
    });
  }
}

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, high: 6, medium: 3, low: 1, info: 0 };

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function computeMetrics(campaignId: string, recipientsCount: number): CampaignMetrics {
  const rows = state.recipients.filter((r) => r.campaignId === campaignId);
  const sent = rows.filter((r) => r.sentAt).length;
  const opened = rows.filter((r) => r.openedAt).length;
  const clicked = rows.filter((r) => r.clickedAt).length;
  const submitted = rows.filter((r) => r.submittedAt).length;
  const reported = rows.filter((r) => r.reportedAt).length;
  const trained = rows.filter((r) => r.trainingCompleted).length;
  return {
    recipients: Math.max(recipientsCount, rows.length),
    sent,
    opened,
    clicked,
    submitted,
    reported,
    trained,
    openRate: pct(opened, sent),
    clickRate: pct(clicked, sent),
    submitRate: pct(submitted, sent),
    reportRate: pct(reported, sent),
    trainedRate: pct(trained, clicked),
  };
}

function refreshCampaignMetrics(campaign: Campaign): Campaign {
  // Campanhas semeadas trazem totais autorais (a lista de destinatários é só uma amostra);
  // recalcular a partir da amostra encolheria "enviados" de 156 para ~16. Só campanhas
  // criadas em runtime têm métricas derivadas dos próprios destinatários.
  if (state.runtimeCampaigns.has(campaign.id)) {
    campaign.metrics = computeMetrics(campaign.id, campaign.metrics.recipients);
  }
  return campaign;
}

function recipientByLink(token: string): CampaignRecipient {
  const recipient = state.recipients.find((r) => r.id === token.trim());
  if (!recipient) throw new HttpError(404, 'TREINAMENTO_NAO_ENCONTRADO', 'Treinamento não encontrado');
  return recipient;
}

/** Treinamento do template da campanha, sem expor a campanha (como na API real). */
function linkTraining(token: string, recipient: CampaignRecipient): Training {
  const campaign = state.campaigns.find((c) => c.id === recipient.campaignId);
  const base =
    state.trainings.find((t) => t.id === `trn-${campaign?.template ?? 'urgency'}`) ?? state.trainings[0];
  return {
    ...clone(base),
    id: token,
    campaignId: null,
    progress: recipient.trainingCompleted ? 100 : 0,
    completed: recipient.trainingCompleted,
    completedAt: null,
  };
}

function buildFunnel(metrics: CampaignMetrics): FunnelStage[] {
  return [
    { key: 'sent', label: FUNNEL_STAGE_LABEL.sent, value: metrics.sent, pct: metrics.sent > 0 ? 100 : 0 },
    { key: 'opened', label: FUNNEL_STAGE_LABEL.opened, value: metrics.opened, pct: metrics.openRate },
    { key: 'clicked', label: FUNNEL_STAGE_LABEL.clicked, value: metrics.clicked, pct: metrics.clickRate },
    {
      key: 'submitted',
      label: FUNNEL_STAGE_LABEL.submitted,
      value: metrics.submitted,
      pct: metrics.submitRate,
    },
    {
      key: 'reported',
      label: FUNNEL_STAGE_LABEL.reported,
      value: metrics.reported,
      pct: metrics.reportRate,
    },
  ];
}

function buildCampaignTimeline(campaign: Campaign, recipients: CampaignRecipient[]): CampaignTimelineEvent[] {
  const events: CampaignTimelineEvent[] = [];
  events.push({
    id: `${campaign.id}-scheduled`,
    at: campaign.createdAt,
    kind: 'scheduled',
    description: `Campanha "${campaign.name}" agendada para ${campaign.targetGroup}.`,
  });
  if (campaign.startedAt) {
    events.push({
      id: `${campaign.id}-started`,
      at: campaign.startedAt,
      kind: 'started',
      description: `Disparo iniciado para ${campaign.metrics.recipients} destinatários.`,
    });
  }
  const push = (
    r: CampaignRecipient,
    at: string | null | undefined,
    kind: CampaignTimelineEvent['kind'],
    text: string,
  ) => {
    if (at) events.push({ id: `${r.id}-${kind}`, at, kind, description: `${r.name} ${text}` });
  };
  for (const r of recipients) {
    push(r, r.clickedAt, 'clicked', 'clicou no link da simulação.');
    push(r, r.submittedAt, 'submitted', 'submeteu credenciais no formulário falso.');
    push(r, r.reportedAt, 'reported', 'reportou o e-mail suspeito ao time de TI.');
    if (r.trainingCompleted && r.clickedAt) {
      events.push({
        id: `${r.id}-trained`,
        at: r.clickedAt,
        kind: 'trained',
        description: `${r.name} concluiu o treinamento contextual.`,
      });
    }
  }
  if (campaign.endedAt) {
    events.push({
      id: `${campaign.id}-ended`,
      at: campaign.endedAt,
      kind: 'ended',
      description: 'Campanha encerrada.',
    });
  }
  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 25);
}

function pushTimeline(event: Omit<TimelineEvent, 'id' | 'at'>): void {
  state.timeline.unshift({ id: nextId('evt'), at: nowIso(), ...event });
}

// ---- Implementação ----------------------------------------------------------

/** Token da sessao mock, usado pelo login, pela renovacao e pela troca de senha. */
function emitirToken(user: { id: string; email: string; name: string; role: RBACRole }): string {
  return buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
}

// ---- Análise de arquivos (B05, contrato do B04) -------------------------------

/** Limite simulado de análises por usuário por hora (429 MUITAS_ANALISES acima disso). */
export const MOCK_FILE_SCANS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;
export const EICAR_SIGNATURE = 'Eicar-Signature';

function readFileBytes(file: Blob): Promise<Uint8Array> {
  // O jsdom não implementa Blob.arrayBuffer; o FileReader existe nos dois ambientes.
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo'));
    reader.readAsArrayBuffer(file);
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 pelo Web Crypto; sem ele (contexto não seguro), um hash FNV-1a de 256 bits só para a demonstração. */
export async function mockSha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const copy = new Uint8Array(bytes);
    return toHex(new Uint8Array(await subtle.digest('SHA-256', copy.buffer)));
  }
  let out = '';
  for (let round = 0; round < 8; round += 1) {
    let hash = (0x811c9dc5 ^ (round * 0x9e3779b1)) >>> 0;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    out += hash.toString(16).padStart(8, '0');
  }
  return out;
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const pattern = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + pattern.length <= bytes.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) if (bytes[i + j] !== pattern[j]) continue outer;
    return true;
  }
  return false;
}

function fileScanView(entry: MockFileScan, withUser: boolean): FileScan {
  const { userId, ...scan } = entry;
  if (!withUser) return { ...scan };
  const owner = state.users.find((u) => u.id === userId);
  return { ...scan, uploadedBy: { name: owner?.name ?? 'Usuário removido', email: owner?.email ?? '—' } };
}

export const mockApi: BaluarteApi = {
  // ---- Autenticação ----
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    await delay();
    const email = credentials.email.trim().toLowerCase();
    if (!email) throw new HttpError(400, 'EMAIL_OBRIGATORIO', 'E-mail é obrigatório');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'EMAIL_INVALIDO', 'Formato de e-mail inválido');
    if (!credentials.password) throw new HttpError(400, 'SENHA_OBRIGATORIA', 'Senha é obrigatória');

    const user = state.users.find((u) => u.email.toLowerCase() === email);
    const expected = state.passwords.get(email);
    if (!user || !expected || expected !== credentials.password) {
      throw new HttpError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha inválidos');
    }
    if (user.status === 'inactive') {
      throw new HttpError(403, 'USUARIO_INATIVO', 'Usuário inativo. Contate o administrador.');
    }
    if (user.status === 'pending') {
      throw new HttpError(
        403,
        'CONTA_PENDENTE',
        'Conta ainda não ativada. Crie sua senha pelo link do convite.',
      );
    }
    user.lastLoginAt = nowIso();
    pushAudit(user, 'LOGIN');
    const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
    const authUser: AuthUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    return clone({ token, user: authUser });
  },

  async me(): Promise<AuthUser> {
    return simulate(
      () => {
        const u = requireUser();
        return { id: u.id, name: u.name, email: u.email, role: u.role };
      },
      { canFail: false },
    );
  },

  async requestPasswordReset(email: string): Promise<MessageResponse> {
    await delay();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) throw new HttpError(400, 'EMAIL_INVALIDO', 'Formato de e-mail inválido');
    // Mensagem idêntica para e-mails conhecidos e desconhecidos (evita enumeração de usuários).
    const response: MessageResponse = {
      message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.',
    };
    const user = state.users.find((u) => u.email.toLowerCase() === normalized && u.status !== 'inactive');
    if (user) {
      // Não há e-mail no ambiente de demonstração: o token volta na resposta para
      // a tela completar o fluxo. A API real nunca faz isso (token só no servidor).
      const token = nextId('demo-reset');
      state.resetTokens.set(token, user.email.toLowerCase());
      response.demoToken = token;
    }
    return response;
  },

  async confirmPasswordReset(token: string, newPassword: string): Promise<MessageResponse> {
    await delay();
    const key = token.trim();
    if (!key) throw new HttpError(400, 'TOKEN_OBRIGATORIO', 'Token é obrigatório');
    const problem = passwordMeetsPolicy(newPassword, state.securityPolicy);
    if (problem) throw new HttpError(400, 'SENHA_FRACA', problem);
    const email = state.resetTokens.get(key);
    const user = email ? state.users.find((u) => u.email.toLowerCase() === email) : undefined;
    if (!email || !user) throw new HttpError(400, 'TOKEN_RESET_INVALIDO', 'Token inválido ou expirado');
    state.resetTokens.delete(key);
    state.passwords.set(email, newPassword);
    if (user.status === 'pending') user.status = 'active';
    return { message: 'Senha redefinida com sucesso.' };
  },

  async changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
    await delay();
    const user = requireUser();
    const current = state.passwords.get(user.email.toLowerCase());
    if (!current || current !== input.currentPassword) {
      throw new HttpError(400, 'SENHA_ATUAL_INCORRETA', 'A senha atual está incorreta.');
    }
    const problem = passwordMeetsPolicy(input.newPassword, state.securityPolicy);
    if (problem) throw new HttpError(400, 'SENHA_FRACA', problem);
    if (input.newPassword === input.currentPassword) {
      throw new HttpError(400, 'SENHA_REPETIDA', 'A nova senha deve ser diferente da atual.');
    }
    state.passwords.set(user.email.toLowerCase(), input.newPassword);
    // Como na API real: o token anterior morre e quem chama precisa guardar este.
    return { message: 'Senha alterada com sucesso.', token: emitirToken(user) };
  },

  async verifyAccountLink(token: string): Promise<AccountLink> {
    await delay();
    const email = state.resetTokens.get(token.trim());
    const user = email ? state.users.find((u) => u.email.toLowerCase() === email) : undefined;
    if (!email || !user) throw new HttpError(400, 'TOKEN_RESET_INVALIDO', 'Token inválido ou expirado');
    return {
      kind: user.status === 'pending' ? 'invite' : 'reset',
      name: user.name,
      email: user.email,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    };
  },

  async logout(): Promise<void> {
    await delay();
    requireUser();
  },

  async renewSession(): Promise<string> {
    await delay();
    return emitirToken(requireUser());
  },

  // ---- Dashboard ----
  async getDashboard(): Promise<DashboardMetrics> {
    return simulate(() => {
      const user = requireUser();
      // Colaboradores veem os índices e KPIs, mas não a lista técnica de achados nem as
      // métricas por campanha — mesma fronteira que /vulnerabilidades e /campanhas impõem.
      const manager = user.role === 'admin' || user.role === 'analyst';
      advanceScans();
      const vulns = state.vulnerabilities;
      const open = vulns.filter(isOpen);
      const severityDistribution = emptySeverityMap();
      let weighted = 0;
      for (const v of open) {
        severityDistribution[v.severity] += 1;
        weighted += SEVERITY_WEIGHT[v.severity];
      }
      const capacity = Math.max(1, state.assets.length) * 20;
      const technicalRisk = clampPct((weighted / capacity) * 100);

      const campaigns = state.campaigns.map(refreshCampaignMetrics);
      const measured = campaigns.filter((c) => c.metrics.sent > 0);
      const totalSent = measured.reduce((a, c) => a + c.metrics.sent, 0);
      const totalClicked = measured.reduce((a, c) => a + c.metrics.clicked, 0);
      const totalSubmitted = measured.reduce((a, c) => a + c.metrics.submitted, 0);
      const clickRate = pct(totalClicked, totalSent);
      const submitRate = pct(totalSubmitted, totalSent);
      const humanRisk = clampPct(clickRate * 2 + submitRate * 2);

      const byDate = <T extends { [K in F]: string }, F extends keyof T>(items: T[], field: F) =>
        [...items].sort((a, b) => new Date(b[field]).getTime() - new Date(a[field]).getTime());

      // O dashboard nunca exibe evidências/remediação/histórico: não os envia.
      const digest = (v: Vulnerability): Vulnerability => ({
        ...v,
        evidence: [],
        remediation: [],
        history: [],
      });

      // Treinamento pendente: o do próprio usuário como destinatário que clicou, senão o primeiro módulo aberto.
      const ownRecipient = state.recipients.find(
        (r) => r.email.toLowerCase() === user.email.toLowerCase() && r.clickedAt && !r.trainingCompleted,
      );
      const pending =
        (ownRecipient?.trainingId && state.trainings.find((t) => t.id === ownRecipient.trainingId)) ||
        state.trainings.find((t) => !t.completed) ||
        null;
      const pendingCampaign = pending?.campaignId
        ? state.campaigns.find((c) => c.id === pending.campaignId)
        : null;

      return {
        technicalRisk,
        humanRisk: totalSent > 0 ? humanRisk : 0,
        kpis: {
          openVulnerabilities: open.length,
          criticalVulnerabilities: open.filter((v) => v.severity === 'critical').length,
          phishingResilience: totalSent > 0 ? 100 - clickRate : null,
          monitoredAssets: state.assets.filter((a) => a.status === 'active').length,
          activeCampaigns: campaigns.filter((c) => c.status === 'active').length,
          trainedCollaborators: campaigns.reduce((sum, c) => sum + c.metrics.trained, 0),
        },
        severityDistribution,
        recentFindings: manager ? byDate(open, 'detectedAt').slice(0, 5).map(digest) : [],
        recentCampaigns: manager ? byDate(campaigns, 'createdAt').slice(0, 4) : [],
        recentScans: manager ? byDate(state.scans, 'startedAt').slice(0, 3) : [],
        timeline: byDate(state.timeline, 'at').slice(0, 8),
        pendingTraining: pending
          ? {
              id: pending.id,
              title: pending.title,
              moduleCode: pending.moduleCode,
              durationMin: pending.durationMin,
              campaignName: pendingCampaign?.name ?? null,
            }
          : null,
        generatedAt: nowIso(),
      };
    });
  },

  // ---- Ativos ----
  async listAssets(): Promise<Asset[]> {
    return simulate(() => {
      requireUser();
      advanceScans();
      return state.assets.map((a) => ({
        ...a,
        openFindings: state.vulnerabilities.filter((v) => v.assetId === a.id && isOpen(v)).length,
      }));
    });
  },

  async createAsset(input: AssetInput): Promise<Asset> {
    await delay();
    const user = requireUser();
    requireRole(user, ['admin', 'analyst']);
    const name = input.name?.trim();
    const host = input.host?.trim();
    if (!name) throw new HttpError(400, 'NOME_OBRIGATORIO', 'Nome do ativo é obrigatório');
    if (!['server', 'application', 'network', 'database'].includes(input.type))
      throw new HttpError(400, 'TIPO_INVALIDO', 'Tipo de ativo inválido');
    if (!host || !isValidHost(host)) throw new HttpError(400, 'HOST_INVALIDO', 'Host inválido');
    if (input.ip && !isValidIpv4(input.ip)) throw new HttpError(400, 'IP_INVALIDO', 'Endereço IP inválido');
    if (state.assets.some((a) => a.host.toLowerCase() === host.toLowerCase()))
      throw new HttpError(409, 'ATIVO_DUPLICADO', 'Ativo já cadastrado');

    const asset: Asset = {
      id: nextId('asset'),
      name,
      type: input.type,
      host,
      ip: input.ip?.trim() || null,
      description: input.description?.trim() || null,
      status: 'active',
      owner: user.name,
      createdAt: nowIso(),
      lastScanAt: null,
      openFindings: 0,
    };
    state.assets.unshift(asset);
    pushAudit(user, 'CRIAR_ATIVO', `${asset.id} (${asset.host}, ${asset.type})`);
    pushTimeline({
      kind: 'system',
      title: 'Novo ativo cadastrado',
      description: `${asset.name} (${asset.host})`,
      href: '/vulnerabilities',
    });
    return clone(asset);
  },

  // ---- Varreduras ----
  async listScans(): Promise<ScanReport[]> {
    return simulate(() => {
      requireUser();
      advanceScans();
      return [...state.scans].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
    });
  },

  async startScan(assetId: string): Promise<ScanReport> {
    await delay();
    const user = requireUser();
    requireRole(user, ['admin', 'analyst']);
    const asset = state.assets.find((a) => a.id === assetId);
    if (!asset) throw new HttpError(404, 'ATIVO_NAO_ENCONTRADO', 'Ativo não encontrado');
    if (asset.status !== 'active')
      throw new HttpError(422, 'ATIVO_INATIVO', 'Varredura não permitida: ativo está inativo');
    // RN-003: uma varredura por vez no mesmo ativo.
    advanceScans();
    if (state.scans.some((s) => s.assetId === asset.id && (s.status === 'queued' || s.status === 'running')))
      throw new HttpError(
        409,
        'VARREDURA_EM_ANDAMENTO',
        'Já existe uma varredura em andamento para este ativo',
      );
    const scan: ScanReport = {
      id: nextId('scan'),
      assetId: asset.id,
      assetName: asset.name,
      assetHost: asset.host,
      status: 'queued',
      scanner: 'Baluarte OWASP Engine 1.4',
      startedAt: nowIso(),
      finishedAt: null,
      durationSec: null,
      findingsCount: 0,
      findingsBySeverity: emptySeverityMap(),
    };
    state.scans.unshift(scan);
    state.runtimeScans.add(scan.id);
    asset.lastScanAt = scan.startedAt;
    pushAudit(user, 'INICIAR_VARREDURA', `${scan.id} no ativo ${asset.id} (${asset.host})`);
    pushTimeline({
      kind: 'scan',
      title: 'Varredura enfileirada',
      description: `${asset.name} (${asset.host})`,
    });
    return clone(scan);
  },

  // ---- Vulnerabilidades ----
  async listVulnerabilities(filters: VulnerabilityFilters = {}): Promise<VulnerabilityListResponse> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin', 'analyst']);
      advanceScans();
      let items = [...state.vulnerabilities];
      if (filters.severity && filters.severity !== 'all')
        items = items.filter((v) => v.severity === filters.severity);
      if (filters.status && filters.status !== 'all')
        items = items.filter((v) => v.status === filters.status);
      const q = filters.query?.trim().toLowerCase();
      if (q) {
        items = items.filter((v) =>
          [v.title, v.cve ?? '', v.assetHost, v.assetName, v.owaspCategory, v.owaspId, v.affectedComponent]
            .join(' ')
            .toLowerCase()
            .includes(q),
        );
      }
      items.sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          b.cvss.base - a.cvss.base ||
          new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
      );
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
    });
  },

  async getVulnerability(id: string): Promise<Vulnerability> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin', 'analyst']);
      const v = state.vulnerabilities.find((x) => x.id === id);
      if (!v) throw new HttpError(404, 'FINDING_NAO_ENCONTRADO', 'Vulnerabilidade não encontrada');
      return v;
    });
  },

  async updateVulnerabilityStatus(
    id: string,
    status: VulnerabilityStatus,
    note?: string,
  ): Promise<Vulnerability> {
    await delay();
    const user = requireUser();
    requireRole(user, ['admin', 'analyst']);
    const v = state.vulnerabilities.find((x) => x.id === id);
    if (!v) throw new HttpError(404, 'FINDING_NAO_ENCONTRADO', 'Vulnerabilidade não encontrada');
    if (!['open', 'in_review', 'remediating', 'resolved', 'accepted'].includes(status))
      throw new HttpError(400, 'STATUS_INVALIDO', 'Status inválido');
    if (v.status === status) return clone(v);
    const entry: VulnerabilityHistoryEntry = {
      id: nextId('hist'),
      at: nowIso(),
      actor: user.name,
      action: 'status_changed',
      from: v.status,
      to: status,
      note: note?.trim() || undefined,
    };
    pushAudit(
      user,
      'ALTERAR_STATUS_VULNERABILIDADE',
      `${v.id} (${v.assetHost}, ${v.owaspId}): ${VULN_STATUS_LABEL[v.status]} → ${VULN_STATUS_LABEL[status]}`,
    );
    v.status = status;
    v.updatedAt = entry.at;
    v.history.unshift(entry);
    pushTimeline({
      kind: 'finding',
      severity: v.severity,
      title: `Status alterado: ${v.cve ?? v.title}`,
      description: `${user.name} moveu para "${VULN_STATUS_LABEL[status]}" em ${v.assetHost}`,
      href: `/vulnerabilities/${v.id}`,
    });
    return clone(v);
  },

  // ---- Campanhas ----
  async listCampaigns(filters: CampaignFilters = {}): Promise<Campaign[]> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin', 'analyst']);
      let items = state.campaigns.map(refreshCampaignMetrics);
      if (filters.status && filters.status !== 'all')
        items = items.filter((c) => c.status === filters.status);
      // Limites no fuso local: o usuário digita a data como a vê na tela.
      const from = localDayRange(filters.from);
      if (from) items = items.filter((c) => new Date(c.scheduledAt).getTime() >= from.start);
      const to = localDayRange(filters.to);
      if (to) items = items.filter((c) => new Date(c.scheduledAt).getTime() <= to.end);
      const q = filters.query?.trim().toLowerCase();
      if (q) items = items.filter((c) => `${c.name} ${c.targetGroup}`.toLowerCase().includes(q));
      return items.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    });
  },

  async getCampaignReport(id: string): Promise<CampaignReport> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin', 'analyst']);
      const campaign = state.campaigns.find((c) => c.id === id);
      if (!campaign) throw new HttpError(404, 'CAMPANHA_NAO_ENCONTRADA', 'Campanha não encontrada');
      refreshCampaignMetrics(campaign);
      const recipients = state.recipients
        .filter((r) => r.campaignId === id)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      const departments = new Map<string, { recipients: number; clicked: number }>();
      for (const r of recipients) {
        const d = departments.get(r.department) ?? { recipients: 0, clicked: 0 };
        d.recipients += 1;
        if (r.clickedAt) d.clicked += 1;
        departments.set(r.department, d);
      }
      return {
        campaign,
        recipients,
        funnel: buildFunnel(campaign.metrics),
        timeline: buildCampaignTimeline(campaign, recipients),
        byDepartment: [...departments.entries()]
          .map(([department, d]) => ({
            department,
            recipients: d.recipients,
            clicked: d.clicked,
            clickRate: pct(d.clicked, d.recipients),
          }))
          .sort((a, b) => b.clickRate - a.clickRate),
      };
    });
  },

  async createCampaign(input: CampaignInput): Promise<Campaign> {
    await delay();
    const user = requireUser();
    requireRole(user, ['admin', 'analyst']);
    const name = input.name?.trim();
    if (!name) throw new HttpError(400, 'NOME_OBRIGATORIO', 'Nome da campanha é obrigatório');
    if (!['urgency', 'authority', 'curiosity'].includes(input.template))
      throw new HttpError(400, 'TEMPLATE_OBRIGATORIO', 'Template é obrigatório');
    if (!input.targetGroup?.trim()) throw new HttpError(400, 'GRUPO_OBRIGATORIO', 'Grupo-alvo é obrigatório');
    const scheduledAt = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime()))
      throw new HttpError(400, 'AGENDAMENTO_INVALIDO', 'Data de agendamento inválida');
    const recipients = (input.recipients ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean);
    if (recipients.length === 0)
      throw new HttpError(400, 'DESTINATARIOS_OBRIGATORIOS', 'Informe ao menos um destinatário');
    for (const r of recipients) {
      if (!EMAIL_RE.test(r)) throw new HttpError(400, 'EMAIL_INVALIDO', `Formato de e-mail inválido: ${r}`);
      if (!r.endsWith(INTERNAL_DOMAIN))
        throw new HttpError(
          422,
          'DESTINATARIO_EXTERNO',
          'Destinatário não autorizado: apenas e-mails internos',
        );
    }

    const campaign: Campaign = {
      id: nextId('camp'),
      name,
      template: input.template,
      targetGroup: input.targetGroup.trim(),
      status: 'scheduled',
      scheduledAt: scheduledAt.toISOString(),
      startedAt: null,
      endedAt: null,
      createdBy: user.name,
      createdAt: nowIso(),
      trainingId: `trn-${input.template}`,
      metrics: {
        recipients: recipients.length,
        sent: 0,
        opened: 0,
        clicked: 0,
        submitted: 0,
        reported: 0,
        trained: 0,
        openRate: 0,
        clickRate: 0,
        submitRate: 0,
        reportRate: 0,
        trainedRate: 0,
      },
    };
    state.campaigns.unshift(campaign);
    state.runtimeCampaigns.add(campaign.id);
    for (const email of new Set(recipients)) {
      state.recipients.push({
        id: nextId('rcpt'),
        campaignId: campaign.id,
        name:
          email
            .split('@')[0]
            ?.replace(/[._-]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()) ?? email,
        email,
        department: campaign.targetGroup,
        sentAt: null,
        openedAt: null,
        clickedAt: null,
        submittedAt: null,
        reportedAt: null,
        trainingCompleted: false,
        trainingId: null,
      });
    }
    pushTimeline({
      kind: 'campaign',
      title: 'Campanha agendada',
      description: `${campaign.name} — ${campaign.targetGroup}`,
      href: `/campaigns/${campaign.id}`,
    });
    return clone(campaign);
  },

  // ---- Treinamento ----
  // Espelha o /treinamentos/consolidado: o mesmo cálculo que a tela fazia no cliente.
  async getTrainingOverview(): Promise<TrainingOverview> {
    return simulate(() => {
      const ator = requireUser();
      requireRole(ator, ['admin', 'analyst']);
      const campanhas = state.campaigns;
      const conclusoes = campanhas.reduce((soma, c) => soma + c.metrics.trained, 0);
      const cliques = campanhas.reduce((soma, c) => soma + c.metrics.clicked, 0);

      const porPessoa = new Map<string, TrainingOverview['people'][number]>();
      const porDepartamento = new Map<string, number>();
      let conclusoesNominais = 0;
      for (const r of state.recipients) {
        if (!r.trainingCompleted) continue;
        conclusoesNominais += 1;
        porDepartamento.set(r.department, (porDepartamento.get(r.department) ?? 0) + 1);
        const campanha = campanhas.find((c) => c.id === r.campaignId);
        const chave = r.email.toLowerCase();
        const existente = porPessoa.get(chave);
        const entrada = { id: r.campaignId, name: campanha?.name ?? r.campaignId };
        if (existente) existente.campaigns.push(entrada);
        else
          porPessoa.set(chave, {
            name: r.name,
            email: r.email,
            department: r.department,
            campaigns: [entrada],
          });
      }

      return clone({
        campaigns: campanhas.length,
        completions: conclusoes,
        clicked: cliques,
        pendingAfterClick: Math.max(0, cliques - conclusoes),
        namedCompletions: conclusoesNominais,
        people: [...porPessoa.values()].sort(
          (a, b) => b.campaigns.length - a.campaigns.length || a.name.localeCompare(b.name, 'pt-BR'),
        ),
        byDepartment: [...porDepartamento.entries()]
          .map(([department, completions]) => ({ department, completions }))
          .sort((a, b) => b.completions - a.completions || a.department.localeCompare(b.department, 'pt-BR')),
      });
    });
  },

  async getTraining(id: string): Promise<Training> {
    return simulate(() => {
      requireUser();
      const training = state.trainings.find((t) => t.id === id);
      if (!training) throw new HttpError(404, 'TREINAMENTO_NAO_ENCONTRADO', 'Treinamento não encontrado');
      return training;
    });
  },

  async completeTraining(id: string): Promise<Training> {
    await delay();
    const user = requireUser();
    const training = state.trainings.find((t) => t.id === id);
    if (!training) throw new HttpError(404, 'TREINAMENTO_NAO_ENCONTRADO', 'Treinamento não encontrado');
    if (!training.completed) {
      training.completed = true;
      training.progress = 100;
      training.completedAt = nowIso();
      // Só o próprio usuário conclui o treinamento; os demais destinatários não mudam.
      for (const r of state.recipients) {
        if (r.trainingCompleted || r.email.toLowerCase() !== user.email.toLowerCase()) continue;
        if (r.trainingId === id || (training.campaignId && r.campaignId === training.campaignId)) {
          r.trainingCompleted = true;
          const campaign = state.campaigns.find((c) => c.id === r.campaignId);
          if (campaign && !state.runtimeCampaigns.has(campaign.id)) {
            campaign.metrics.trained += 1;
            campaign.metrics.trainedRate = pct(campaign.metrics.trained, campaign.metrics.clicked);
          }
        }
      }
      pushTimeline({
        kind: 'training',
        title: 'Treinamento concluído',
        description: `${user.name} concluiu "${training.title}"`,
      });
    }
    return clone(training);
  },

  // ---- Link público do e-mail da campanha (/t/:token) ----
  // Sem e-mail no modo mock, o "token do link" é o id do destinatário (ex.: o de um
  // destinatário criado nesta sessão). Na API real é um token aleatório guardado como hash.
  async getTrainingByLink(token: string): Promise<Training> {
    return simulate(() => {
      const recipient = recipientByLink(token);
      if (!recipient.clickedAt) {
        const now = nowIso();
        recipient.clickedAt = now;
        recipient.openedAt = recipient.openedAt ?? now;
        recipient.sentAt = recipient.sentAt ?? now;
      }
      return linkTraining(token, recipient);
    });
  },

  async completeTrainingByLink(token: string): Promise<Training> {
    await delay();
    const recipient = recipientByLink(token);
    if (!recipient.clickedAt)
      throw new HttpError(409, 'TREINAMENTO_NAO_INICIADO', 'Abra o treinamento antes de concluí-lo');
    recipient.trainingCompleted = true;
    return { ...linkTraining(token, recipient), completedAt: nowIso() };
  },

  async reportPhishing(token: string): Promise<PhishingReportResult> {
    return simulate(() => {
      const recipient = state.recipients.find((r) => r.id === token.trim());
      if (!recipient) throw new HttpError(404, 'LINK_NAO_ENCONTRADO', 'Link de campanha não encontrado');
      if (!recipient.reportedAt) {
        recipient.reportedAt = nowIso();
        recipient.openedAt = recipient.openedAt ?? recipient.reportedAt;
        recipient.sentAt = recipient.sentAt ?? recipient.reportedAt;
      }
      return { reported: true as const, reportedAt: recipient.reportedAt };
    });
  },

  // ---- Departamentos (mesma lista do seed do backend) ----
  async listDepartments(): Promise<string[]> {
    return simulate(() => {
      requireRole(requireUser(), ['admin', 'analyst']);
      return ['Comercial', 'Diretoria', 'Financeiro', 'Operações', 'RH', 'TI'];
    });
  },

  // ---- Usuários ----
  async listUsers(): Promise<User[]> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin']);
      return [...state.users].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    });
  },

  async getUser(id: string): Promise<User> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin']);
      const found = state.users.find((u) => u.id === id);
      if (!found) throw new HttpError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado');
      return found;
    });
  },

  async createUser(input: UserInput): Promise<CreatedUser> {
    await delay();
    const actor = requireUser();
    requireRole(actor, ['admin']);
    const name = input.name?.trim();
    const email = input.email?.trim().toLowerCase();
    if (!name) throw new HttpError(400, 'NOME_OBRIGATORIO', 'Nome é obrigatório');
    if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'EMAIL_INVALIDO', 'Email inválido');
    if (!['admin', 'analyst', 'collaborator'].includes(input.role))
      throw new HttpError(400, 'PERFIL_INVALIDO', 'Perfil inválido');
    if (state.users.some((u) => u.email.toLowerCase() === email))
      throw new HttpError(409, 'EMAIL_DUPLICADO', 'Email já cadastrado');
    const user: User = {
      id: nextId('user'),
      name,
      email,
      role: input.role,
      status: input.status ?? 'pending',
      department: input.department?.trim() || undefined,
      createdAt: nowIso(),
      lastLoginAt: null,
    };
    state.users.push(user);
    // Nao existe senha provisoria: a conta nasce Pendente e so ganha senha pelo convite.
    const convite = nextId('convite');
    state.resetTokens.set(convite, email);
    pushTimeline({
      kind: 'user',
      title: 'Usuário cadastrado',
      description: `${user.name} (${user.email})`,
      href: '/users',
    });
    return { ...clone(user), inviteSent: true };
  },

  async resendInvite(id: string): Promise<MessageResponse> {
    await delay();
    const actor = requireUser();
    requireRole(actor, ['admin', 'analyst']);
    const alvo = state.users.find((u) => u.id === id);
    if (!alvo) throw new HttpError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado');
    if (alvo.role === 'admin' && actor.role !== 'admin')
      throw new HttpError(403, 'PERFIL_SEM_PERMISSAO', 'Acesso negado para o seu perfil');
    if (alvo.status !== 'pending')
      throw new HttpError(
        409,
        'USUARIO_NAO_PENDENTE',
        'O convite só pode ser reenviado para contas pendentes',
      );
    const convite = nextId('convite');
    state.resetTokens.set(convite, alvo.email.toLowerCase());
    return { message: `Convite reenviado para ${alvo.email}` };
  },

  // Ação do administrador: dispara o link de redefinição de uma conta já ativa.
  // Conta Pendente ainda não tem senha, então o caminho dela é o convite.
  async sendPasswordReset(id: string): Promise<MessageResponse> {
    await delay();
    const actor = requireUser();
    requireRole(actor, ['admin']);
    const alvo = state.users.find((u) => u.id === id);
    if (!alvo) throw new HttpError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado');
    if (alvo.status !== 'active')
      throw new HttpError(409, 'USUARIO_NAO_ATIVO', 'O link de redefinição só é enviado para contas ativas');
    const token = nextId('demo-reset');
    state.resetTokens.set(token, alvo.email.toLowerCase());
    return { message: `Link de redefinição enviado para ${alvo.email}` };
  },

  async updateUser(id: string, input: Partial<UserInput>): Promise<User> {
    await delay();
    const actor = requireUser();
    requireRole(actor, ['admin']);
    const user = state.users.find((u) => u.id === id);
    if (!user) throw new HttpError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado');
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'EMAIL_INVALIDO', 'Email inválido');
      if (state.users.some((u) => u.id !== id && u.email.toLowerCase() === email))
        throw new HttpError(409, 'EMAIL_DUPLICADO', 'Email já cadastrado');
      const previous = state.passwords.get(user.email.toLowerCase());
      state.passwords.delete(user.email.toLowerCase());
      if (previous) state.passwords.set(email, previous);
      user.email = email;
    }
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new HttpError(400, 'NOME_OBRIGATORIO', 'Nome é obrigatório');
      user.name = input.name.trim();
    }
    if (input.role !== undefined) {
      if (!['admin', 'analyst', 'collaborator'].includes(input.role))
        throw new HttpError(400, 'PERFIL_INVALIDO', 'Perfil inválido');
      const admins = state.users.filter((u) => u.role === 'admin' && u.status !== 'inactive');
      if (user.role === 'admin' && input.role !== 'admin' && admins.length <= 1)
        throw new HttpError(409, 'ULTIMO_ADMIN', 'Não é possível rebaixar o único administrador ativo.');
      user.role = input.role;
    }
    if (input.status !== undefined) {
      if (user.id === actor.id && input.status === 'inactive')
        throw new HttpError(422, 'AUTO_INATIVACAO', 'Você não pode inativar a própria conta.');
      user.status = input.status;
    }
    if (input.department !== undefined) user.department = input.department.trim() || undefined;
    return clone(user);
  },

  async deleteUser(id: string): Promise<void> {
    await delay();
    const actor = requireUser();
    requireRole(actor, ['admin']);
    const index = state.users.findIndex((u) => u.id === id);
    if (index === -1) throw new HttpError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado');
    const user = state.users[index]!;
    if (user.id === actor.id)
      throw new HttpError(422, 'AUTO_EXCLUSAO', 'Você não pode excluir a própria conta.');
    const admins = state.users.filter((u) => u.role === 'admin' && u.status !== 'inactive');
    if (user.role === 'admin' && admins.length <= 1)
      throw new HttpError(409, 'ULTIMO_ADMIN', 'Não é possível excluir o único administrador ativo.');
    state.users.splice(index, 1);
    state.passwords.delete(user.email.toLowerCase());
    pushTimeline({
      kind: 'user',
      title: 'Usuário removido',
      description: `${user.name} (${user.email})`,
      href: '/users',
    });
  },

  // ---- Análise de arquivos ----
  async analyzeFile(file: File, options: AnalyzeFileOptions = {}): Promise<FileScanOutcome> {
    await delay();
    const user = requireUser();
    if (!file) throw new HttpError(400, 'ARQUIVO_OBRIGATORIO', 'Arquivo é obrigatório');
    if (file.size > MAX_FILE_SIZE_BYTES)
      throw new HttpError(413, 'ARQUIVO_MUITO_GRANDE', 'Arquivo excede o limite de 10 MB');
    const now = Date.now();
    const recent = (state.fileScanTimes.get(user.id) ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= MOCK_FILE_SCANS_PER_HOUR)
      throw new HttpError(429, 'MUITAS_ANALISES', 'Limite de análises por hora atingido. Tente mais tarde.');
    if (!state.antivirusAvailable)
      throw new HttpError(
        503,
        'ANTIVIRUS_INDISPONIVEL',
        'O antivírus não está disponível neste ambiente. Tente mais tarde.',
      );
    options.onProgress?.(100);
    const bytes = await readFileBytes(file);
    // Arquivo de teste EICAR: pelo nome (eicar.com, eicar.txt…) ou pela assinatura no conteúdo.
    const threat = /eicar/i.test(file.name) || containsAscii(bytes, 'EICAR');
    const entry: MockFileScan = {
      id: nextId('arq'),
      userId: user.id,
      name: file.name,
      size: file.size,
      sha256: await mockSha256(bytes),
      result: threat ? 'threat' : 'clean',
      threat: threat ? EICAR_SIGNATURE : null,
      scannedAt: nowIso(),
    };
    state.fileScans.unshift(entry);
    state.fileScanTimes.set(user.id, [...recent, now]);
    const scan = fileScanView(entry, false);
    return { scan, message: fileScanVerdict(scan) };
  },

  async listFileScans(): Promise<FileScan[]> {
    return simulate(() => {
      const user = requireUser();
      const operator = user.role === 'admin' || user.role === 'analyst';
      return state.fileScans
        .filter((entry) => operator || entry.userId === user.id)
        .sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime())
        .map((entry) => fileScanView(entry, operator));
    });
  },

  // ---- Configurações ----
  // ---- Auditoria ----
  async listAuditLog(filters: AuditFilters = {}): Promise<AuditListResponse> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin']);
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      if (!Number.isInteger(page) || page < 1)
        throw new HttpError(400, 'PAGINA_INVALIDA', 'Página inválida: use um inteiro a partir de 1');
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new HttpError(400, 'TAMANHO_INVALIDO', 'Tamanho inválido: use um inteiro de 1 a 100');
      const from = localDayRange(filters.from);
      const to = localDayRange(filters.to);
      if (from && to && from.start > to.end)
        throw new HttpError(400, 'PERIODO_INVALIDO', 'Período inválido: a data inicial é posterior à final');
      let items = [...state.auditLog];
      if (filters.action) items = items.filter((e) => e.action === filters.action);
      if (from) items = items.filter((e) => Date.parse(e.at) >= from.start);
      if (to) items = items.filter((e) => Date.parse(e.at) <= to.end);
      items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
      const actions = Array.from(new Set(state.auditLog.map((e) => e.action))).sort();
      return {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
        actions,
      };
    });
  },

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    return simulate(() => {
      requireUser();
      return state.notificationPreferences;
    });
  },

  async updateNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    await delay();
    requireUser();
    state.notificationPreferences = { ...state.notificationPreferences, ...prefs };
    return clone(state.notificationPreferences);
  },

  async getSecurityPolicy(): Promise<SecurityPolicy> {
    return simulate(() => {
      requireUser();
      return state.securityPolicy;
    });
  },
};

/** Utilitário exposto para testes: severidade coerente com o CVSS informado. */
export function mockSeverityFor(cvss: number): Severity {
  return severityFromCvss(cvss);
}
