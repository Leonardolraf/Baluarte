import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';
import { erro } from './util.js';

// Payload que vai dentro do JWT.
export interface TokenPayload {
  idUsuario: string;
  email: string;
  perfil: string;
  /** Inicio da sessao (epoch em segundos): o login original, preservado nas renovacoes. */
  inicioSessao?: number;
  /** Emissao em milissegundos: `iat` so tem segundos e nao separa um logout do login logo antes. */
  emitidoEmMs?: number;
  /** Emissao (epoch em segundos), preenchida pelo jsonwebtoken. */
  iat?: number;
}

/** Usuario carregado do banco a cada requisicao autenticada: fonte de verdade para perfil e status. */
export interface UsuarioAtual {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  status: string;
  senhaHash: string;
  senhaAlteradaEm: Date | null;
  sessaoEncerradaEm: Date | null;
  departmentId: string | null;
}

export type RequestAutenticada = Request & { usuario?: TokenPayload; usuarioAtual?: UsuarioAtual };

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

/**
 * Token emitido antes do instante dado. Usa a emissao em milissegundos; tokens antigos,
 * sem ela, caem no `iat` (segundos, com 1 s de folga).
 */
function emitidoAntes(payload: TokenPayload, instante: Date | null): boolean {
  if (instante === null) return false;
  if (typeof payload.emitidoEmMs === 'number') return payload.emitidoEmMs <= instante.getTime();
  return payload.iat !== undefined && payload.iat * 1000 < instante.getTime() - 1000;
}

/** Usuario dono do token, ja carregado do banco por `exigeToken`. */
export function usuarioDe(req: Request): UsuarioAtual {
  return (req as RequestAutenticada).usuarioAtual!;
}

// Middleware que exige um Bearer token JWT valido E um usuario existente e ativo no banco.
// Espelha o contrato do stub: ausente -> 401 TOKEN_AUSENTE; invalido -> 401 TOKEN_INVALIDO.
// Codigos adicionais: 401 USUARIO_REMOVIDO (conta excluida) e 401 USUARIO_INATIVO (conta inativada).
export function exigeToken(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return erro(res, 401, 'Token não fornecido', 'TOKEN_AUSENTE');
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, segredo()) as TokenPayload;
  } catch {
    return erro(res, 401, 'Token inválido', 'TOKEN_INVALIDO');
  }
  prisma.user
    .findUnique({ where: { id: payload.idUsuario } })
    .then((usuario) => {
      if (!usuario) return erro(res, 401, 'Usuário não existe mais', 'USUARIO_REMOVIDO');
      if (usuario.status === 'Inativo')
        return erro(res, 401, 'Usuário inativo. Contate o administrador.', 'USUARIO_INATIVO');
      // Redefinicao de senha e logout derrubam as sessoes abertas antes deles.
      if (emitidoAntes(payload, usuario.senhaAlteradaEm))
        return erro(res, 401, 'Sessão encerrada: a senha foi redefinida', 'SENHA_REDEFINIDA');
      if (emitidoAntes(payload, usuario.sessaoEncerradaEm))
        return erro(res, 401, 'Sessão encerrada', 'SESSAO_ENCERRADA');
      const r = req as RequestAutenticada;
      r.usuario = payload;
      r.usuarioAtual = usuario;
      next();
    })
    .catch((e) => {
      console.error('[auth] falha ao carregar usuário', e);
      erro(res, 500, 'Erro interno no servidor', 'ERRO_INTERNO');
    });
}

// Middleware de RBAC: restringe a rota aos perfis informados, usando o perfil ATUAL do
// banco (o JWT pode estar defasado depois de um rebaixamento).
export function exigePerfil(...perfis: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const r = req as RequestAutenticada;
    const perfil = r.usuarioAtual?.perfil ?? r.usuario?.perfil;
    if (!perfil || !perfis.includes(perfil)) {
      return erro(res, 403, 'Acesso negado para o seu perfil', 'PERFIL_SEM_PERMISSAO');
    }
    next();
  };
}
