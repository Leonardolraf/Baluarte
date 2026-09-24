import type { User } from '../types';

/**
 * Contas de demonstração (as mesmas do produto web). Não há senha aqui:
 * a autenticação do app é simulada e aceita qualquer senha com 6+ caracteres.
 */
export const DEMO_USERS: readonly User[] = [
  {
    id: 'u-000',
    name: 'Leonardo Rodrigues',
    email: 'admin@empresa.com',
    role: 'admin',
    department: 'Diretoria',
  },
  {
    id: 'u-001',
    name: 'Rafael Nunes',
    email: 'analista@empresa.com',
    role: 'analyst',
    department: 'TI',
  },
  {
    id: 'u-002',
    name: 'João Pereira',
    email: 'colaborador@empresa.com',
    role: 'collaborator',
    department: 'Comercial',
  },
];

/** E-mail que já vem preenchido no Login. */
export const DEFAULT_LOGIN_EMAIL = 'admin@empresa.com';
