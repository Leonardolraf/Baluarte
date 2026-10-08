import type { Router } from 'express';
import * as treinamentoController from '../controllers/treinamento.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

export function rotasTreinamento(r: Router) {
  // Registrada ANTES de /treinamentos/:token, senao "consolidado" seria lido como token.
  r.get('/treinamentos/consolidado', exigeToken, exigePerfil(...OPERADORES), wrap(treinamentoController.consolidado));

  // Dentro do sistema (com login): `:token` e o id do evento de campanha.
  r.get('/treinamentos/:token', exigeToken, wrap(treinamentoController.ver));
  r.post('/treinamentos/:token/concluir', exigeToken, wrap(treinamentoController.concluir));

  // Link do e-mail simulado (publico, sem login).
  r.get('/treinamentos/link/:token', wrap(treinamentoController.abrirPeloLink));
  r.post('/treinamentos/link/:token/concluir', wrap(treinamentoController.concluirPeloLink));
  r.post('/treinamentos/link/:token/reportar', wrap(treinamentoController.reportar));
}
