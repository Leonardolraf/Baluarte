import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { CIENCIA, CONSULTA_CIENCIAS, TAMANHO_PADRAO } from '../models/avisoMonitoramento.model.js';
import * as avisoService from '../services/avisoMonitoramento.service.js';
import { enviar } from '../utils/resposta.js';
import { textoDeQuery, validar } from '../utils/esquemas.js';

// Controller do aviso de monitoramento da estacao (B18).

/** GET /monitoramento/aviso (qualquer perfil logado). */
export async function aviso(req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await avisoService.aviso(usuarioDe(req).id) });
}

/** POST /monitoramento/ciencia { versao } (qualquer perfil logado; idempotente). */
export async function registrarCiencia(req: Request, res: Response) {
  const { versao } = validar(req.body, CIENCIA);
  const dados = await avisoService.registrarCiencia(usuarioDe(req).id, versao as string);
  enviar(res, dados.nova ? 201 : 200, {
    status: 'sucesso',
    mensagem: dados.nova ? 'Ciência registrada' : 'Ciência já registrada para esta versão',
    dados,
  });
}

/** GET /monitoramento/ciencias?versao=&pagina=&tamanho= (so Administrador). */
export async function listarCiencias(req: Request, res: Response) {
  validar(req.query, CONSULTA_CIENCIAS);
  // Depois de validar, todo parametro presente e string; vazio conta como ausente.
  const q = (campo: string) => textoDeQuery.parse(req.query[campo])?.trim() || undefined;
  const { lista, resumo } = await avisoService.listarCiencias({
    versao: q('versao'),
    pagina: Number(q('pagina') ?? 1),
    tamanho: Number(q('tamanho') ?? TAMANHO_PADRAO),
  });
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}
