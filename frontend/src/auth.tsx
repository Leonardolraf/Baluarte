import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setToken, getToken } from './api';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: string;
}

interface AuthCtx {
  usuario: Usuario | null;
  carregando: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const r = await api.get('/me');
          setUsuario(r.dados);
        } catch {
          setToken(null);
        }
      }
      setCarregando(false);
    })();
  }, []);

  async function login(email: string, senha: string) {
    const r = await api.post('/login', { email, senha });
    setToken(r.dados.token);
    const me = await api.get('/me');
    setUsuario(me.dados);
  }

  function logout() {
    setToken(null);
    setUsuario(null);
  }

  return <AuthContext.Provider value={{ usuario, carregando, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
