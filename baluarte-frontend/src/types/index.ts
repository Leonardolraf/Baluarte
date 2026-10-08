// -----------------------------------------------------------------------------
// Modelos de domínio do Baluarte (frontend).
// Identificadores em inglês (contrato do código); rótulos exibidos ao usuário
// vivem em `@/lib` (pt-BR). A camada `services/adapters.ts` converte o contrato
// do backend Express (campos em português) para estes tipos.
// -----------------------------------------------------------------------------

// ---- RBAC -------------------------------------------------------------------

export type RBACRole = 'admin' | 'analyst' | 'collaborator';

export const RBAC_ROLES: readonly RBACRole[] = ['admin', 'analyst', 'collaborator'] as const;

export type UserStatus = 'active' | 'inactive' | 'pending';

export interface User {
  id: string;
  name: string;
  email: string;
  role: RBACRole;
  status: UserStatus;
  department?: string;
  createdAt: string;
  lastLoginAt?: string | null;
}

export type AuthUser = Pick<User, 'id' | 'name' | 'email' | 'role'>;

export interface UserInput {
  name: string;
  email: string;
  role: RBACRole;
  status?: UserStatus;
  department?: string;
}

// ---- Autenticação -----------------------------------------------------------

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

/** Claims do JWT emitido pela API (RS256 em produção; o mock gera o mesmo formato). */
export interface JwtPayload {
  sub: string;
  email: string;
  name?: string;
  role: RBACRole;
  iat: number;
  exp: number;
}

export interface PasswordResetRequest {
  email: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

// ---- Severidade / CVSS ------------------------------------------------------

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'] as const;

export interface CvssScore {
  version: '3.1';
  /** Ex.: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H */
  vector: string;
  /** 0.0 – 10.0 */
  base: number;
}

// ---- Ativos -----------------------------------------------------------------

/** `workstation`: estação inscrita pelo agente osquery (B07); só nasce pela inscrição, nunca pelo cadastro. */
export type AssetType = 'server' | 'application' | 'network' | 'database' | 'workstation';

/** Tipos aceitos no cadastro manual de ativo (a estação de trabalho fica de fora). */
export const ASSET_TYPES: readonly AssetType[] = ['server', 'application', 'network', 'database'] as const;

export type AssetStatus = 'active' | 'inactive';

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  host: string;
  ip?: string | null;
  description?: string | null;
  status: AssetStatus;
  owner?: string;
  createdAt: string;
  lastScanAt?: string | null;
  openFindings: number;
  /**
   * Nota de risco 0–100 calculada pelo servidor a cada leitura (B25): 10 × críticas + 7 × altas +
   * 4 × médias + 1 × baixa abertas, com teto 100. Ausente em API sem a nota.
   */
  riskScore?: number;
  /** Achados abertos por severidade (base da nota). */
  openBySeverity?: Record<Severity, number>;
}

/** Ativo no ranking de maior risco do dashboard (B25). */
export interface AssetRisk {
  id: string;
  name: string;
  host: string;
  riskScore: number;
  openFindings: number;
  openBySeverity: Record<Severity, number>;
}

export interface AssetInput {
  name: string;
  type: AssetType;
  host: string;
  ip?: string;
  description?: string;
}

// ---- Vulnerabilidades -------------------------------------------------------

export type VulnerabilityStatus = 'open' | 'in_review' | 'remediating' | 'resolved' | 'accepted';

export const VULNERABILITY_STATUSES: readonly VulnerabilityStatus[] = [
  'open',
  'in_review',
  'remediating',
  'resolved',
  'accepted',
] as const;

export type EvidenceKind = 'request' | 'response' | 'log' | 'hash' | 'screenshot' | 'note';

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  label: string;
  /** Conteúdo bruto (headers, payloads, hashes) — renderizado em `font-mono`. */
  content: string;
  capturedAt: string;
}

export interface RemediationStep {
  order: number;
  title: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
}

export interface VulnerabilityHistoryEntry {
  id: string;
  at: string;
  /** Quem fez (ausente quando o dado não diz: a detecção é da varredura, não de uma pessoa). */
  actor?: string;
  action: 'detected' | 'status_changed' | 'commented' | 'rescanned' | 'assigned';
  from?: VulnerabilityStatus;
  to?: VulnerabilityStatus;
  note?: string;
}

