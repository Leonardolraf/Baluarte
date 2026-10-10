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
  AssetRisk,
  AuditEntry,
  AuditFilters,
  AuditIntegrity,
  AuditListResponse,
  AuthUser,
  Campaign,
  CampaignFilters,
  CampaignInput,
  CampaignMetrics,
  CampaignRecipient,
  CampaignAttachments,
  CampaignReport,
  CampaignTimelineEvent,
  ChangePasswordInput,
  CreatedUser,
  DashboardMetrics,
  FileScan,
  FileScanFilters,
  FileScanListResponse,
  FileScanOutcome,
  ReceivedCampaignsResponse,
  FunnelStage,
  SecondOpinion,
  LoginCredentials,
  LoginResponse,
  MonitoringAcknowledgementFilters,
  MonitoringAcknowledgementListResponse,
  MonitoringAcknowledgementResult,
  MonitoringNotice,
  NotificationPreferences,
  PhishingReportResult,
  RBACRole,
  RiskTrendPoint,
  ScanReport,
  SecurityPolicy,
  Severity,
  Station,
  StationDetail,
  StationListResponse,
  StationVerification,
  TimelineEvent,
  Training,
  TrainingOverview,
  User,
  UserInput,
  Vulnerability,
  VulnerabilityFilters,
  VulnerabilityHistoryEntry,
  VulnerabilityListOptions,
  VulnerabilityListResponse,
  VulnerabilityReportFile,
  VulnerabilityStatus,
} from '@/types';
import { SEVERITIES, VULN_PAGE_SIZE } from '@/types';
import { HttpError } from '@/lib/errors';
import { dispatchAuthEvent, FORBIDDEN_EVENT, UNAUTHORIZED_EVENT } from '@/lib/events';
import { fileScanVerdict, isOwnRule, MAX_ATTACHMENTS_PER_CAMPAIGN, MAX_FILE_SIZE_BYTES } from '@/lib/files';
import { SCAN_DURATION_MS, scanProgressByTime } from './scanProgress';
import { vulnerabilityReportFilename } from '@/lib/download';
import { formatDate, formatDateTime, localDayRange } from '@/lib/format';
import { normalizeAssetHost } from '@/lib/host';
import { buildMockToken, decodeToken } from '@/lib/jwt';
import { tokenStorage } from '@/lib/storage';
import { FUNNEL_STAGE_LABEL, SEVERITY_LABEL, severityFromCvss, VULN_STATUS_LABEL } from '@/lib/severity';
import { simplePdf } from '@/mocks/pdf';
import {
  MOCK_ASSETS,
  MOCK_AUDIT_LOG,
  MOCK_CAMPAIGNS,
  MOCK_CREDENTIALS,
  MOCK_FILE_SCANS,
  MOCK_MONITORING_ACKS,
  MOCK_MONITORING_NOTICE,
  MOCK_NOTIFICATION_PREFERENCES,
  MOCK_RECIPIENTS,
  MOCK_SCANS,
  MOCK_SECURITY_POLICY,
  MOCK_TIMELINE,
  MOCK_TRAININGS,
  MOCK_USERS,
  MOCK_STATION_OFFLINE_AFTER_SEC,
  MOCK_VULNERABILITIES,
  buildMockStations,
  MOCK_STATION_CVES,
  type MockFileScan,
  type MockMonitoringAcknowledgement,
  type MockStation,
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
  /** Estações inscritas pelo agente (B13); o último contato é relativo ao relógio real. */
  stations: MockStation[];
  /** Segunda opinião do VirusTotal simulada (B20): ligada, desligada (sem chave) ou sem cota. */
  secondOpinionMode: MockSecondOpinionMode;
  /** Ciências do aviso de monitoramento (B18): uma por usuário e versão. */
  monitoringAcks: MockMonitoringAcknowledgement[];
}

export type MockSecondOpinionMode = 'enabled' | 'disabled' | 'quota';

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
    stations: buildMockStations(),
    secondOpinionMode: 'enabled',
    monitoringAcks: clone(MOCK_MONITORING_ACKS),
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

