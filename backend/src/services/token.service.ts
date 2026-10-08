import jwt from 'jsonwebtoken';
import type { TokenPayload } from '../models/auth.model.js';

// Emissao e verificacao do JWT (HS256) da sessao. Quem usa isto: o middleware
// src/middlewares/auth.middleware.ts (exigeToken) e o auth.service (login, renovacao).
// O formato do payload (TokenPayload) fica em models/auth.model.ts.

export type { TokenPayload };

const SEGREDO_DEV = 'baluarte-v2-dev-secret';
// Valores de exemplo que aparecem em .env.example / docker-compose: nunca valem em producao.
const SEGREDOS_DE_EXEMPLO = new Set([SEGREDO_DEV, 'baluarte-v2-docker-secret-troque', 'troque-em-producao']);

function segredo(): string {
  return process.env.JWT_SECRET || SEGREDO_DEV;
}

/**
 * Falha cedo se o segredo do JWT nao servir para producao. Chamar antes do listen().
 * Fora de producao, avisa e segue com o segredo de desenvolvimento.
 */
export function validarSegredoJwt(): void {
  const valor = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!valor || valor.length < 16 || SEGREDOS_DE_EXEMPLO.has(valor)) {
      throw new Error('JWT_SECRET é obrigatório em produção (mínimo 16 caracteres, diferente dos valores de exemplo).');
    }
    return;
  }
  if (!valor) console.warn('[auth] JWT_SECRET não definido: usando o segredo de desenvolvimento.');
}

// Sessao: o token vale 30 min e o frontend o renova enquanto a pessoa usa o sistema
// (POST /auth/renovar). Parado por 30 min, a sessao expira; e nenhuma renovacao passa
// de 8 h contadas do login, para uma sessao esquecida aberta nao durar para sempre.
export const SESSAO_MAXIMA_MS = 8 * 60 * 60 * 1000;

export function gerarToken(payload: TokenPayload): string {
  const { idUsuario, email, perfil } = payload;
  const inicioSessao = payload.inicioSessao ?? Math.floor(Date.now() / 1000);
  return jwt.sign({ idUsuario, email, perfil, inicioSessao, emitidoEmMs: Date.now() }, segredo(), { expiresIn: '30m' });
}

/** Payload do token, ou null se a assinatura, o formato ou a validade nao conferirem. */
export function verificarToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, segredo()) as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Token emitido antes do instante dado. Usa a emissao em milissegundos; tokens antigos,
 * sem ela, caem no `iat` (segundos, com 1 s de folga).
 */
export function emitidoAntes(payload: TokenPayload, instante: Date | null): boolean {
  if (instante === null) return false;
  if (typeof payload.emitidoEmMs === 'number') return payload.emitidoEmMs <= instante.getTime();
  return payload.iat !== undefined && payload.iat * 1000 < instante.getTime() - 1000;
}
