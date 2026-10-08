import type { Router } from 'express';
import * as avisoController from '../controllers/avisoMonitoramento.controller.js';
import { exigePerfil, exigeToken } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

// Aviso de monitoramento da estacao (B18, LGPD): todo perfil logado le o aviso e registra a
// propria ciencia; a lista de quem deu ciencia e so do Administrador.
export function rotasAvisoMonitoramento(r: Router) {
  r.get('/monitoramento/aviso', exigeToken, wrap(avisoController.aviso));
  r.post('/monitoramento/ciencia', exigeToken, wrap(avisoController.registrarCiencia));
  r.get('/monitoramento/ciencias', exigeToken, exigePerfil('Administrador'), wrap(avisoController.listarCiencias));
}
