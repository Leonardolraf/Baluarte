/**
 * Camada de repositório: a única porta entre a UI e a origem dos dados.
 *
 * A UI (contexts) só conhece estas interfaces. A implementação concreta é
 * escolhida uma vez, por ambiente:
 * - **modo demo** (padrão): `mockRepository` — tudo em memória;
 * - **modo API** (`EXPO_PUBLIC_API_BASE_URL` definida): `apiRepository` — fetch real.
 *
 * Assim a mesma tela roda contra os mocks (demo-safe, testes) ou contra a API
 * da VM sem nenhuma mudança nos componentes.
 */
import { IS_API_MODE } from '../lib/config';
import type { AuthResult } from '../lib/auth';
import type { Campaign, NewCampaignInput, User } from '../types';

export interface AuthRepository {
  /** Autentica e, no modo API, guarda o token de sessão. */
  signIn(email: string, password: string): Promise<AuthResult>;
  /** Encerra a sessão (no modo API, também no servidor) e limpa o token. */
  signOut(): Promise<void>;
  /** Na abertura do app: devolve o usuário se houver sessão válida, senão `null`. */
  restoreSession(): Promise<User | null>;
}

export interface CampaignRepository {
  list(): Promise<Campaign[]>;
  get(id: string): Promise<Campaign | undefined>;
  create(input: NewCampaignInput): Promise<Campaign>;
}

/** Carregamento preguiçoso: o módulo da API (e `expo-secure-store`) só entra em modo API. */
function pickAuth(): AuthRepository {
  if (IS_API_MODE) return require('../lib/api/apiRepository').apiAuthRepository;
  return require('./mockRepository').mockAuthRepository;
}

function pickCampaigns(): CampaignRepository {
  if (IS_API_MODE) return require('../lib/api/apiRepository').apiCampaignRepository;
  return require('./mockRepository').mockCampaignRepository;
}

export const authRepository: AuthRepository = pickAuth();
export const campaignRepository: CampaignRepository = pickCampaigns();