/** Modo da segunda opinião simulada (testes e demonstração). Volta a `enabled` com `resetMockState`. */
export function setMockSecondOpinion(mode: MockSecondOpinionMode): void {
  state.secondOpinionMode = mode;
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

/** Estação como o servidor devolve: status pelo último contato e os totais do inventário. */
function stationView(station: MockStation, nowMs: number = Date.now()): StationDetail {
  const silentMs = nowMs - new Date(station.lastSeenAt).getTime();
  return {
    ...station,
    status: silentMs <= MOCK_STATION_OFFLINE_AFTER_SEC * 1000 ? 'online' : 'offline',
    softwareCount: station.software.length,
    portCount: station.ports.length,
    offlineAfterSec: MOCK_STATION_OFFLINE_AFTER_SEC,
    verifiedAt: station.verifiedAt ?? null,
    findingsTotal: station.findingsTotal ?? 0,
    findingsOpen: station.findingsOpen ?? 0,
  };
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

// ---- Pesos de severidade (espelham PESO_SEVERIDADE em backend/src/models/dominio.model.ts) ----
// Os mesmos para a nota por ativo, o índice global e a evolução do risco (B25b). Escala
// 10/7/4/1, aprovada pelo Leo em 10/10/2026 (DT07): se mudar no backend, muda aqui.
// Nota do ativo: pontos = 10 × crítica + 7 × alta + 4 × média + 1 × baixa (abertas); nota = min(100, pontos).
const RISK_WEIGHT: Record<Severity, number> = { critical: 10, high: 7, medium: 4, low: 1, info: 0 };
const RISK_MAX = 100;
/** Quantos ativos o dashboard mostra no ranking de maior risco. */
export const TOP_RISK_ASSETS = 5;

function openBySeverityOf(assetId: string): Record<Severity, number> {
  const map = emptySeverityMap();
  for (const v of state.vulnerabilities) if (v.assetId === assetId && isOpen(v)) map[v.severity] += 1;
  return map;
}

function riskPoints(open: Record<Severity, number>): number {
  return SEVERITIES.reduce((sum, s) => sum + RISK_WEIGHT[s] * open[s], 0);
}

export function mockRiskScore(open: Record<Severity, number>): number {
  return Math.min(RISK_MAX, riskPoints(open));
}

function topRiskAssets(): AssetRisk[] {
  return state.assets
    .map((a) => {
      const openBySeverity = openBySeverityOf(a.id);
      return {
        id: a.id,
        name: a.name,
        host: a.host,
        riskScore: mockRiskScore(openBySeverity),
        openFindings: SEVERITIES.reduce((n, s) => n + openBySeverity[s], 0),
        openBySeverity,
      };
    })
    .filter((a) => a.openFindings > 0)
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore ||
        riskPoints(b.openBySeverity) - riskPoints(a.openBySeverity) ||
        SEVERITIES.reduce((d, s) => d || b.openBySeverity[s] - a.openBySeverity[s], 0) ||
        a.name.localeCompare(b.name, 'pt-BR') ||
        a.id.localeCompare(b.id),
    )
    .slice(0, TOP_RISK_ASSETS);
}

// ---- Lista de vulnerabilidades (filtro, ordem e página, como o servidor) ----

function filterVulnerabilities(filters: VulnerabilityFilters): Vulnerability[] {
  let items = [...state.vulnerabilities];
  if (filters.severity && filters.severity !== 'all')
    items = items.filter((v) => v.severity === filters.severity);
  if (filters.status && filters.status !== 'all') items = items.filter((v) => v.status === filters.status);
  const q = filters.query?.trim().toLowerCase();
  if (q) {
    items = items.filter((v) =>
      [v.title, v.cve ?? '', v.assetHost, v.assetName, v.owaspCategory, v.owaspId, v.affectedComponent]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }
  return items;
}

const time = (iso: string) => new Date(iso).getTime();

/** Mesma ordem estável do servidor: a coluna pedida, depois a mais recente, depois o id. */
function sortVulnerabilities(
  items: Vulnerability[],
  sort: VulnerabilityListOptions['sort'],
): Vulnerability[] {
  const byKey = (a: Vulnerability, b: Vulnerability): number => {
    if (!sort) return 0;
    const factor = sort.direction === 'asc' ? 1 : -1;
    switch (sort.key) {
      case 'severity': // da mais grave (asc) = CVSS do maior para o menor
        return (b.cvss.base - a.cvss.base) * factor;
      case 'cvss':
        return (a.cvss.base - b.cvss.base) * factor;
      case 'title':
        return a.title.localeCompare(b.title, 'pt-BR') * factor;
      case 'detectedAt':
        return (time(a.detectedAt) - time(b.detectedAt)) * factor;
    }
  };
  return [...items].sort(
    (a, b) => byKey(a, b) || time(b.detectedAt) - time(a.detectedAt) || b.id.localeCompare(a.id),
  );
}

// ---- Varredura simulada (espelha backend/src/services/cicloVarredura.service.ts) ----
// Status e progresso saem do tempo decorrido desde o início, avaliados na leitura
// (mocks/scanProgress.ts). Os achados nascem na conclusão.
export { SCAN_DURATION_MS, SCAN_QUEUE_MS } from './scanProgress';

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
    const { status, progress, stage, estimatedCompletionAt } = scanProgressByTime(scan.startedAt, now);
    scan.progress = progress;
    scan.stage = stage;
    scan.estimatedCompletionAt = estimatedCompletionAt;
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

/** Índice global (espelha backend/src/services/indiceRisco.service.ts): pontos / (ativos × 20) × 100, teto 100. */
function technicalRiskIndex(open: Record<Severity, number>, assets: number): number {
  return clampPct((riskPoints(open) / (Math.max(1, assets) * 20)) * 100);
}

/** Status do achado ao fim de `end` pelo histórico (sem mudança registrada até ali: o de antes da primeira). */
function statusAt(v: Vulnerability, end: number): VulnerabilityStatus {
  const changes = v.history
    .filter((h) => h.action === 'status_changed' && h.to)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const done = changes.filter((h) => Date.parse(h.at) <= end);
  if (done.length) return done[done.length - 1]!.to!;
  return changes[0]?.from ?? v.status;
}

/** Dia local AAAA-MM-DD. */
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Evolução do risco nos últimos 30 dias (espelha backend/src/services/evolucaoRisco.service.ts):
 * abertas por severidade ao fim de cada dia (pelo histórico), arquivos com ameaça na janela de 30
 * dias que termina no dia, ativos já criados e o índice do dia; hoje termina agora.
 */
function riskTrend(now = Date.now()): RiskTrendPoint[] {
  const today = new Date(now);
  return Array.from({ length: 30 }, (_, i) => {
    const back = 29 - i;
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const end =
      back === 0
        ? now
        : new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1).getTime() - 1;
    const open = emptySeverityMap();
    for (const v of state.vulnerabilities) {
      if (Date.parse(v.detectedAt) > end) continue;
      const status = back === 0 ? v.status : statusAt(v, end);
      if (status !== 'resolved' && status !== 'accepted') open[v.severity] += 1;
    }
    const maliciousFiles = countMaliciousFiles(end, end);
    const assets = state.assets.filter((a) => Date.parse(a.createdAt) <= end).length;
    return {
      date: localDate(dayStart.getTime()),
      critical: open.critical,
      high: open.high,
      medium: open.medium,
      low: open.low,
      maliciousFiles,
      assets,
      index: technicalRiskIndex({ ...open, critical: open.critical + maliciousFiles }, assets),
    };
  });
}

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

/** Detecções simuladas do EICAR no VirusTotal (o arquivo de teste é conhecido por quase todos). */
export const MOCK_EICAR_DETECTIONS = { detections: 61, total: 68 };

/**
 * Segunda opinião simulada, como no B20: só pelo hash, com cache do mesmo hash já consultado.
 * EICAR é malicioso; qualquer outro arquivo novo é desconhecido (o mock não conhece hashes reais).
 */
function mockSecondOpinion(sha256: string, threat: boolean): SecondOpinion {
  const base = { source: 'VirusTotal' as const, link: `https://www.virustotal.com/gui/file/${sha256}` };
  if (state.secondOpinionMode === 'disabled')
    return { ...base, status: 'disabled', reason: null, detections: null, total: null, checkedAt: null };
  const cached = state.fileScans.find(
    (s) => s.sha256 === sha256 && s.secondOpinion && s.secondOpinion.checkedAt !== null,
  )?.secondOpinion;
  if (cached) return { ...cached };
  if (state.secondOpinionMode === 'quota')
    return {
      ...base,
      status: 'unavailable',
      reason: 'quota',
      detections: null,
      total: null,
      checkedAt: null,
    };
  if (threat)
    return { ...base, status: 'malicious', reason: null, ...MOCK_EICAR_DETECTIONS, checkedAt: nowIso() };
  return { ...base, status: 'unknown', reason: null, detections: null, total: null, checkedAt: nowIso() };
}

/** Janela dos arquivos maliciosos no risco técnico (a mesma do backend, B17). */
export const MALICIOUS_FILES_WINDOW_DAYS = 30;

/** Arquivos distintos (por SHA-256) com ameaça nos últimos 30 dias, de todos os usuários. */
function countMaliciousFiles(now = Date.now(), until = Infinity): number {
  const since = now - MALICIOUS_FILES_WINDOW_DAYS * 24 * HOUR_MS;
  const hashes = new Set(
    state.fileScans
      .filter(
        (s) => s.result === 'threat' && Date.parse(s.scannedAt) >= since && Date.parse(s.scannedAt) <= until,
      )
      .map((s) => s.sha256),
  );
  return hashes.size;
}

/** Campanha de onde veio o anexo (B23): pelo destinatário; campanha excluída = sem origem. */
function campaignOf(campaignEventId: string | null | undefined): FileScan['campaign'] {
  const recipient = campaignEventId ? state.recipients.find((r) => r.id === campaignEventId) : undefined;
  const campaign = recipient ? state.campaigns.find((c) => c.id === recipient.campaignId) : undefined;
  return campaign ? { id: campaign.id, name: campaign.name } : null;
}

function fileScanView(entry: MockFileScan, withUser: boolean): FileScan {
  const { userId, campaignEventId, ...rest } = entry;
  const scan: FileScan = {
    ...rest,
    ownRule: rest.result === 'threat' && isOwnRule(rest.threat),
    campaign: campaignOf(campaignEventId),
  };
  if (!withUser) return scan;
  const owner = state.users.find((u) => u.id === userId);
  return { ...scan, uploadedBy: { name: owner?.name ?? 'Usuário removido', email: owner?.email ?? '—' } };
}

// ---- Regras YARA próprias e anexo de campanha (B23) ---------------------------

/**
 * Detecções simuladas das regras de antivirus/regras: o marcador de teste do Baluarte e o par
 * "gatilho automático + chamada ao sistema" da regra de macro. Os textos são montados em partes.
 */
const MOCK_OWN_RULES: Array<{ name: string; matches: (bytes: Uint8Array) => boolean }> = [
  {
    name: 'YARA.BaluarteMarcadorTeste.UNOFFICIAL',
    matches: (bytes) => containsAscii(bytes, ['BALUARTE', 'TESTE', 'AMEACA', '0001'].join('-')),
  },
  {
    name: 'YARA.BaluarteMacroSuspeita.UNOFFICIAL',
    matches: (bytes) =>
      (containsAscii(bytes, 'Document_Open') || containsAscii(bytes, 'AutoOpen')) &&
      (containsAscii(bytes, 'CreateObject') || containsAscii(bytes, 'WScript.Shell')),
  },
];

/** Destinatário da campanha que o usuário recebeu (o e-mail saiu); senão 404, como o backend. */
function receivedRecipient(campaignEventId: string, email: string): CampaignRecipient {
  const recipient = state.recipients.find(
    (r) => r.id === campaignEventId && r.email.toLowerCase() === email.toLowerCase() && r.sentAt,
  );
  if (!recipient || !state.campaigns.some((c) => c.id === recipient.campaignId))
    throw new HttpError(404, 'CAMPANHA_NAO_RECEBIDA', 'Campanha não encontrada entre as que você recebeu');
  return recipient;
}

function campaignAttachments(campaignId: string): CampaignAttachments {
  const recipients = new Map(
    state.recipients.filter((r) => r.campaignId === campaignId).map((r) => [r.id, r] as const),
  );
  const items = state.fileScans
    .filter((s) => s.campaignEventId && recipients.has(s.campaignEventId))
    .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt))
    .map((s) => ({
      id: s.id,
      name: s.name,
      sha256: s.sha256,
      result: s.result,
      threat: s.threat,
      ownRule: s.result === 'threat' && isOwnRule(s.threat),
      scannedAt: s.scannedAt,
      recipient: recipients.get(s.campaignEventId!)!.email,
    }));
  return {
    total: items.length,
    threats: items.filter((a) => a.result === 'threat').length,
    ownRules: items.filter((a) => a.ownRule).length,
    items,
  };
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
      for (const v of open) severityDistribution[v.severity] += 1;
      // B17: arquivo malicioso pesa como crítico (distintos por SHA-256, últimos 30 dias, de todos).
      const maliciousFiles = countMaliciousFiles();
      severityDistribution.critical += maliciousFiles;
      // B25b: o "servidor" (este mock) calcula o índice com os pesos únicos; a tela só exibe.
      const technicalRisk = technicalRiskIndex(severityDistribution, state.assets.length);

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

      // Colaborador (RN-006, B10): só a resiliência a phishing; nada técnico nem contagens de campanha.
      return {
        technicalRisk: manager ? technicalRisk : null,
        riskTrend: manager ? riskTrend() : null,
        humanRisk: totalSent > 0 ? humanRisk : 0,
        kpis: {
          openVulnerabilities: manager ? open.length : null,
          criticalVulnerabilities: manager
            ? open.filter((v) => v.severity === 'critical').length + maliciousFiles
            : null,
          maliciousFiles: manager ? maliciousFiles : null,
          phishingResilience: totalSent > 0 ? 100 - clickRate : null,
          monitoredAssets: manager ? state.assets.filter((a) => a.status === 'active').length : null,
          activeCampaigns: manager ? campaigns.filter((c) => c.status === 'active').length : null,
          trainedCollaborators: manager ? campaigns.reduce((sum, c) => sum + c.metrics.trained, 0) : null,
        },
        severityDistribution: manager ? severityDistribution : null,
        recentFindings: manager ? byDate(open, 'detectedAt').slice(0, 5).map(digest) : [],
        topRiskAssets: manager ? topRiskAssets() : [],
        recentCampaigns: manager ? byDate(campaigns, 'createdAt').slice(0, 4) : [],
        recentScans: manager ? byDate(state.scans, 'startedAt').slice(0, 3) : [],
        // A linha do tempo mistura achados e campanhas: também é só dos operadores.
        timeline: manager ? byDate(state.timeline, 'at').slice(0, 8) : [],
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
      return state.assets.map((a) => {
        const openBySeverity = openBySeverityOf(a.id);
        return {
          ...a,
          openFindings: SEVERITIES.reduce((n, s) => n + openBySeverity[s], 0),
          riskScore: mockRiskScore(openBySeverity),
          openBySeverity,
        };
      });
    });
  },

  async createAsset(input: AssetInput): Promise<Asset> {
    await delay();
    const user = requireUser();
    requireRole(user, ['admin', 'analyst']);
    const name = input.name?.trim();
    // Mesma normalização do backend (B10): https://host/caminho vira só o host.
    const host = input.host === undefined ? undefined : normalizeAssetHost(input.host);
    if (!name) throw new HttpError(400, 'NOME_OBRIGATORIO', 'Nome do ativo é obrigatório');
    if (!['server', 'application', 'network', 'database'].includes(input.type))
      throw new HttpError(400, 'TIPO_INVALIDO', 'Tipo de ativo inválido');
    if (!host || !isValidHost(host)) throw new HttpError(400, 'HOST_INVALIDO', 'Host inválido');
    if (input.ip && !isValidIpv4(input.ip)) throw new HttpError(400, 'IP_INVALIDO', 'Endereço IP inválido');
    if (input.description && input.description.trim().length > 500)
      throw new HttpError(400, 'DESCRICAO_INVALIDA', 'A descrição deve ter no máximo 500 caracteres');
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

  async getScan(id: string): Promise<ScanReport> {
    return simulate(() => {
      requireRole(requireUser(), ['admin', 'analyst']);
      advanceScans();
      const scan = state.scans.find((s) => s.id === id);
      if (!scan) throw new HttpError(404, 'VARREDURA_NAO_ENCONTRADA', 'Varredura não encontrada');
      return clone(scan);
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
    const startedAt = nowIso();
    const { progress, stage, estimatedCompletionAt } = scanProgressByTime(startedAt, Date.now());
    const scan: ScanReport = {
      id: nextId('scan'),
      assetId: asset.id,
      assetName: asset.name,
      assetHost: asset.host,
      status: 'queued',
      scanner: 'Baluarte OWASP Engine 1.4',
      startedAt,
      finishedAt: null,
      durationSec: null,
      findingsCount: 0,
      findingsBySeverity: emptySeverityMap(),
      progress,
      stage,
      estimatedCompletionAt,
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
  async listVulnerabilities(
    filters: VulnerabilityFilters = {},
    options: VulnerabilityListOptions = {},
  ): Promise<VulnerabilityListResponse> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin', 'analyst']);
      const page = options.page ?? 1;
      const pageSize = options.pageSize ?? VULN_PAGE_SIZE;
      if (!Number.isInteger(page) || page < 1)
        throw new HttpError(400, 'PAGINA_INVALIDA', 'Página inválida: use um inteiro a partir de 1');
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new HttpError(400, 'TAMANHO_INVALIDO', 'Tamanho inválido: use um inteiro de 1 a 100');
      advanceScans();
      const items = sortVulnerabilities(filterVulnerabilities(filters), options.sort);
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
        items: items.slice((page - 1) * pageSize, page * pageSize),
        summary: {
          total: items.length,
          bySeverity,
          byStatus,
          assets: new Set(items.map((v) => v.assetId)).size,
        },
        page,
        pageSize,
      };
    });
  },

  // Sem backend, o relatório é um PDF simples de texto (src/mocks/pdf.ts) com os mesmos
  // filtros da lista; a exportação entra na trilha de auditoria da sessão, como no servidor.
  async exportVulnerabilityReport(filters: VulnerabilityFilters = {}): Promise<VulnerabilityReportFile> {
    // O relatório não pagina: leva todos os achados do filtro (como o servidor).
    const { summary } = await this.listVulnerabilities(filters, { pageSize: 1 });
    const items = filterVulnerabilities(filters);
    const user = requireUser();
    const sorted = [...items].sort((a, b) => b.cvss.base - a.cvss.base);
    const severity =
      filters.severity && filters.severity !== 'all' ? SEVERITY_LABEL[filters.severity] : 'todas';
    const status = filters.status && filters.status !== 'all' ? VULN_STATUS_LABEL[filters.status] : 'todos';
    const query = filters.query?.trim();
    const filtersText = `severidade: ${severity}; status: ${status}; busca: ${query ? `"${query}"` : 'nenhuma'}`;
    const scores = sorted.map((v) => v.cvss.base);
    const lines = [
      'Baluarte — Relatório de vulnerabilidades (modo demonstração)',
      `Gerado em ${formatDateTime(new Date())} por ${user.name} (${user.email})`,
      `Filtros — ${filtersText}`,
      '',
      `Achados: ${summary.total} · Ativos afetados: ${summary.assets}` +
        (scores.length
          ? ` · CVSS médio: ${(scores.reduce((s, n) => s + n, 0) / scores.length).toFixed(1)} · CVSS máximo: ${Math.max(...scores).toFixed(1)}`
          : ''),
      '',
      ...sorted.flatMap((v, i) => [
        `${i + 1}. [${v.cvss.base.toFixed(1)} ${SEVERITY_LABEL[v.severity]}] ${v.assetHost} — ${v.owaspId} ${v.owaspCategory}`,
        `    ${[v.cwe, v.cve].filter(Boolean).join(' · ') || 'sem CWE/CVE'} · ${VULN_STATUS_LABEL[v.status]} · ${formatDate(v.detectedAt)}`,
      ]),
      ...(sorted.length ? [] : ['Nenhum achado para os filtros aplicados.']),
    ];
    pushAudit(
      user,
      'EXPORTAR_RELATORIO_VULNERABILIDADES',
      `${summary.total} ${summary.total === 1 ? 'achado' : 'achados'}; ${filtersText}`,
    );
    return { blob: simplePdf(lines, 'Baluarte (demonstração)'), filename: vulnerabilityReportFilename() };
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
        attachments: campaignAttachments(id),
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
    // Como a API: quem já foi destinatário de campanha de phishing tem histórico e só pode ser
    // inativado (USUARIO_COM_HISTORICO), antes da regra da ciência, na mesma ordem do backend.
    if (state.recipients.some((r) => r.email.toLowerCase() === user.email.toLowerCase()))
      throw new HttpError(
        409,
        'USUARIO_COM_HISTORICO',
        'Usuário com histórico em campanhas de phishing: inative a conta em vez de excluir',
      );
    // Como a API (B18, decisão de 10/10/2026): a ciência do aviso de monitoramento, de qualquer
    // versão, é a prova de que a pessoa foi avisada; a conta que a tem só pode ser inativada.
    if (state.monitoringAcks.some((a) => a.userId === user.id))
      throw new HttpError(
        409,
        'USUARIO_COM_CIENCIA',
        'Usuário com ciência registrada do aviso de monitoramento: inative a conta em vez de excluir',
      );
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
    // B23: a origem (campanha recebida) é conferida antes de ler o arquivo, como no backend.
    const campaignEventId = options.campaignEventId?.trim() || null;
    if (campaignEventId) {
      receivedRecipient(campaignEventId, user.email);
      if (
        state.fileScans.filter((s) => s.campaignEventId === campaignEventId).length >=
        MAX_ATTACHMENTS_PER_CAMPAIGN
      )
        throw new HttpError(
          429,
          'LIMITE_ANEXOS_CAMPANHA',
          `Limite de ${MAX_ATTACHMENTS_PER_CAMPAIGN} anexos por campanha atingido`,
        );
    }
    options.onProgress?.(100);
    const bytes = await readFileBytes(file);
    // Arquivo de teste EICAR: pelo nome (eicar.com, eicar.txt…) ou pela assinatura no conteúdo.
    const eicar = /eicar/i.test(file.name) || containsAscii(bytes, 'EICAR');
    // Regras YARA próprias do Baluarte (B23), depois das assinaturas oficiais.
    const ownRule = eicar ? undefined : MOCK_OWN_RULES.find((rule) => rule.matches(bytes));
    const threat = eicar ? EICAR_SIGNATURE : (ownRule?.name ?? null);
    const sha256 = await mockSha256(bytes);
    const entry: MockFileScan = {
      id: nextId('arq'),
      userId: user.id,
      campaignEventId,
      name: file.name,
      size: file.size,
      sha256,
      result: threat ? 'threat' : 'clean',
      threat,
      scannedAt: nowIso(),
      // Depois do antivírus, só pelo hash; não muda o veredito acima. Regra própria é do
      // Baluarte: o VirusTotal não a conhece (o arquivo novo sai como desconhecido).
      secondOpinion: mockSecondOpinion(sha256, eicar),
    };
    state.fileScans.unshift(entry);
    state.fileScanTimes.set(user.id, [...recent, now]);
    const scan = fileScanView(entry, false);
    return { scan, message: fileScanVerdict(scan) };
  },

  async listFileScans(filters: FileScanFilters = {}): Promise<FileScanListResponse> {
    return simulate(() => {
      const user = requireUser();
      const operator = user.role === 'admin' || user.role === 'analyst';
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      if (!Number.isInteger(page) || page < 1)
        throw new HttpError(400, 'PAGINA_INVALIDA', 'Página inválida: use um inteiro a partir de 1');
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new HttpError(400, 'TAMANHO_INVALIDO', 'Tamanho inválido: use um inteiro de 1 a 100');
      if (filters.result && filters.result !== 'clean' && filters.result !== 'threat')
        throw new HttpError(400, 'RESULTADO_INVALIDO', 'Filtro de resultado inválido: use LIMPO ou AMEACA');
      const items = state.fileScans
        .filter((entry) => operator || entry.userId === user.id)
        .filter((entry) => !filters.result || entry.result === filters.result)
        .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt) || b.id.localeCompare(a.id));
      return {
        items: items
          .slice((page - 1) * pageSize, page * pageSize)
          .map((entry) => fileScanView(entry, operator)),
        total: items.length,
        page,
        pageSize,
      };
    });
  },

  async listReceivedCampaigns(link?: string): Promise<ReceivedCampaignsResponse> {
    return simulate(() => {
      const user = requireUser();
      const items = state.recipients
        .filter((r) => r.email.toLowerCase() === user.email.toLowerCase() && r.sentAt)
        .map((r) => ({ recipient: r, campaign: state.campaigns.find((c) => c.id === r.campaignId) }))
        .filter((x): x is { recipient: CampaignRecipient; campaign: Campaign } => Boolean(x.campaign))
        .sort((a, b) => Date.parse(b.recipient.sentAt!) - Date.parse(a.recipient.sentAt!))
        .map(({ recipient, campaign }) => ({
          id: recipient.id,
          campaign: { id: campaign.id, name: campaign.name },
          receivedAt: recipient.sentAt ?? null,
          attachmentsSent: state.fileScans.filter((s) => s.campaignEventId === recipient.id).length,
        }));
      // No modo mock o token do link é o id do destinatário.
      const selected = link && items.some((c) => c.id === link.trim()) ? link.trim() : null;
      return { items, selected };
    });
  },

  // ---- Estações monitoradas (B13) ----
  async listStations(): Promise<StationListResponse> {
    return simulate(() => {
      requireRole(requireUser(), ['admin', 'analyst']);
      const items: Station[] = [...state.stations]
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
        .map((station) => {
          const view: Partial<StationDetail> = stationView(station);
          delete view.software;
          delete view.ports;
          delete view.offlineAfterSec;
          delete view.findingsTotal;
          delete view.findingsOpen;
          return view as Station;
        });
      const online = items.filter((s) => s.status === 'online').length;
      return {
        items,
        summary: {
          total: items.length,
          online,
          offline: items.length - online,
          offlineAfterSec: MOCK_STATION_OFFLINE_AFTER_SEC,
        },
      };
    });
  },

  async getStation(id: string): Promise<StationDetail> {
    return simulate(() => {
      requireRole(requireUser(), ['admin', 'analyst']);
      const station = state.stations.find((s) => s.id === id);
      if (!station) throw new HttpError(404, 'ESTACAO_NAO_ENCONTRADA', 'Estação não encontrada');
      return stationView(station);
    });
  },

  // B14: a verificação simulada acha MOCK_STATION_CVES[id] CVEs; nas seguintes, nada de novo.
  async verifyStation(id: string): Promise<StationVerification> {
    return simulate(() => {
      requireRole(requireUser(), ['admin', 'analyst']);
      const station = state.stations.find((s) => s.id === id);
      if (!station) throw new HttpError(404, 'ESTACAO_NAO_ENCONTRADA', 'Estação não encontrada');
      const covered = station.osPlatform !== 'rhel';
      const found = covered ? (MOCK_STATION_CVES[id] ?? 0) : 0;
      const before = station.findingsTotal ?? 0;
      const created = Math.max(0, found - before);
      station.findingsTotal = before + created;
      station.findingsOpen = (station.findingsOpen ?? 0) + created;
      station.verifiedAt = new Date().toISOString();
      return {
        verifiedAt: station.verifiedAt,
        checkedPrograms: covered ? station.software.length : 0,
        uncoveredPrograms: covered ? 0 : station.software.length,
        vulnerabilitiesFound: found,
        newFindings: created,
        existingFindings: found - created,
        noCvss: 0,
        pending: 0,
        failures: [],
      };
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
      // Ordem por unidade de código, explícita (códigos de ação são identificadores).
      const actions = Array.from(new Set(state.auditLog.map((e) => e.action))).sort((a, b) =>
        a === b ? 0 : a < b ? -1 : 1,
      );
      return {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
        actions,
      };
    });
  },

  // A trilha da sessão é só da memória: a cadeia de hash existe só na API real. O mock
  // responde como o servidor da main: cadeia íntegra e trava do banco desligada (ela fica na
  // branch feat/b29-trava). Os testes da tela forçam a quebra com spy.
  async verifyAuditIntegrity(): Promise<AuditIntegrity> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin']);
      return { intact: true, verifiedCount: state.auditLog.length, databaseLock: false, firstBreak: null };
    });
  },

  // ---- Aviso de monitoramento da estação (B18) ----
  async getMonitoringNotice(): Promise<MonitoringNotice> {
    return simulate(() => {
      const user = requireUser();
      const ack = state.monitoringAcks.find(
        (a) => a.userId === user.id && a.version === MOCK_MONITORING_NOTICE.version,
      );
      return {
        ...MOCK_MONITORING_NOTICE,
        acknowledged: !!ack,
        acknowledgedAt: ack?.acknowledgedAt ?? null,
      };
    });
  },

  async acknowledgeMonitoringNotice(version: string): Promise<MonitoringAcknowledgementResult> {
    await delay();
    const user = requireUser();
    if (typeof version !== 'string' || !/^[0-9A-Za-z._-]{1,32}$/.test(version))
      throw new HttpError(400, 'VERSAO_INVALIDA', 'Versão do aviso inválida');
    if (version !== MOCK_MONITORING_NOTICE.version)
      throw new HttpError(
        409,
        'VERSAO_DESATUALIZADA',
        'O aviso mudou desde a sua leitura: leia a versão atual antes de registrar a ciência',
      );
    const existing = state.monitoringAcks.find((a) => a.userId === user.id && a.version === version);
    if (existing) return { version, acknowledgedAt: existing.acknowledgedAt, created: false };
    const ack: MockMonitoringAcknowledgement = {
      id: nextId('ack'),
      userId: user.id,
      version,
      acknowledgedAt: nowIso(),
    };
    state.monitoringAcks.push(ack);
    pushAudit(user, 'REGISTRAR_CIENCIA_MONITORAMENTO', `versao=${version}`);
    return { version, acknowledgedAt: ack.acknowledgedAt, created: true };
  },

  async listMonitoringAcknowledgements(
    filters: MonitoringAcknowledgementFilters = {},
  ): Promise<MonitoringAcknowledgementListResponse> {
    return simulate(() => {
      const user = requireUser();
      requireRole(user, ['admin']);
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      if (!Number.isInteger(page) || page < 1)
        throw new HttpError(400, 'PAGINA_INVALIDA', 'Página inválida: use um inteiro a partir de 1');
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new HttpError(400, 'TAMANHO_INVALIDO', 'Tamanho inválido: use um inteiro de 1 a 100');
      const current = MOCK_MONITORING_NOTICE.version;
      const rows = state.monitoringAcks
        .filter((a) => !filters.version || a.version === filters.version)
        .map((a) => ({ ack: a, owner: state.users.find((u) => u.id === a.userId) }))
        .filter((row): row is { ack: MockMonitoringAcknowledgement; owner: User } => !!row.owner)
        .sort(
          (a, b) =>
            Date.parse(b.ack.acknowledgedAt) - Date.parse(a.ack.acknowledgedAt) ||
            b.ack.id.localeCompare(a.ack.id),
        );
      const pending = state.users.filter(
        (u) =>
          u.status === 'active' &&
          !state.monitoringAcks.some((a) => a.userId === u.id && a.version === current),
      ).length;
      return {
        items: rows.slice((page - 1) * pageSize, page * pageSize).map(({ ack, owner }) => ({
          id: ack.id,
          version: ack.version,
          acknowledgedAt: ack.acknowledgedAt,
          user: {
            id: owner.id,
            name: owner.name,
            email: owner.email,
            role: owner.role,
            status: owner.status,
          },
        })),
        total: rows.length,
        page,
        pageSize,
        currentVersion: current,
        pendingCurrentVersion: pending,
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
