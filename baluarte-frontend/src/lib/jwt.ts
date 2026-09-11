import { jwtDecode } from 'jwt-decode';
import type { AuthUser, JwtPayload, RBACRole } from '@/types';
import { roleFromLabel } from '@/lib/roles';

/** Claims possíveis: formato canônico do Baluarte ou o payload legado do backend Express. */
interface RawClaims {
  sub?: string;
  idUsuario?: string;
  email?: string;
  name?: string;
  nome?: string;
  role?: string;
  perfil?: string;
  iat?: number;
  exp?: number;
}

const ROLE_SET: ReadonlySet<string> = new Set<RBACRole>(['admin', 'analyst', 'collaborator']);

function normalizeRole(value: string | undefined): RBACRole {
  if (value && ROLE_SET.has(value)) return value as RBACRole;
  return roleFromLabel(value);
}

/** Decodifica o JWT (sem verificar assinatura — isso é papel da API). Retorna null se malformado. */
export function decodeToken(token: string | null | undefined): JwtPayload | null {
  if (!token) return null;
  try {
    const raw = jwtDecode<RawClaims>(token);
    const sub = raw.sub ?? raw.idUsuario;
    if (!sub || !raw.email) return null;
    return {
      sub,
      email: raw.email,
      name: raw.name ?? raw.nome,
      role: normalizeRole(raw.role ?? raw.perfil),
      iat: raw.iat ?? 0,
      exp: raw.exp ?? 0,
    };
  } catch {
    return null;
  }
}

/** Token expirado (ou sem `exp`) considerando uma folga de segurança em segundos. */
export function isTokenExpired(
  token: string | null | undefined,
  skewSeconds = 30,
  now: Date = new Date(),
): boolean {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) return true;
  return payload.exp * 1000 <= now.getTime() + skewSeconds * 1000;
}

export function userFromToken(token: string): AuthUser | null {
  const payload = decodeToken(token);
  if (!payload) return null;
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split('@')[0] ?? 'Usuário',
    role: payload.role,
  };
}

// ---- Utilitários para o mock -----------------------------------------------

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Monta um JWT *estruturalmente válido* (header.payload.signature) para a camada mock.
 * A assinatura é fictícia: o mock nunca é aceito por um backend real.
 */
export function buildMockToken(
  claims: Omit<JwtPayload, 'iat' | 'exp'>,
  ttlMinutes = 30,
  now: Date = new Date(),
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlMinutes * 60;
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'baluarte-mock' }));
  const payload = base64UrlEncode(
    JSON.stringify({ ...claims, iat, exp, iss: 'baluarte-mock', aud: 'baluarte-web' }),
  );
  const signature = base64UrlEncode(`mock-signature:${claims.sub}:${exp}`);
  return `${header}.${payload}.${signature}`;
}
