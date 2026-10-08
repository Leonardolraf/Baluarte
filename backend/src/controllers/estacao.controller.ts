import type { Request, Response } from 'express';
import { PARAMETRO_ID } from '../models/estacao.model.js';
import * as estacaoService from '../services/estacao.service.js';
import { enviar } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller do painel de estacoes monitoradas (B13). Envelope { status, dados, resumo }
// da API, ao contrario das rotas do agente, que falam o protocolo do osquery.

/** GET /estacoes (Administrador/Analista). */
export async function listar(_req: Request, res: Response) {
  const { lista, resumo } = await estacaoService.listar();
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}

/** GET /estacoes/:id (Administrador/Analista): programas instalados e portas abertas. */
export async function detalhe(req: Request, res: Response) {
  const { id } = validar(req.params, PARAMETRO_ID);
  enviar(res, 200, { status: 'sucesso', dados: await estacaoService.detalhe(id as string) });
}
