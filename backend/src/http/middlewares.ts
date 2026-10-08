import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../platform/db.js';
import { emitidoAntes, verificarToken, type TokenPayload } from '../modules/auth/jwt.js';
import { erro } from './resposta.js';

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

/** Usuario dono do token, ja carregado do banco por `exigeToken`. */
export function usuarioDe(req: Request): UsuarioAtual {
  return (req as RequestAutenticada).usuarioAtual!;
}

/** Payload do token da requisicao (inicio da sessao, emissao), ja verificado por `exigeToken`. */
export function tokenDe(req: Request): TokenPayload {
  return (req as RequestAutenticada).usuario!;
}

// Middleware que exige um Bearer token JWT valido E um usuario existente e ativo no banco.
// Espelha o contrato do stub: ausente -> 401 TOKEN_AUSENTE; invalido -> 401 TOKEN_INVALIDO.
// Codigos adicionais: 401 USUARIO_REMOVIDO (conta excluida) e 401 USUARIO_INATIVO (conta inativada).
export function exigeToken(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return erro(res, 401, 'Token não fornecido', 'TOKEN_AUSENTE');
  const payload = verificarToken(token);
  if (!payload) return erro(res, 401, 'Token inválido', 'TOKEN_INVALIDO');
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
