import type { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { exigeToken } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

// Rotas de autenticacao e conta: login (contrato N2 AT1), troca e redefinicao de senha,
// verificacao do link, logout, renovacao da sessao e a politica de seguranca publicada.
export function rotasAuth(r: Router) {
  r.post('/login', wrap(authController.login));
  r.post('/auth/change-password', exigeToken, wrap(authController.trocarSenha));
  r.post('/auth/reset-password', wrap(authController.solicitarRedefinicao));
  r.post('/auth/reset-password/confirm', wrap(authController.confirmarRedefinicao));
  r.post('/auth/link/verificar', wrap(authController.verificarLink));
  r.post('/auth/logout', exigeToken, wrap(authController.logout));
  r.post('/auth/renovar', exigeToken, wrap(authController.renovar));
  r.get('/configuracoes/seguranca', exigeToken, wrap(authController.politicaSeguranca));
}
