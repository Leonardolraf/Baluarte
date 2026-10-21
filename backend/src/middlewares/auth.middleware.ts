import type { Request, Response, NextFunction } from 'express';
import type { TokenPayload } from '../models/auth.model.js';
import { termosAceitos } from '../models/termos.model.js';
import type { UsuarioAtual } from '../models/usuario.model.js';
import { buscarPorId } from '../repositories/usuario.repository.js';
import { emitidoAntes, verificarToken } from '../services/token.service.js';
import { erro } from '../utils/resposta.js';

// Middlewares de autenticacao (exigeToken, exigeSessao), do aceite dos termos de uso
// (exigeTermosAceitos) e de RBAC (exigePerfil), usados na declaracao das rotas, e os
// acessores do usuario autenticado para os controllers.

export type { UsuarioAtual };

export type RequestAutenticada = Request & { usuario?: TokenPayload; usuarioAtual?: UsuarioAtual };

/** Usuario dono do token, ja carregado do banco por `exigeToken`. */
export function usuarioDe(req: Request): UsuarioAtual {
  return (req as RequestAutenticada).usuarioAtual!;
}

/** Payload do token da requisicao (inicio da sessao, emissao), ja verificado por `exigeToken`. */
export function tokenDe(req: Request): TokenPayload {
  return (req as RequestAutenticada).usuario!;
}

// Middleware que exige um Bearer token JWT valido E um usuario existente e ativo no banco,
// SEM exigir o aceite dos termos. So para as rotas que quem ainda nao aceitou precisa usar:
// logout, renovacao da sessao, GET /conta/termos e o aceite. As demais usam exigeToken.
// Espelha o contrato do stub: ausente -> 401 TOKEN_AUSENTE; invalido -> 401 TOKEN_INVALIDO.
// Codigos adicionais: 401 USUARIO_REMOVIDO (conta excluida) e 401 USUARIO_INATIVO (conta inativada).
export function exigeSessao(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return erro(res, 401, 'Token não fornecido', 'TOKEN_AUSENTE');
  const payload = verificarToken(token);
  if (!payload) return erro(res, 401, 'Token inválido', 'TOKEN_INVALIDO');
  buscarPorId(payload.idUsuario)
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

// Melhorias #5: sem aceite valido dos termos de uso, 403 TERMOS_NAO_ACEITOS. Roda depois de
// exigeSessao (precisa do usuario carregado do banco).
export function exigeTermosAceitos(req: Request, res: Response, next: NextFunction): void {
  if (!termosAceitos((req as RequestAutenticada).usuarioAtual?.termosAceitosEm))
    return erro(res, 403, 'Aceite os termos de uso para continuar', 'TERMOS_NAO_ACEITOS');
  next();
}

// Padrao das rotas autenticadas: sessao valida (exigeSessao) E termos aceitos
// (exigeTermosAceitos). Fechado por padrao: rota nova com exigeToken ja nasce bloqueada para
// quem nao aceitou; liberar exige trocar por exigeSessao de proposito.
export function exigeToken(req: Request, res: Response, next: NextFunction): void {
  exigeSessao(req, res, () => exigeTermosAceitos(req, res, next));
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
