import type { RBACRole, Severity } from '@/types';

export const ROLE_LABEL: Record<RBACRole, string> = {
  admin: 'Administrador',
  analyst: 'Analista',
  collaborator: 'Colaborador',
};

export const ROLE_DESCRIPTION: Record<RBACRole, string> = {
  admin: 'Acesso total: gerencia usuários, ativos, varreduras e campanhas.',
  analyst: 'Opera varreduras, vulnerabilidades e campanhas; não gerencia usuários.',
  collaborator: 'Acessa o dashboard, seus treinamentos e configurações pessoais.',
};

/** Tom visual usado pelo SeverityBadge quando exibe um perfil. */
export const ROLE_SEVERITY: Record<RBACRole, Severity> = {
  admin: 'high',
  analyst: 'info',
  collaborator: 'low',
};

/** Perfis autorizados por área de navegação (espelha a tabela de rotas). */
export const ROUTE_ROLES = {
  dashboard: ['admin', 'analyst', 'collaborator'],
  vulnerabilities: ['admin', 'analyst'],
  assets: ['admin', 'analyst'],
  campaigns: ['admin', 'analyst'],
  training: ['admin', 'analyst', 'collaborator'],
  users: ['admin'],
  settings: ['admin', 'analyst', 'collaborator'],
} as const satisfies Record<string, readonly RBACRole[]>;

/** Converte o rótulo do backend ("Administrador") para o identificador interno. */
export function roleFromLabel(label: string | null | undefined): RBACRole {
  const normalized = (label ?? '').trim().toLowerCase();
  if (normalized.startsWith('admin')) return 'admin';
  if (normalized.startsWith('anal')) return 'analyst';
  return 'collaborator';
}

export function roleToLabel(role: RBACRole): string {
  return ROLE_LABEL[role];
}

export function hasAnyRole(role: RBACRole | null | undefined, allowed: readonly RBACRole[]): boolean {
  return !!role && allowed.includes(role);
}
