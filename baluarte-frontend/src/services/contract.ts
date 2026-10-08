import type {
  AccountLink,
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
  TrainingOverview,
  DashboardMetrics,
  FileScanFilters,
  FileScanListResponse,
  ReceivedCampaignsResponse,
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
  StationDetail,
  StationListResponse,
  StationVerification,
  Training,
  User,
  UserInput,
  Vulnerability,
  VulnerabilityFilters,
  VulnerabilityListOptions,
  VulnerabilityListResponse,
  VulnerabilityReportFile,
  VulnerabilityStatus,
} from '@/types';

export interface ChangePasswordResult extends MessageResponse {
  /** Token novo: o anterior deixa de valer assim que a senha muda. */
  token: string;
}

export interface AnalyzeFileOptions {
  /** Progresso do envio (0–100). A análise em si começa quando chega a 100. */
  onProgress?: (percent: number) => void;
  /**
   * B23: id do destinatário na campanha (`ReceivedCampaign.id`) quando o arquivo é um anexo
   * suspeito recebido nela. Ausente = envio avulso.
   */
  campaignEventId?: string;
}

export interface MessageResponse {
  message: string;
  /**
   * Somente na camada mock: token de redefinição devolvido junto da resposta para
   * demonstrar o fluxo completo sem e-mail. A API real nunca o expõe ao cliente.
   */
  demoToken?: string;
}

/**
 * Contrato da API consumida pelas telas. Implementado por:
 *  - `@/mocks/api` (dados em memória, latência e falhas simuladas);
 *  - `@/services/api` (axios contra `VITE_API_BASE_URL`, com adapters).
 */
export interface BaluarteApi {
  // Autenticação
  login(credentials: LoginCredentials): Promise<LoginResponse>;
  me(): Promise<AuthUser>;
  requestPasswordReset(email: string): Promise<MessageResponse>;
  /** Conclui a redefinição com o token recebido (link do e-mail ou, em dev, console do servidor). */
  confirmPasswordReset(token: string, newPassword: string): Promise<MessageResponse>;
  /** Confere o link do e-mail antes de pedir a senha; rejeita token inválido ou expirado. */
  verifyAccountLink(token: string): Promise<AccountLink>;
  /** Troca a senha da sessão atual. O token anterior morre: use o devolvido aqui. */
  changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult>;
  /** Encerra a sessão no servidor (invalida os tokens em todos os dispositivos). */
  logout(): Promise<void>;
  /** Estende a sessão enquanto há uso; falha com SESSAO_EXPIRADA no teto de horas. */
  renewSession(): Promise<string>;

  // Dashboard
  getDashboard(): Promise<DashboardMetrics>;

  // Ativos e varreduras
  listAssets(): Promise<Asset[]>;
  createAsset(input: AssetInput): Promise<Asset>;
  listScans(): Promise<ScanReport[]>;
  /** Uma varredura só, com o progresso (B26): a tela acompanha as que estão em curso. */
  getScan(id: string): Promise<ScanReport>;
  startScan(assetId: string): Promise<ScanReport>;

  // Vulnerabilidades
  /** Uma página da lista, filtrada e ordenada no servidor; `summary` cobre o filtro inteiro. */
  listVulnerabilities(
    filters?: VulnerabilityFilters,
    options?: VulnerabilityListOptions,
  ): Promise<VulnerabilityListResponse>;
  getVulnerability(id: string): Promise<Vulnerability>;
  updateVulnerabilityStatus(id: string, status: VulnerabilityStatus, note?: string): Promise<Vulnerability>;
  /** Relatório em PDF com os mesmos filtros da lista (B24; registra a exportação na auditoria). */
  exportVulnerabilityReport(filters?: VulnerabilityFilters): Promise<VulnerabilityReportFile>;

  // Campanhas de phishing
  listCampaigns(filters?: CampaignFilters): Promise<Campaign[]>;
  getCampaignReport(id: string): Promise<CampaignReport>;
  createCampaign(input: CampaignInput): Promise<Campaign>;

