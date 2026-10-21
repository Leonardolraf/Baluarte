import type { Router } from 'express';
import * as estacaoController from '../controllers/estacao.controller.js';
import * as vinculoController from '../controllers/vinculoEstacao.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

// Rotas das estacoes monitoradas: painel (B13, leitura do que o agente osquery registrou),
// verificacao de vulnerabilidades sob demanda (B14) e o vinculo de inscricao do agente (#9).
// Separadas das rotas do agente (agente.routes.ts), que sao publicas e falam o protocolo dele.
export function rotasEstacoes(r: Router) {
  r.get('/estacoes', exigeToken, exigePerfil(...OPERADORES), wrap(estacaoController.listar));
  // #9: vinculo de inscricao — SO Administrador. Registrado ANTES de /estacoes/:id (rota estatica
  // vs. parametro), senao "vinculos" cairia em :id.
  r.post('/estacoes/vinculos', exigeToken, exigePerfil('Administrador'), wrap(vinculoController.emitir));
  r.get('/estacoes/vinculos', exigeToken, exigePerfil('Administrador'), wrap(vinculoController.listar));
  r.delete('/estacoes/vinculos/:id', exigeToken, exigePerfil('Administrador'), wrap(vinculoController.revogar));
  r.get('/estacoes/:id', exigeToken, exigePerfil(...OPERADORES), wrap(estacaoController.detalhe));
  // B14: cruzamento do inventario com as bases publicas de vulnerabilidades (escrita auditada).
  r.post('/estacoes/:id/verificar', exigeToken, exigePerfil(...OPERADORES), wrap(estacaoController.verificar));
}
