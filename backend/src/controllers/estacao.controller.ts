import type { Request, Response } from 'express';
import { PARAMETRO_ID } from '../models/estacao.model.js';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import * as cruzamentoService from '../services/cruzamento.service.js';
import * as estacaoService from '../services/estacao.service.js';
import { enviar } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller das estacoes monitoradas: painel (B13) e cruzamento do inventario com as bases
// publicas de vulnerabilidades sob demanda (B14). Envelope { status, dados, resumo }
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

/**
 * POST /estacoes/:id/verificar (Administrador/Analista): cruza o inventario com o OSV e o NVD
 * agora. :id e o id da estacao ou o do ativo dela (os dois sao cuid).
 */
export async function verificar(req: Request, res: Response) {
  const { id } = validar(req.params, PARAMETRO_ID);
  const dados = await cruzamentoService.verificar(id as string, usuarioDe(req).id);
  const mensagem = dados.falhas.length ? `Verificação concluída sem resposta de: ${dados.falhas.join(', ')}` : 'Verificação concluída';
  enviar(res, 200, { status: 'sucesso', mensagem, dados });
}