  // Treinamento
  /** Consolidado de quem concluiu treinamento (uma requisição, calculada no servidor). */
  getTrainingOverview(): Promise<TrainingOverview>;
  getTraining(id: string): Promise<Training>;
  completeTraining(id: string): Promise<Training>;
  /** Link público do e-mail da campanha (/t/:token): abre o treinamento e registra o clique. */
  getTrainingByLink(token: string): Promise<Training>;
  completeTrainingByLink(token: string): Promise<Training>;
  /** Rodapé do e-mail simulado (/t/:token/reportar): registra o reporte; idempotente. */
  reportPhishing(token: string): Promise<PhishingReportResult>;

  // Usuários (RBAC)
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User>;
  createUser(input: UserInput): Promise<CreatedUser>;
  /** Reenvia o convite de uma conta Pendente. */
  resendInvite(id: string): Promise<MessageResponse>;
  /** Dispara o e-mail de redefinição de senha de uma conta Ativa (ação do administrador). */
  sendPasswordReset(id: string): Promise<MessageResponse>;
  updateUser(id: string, input: Partial<UserInput>): Promise<User>;
  deleteUser(id: string): Promise<void>;
  /** Nomes dos departamentos cadastrados (opções do cadastro de usuário). */
  listDepartments(): Promise<string[]>;

  // Análise de arquivos (B04/B05)
  /** Envia um arquivo (multipart, campo `arquivo`) para o antivírus. O servidor descarta o arquivo. */
  analyzeFile(file: File, options?: AnalyzeFileOptions): Promise<FileScanOutcome>;
  /**
   * Análises anteriores, mais recente primeiro, filtradas por resultado e paginadas no servidor
   * (B17). Colaborador só recebe as próprias.
   */
  listFileScans(filters?: FileScanFilters): Promise<FileScanListResponse>;
  /**
   * Campanhas que o próprio usuário recebeu, para ligar um anexo suspeito a uma delas (B23).
   * Com `link` (token do e-mail), `selected` traz a campanha desse link, se for dele.
   */
  listReceivedCampaigns(link?: string): Promise<ReceivedCampaignsResponse>;

  // Auditoria (só Administrador)
  /** Trilha de auditoria filtrada e paginada no servidor, mais recente primeiro. */
  listAuditLog(filters?: AuditFilters): Promise<AuditListResponse>;
  /** Recalcula a cadeia de hash da trilha e aponta o primeiro registro que não confere. */
  verifyAuditIntegrity(): Promise<AuditIntegrity>;

  // Estações monitoradas (B13): só Administrador e Analista
  /** Estações inscritas pelo agente, com status online/offline e o total de cada um. */
  listStations(): Promise<StationListResponse>;
  /** Detalhe com os programas instalados e as portas abertas. */
  getStation(id: string): Promise<StationDetail>;
  /** Cruza o inventário com as bases públicas de vulnerabilidades agora (B14). */
  verifyStation(id: string): Promise<StationVerification>;

  // Aviso de monitoramento da estação (B18, LGPD)
  /** Texto em vigor (servido pela API), a versão e a ciência do usuário atual nela. Qualquer perfil. */
  getMonitoringNotice(): Promise<MonitoringNotice>;
  /** Registra "Li e estou ciente" da versão lida; idempotente. 409 se o texto mudou nesse meio-tempo. */
  acknowledgeMonitoringNotice(version: string): Promise<MonitoringAcknowledgementResult>;
  /** Quem deu ciência de qual versão, paginado no servidor. Só Administrador. */
  listMonitoringAcknowledgements(
    filters?: MonitoringAcknowledgementFilters,
  ): Promise<MonitoringAcknowledgementListResponse>;

  // Configurações
  getNotificationPreferences(): Promise<NotificationPreferences>;
  updateNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;
  getSecurityPolicy(): Promise<SecurityPolicy>;
}
