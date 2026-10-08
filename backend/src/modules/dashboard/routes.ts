import type { Router } from 'express';
import { enviar, wrap } from '../../http/resposta.js';
import { exigeToken, usuarioDe } from '../../http/middlewares.js';
import * as dashboard from './service.js';

export function rotasDashboard(r: Router) {
  // ---- GET /dashboard (todos os perfis; o conteudo depende do perfil) ----
  r.get('/dashboard', exigeToken, wrap(async (req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await dashboard.painel(usuarioDe(req).perfil) });
  }));
}