export interface Vulnerability {
  id: string;
  title: string;
  /** Ex.: CVE-2021-44228 (pode não existir para achados de configuração). */
  cve?: string | null;
  /** Tipo de falha, ex.: CWE-89 (injeção de SQL). */
  cwe?: string | null;
  /** Ex.: A03:2021 */
  owaspId: string;
  /** Ex.: Injection */
  owaspCategory: string;
  cvss: CvssScore;
  severity: Severity;
  status: VulnerabilityStatus;
  assetId: string;
  assetName: string;
  assetHost: string;
  /** Componente afetado, ex.: log4j-core */
  affectedComponent: string;
  affectedVersion?: string | null;
  fixedVersion?: string | null;
  /** Hash SHA-256 do artefato afetado, quando aplicável. */
  artifactHash?: string | null;
  description: string;
  evidence: Evidence[];
  remediation: RemediationStep[];
  references: string[];
  detectedAt: string;
  updatedAt: string;
  history: VulnerabilityHistoryEntry[];
  /**
   * O histórico explica o status atual? `false` quando há mudanças de status sem registro
   * (o servidor ainda não tem tabela de histórico: B25b). Ausente = não informado.
   */
  historyComplete?: boolean;
  /** De onde o achado veio: a varredura que o gerou (só no detalhe). */
  origin?: { scanId: string; scanStartedAt: string; assetId: string } | null;
}

export interface VulnerabilityFilters {
  severity?: Severity | 'all';
  status?: VulnerabilityStatus | 'all';
  query?: string;
}

export interface VulnerabilitySummary {
  total: number;
  bySeverity: Record<Severity, number>;
  byStatus: Record<VulnerabilityStatus, number>;
  assets: number;
}

/** Tamanho padrão da página da lista de vulnerabilidades (o servidor aceita até 100). */
export const VULN_PAGE_SIZE = 20;

/** Colunas pelas quais a lista de vulnerabilidades ordena (no servidor). */
export type VulnerabilitySortKey = 'severity' | 'title' | 'cvss' | 'detectedAt';

/** Página pedida à lista (paginação e ordenação no servidor, B25). */
export interface VulnerabilityListOptions {
  /** A partir de 1. Padrão 1. */
  page?: number;
  /** Padrão `VULN_PAGE_SIZE` (20); o servidor aceita até 100. */
  pageSize?: number;
  /** `null`/ausente: a mais recente primeiro. */
  sort?: SortState<VulnerabilitySortKey> | null;
}

export interface VulnerabilityListResponse {
  /** Só a página pedida. */
  items: Vulnerability[];
  /** Números do filtro inteiro (não só da página). */
  summary: VulnerabilitySummary;
  page: number;
  pageSize: number;
}

/** Relatório de vulnerabilidades exportado (B24): o arquivo e o nome sugerido para salvar. */
export interface VulnerabilityReportFile {
  blob: Blob;
  filename: string;
}

// ---- Varreduras -------------------------------------------------------------

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ScanReport {
  id: string;
  assetId: string;
  assetName: string;
  assetHost: string;
  status: ScanStatus;
  scanner: string;
  startedAt: string;
  finishedAt?: string | null;
  durationSec?: number | null;
  findingsCount: number;
  findingsBySeverity: Record<Severity, number>;
  /** 0 a 100: 0 na fila, 1 a 99 em andamento, 100 concluída (B26; calculado pelo servidor na leitura). */
  progress: number;
  /** Etapa legível ("Na fila", "Testando injeção", "Concluída"...). */
  stage: string;
  /** Quando a varredura conclui (ou concluiu), em ISO 8601; null se o servidor não informou. */
  estimatedCompletionAt: string | null;
}

// ---- Campanhas de phishing --------------------------------------------------

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled';

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'draft',
  'scheduled',
  'active',
  'completed',
  'cancelled',
] as const;

export type CampaignTemplate = 'urgency' | 'authority' | 'curiosity';

export const CAMPAIGN_TEMPLATES: readonly CampaignTemplate[] = ['urgency', 'authority', 'curiosity'] as const;

export interface CampaignMetrics {
  recipients: number;
  sent: number;
  opened: number;
  clicked: number;
  submitted: number;
  reported: number;
  trained: number;
  /** Percentuais 0–100, calculados sobre `sent`. */
  openRate: number;
  clickRate: number;
  submitRate: number;
  reportRate: number;
  /** Percentual de quem clicou e concluiu o treinamento. */
  trainedRate: number;
}

export interface Campaign {
  id: string;
  name: string;
  template: CampaignTemplate;
  targetGroup: string;
  status: CampaignStatus;
  scheduledAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  createdBy: string;
  createdAt: string;
  /** Módulo de treinamento contextual associado ao template; nulo quando a API não o expõe. */
  trainingId?: string | null;
  metrics: CampaignMetrics;
}

