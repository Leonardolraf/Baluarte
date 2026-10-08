import type { Router } from 'express';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { exigeToken, tokenDe, usuarioDe } from '../../http/middlewares.js';
import { emailFormatoValido, validarSenha, vazio } from '../../shared/validacao.js';
import * as auth from './service.js';

// Rotas de autenticacao e conta: login (contrato N2 AT1), troca e redefinicao de senha,
// verificacao do link, logout, renovacao da sessao e a politica de seguranca publicada.
// A rota valida o formato da entrada; a regra fica em service.ts.
export function rotasAuth(r: Router) {
  // ---- POST /api/login (contrato N2 AT1) -------------------------------------
  r.post('/login', wrap(async (req, res) => {
    const { email, senha } = req.body ?? {};
    if (vazio(email)) return erro(res, 400, 'E-mail é obrigatório', 'EMAIL_OBRIGATORIO');
    if (typeof senha !== 'string' || vazio(senha)) return erro(res, 400, 'Senha é obrigatória', 'SENHA_OBRIGATORIA');
    if (!emailFormatoValido(email)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
    const dados = await auth.entrar(String(email), String(senha));
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Autenticado com sucesso', dados });
  }));

  // ---- POST /auth/change-password (protegido) --------------------------------
  r.post('/auth/change-password', exigeToken, wrap(async (req, res) => {
    const { senhaAtual, novaSenha } = req.body ?? {};
    if (vazio(senhaAtual)) return erro(res, 400, 'Senha atual é obrigatória', 'SENHA_ATUAL_OBRIGATORIA');
    if (vazio(novaSenha)) return erro(res, 400, 'Nova senha é obrigatória', 'NOVA_SENHA_OBRIGATORIA');
    const problema = validarSenha(novaSenha);
    if (problema) return erro(res, 400, problema, 'SENHA_FRACA');
    const token = await auth.trocarSenha(usuarioDe(req), tokenDe(req), String(senhaAtual), String(novaSenha));
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Senha alterada com sucesso', dados: { token } });
  }));

  // ---- POST /auth/reset-password (publico) -----------------------------------
  r.post('/auth/reset-password', wrap(async (req, res) => {
    const { email } = req.body ?? {};
    if (!emailFormatoValido(email)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
    await auth.solicitarRedefinicao(String(email));
    // Resposta identica para e-mails conhecidos e desconhecidos (evita enumeracao de usuarios).
    return enviar(res, 200, { status: 'sucesso', mensagem: auth.MSG_RESET_GENERICA });
  }));

  // ---- POST /auth/reset-password/confirm (publico; tambem aceita o convite) ---
  r.post('/auth/reset-password/confirm', wrap(async (req, res) => {
    const { token, novaSenha } = req.body ?? {};
    if (vazio(token)) return erro(res, 400, 'Token é obrigatório', 'TOKEN_OBRIGATORIO');
    if (vazio(novaSenha)) return erro(res, 400, 'Nova senha é obrigatória', 'NOVA_SENHA_OBRIGATORIA');
    const problema = validarSenha(novaSenha);
    if (problema) return erro(res, 400, problema, 'SENHA_FRACA');
    const mensagem = await auth.confirmarRedefinicao(String(token), String(novaSenha));
    return enviar(res, 200, { status: 'sucesso', mensagem });
  }));

  // ---- POST /auth/link/verificar (publico) -----------------------------------
  // A tela de criar/redefinir senha confere o link antes de pedir a senha. So quem tem
  // o token (256 bits, entregue por e-mail) chega aqui com sucesso.
  r.post('/auth/link/verificar', wrap(async (req, res) => {
    const { token } = req.body ?? {};
    if (vazio(token)) return erro(res, 400, 'Token é obrigatório', 'TOKEN_OBRIGATORIO');
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
