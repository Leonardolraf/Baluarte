import type {
  AccountLink,
  Asset,
  AssetInput,
  AuthUser,
  Campaign,
  CampaignFilters,
  CampaignInput,
  CampaignReport,
  ChangePasswordInput,
  CreatedUser,
  DashboardMetrics,
  LoginCredentials,
  LoginResponse,
  NotificationPreferences,
  PhishingReportResult,
  ScanReport,
  SecurityPolicy,
  Training,
  User,
  UserInput,
  Vulnerability,
  VulnerabilityFilters,
  VulnerabilityListResponse,
  VulnerabilityStatus,
} from '@/types';

export interface ChangePasswordResult extends MessageResponse {
  /** Token novo: o anterior deixa de valer assim que a senha muda. */
  token: string;
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
  startScan(assetId: string): Promise<ScanReport>;

  // Vulnerabilidades
  listVulnerabilities(filters?: VulnerabilityFilters): Promise<VulnerabilityListResponse>;
  getVulnerability(id: string): Promise<Vulnerability>;
  updateVulnerabilityStatus(id: string, status: VulnerabilityStatus, note?: string): Promise<Vulnerability>;

  // Campanhas de phishing
  listCampaigns(filters?: CampaignFilters): Promise<Campaign[]>;
  getCampaignReport(id: string): Promise<CampaignReport>;
  createCampaign(input: CampaignInput): Promise<Campaign>;

  // Treinamento
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

  // Configurações
  getNotificationPreferences(): Promise<NotificationPreferences>;
  updateNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;
  getSecurityPolicy(): Promise<SecurityPolicy>;
}
