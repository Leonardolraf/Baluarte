import type { Router } from 'express';
import * as ativoController from '../controllers/ativo.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

// Rotas de ativos. POST /assets e do contrato N2 AT1.
export function rotasAtivos(r: Router) {
  r.post('/assets', exigeToken, exigePerfil(...OPERADORES), wrap(ativoController.cadastrar));
  r.get('/assets', exigeToken, exigePerfil(...OPERADORES), wrap(ativoController.listar));
}
