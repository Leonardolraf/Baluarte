import { z } from 'zod';
import type { Router } from 'express';
import { enviar, wrap } from '../../http/resposta.js';
import { exigeToken, tokenDe, usuarioDe } from '../../http/middlewares.js';
import { email, preenchido, problemaDaSenha, regra, senhaNova, validar } from '../../shared/esquemas.js';
import * as auth from './service.js';

// Regras de entrada (zod), na ordem do contrato.
const LOGIN = [
  regra('email', preenchido, 'E-mail é obrigatório', 'EMAIL_OBRIGATORIO'),
  regra('senha', preenchido, 'Senha é obrigatória', 'SENHA_OBRIGATORIA'),
  regra('senha', z.string(), 'Senha é obrigatória', 'SENHA_OBRIGATORIA'),
  regra('email', email, 'Formato de e-mail inválido', 'EMAIL_INVALIDO'),
];
const NOVA_SENHA = [
  regra('novaSenha', preenchido, 'Nova senha é obrigatória', 'NOVA_SENHA_OBRIGATORIA'),
  regra('novaSenha', senhaNova, problemaDaSenha, 'SENHA_FRACA'),
];
const TROCA_SENHA = [regra('senhaAtual', preenchido, 'Senha atual é obrigatória', 'SENHA_ATUAL_OBRIGATORIA'), ...NOVA_SENHA];
const TOKEN = regra('token', preenchido, 'Token é obrigatório', 'TOKEN_OBRIGATORIO');
const PEDIDO_RESET = [regra('email', email, 'Formato de e-mail inválido', 'EMAIL_INVALIDO')];

// Rotas de autenticacao e conta: login (contrato N2 AT1), troca e redefinicao de senha,
// verificacao do link, logout, renovacao da sessao e a politica de seguranca publicada.
// A rota valida o formato da entrada; a regra fica em service.ts.
export function rotasAuth(r: Router) {
  // ---- POST /api/login (contrato N2 AT1) -------------------------------------
  r.post('/login', wrap(async (req, res) => {
    const { email, senha } = validar(req.body, LOGIN);
    const dados = await auth.entrar(String(email), String(senha));
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Autenticado com sucesso', dados });
  }));

  // ---- POST /auth/change-password (protegido) --------------------------------
  r.post('/auth/change-password', exigeToken, wrap(async (req, res) => {
    const { senhaAtual, novaSenha } = validar(req.body, TROCA_SENHA);
    const token = await auth.trocarSenha(usuarioDe(req), tokenDe(req), String(senhaAtual), String(novaSenha));
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Senha alterada com sucesso', dados: { token } });
  }));

  // ---- POST /auth/reset-password (publico) -----------------------------------
  r.post('/auth/reset-password', wrap(async (req, res) => {
    const { email } = validar(req.body, PEDIDO_RESET);
    await auth.solicitarRedefinicao(String(email));
    // Resposta identica para e-mails conhecidos e desconhecidos (evita enumeracao de usuarios).
    return enviar(res, 200, { status: 'sucesso', mensagem: auth.MSG_RESET_GENERICA });
  }));

  // ---- POST /auth/reset-password/confirm (publico; tambem aceita o convite) ---
  r.post('/auth/reset-password/confirm', wrap(async (req, res) => {
    const { token, novaSenha } = validar(req.body, [TOKEN, ...NOVA_SENHA]);
    const mensagem = await auth.confirmarRedefinicao(String(token), String(novaSenha));
    return enviar(res, 200, { status: 'sucesso', mensagem });
  }));

  // ---- POST /auth/link/verificar (publico) -----------------------------------
  // A tela de criar/redefinir senha confere o link antes de pedir a senha. So quem tem
  // o token (256 bits, entregue por e-mail) chega aqui com sucesso.
  r.post('/auth/link/verificar', wrap(async (req, res) => {
    const { token } = validar(req.body, [TOKEN]);
    return enviar(res, 200, { status: 'sucesso', dados: await auth.verificarLink(String(token)) });
  }));

  // ---- POST /auth/logout (protegido) -----------------------------------------
  // Encerra a sessao em todos os dispositivos.
  r.post('/auth/logout', exigeToken, wrap(async (req, res) => {
    await auth.sair(usuarioDe(req));
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Sessão encerrada' });
  }));

  // ---- POST /auth/renovar (protegido) ----------------------------------------
  // O frontend renova o token enquanto a pessoa usa o sistema; parada por 30 min, a
  // sessao expira. Nenhuma renovacao passa de 8 h contadas do login.
  r.post('/auth/renovar', exigeToken, wrap(async (req, res) => {
    return enviar(res, 200, { status: 'sucesso', dados: { token: auth.renovar(usuarioDe(req), tokenDe(req)) } });
  }));

  // ---- GET /configuracoes/seguranca (politica documentada, leitura) ----------
  r.get('/configuracoes/seguranca', exigeToken, wrap(async (_req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: auth.politicaSeguranca() });
  }));
}
