import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { ACEITE } from '../models/termos.model.js';
import * as termosService from '../services/termos.service.js';
import { enviar } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller dos termos de uso (Melhorias #5).

/** GET /conta/termos (qualquer perfil logado, mesmo sem aceite). */
export async function termos(req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: termosService.termos(usuarioDe(req)) });
}

/** POST /conta/termos/aceite { versao } (qualquer perfil logado; idempotente). */
export async function aceitar(req: Request, res: Response) {
  const { versao } = validar(req.body, ACEITE);
  const dados = await termosService.aceitar(usuarioDe(req), versao as string);
  enviar(res, dados.novo ? 201 : 200, {
    status: 'sucesso',
    mensagem: dados.novo ? 'Termos de uso aceitos' : 'Termos de uso já aceitos',
    dados,
  });
}
