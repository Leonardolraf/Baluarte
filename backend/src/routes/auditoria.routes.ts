import type { Router } from 'express';
import * as auditoriaController from '../controllers/auditoria.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

// Rotas da trilha de auditoria (RN-008, RNF-002): consulta, verificacao da cadeia de hash e
// retencao, todas so do Administrador.
export function rotasAuditoria(r: Router) {
  r.get('/auditoria', exigeToken, exigePerfil('Administrador'), wrap(auditoriaController.consultar));
  r.get('/auditoria/integridade', exigeToken, exigePerfil('Administrador'), wrap(auditoriaController.verificarIntegridade));
  r.post('/auditoria/retencao', exigeToken, exigePerfil('Administrador'), wrap(auditoriaController.aplicarRetencao));
}
