import type { Request, Response } from 'express';
import { INICIO } from '../models/varredura.model.js';
import * as varreduraService from '../services/varredura.service.js';
import { enviar } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller de varreduras (scanner simulado).

/** POST /scans (contrato N2 AT1; Administrador/Analista). */
export async function iniciar(req: Request, res: Response) {
  const { ativoId } = validar(req.body, INICIO);
  const dados = await varreduraService.iniciar(String(ativoId));
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Varredura enfileirada com sucesso', dados });
}

/** GET /scans (lista tecnica, so quem opera a plataforma: RN-006). */
export async function listar(_req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await varreduraService.listar() });
}