export interface CampaignInput {
  name: string;
  template: CampaignTemplate;
  targetGroup: string;
  scheduledAt: string;
  /** Destinatários internos (somente domínio corporativo). */
  recipients: string[];
}

export type RecipientStage = 'sent' | 'opened' | 'clicked' | 'submitted' | 'reported';

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  name: string;
  email: string;
  department: string;
  /** Nulo enquanto a campanha ainda não disparou. */
  sentAt?: string | null;
  openedAt?: string | null;
  clickedAt?: string | null;
  submittedAt?: string | null;
  reportedAt?: string | null;
  trainingCompleted: boolean;
  trainingId?: string | null;
}

export interface FunnelStage {
  key: RecipientStage;
  label: string;
  value: number;
  /** Percentual sobre enviados (0–100). */
  pct: number;
}

export interface CampaignTimelineEvent {
  id: string;
  at: string;
  kind: 'scheduled' | 'started' | 'opened' | 'clicked' | 'submitted' | 'reported' | 'trained' | 'ended';
  description: string;
}

export interface CampaignReport {
  campaign: Campaign;
  recipients: CampaignRecipient[];
  funnel: FunnelStage[];
  timeline: CampaignTimelineEvent[];
  byDepartment: Array<{ department: string; recipients: number; clicked: number; clickRate: number }>;
}

export interface CampaignFilters {
  status?: CampaignStatus | 'all';
  from?: string;
  to?: string;
  query?: string;
}

// ---- Treinamento ------------------------------------------------------------

/** Resultado de reportar o e-mail simulado pelo link do rodapé. */
export interface PhishingReportResult {
  reported: true;
  reportedAt: string;
}

export interface TrainingSection {
  heading: string;
  body: string;
}

export interface Training {
  id: string;
  campaignId?: string | null;
  moduleCode: string;
  title: string;
  attackType: string;
  durationMin: number;
  /** 0–100 */
  progress: number;
  completed: boolean;
  completedAt?: string | null;
  summary: string;
  sections: TrainingSection[];
  warningSigns: string[];
  bestPractices: string[];
}

// ---- Dashboard --------------------------------------------------------------

export type TimelineEventKind = 'finding' | 'scan' | 'campaign' | 'training' | 'user' | 'system';

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineEventKind;
  severity?: Severity;
  title: string;
  description: string;
  href?: string;
}

/**
 * KPIs do dashboard. O Colaborador recebe só a resiliência a phishing (RN-006, B10): os
 * indicadores técnicos e os de campanha chegam `null` para ele e a tela não os exibe.
 */
export interface DashboardKpis {
  openVulnerabilities: number | null;
  criticalVulnerabilities: number | null;
  /** 100 − taxa de clique; `null` enquanto nenhuma campanha foi disparada (não medido ≠ 0 %). */
  phishingResilience: number | null;
  monitoredAssets: number | null;
  activeCampaigns: number | null;
  trainedCollaborators: number | null;
  /**
   * Arquivos distintos (por SHA-256) com ameaça nos últimos 30 dias (B17). Já estão somados em
   * `criticalVulnerabilities` e no `critical` da distribuição; não em `openVulnerabilities`.
   * KPI técnico: `null` para o Colaborador, como os demais.
   */
  maliciousFiles: number | null;
}

export interface DashboardMetrics {
  /** Risco técnico agregado (0–100, maior = pior); `null` para o Colaborador (RN-006). */
  technicalRisk: number | null;
  /** Risco humano agregado (0–100, maior = pior). */
  humanRisk: number;
  kpis: DashboardKpis;
  /** `null` para o Colaborador (RN-006). */
  severityDistribution: Record<Severity, number> | null;
  recentFindings: Vulnerability[];
  /** Os 5 ativos de maior risco (B25); vazio para o Colaborador. */
  topRiskAssets: AssetRisk[];
  recentCampaigns: Campaign[];
  recentScans: ScanReport[];
  timeline: TimelineEvent[];
  /** Treinamento disponível/pendente para o usuário atual (colaboradores); nulo quando não há. */
  pendingTraining: PendingTraining | null;
  generatedAt: string;
}

export interface PendingTraining {
  id: string;
  title: string;
  moduleCode: string;
  durationMin: number;
  campaignName?: string | null;
}

// ---- Configurações ----------------------------------------------------------

export interface NotificationPreferences {
  emailAlerts: boolean;
  criticalOnly: boolean;
  weeklyDigest: boolean;
  campaignReports: boolean;
}

