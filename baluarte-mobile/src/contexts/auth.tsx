import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authRepository } from '../data/repository';
import { IS_API_MODE } from '../lib/config';
import type { AuthResult } from '../lib/auth';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  /** `true` enquanto o app verifica, na abertura, se há sessão salva (modo API). */
  restoring: boolean;
  /**
   * Autentica. No modo demo é imediato; no modo API chama `POST /login` e guarda
   * o token. Em caso de sucesso, as rotas trocam sozinhas para o app.
   */
  signIn: (email: string, password: string) => Promise<AuthResult>;
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
  // Só há o que restaurar no modo API e quando não começamos já logados (testes).
  const [restoring, setRestoring] = useState(IS_API_MODE && initialUser === null);

  useEffect(() => {
    if (!restoring) return;
    let active = true;
    authRepository
      .restoreSession()
      .then((restored) => {
        if (active && restored) setUser(restored);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
    // Só na montagem: a restauração de sessão é feita uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authRepository.signIn(email, password);
    if (result.ok) setUser(result.user);
    return result;
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    // Encerra no servidor/limpa o token em segundo plano (não trava a UI).
    void authRepository.signOut();
  }, []);

  const value = useMemo(
    () => ({ user, restoring, signIn, signOut }),
    [user, restoring, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return context;
}
