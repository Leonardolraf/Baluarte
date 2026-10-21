import { DEMO_USERS } from '../data/users';
import type { Role, User } from '../types';
import { PASSWORD_MIN_LENGTH } from './validation';

/**
 * Autenticação SIMULADA (modo demonstração): o e-mail precisa ser de uma das
 * contas demo e qualquer senha com 6+ caracteres é aceita. Nenhuma senha é
 * guardada ou comparada — não existe segredo no código.
 */

export const AUTH_MESSAGES = {
  invalidCredentials: 'E-mail ou senha inválidos.',
  collaboratorDenied: 'O perfil Colaborador não tem acesso às campanhas neste app.',
} as const;

/** RBAC: como no produto, campanhas são de Administrador e Analista. */
export const CAMPAIGN_ROLES: readonly Role[] = ['admin', 'analyst'];

export function canAccessCampaigns(role: Role): boolean {
  return CAMPAIGN_ROLES.includes(role);
}

export type AuthResult = { ok: true; user: User } | { ok: false; error: string };

export function authenticate(
  email: string,
  password: string,
  users: readonly User[] = DEMO_USERS,
): AuthResult {
  const normalized = email.trim().toLowerCase();
  const user = users.find((candidate) => candidate.email === normalized);

  // Mesma mensagem para e-mail desconhecido e senha curta: não revela quais contas existem.
  if (!user || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: AUTH_MESSAGES.invalidCredentials };
  }
  if (!canAccessCampaigns(user.role)) {
    return { ok: false, error: AUTH_MESSAGES.collaboratorDenied };
  }
  return { ok: true, user };
}
