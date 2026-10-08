import type { Router } from 'express';
import * as departamentoController from '../controllers/departamento.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

export function rotasDepartamentos(r: Router) {
  r.get('/departamentos', exigeToken, exigePerfil(...OPERADORES), wrap(departamentoController.listar));
  r.post('/departamentos', exigeToken, exigePerfil('Administrador'), wrap(departamentoController.cadastrar));
  r.delete('/departamentos/:id', exigeToken, exigePerfil('Administrador'), wrap(departamentoController.excluir));
}
