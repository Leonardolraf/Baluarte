import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { CADASTRO } from '../models/ativo.model.js';
import * as ativoService from '../services/ativo.service.js';
import { enviar } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller de ativos.

/** POST /assets (contrato N2 AT1; Administrador/Analista). */
export async function cadastrar(req: Request, res: Response) {
  const { nome, tipo, host } = validar(req.body, CADASTRO);
  const dados = await ativoService.cadastrar(usuarioDe(req).id, { nome: nome as string, tipo: tipo as string, host: String(host).trim() });
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Ativo cadastrado com sucesso', dados });
}

/** GET /assets (Administrador/Analista). */
export async function listar(_req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await ativoService.listar() });
}
