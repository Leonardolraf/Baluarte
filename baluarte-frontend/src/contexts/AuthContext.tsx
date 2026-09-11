import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser, LoginCredentials, RBACRole } from '@/types';
import { api } from '@/services/api';
import { FORBIDDEN_EVENT, UNAUTHORIZED_EVENT } from '@/lib/events';
import { isTokenExpired, userFromToken } from '@/lib/jwt';
import { clearSession, tokenStorage, userStorage } from '@/lib/storage';
import { hasAnyRole } from '@/lib/roles';
import { notify } from '@/store/uiStore';
import { AuthContext, useAuth, type AuthContextValue, type AuthStatus } from '@/contexts/useAuth';

// Reexportados para manter o ponto de importação único (`@/contexts/AuthContext`).
export { useAuth };
export type { AuthContextValue, AuthStatus };

interface SessionState {
  status: AuthStatus;
  token: string | null;
  user: AuthUser | null;
}

function restoreSession(): SessionState {
  const token = tokenStorage.get();
  if (!token || isTokenExpired(token)) {
    clearSession();
    return { status: 'anonymous', token: null, user: null };
  }
  const claims = userFromToken(token);
  if (!claims) {
    clearSession();
    return { status: 'anonymous', token: null, user: null };
  }
  // O token é a fonte de verdade para id/e-mail/perfil (o storage é editável pelo
  // usuário); o objeto guardado só contribui com o nome completo vindo de /me.
  const stored = userStorage.get();
  const user: AuthUser =
    stored && stored.id === claims.id ? { ...claims, name: stored.name || claims.name } : claims;
  return { status: 'authenticated', token, user };
}

export interface AuthProviderProps {
  children: ReactNode;
  /** Sessão inicial (testes). Quando omitida, é restaurada do localStorage. */
  initialSession?: Partial<SessionState>;
  /** Revalida o usuário com `GET /me` ao montar (desligado em testes). */
  revalidateOnMount?: boolean;
}

export function AuthProvider({ children, initialSession, revalidateOnMount = true }: AuthProviderProps) {
  const [session, setSession] = useState<SessionState>(() => {
    if (initialSession) {
      const token = initialSession.token ?? null;
      const user = initialSession.user ?? null;
      return { status: initialSession.status ?? (user ? 'authenticated' : 'anonymous'), token, user };
    }
    return restoreSession();
  });

  const logout = useCallback((reason?: string) => {
    clearSession();
    setSession({ status: 'anonymous', token: null, user: null });
    if (reason) notify.info(reason);
  }, []);

  const login = useCallback(async (credentials: LoginCredentials): Promise<AuthUser> => {
    const response = await api.login(credentials);
    tokenStorage.set(response.token);
    userStorage.set(response.user);
    setSession({ status: 'authenticated', token: response.token, user: response.user });
    return response.user;
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setSession((current) => {
      if (!current.user) return current;
      const user = { ...current.user, ...patch };
      userStorage.set(user);
      return { ...current, user };
    });
  }, []);

  // Revalida a sessão restaurada com o servidor (token válido localmente pode ter sido revogado).
  useEffect(() => {
    if (!revalidateOnMount || session.status !== 'authenticated' || !session.token) return;
    let cancelled = false;
    api
      .me()
      .then((user) => {
        if (cancelled) return;
        userStorage.set(user);
        setSession((current) => (current.status === 'authenticated' ? { ...current, user } : current));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const status =
          typeof error === 'object' && error && 'status' in error
            ? Number((error as { status: number }).status)
            : 0;
        if (status === 401 || status === 403) logout('Sua sessão expirou. Faça login novamente.');
      });
    return () => {
      cancelled = true;
    };
    // Executa uma única vez por token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, revalidateOnMount]);

  // 401 vindo de qualquer chamada encerra a sessão.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      if (tokenStorage.get()) logout('Sua sessão expirou. Faça login novamente.');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [logout]);

  // 403: o perfil em memória pode ter mudado (ex.: admin rebaixou o usuário) — ressincroniza com /me.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let syncing = false;
    const handler = () => {
      if (syncing || !tokenStorage.get()) return;
      syncing = true;
      api
        .me()
        .then((user) => {
          userStorage.set(user);
          setSession((current) => (current.status === 'authenticated' ? { ...current, user } : current));
        })
        .catch(() => undefined)
        .finally(() => {
          syncing = false;
        });
    };
    window.addEventListener(FORBIDDEN_EVENT, handler);
    return () => window.removeEventListener(FORBIDDEN_EVENT, handler);
  }, []);

  // Expiração do token em tempo real (checa a cada 30 s).
  useEffect(() => {
    if (session.status !== 'authenticated' || !session.token) return;
    const interval = window.setInterval(() => {
      if (isTokenExpired(session.token)) logout('Sua sessão expirou. Faça login novamente.');
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [session.status, session.token, logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session.status,
      token: session.token,
      user: session.user,
      role: session.user?.role ?? null,
      isAuthenticated: session.status === 'authenticated',
      login,
      logout,
      updateUser,
      hasRole: (...roles: RBACRole[]) => hasAnyRole(session.user?.role, roles),
    }),
    [session, login, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
