import type {
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
  Training,
  User,
  UserInput,
  Vulnerability,
  VulnerabilityFilters,
  VulnerabilityListResponse,
  VulnerabilityStatus,
} from '@/types';

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
  changePassword(input: ChangePasswordInput): Promise<MessageResponse>;

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

  // Usuários (RBAC)
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User>;
  createUser(input: UserInput): Promise<User>;
  updateUser(id: string, input: Partial<UserInput>): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Configurações
  getNotificationPreferences(): Promise<NotificationPreferences>;
  updateNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;
  getSecurityPolicy(): Promise<SecurityPolicy>;
}
