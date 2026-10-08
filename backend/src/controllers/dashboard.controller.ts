import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import * as dashboardService from '../services/dashboard.service.js';
import { enviar } from '../utils/resposta.js';

// Controller do dashboard unificado.

/** GET /dashboard (todos os perfis; o conteudo depende do perfil). */
export async function painel(req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await dashboardService.painel(usuarioDe(req).perfil) });
}
