import type { Router } from 'express';
import * as vulnerabilidadeController from '../controllers/vulnerabilidade.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

// Rotas de vulnerabilidades. GET /findings/classificacao e do contrato N2 AT1 (publica).
export function rotasVulnerabilidades(r: Router) {
  r.get('/findings/classificacao', wrap(vulnerabilidadeController.classificar));
  r.get('/vulnerabilidades', exigeToken, exigePerfil(...OPERADORES), wrap(vulnerabilidadeController.listar));
  r.get('/vulnerabilidades/:id', exigeToken, exigePerfil(...OPERADORES), wrap(vulnerabilidadeController.detalhe));
  r.patch('/vulnerabilidades/:id', exigeToken, exigePerfil(...OPERADORES), wrap(vulnerabilidadeController.alterarStatus));
}