export interface SecurityPolicy {
  passwordMinLength: number;
  requireMixedCase: boolean;
  requireNumberAndSymbol: boolean;
  tokenAlgorithm: string;
  /** Tempo de inatividade que encerra a sessão; o app renova o token enquanto há uso. */
  sessionExpirationMinutes: number;
  /** Teto absoluto da sessão, contado do login: nenhuma renovação passa disso. */
  sessionMaxHours: number;
  loginAttemptLimit: number;
  twoFactorEnabled: boolean;
  auditRegistersActions: boolean;
  /**
   * Trava no banco ativa: UPDATE/DELETE/TRUNCATE no AuditLog recusados (migration
   * 20261008171000_auditoria_imutavel). Sem ela a trilha ainda tem a cadeia de hash, que
   * detecta adulteração, mas o banco aceita a alteração.
   */
  auditLogImmutable: boolean;
  /** Nulo quando ainda não há política de retenção definida. */
  auditRetentionMonths: number | null;
}

/** Link de conta recebido por e-mail (convite novo ou redefinição de senha). */
export interface AccountLink {
  kind: 'invite' | 'reset';
  name: string;
  email: string;
  expiresAt: string;
}

/** Consolidado de treinamentos concluídos, calculado pela API numa só consulta. */
export interface TrainingOverview {
  campaigns: number;
  completions: number;
  clicked: number;
  pendingAfterClick: number;
  namedCompletions: number;
  people: Array<{
    name: string;
    email: string;
    department: string;
    campaigns: Array<{ id: string; name: string }>;
  }>;
  byDepartment: Array<{ department: string; completions: number }>;
}

/** Usuário recém-criado: `inviteSent` diz se o convite saiu por e-mail. */
export interface CreatedUser extends User {
  inviteSent: boolean;
}

// ---- Análise de arquivos (B04/B05) ------------------------------------------

/** Veredito do antivírus: só diz se uma assinatura CONHECIDA casou, nunca que o arquivo é seguro. */
export type FileScanResult = 'clean' | 'threat';

/**
 * Segunda opinião do VirusTotal (B20), consultada só pelo SHA-256 depois do antivírus: o arquivo
 * nunca é enviado a ele, e ela não muda o veredito principal (`result`).
 */
export type SecondOpinionStatus =
  'malicious' | 'suspicious' | 'no_detection' | 'unknown' | 'unavailable' | 'disabled';

/** Por que a segunda opinião ficou indisponível (só com `unavailable`). */
export type SecondOpinionReason = 'quota' | 'invalid_key' | 'provider_limit' | 'timeout' | 'failure';

export interface SecondOpinion {
  source: 'VirusTotal';
  status: SecondOpinionStatus;
  reason: SecondOpinionReason | null;
  /** Mecanismos que marcaram o arquivo como malicioso ou suspeito (só com veredito). */
  detections: number | null;
  /** Mecanismos que deram veredito (só com veredito). */
  total: number | null;
  /** Quando o VirusTotal respondeu (null se não respondeu ou está desligado). */
  checkedAt: string | null;
  /** Relatório público do hash no VirusTotal. */
  link: string;
}

/** Análise de um arquivo enviado. O arquivo é descartado; só o hash e o resultado ficam. */
export interface FileScan {
  id: string;
  name: string;
  /** Tamanho em bytes. */
  size: number;
  sha256: string;
  result: FileScanResult;
  /** Nome da assinatura encontrada (só quando `result` é `threat`). */
  threat: string | null;
  scannedAt: string;
  /** Segunda opinião do VirusTotal; null nas análises anteriores a ela (B20). */
  secondOpinion: SecondOpinion | null;
  /** Quem enviou: só vem para Administrador e Analista. */
  uploadedBy?: { name: string; email: string };
}

/** Filtros do histórico de análises (B17): resultado e paginação vão para o servidor. */
export interface FileScanFilters {
  /** Vazio ou ausente = todos os resultados. */
  result?: FileScanResult;
  /** Página (a partir de 1) e tamanho (máximo 100). */
  page?: number;
  pageSize?: number;
}

export type FileScanListResponse = Paginated<FileScan>;

/** Resposta do envio: a análise e a mensagem do servidor ("Nenhuma ameaça conhecida encontrada"…). */
export interface FileScanOutcome {
  scan: FileScan;
  message: string;
}

// ---- Auditoria --------------------------------------------------------------

/**
 * Registro da trilha de auditoria (RN-008). A ação é o código gravado pelo servidor
 * (ex.: `CRIAR_ATIVO`): texto aberto, para que ações novas apareçam sem mudar o frontend.
 */
export interface AuditEntry {
  id: string;
  action: string;
  detail: string | null;
  /** ISO 8601. */
  at: string;
  /** Autor; `null` quando a conta foi excluída ou a ação não tem autor. */
  user: { id: string; name: string; email: string } | null;
}

