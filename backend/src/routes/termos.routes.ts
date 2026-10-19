import type { Router } from 'express';
import * as termosController from '../controllers/termos.controller.js';
import { exigeSessao } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

// Termos de uso (Melhorias #5): ler e aceitar. Usam exigeSessao (sem a exigencia do aceite),
// senao quem ainda nao aceitou nao conseguiria aceitar.
export function rotasTermos(r: Router) {
  r.get('/conta/termos', exigeSessao, wrap(termosController.termos));
  r.post('/conta/termos/aceite', exigeSessao, wrap(termosController.aceitar));
}
