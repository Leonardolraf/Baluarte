/**
 * Repositório do modo API: fala com a API real do produto e converte as
 * respostas para os modelos de domínio do app. Só é usado quando
 * `EXPO_PUBLIC_API_BASE_URL` está configurada.
 */
import type { AuthRepository, CampaignRepository } from '../../data/repository';
import { AUTH_MESSAGES, canAccessCampaigns, type AuthResult } from '../auth';
import type { Campaign, NewCampaignInput, User } from '../../types';
import { ApiError, NetworkError, request } from './client';
import {
  campaignFromList,
  campaignFromReport,
  createBodyFromInput,
  userFromLogin,
  userFromMe,
  type BackendCampaignList,
  type BackendCampaignReport,
  type BackendCreateCampaignData,
  type BackendLoginData,
  type BackendMeData,
} from './mappers';
import { tokenStore } from './tokenStore';

/** Mensagens de erro do login por código do backend (humanizadas, sem vazar detalhe). */
const LOGIN_ERROR: Record<string, string> = {
  CREDENCIAIS_INVALIDAS: AUTH_MESSAGES.invalidCredentials,
  EMAIL_INVALIDO: AUTH_MESSAGES.invalidCredentials,
  EMAIL_OBRIGATORIO: AUTH_MESSAGES.invalidCredentials,
  SENHA_OBRIGATORIA: AUTH_MESSAGES.invalidCredentials,
  USUARIO_INATIVO: 'Esta conta está inativa. Procure um administrador.',
  CONTA_PENDENTE: 'Conta ainda não ativada. Use o convite enviado por e-mail.',
  MUITAS_TENTATIVAS: 'Muitas tentativas. Tente de novo em alguns minutos.',
};

async function loadUser(login: BackendLoginData): Promise<User> {
  try {
    const me = await request<BackendMeData>('/me');
    return userFromMe(me);
  } catch {
    // Igual ao web: se o /me falhar, segue com o que o login trouxe.
    return userFromLogin(login);
  }
}

export const apiAuthRepository: AuthRepository = {
  async signIn(email, password): Promise<AuthResult> {
    let login: BackendLoginData;
    try {
      login = await request<BackendLoginData>('/login', {
        method: 'POST',
        auth: false,
        body: { email: email.trim(), senha: password },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return { ok: false, error: LOGIN_ERROR[error.code] ?? AUTH_MESSAGES.invalidCredentials };
      }
      if (error instanceof NetworkError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    await tokenStore.set(login.token);
    const user = await loadUser(login);

    // RBAC igual ao app demo: campanhas são de Administrador e Analista.
    if (!canAccessCampaigns(user.role)) {
      await this.signOut();
      return { ok: false, error: AUTH_MESSAGES.collaboratorDenied };
    }
    return { ok: true, user };
  },

  async signOut() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      /* encerra localmente mesmo se o servidor não responder */
    } finally {
      await tokenStore.clear();
    }
  },

  async restoreSession(): Promise<User | null> {
    const token = await tokenStore.get();
    if (!token) return null;
    try {
      const me = await request<BackendMeData>('/me');
      const user = userFromMe(me);
      return canAccessCampaigns(user.role) ? user : null;
    } catch {
      // Token expirado/inválido: limpa e volta ao login.
      await tokenStore.clear();
      return null;
    }
  },
};

export const apiCampaignRepository: CampaignRepository = {
  async list(): Promise<Campaign[]> {
    const raw = await request<BackendCampaignList[]>('/campanhas');
    return (raw ?? []).map(campaignFromList);
  },

  async get(id: string): Promise<Campaign | undefined> {
    try {
      const raw = await request<BackendCampaignReport>(`/campanhas/${encodeURIComponent(id)}`);
      return campaignFromReport(raw);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  },

  async create(input: NewCampaignInput): Promise<Campaign> {
    const data = await request<BackendCreateCampaignData>('/campaigns', {
      method: 'POST',
      body: createBodyFromInput(input),
    });
    // O POST devolve pouco (id em `idCampanha`); monta a campanha agendada local.
    return {
      id: data.idCampanha,
      name: input.name,
      template: input.template,
      targetGroup: input.targetGroup,
      status: 'scheduled',
      scheduledAt: input.scheduledAt.toISOString(),
      metrics: {
        recipients: input.recipients.length,
        sent: 0,
        opened: 0,
        clicked: 0,
        submitted: 0,
        reported: 0,
      },
      recipients: [],
    };
  },
};
