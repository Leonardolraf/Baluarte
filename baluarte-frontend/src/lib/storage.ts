import { RBAC_ROLES, type AuthUser } from '@/types';

const TOKEN_KEY = 'baluarte.token';
const USER_KEY = 'baluarte.user';

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export const tokenStorage = {
  get(): string | null {
    return safeStorage()?.getItem(TOKEN_KEY) ?? null;
  },
  set(token: string): void {
    safeStorage()?.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    safeStorage()?.removeItem(TOKEN_KEY);
  },
};

export const userStorage = {
  get(): AuthUser | null {
    const raw = safeStorage()?.getItem(USER_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<AuthUser>;
      if (
        parsed &&
        typeof parsed.id === 'string' &&
        typeof parsed.email === 'string' &&
        typeof parsed.role === 'string' &&
        (RBAC_ROLES as readonly string[]).includes(parsed.role)
      ) {
        return parsed as AuthUser;
      }
      return null;
    } catch {
      return null;
    }
  },
  set(user: AuthUser): void {
    safeStorage()?.setItem(USER_KEY, JSON.stringify(user));
  },
  clear(): void {
    safeStorage()?.removeItem(USER_KEY);
  },
};

export function clearSession(): void {
  tokenStorage.clear();
  userStorage.clear();
}
