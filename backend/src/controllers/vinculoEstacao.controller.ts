import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { EMISSAO } from '../models/vinculoEstacao.model.js';
import * as service from '../services/vinculoEstacao.service.js';
import { normalizarHost } from '../utils/validacao.js';
import { enviar } from '../utils/resposta.js';
import { idRecurso, regra, regrasDePaginacao, validar } from '../utils/esquemas.js';

// #9: controller do vinculo de inscricao da estacao. Envelope { status, dados, resumo } da API
// (so Administrador; as rotas ficam em estacao.routes.ts, antes de /estacoes/:id). O codigo em
// claro so sai na resposta da emissao.

const TAMANHO_MAXIMO = 100;
const TAMANHO_PADRAO = 20;

/** POST /estacoes/vinculos (Administrador): emite um codigo de vinculo para a instalacao do agente. */
export async function emitir(req: Request, res: Response) {
  const corpo = req.body && typeof req.body === 'object' ? { ...(req.body as Record<string, unknown>) } : {};
  // Host colado com http(s):// e normalizado antes das regras, como no POST /assets.
  if (corpo.host !== undefined && corpo.host !== null && corpo.host !== '') corpo.host = normalizarHost(corpo.host);
  validar(corpo, EMISSAO);
  const dados = await service.emitir(usuarioDe(req).id, corpo);
  enviar(res, 201, { status: 'sucesso', dados });
}

/** GET /estacoes/vinculos (Administrador): lista paginada com o estado (pendente/consumido/expirado). */
export async function listar(req: Request, res: Response) {
  validar(req.query, regrasDePaginacao(TAMANHO_MAXIMO));
  const pagina = Number(req.query.pagina) || 1;
  const tamanho = Number(req.query.tamanho) || TAMANHO_PADRAO;
  const { lista, resumo } = await service.listar(pagina, tamanho);
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}

/** DELETE /estacoes/vinculos/:id (Administrador): revoga um vinculo pendente (queima o codigo). */
export async function revogar(req: Request, res: Response) {
  const { id } = validar(req.params, [regra('id', idRecurso, 'Vínculo inválido', 'VINCULO_ID_INVALIDO')]);
  await service.revogar(usuarioDe(req).id, id as string);
  enviar(res, 200, { status: 'sucesso', mensagem: 'Vínculo revogado' });
}
