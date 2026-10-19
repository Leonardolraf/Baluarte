import type { Request, Response, NextFunction } from 'express';
import type { TokenPayload } from '../models/auth.model.js';
import { VERSAO_AVISO } from '../models/avisoMonitoramento.model.js';
import type { UsuarioAtual } from '../models/usuario.model.js';
import { buscarParaSessao } from '../repositories/usuario.repository.js';
import { emitidoAntes, verificarToken } from '../services/token.service.js';
import { erro } from '../utils/resposta.js';

// Middlewares de autenticacao (exigeToken, exigeSessao), da ciencia obrigatoria do aviso de
// monitoramento (exigeCienciaAviso) e de RBAC (exigePerfil), usados na declaracao das rotas, e
// os acessores do usuario autenticado para os controllers.

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
// SEM exigir a ciencia do aviso de monitoramento. So para as 4 rotas que quem ainda nao deu
// ciencia precisa usar: POST /auth/logout, POST /auth/renovar, GET /monitoramento/aviso e
// POST /monitoramento/ciencia. As demais usam exigeToken. A ciencia da VERSAO_AVISO em vigor
// vem na mesma consulta do usuario (buscarParaSessao), sem consulta extra por requisicao.
// Espelha o contrato do stub: ausente -> 401 TOKEN_AUSENTE; invalido -> 401 TOKEN_INVALIDO.
// Codigos adicionais: 401 USUARIO_REMOVIDO (conta excluida) e 401 USUARIO_INATIVO (conta inativada).
export function exigeSessao(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return erro(res, 401, 'Token não fornecido', 'TOKEN_AUSENTE');
  const payload = verificarToken(token);
  if (!payload) return erro(res, 401, 'Token inválido', 'TOKEN_INVALIDO');
  buscarParaSessao(payload.idUsuario, VERSAO_AVISO)
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

// Gate de ciencia do aviso de monitoramento (B18 + refatoracao "opcao C" do Leo, 19/10/2026):
// o aviso e o documento UNICO que todo usuario precisa reconhecer para usar o Baluarte. E
// CIENCIA obrigatoria (base legal: legitimo interesse, art. 7o, IX, da LGPD), NAO consentimento.
// Sem ciencia da VERSAO_AVISO em vigor (nenhuma, ou so de versao antiga): 403
// CIENCIA_AVISO_PENDENTE. Roda depois de exigeSessao (precisa do usuario ja carregado).
export function exigeCienciaAviso(req: Request, res: Response, next: NextFunction): void {
  if (!(req as RequestAutenticada).usuarioAtual?.cienciaAvisoEm)
    return erro(res, 403, 'Confirme que leu o aviso de monitoramento para usar o Baluarte', 'CIENCIA_AVISO_PENDENTE');
  next();
}

// Padrao das rotas autenticadas: sessao valida (exigeSessao) E ciencia do aviso em vigor
// (exigeCienciaAviso), antes do RBAC. Fechado por padrao: rota nova com exigeToken ja nasce
// bloqueada para quem nao deu ciencia; liberar exige trocar por exigeSessao de proposito (e
// atualizar a lista de excecoes de tests/ciencia-aviso-gate.test.ts).
export function exigeToken(req: Request, res: Response, next: NextFunction): void {
  exigeSessao(req, res, () => exigeCienciaAviso(req, res, next));
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
