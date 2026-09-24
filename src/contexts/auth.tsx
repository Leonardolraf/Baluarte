import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { authenticate, type AuthResult } from '../lib/auth';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  /** Autenticação simulada; em caso de sucesso as rotas trocam sozinhas para o app. */
  signIn: (email: string, password: string) => AuthResult;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  /** Usuário já autenticado (útil em testes). */
  initialUser?: User | null;
}

export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser);

  const signIn = useCallback((email: string, password: string) => {
    const result = authenticate(email, password);
    if (result.ok) setUser(result.user);
    return result;
  }, []);

  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return context;
}
