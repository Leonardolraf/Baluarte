/**
 * Guarda o token de sessão (JWT) do modo API.
 *
 * - **Nativo (iOS/Android):** Keychain/Keystore via `expo-secure-store`.
 * - **Web:** `localStorage` (mesma chave do frontend do produto), com fallback
 *   em memória quando o `localStorage` não está disponível.
 *
 * Nenhum segredo é guardado no código: aqui só mora o token que a própria API
 * devolve no login do usuário.
 */
import { Platform } from 'react-native';

/** Mesma chave do frontend web (`baluarte.token`), por consistência. */
const TOKEN_KEY = 'baluarte.token';

let memoryToken: string | null = null;

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

function webStore(): TokenStore {
  const ls = (): Storage | null => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  };
  return {
    async get() {
      return ls()?.getItem(TOKEN_KEY) ?? memoryToken;
    },
    async set(token) {
      memoryToken = token;
      try {
        ls()?.setItem(TOKEN_KEY, token);
      } catch {
        /* modo privado/bloqueado: fica só em memória */
      }
    },
    async clear() {
      memoryToken = null;
      try {
        ls()?.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

function nativeStore(): TokenStore {
  // Import tardio: evita carregar o módulo nativo na web e nos testes.
  const secureStore = () => require('expo-secure-store') as typeof import('expo-secure-store');
  return {
    async get() {
      try {
        return await secureStore().getItemAsync(TOKEN_KEY);
      } catch {
        return memoryToken;
      }
    },
    async set(token) {
      memoryToken = token;
      try {
        await secureStore().setItemAsync(TOKEN_KEY, token);
      } catch {
        /* fallback em memória */
      }
    },
    async clear() {
      memoryToken = null;
      try {
        await secureStore().deleteItemAsync(TOKEN_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

export const tokenStore: TokenStore = Platform.OS === 'web' ? webStore() : nativeStore();
