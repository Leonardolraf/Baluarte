import type { Request, Response } from 'express';
import { tokenDe, usuarioDe } from '../middlewares/auth.middleware.js';
import { CONFIRMACAO_RESET, LOGIN, PEDIDO_RESET, TROCA_SENHA, VERIFICACAO_LINK } from '../models/auth.model.js';
import * as authService from '../services/auth.service.js';
import { enviar } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller de autenticacao e conta: le a requisicao, valida a entrada com as regras do
// model, chama o auth.service e monta a resposta.

/** POST /login (contrato N2 AT1). */
export async function login(req: Request, res: Response) {
  const { email, senha } = validar(req.body, LOGIN);
  const dados = await authService.entrar(String(email), String(senha));
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Autenticado com sucesso', dados });
}

/** POST /auth/change-password (protegido). */
export async function trocarSenha(req: Request, res: Response) {
  const { senhaAtual, novaSenha } = validar(req.body, TROCA_SENHA);
  const token = await authService.trocarSenha(usuarioDe(req), tokenDe(req), String(senhaAtual), String(novaSenha));
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Senha alterada com sucesso', dados: { token } });
}

/** POST /auth/reset-password (publico). */
export async function solicitarRedefinicao(req: Request, res: Response) {
  const { email } = validar(req.body, PEDIDO_RESET);
  await authService.solicitarRedefinicao(String(email));
  // Resposta identica para e-mails conhecidos e desconhecidos (evita enumeracao de usuarios).
  return enviar(res, 200, { status: 'sucesso', mensagem: authService.MSG_RESET_GENERICA });
}

/** POST /auth/reset-password/confirm (publico; tambem aceita o convite). */
export async function confirmarRedefinicao(req: Request, res: Response) {
  const { token, novaSenha } = validar(req.body, CONFIRMACAO_RESET);
  const mensagem = await authService.confirmarRedefinicao(String(token), String(novaSenha));
  return enviar(res, 200, { status: 'sucesso', mensagem });
}

/**
 * POST /auth/link/verificar (publico). A tela de criar/redefinir senha confere o link antes
 * de pedir a senha. So quem tem o token (256 bits, entregue por e-mail) chega aqui com sucesso.
 */
export async function verificarLink(req: Request, res: Response) {
  const { token } = validar(req.body, VERIFICACAO_LINK);
  return enviar(res, 200, { status: 'sucesso', dados: await authService.verificarLink(String(token)) });
}

/** POST /auth/logout (protegido). Encerra a sessao em todos os dispositivos. */
export async function logout(req: Request, res: Response) {
  await authService.sair(usuarioDe(req));
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Sessão encerrada' });
}

/**
 * POST /auth/renovar (protegido). O frontend renova o token enquanto a pessoa usa o sistema;
 * parada por 30 min, a sessao expira. Nenhuma renovacao passa de 8 h contadas do login.
 */
export async function renovar(req: Request, res: Response) {
  return enviar(res, 200, { status: 'sucesso', dados: { token: authService.renovar(usuarioDe(req), tokenDe(req)) } });
}

/** GET /configuracoes/seguranca (politica documentada, leitura). */
export async function politicaSeguranca(_req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: authService.politicaSeguranca() });
}
