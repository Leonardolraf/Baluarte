import type { Router } from 'express';
import * as usuarioController from '../controllers/usuario.controller.js';
import { exigePerfil, exigeSessao, exigeToken } from '../middlewares/auth.middleware.js';
import { OPERADORES } from '../models/dominio.model.js';
import { wrap } from '../utils/resposta.js';

// Rotas de usuarios. POST /users e do contrato N2 AT1.
export function rotasUsuarios(r: Router) {
  r.post('/users', exigeToken, exigePerfil(...OPERADORES), wrap(usuarioController.cadastrar));
  // GET /me fica fora do gate de ciencia (so exigeSessao): devolve so os dados do proprio
  // usuario e o campo cienciaAvisoPendente, que o cliente usa para rotear e explicar. O campo
  // NUNCA decide acesso: a autoridade e o 403 CIENCIA_AVISO_PENDENTE das demais rotas.
  r.get('/me', exigeSessao, wrap(usuarioController.perfil));
  r.get('/usuarios', exigeToken, exigePerfil('Administrador'), wrap(usuarioController.listar));
  r.patch('/users/:id', exigeToken, exigePerfil('Administrador'), wrap(usuarioController.atualizar));
  r.delete('/users/:id', exigeToken, exigePerfil('Administrador'), wrap(usuarioController.excluir));
  r.post('/users/:id/convite', exigeToken, exigePerfil(...OPERADORES), wrap(usuarioController.reenviarConvite));
  r.post('/users/:id/redefinir-senha', exigeToken, exigePerfil('Administrador'), wrap(usuarioController.enviarRedefinicao));
}
