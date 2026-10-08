import type { Router } from 'express';
import * as varreduraController from '../controllers/varredura.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

// Rotas de varredura. POST /scans e do contrato N2 AT1.
export function rotasVarreduras(r: Router) {
  r.post('/scans', exigeToken, exigePerfil(...OPERADORES), wrap(varreduraController.iniciar));
  r.get('/scans', exigeToken, exigePerfil(...OPERADORES), wrap(varreduraController.listar));
  r.get('/scans/:id', exigeToken, exigePerfil(...OPERADORES), wrap(varreduraController.detalhe));
}
