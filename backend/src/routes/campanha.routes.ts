import type { Router } from 'express';
import * as campanhaController from '../controllers/campanha.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

// Rotas de campanhas. POST /campaigns e do contrato N2 AT1.
export function rotasCampanhas(r: Router) {
  r.post('/campaigns', exigeToken, exigePerfil(...OPERADORES), wrap(campanhaController.cadastrar));
  r.get('/campanhas', exigeToken, exigePerfil(...OPERADORES), wrap(campanhaController.listar));
  r.get('/campanhas/:id', exigeToken, exigePerfil(...OPERADORES), wrap(campanhaController.relatorio));
  r.delete('/campanhas/:id', exigeToken, exigePerfil(...OPERADORES), wrap(campanhaController.excluir));
}
