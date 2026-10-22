import type { Router } from 'express';
import * as avisoController from '../controllers/avisoMonitoramento.controller.js';
import { exigePerfil, exigeSessao, exigeToken } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

// Aviso de monitoramento da estacao (B18, LGPD): todo perfil logado le o aviso e registra a
// propria ciencia; a lista de quem deu ciencia e so do Administrador. Ler o aviso e registrar a
// ciencia usam exigeSessao (sem o gate exigeCienciaAviso): sao o caminho de quem ainda nao deu
// ciencia. A lista usa exigeToken (com o gate) e o perfil de Administrador.
export function rotasAvisoMonitoramento(r: Router) {
  r.get('/monitoramento/aviso', exigeSessao, wrap(avisoController.aviso));
  r.post('/monitoramento/ciencia', exigeSessao, wrap(avisoController.registrarCiencia));
  r.get('/monitoramento/ciencias', exigeToken, exigePerfil('Administrador'), wrap(avisoController.listarCiencias));
}