export interface AuditFilters {
  /** Código da ação; vazio ou ausente = todas. */
  action?: string;
  /** Período em dias locais (yyyy-mm-dd), inclusivo. */
  from?: string;
  to?: string;
  /** Página (a partir de 1) e tamanho (máximo 100): a paginação é do servidor. */
  page?: number;
  pageSize?: number;
}

export interface AuditListResponse extends Paginated<AuditEntry> {
  /** Ações distintas já registradas (opções do filtro). */
  actions: string[];
}

// ---- Estações monitoradas (B13) -----------------------------------------------

/** Online enquanto o último contato do agente estiver dentro da janela do servidor. */
export type StationStatus = 'online' | 'offline';

/** Estação de trabalho inscrita pelo agente osquery, como a lista mostra. */
export interface Station {
  id: string;
  assetId: string;
  /** Nome da máquina. */
  name: string;
  host: string;
  /** host_identifier do osquery (UUID da máquina). */
  identifier: string;
  /** Sistema operacional legível ("Ubuntu 22.04.4 LTS"). */
  os: string;
  /** Plataforma do osquery: windows, darwin, ubuntu, rhel… */
  osPlatform: string | null;
  osBuild: string | null;
  status: StationStatus;
  lastSeenAt: string;
  enrolledAt: string;
  /** Último inventário recebido (null antes da primeira coleta). */
  inventoryAt: string | null;
  softwareCount: number;
  portCount: number;
  /** Último cruzamento do inventário com as bases de vulnerabilidades (B14); null: nunca. */
  verifiedAt: string | null;
}

/** Origem do programa no inventário (tabela do osquery). */
export type SoftwareSource = 'programs' | 'deb_packages' | 'rpm_packages' | 'apps' | 'other';

export interface StationSoftware {
  name: string;
  /** Vazio quando o sistema não informa a versão. */
  version: string;
  vendor: string | null;
  source: SoftwareSource;
}

export interface StationPort {
  port: number;
  protocol: 'TCP' | 'UDP';
  /** Endereço em escuta (0.0.0.0 = todas as interfaces). */
  address: string;
  process: string | null;
}

export interface StationDetail extends Station {
  /** Segundos sem contato até a estação virar offline. */
  offlineAfterSec: number;
  software: StationSoftware[];
  ports: StationPort[];
  /** Achados da estação (programas com CVE, B14): todos e os ainda em aberto. */
  findingsTotal: number;
  findingsOpen: number;
}

/** Base pública consultada no cruzamento do inventário (B14). */
export type VulnerabilitySource = 'OSV' | 'NVD';

/** Resultado de POST /estacoes/:id/verificar (B14). */
export interface StationVerification {
  verifiedAt: string;
  /** Programas consultados numa base (pacotes Linux no OSV, programas Windows da tabela no NVD). */
  checkedPrograms: number;
  /** Programas sem como consultar (Windows fora da tabela, sistema sem suporte no OSV). */
  uncoveredPrograms: number;
  vulnerabilitiesFound: number;
  newFindings: number;
  existingFindings: number;
  /** CVEs sem nota CVSS 3.x em nenhuma base: não viram achado. */
  noCvss: number;
  /** Consultas que ficaram para a próxima verificação (limite por verificação). */
  pending: number;
  /** Bases que não responderam nesta verificação. */
  failures: VulnerabilitySource[];
}

export interface StationListResponse {
  items: Station[];
  summary: { total: number; online: number; offline: number; offlineAfterSec: number };
}

/**
 * Por que a cadeia de hash quebrou: registro sem hash, conteúdo que não confere com o hash
 * gravado, ou elo (hash anterior) que não aponta para o registro anterior.
 */
export type AuditChainBreakReason = 'missing_hash' | 'content_altered' | 'broken_link' | 'unknown';

/** Resultado da verificação da cadeia de hash da trilha (GET /auditoria/integridade). */
export interface AuditIntegrity {
  intact: boolean;
  verifiedCount: number;
  /** Trava do banco ligada (UPDATE/DELETE/TRUNCATE recusados no AuditLog). */
  databaseLock: boolean;
  /** Primeiro registro que não confere; `null` com a cadeia íntegra. */
  firstBreak: { id: string; at: string; reason: AuditChainBreakReason } | null;
}

// ---- Infra / API ------------------------------------------------------------

export interface ApiError {
  status: number;
  code: string;
  message: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiEnvelope<T> {
  status: 'sucesso' | 'erro';
  mensagem?: string;
  dados: T;
  resumo?: Record<string, unknown>;
}

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}
