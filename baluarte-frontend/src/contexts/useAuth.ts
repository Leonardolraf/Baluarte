import { createContext, useContext } from 'react';
import type { AuthUser, LoginCredentials, RBACRole } from '@/types';

// Objeto de contexto e hook vivem num módulo SEM componentes: assim o Fast Refresh
// do Vite não recria o contexto quando `AuthContext.tsx` é editado em desenvolvimento
// (o que deixaria consumidores apontando para um contexto diferente do Provider).

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  token: string | null;
  user: AuthUser | null;
  role: RBACRole | null;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthUser>;
  logout: (reason?: string) => void;
  hasRole: (...roles: RBACRole[]) => boolean;
  /** Atualiza o usuário em memória e no storage (ex.: após editar o próprio perfil). */
  updateUser: (patch: Partial<AuthUser>) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  return ctx;
}
