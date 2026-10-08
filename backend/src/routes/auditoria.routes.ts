import type { Router } from 'express';
import * as auditoriaController from '../controllers/auditoria.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

// Rotas da trilha de auditoria (RN-008): a consulta e so do Administrador.
export function rotasAuditoria(r: Router) {
  r.get('/auditoria', exigeToken, exigePerfil('Administrador'), wrap(auditoriaController.consultar));
}
