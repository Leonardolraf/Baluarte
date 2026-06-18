import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { erro } from './util.js';

// Payload que vai dentro do JWT.
export interface TokenPayload {
  idUsuario: string;
  email: string;
  perfil: string;
}

function segredo(): string {
  return process.env.JWT_SECRET || 'baluarte-v2-dev-secret';
}

export function gerarToken(payload: TokenPayload): string {
  return jwt.sign(payload, segredo(), { expiresIn: '30m' });
}

// Middleware que exige um Bearer token JWT valido.
// Espelha o contrato do stub: ausente -> 401 TOKEN_AUSENTE; invalido -> 401 TOKEN_INVALIDO.
export function exigeToken(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return erro(res, 401, 'Token não fornecido', 'TOKEN_AUSENTE');
  try {
    const payload = jwt.verify(token, segredo()) as TokenPayload;
    (req as Request & { usuario?: TokenPayload }).usuario = payload;
    next();
  } catch {
    return erro(res, 401, 'Token inválido', 'TOKEN_INVALIDO');
  }
}

// Middleware de RBAC: restringe a rota aos perfis informados.
export function exigePerfil(...perfis: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const usuario = (req as Request & { usuario?: TokenPayload }).usuario;
    if (!usuario || !perfis.includes(usuario.perfil)) {
      return erro(res, 403, 'Acesso negado para o seu perfil', 'PERFIL_SEM_PERMISSAO');
    }
    next();
  };
}
