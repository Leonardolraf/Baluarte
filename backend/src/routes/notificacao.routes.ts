import type { Router } from 'express';
import * as notificacaoController from '../controllers/notificacao.controller.js';
import { exigeToken } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

export function rotasNotificacoes(r: Router) {
  r.get('/configuracoes/notificacoes', exigeToken, wrap(notificacaoController.ler));
  r.put('/configuracoes/notificacoes', exigeToken, wrap(notificacaoController.salvar));
}
