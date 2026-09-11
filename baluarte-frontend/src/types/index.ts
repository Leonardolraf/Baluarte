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

export type AssetType = 'server' | 'application' | 'network' | 'database';

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
  actor: string;
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

export interface VulnerabilityListResponse {
  items: Vulnerability[];
  summary: VulnerabilitySummary;
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

export interface DashboardKpis {
  openVulnerabilities: number;
  criticalVulnerabilities: number;
  /** 100 − taxa de clique; `null` enquanto nenhuma campanha foi disparada (não medido ≠ 0 %). */
  phishingResilience: number | null;
  monitoredAssets: number;
  activeCampaigns: number;
  trainedCollaborators: number;
}

export interface DashboardMetrics {
  /** Risco técnico agregado (0–100, maior = pior). */
  technicalRisk: number;
  /** Risco humano agregado (0–100, maior = pior). */
  humanRisk: number;
  kpis: DashboardKpis;
  severityDistribution: Record<Severity, number>;
  recentFindings: Vulnerability[];
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
  sessionExpirationMinutes: number;
  loginAttemptLimit: number;
  twoFactorEnabled: boolean;
  auditLogImmutable: boolean;
  auditRetentionMonths: number;
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
