import type { Router } from 'express';
import * as estacaoController from '../controllers/estacao.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

// Rotas do painel de estacoes monitoradas (B13): leitura do que o agente osquery registrou.
// Separadas das rotas do agente (agente.routes.ts), que sao publicas e falam o protocolo dele.
export function rotasEstacoes(r: Router) {
  r.get('/estacoes', exigeToken, exigePerfil(...OPERADORES), wrap(estacaoController.listar));
  r.get('/estacoes/:id', exigeToken, exigePerfil(...OPERADORES), wrap(estacaoController.detalhe));
}
