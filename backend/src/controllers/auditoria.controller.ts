import type { Request, Response } from 'express';
import { CONSULTA, TAMANHO_PADRAO } from '../models/auditoria.model.js';
import * as auditoriaService from '../services/auditoria.service.js';
import { enviar } from '../utils/resposta.js';
import { textoDeQuery, validar } from '../utils/esquemas.js';

// Controller da trilha de auditoria (RN-008).

/** Data do filtro; `ate` so com o dia (AAAA-MM-DD) vale ate o fim desse dia (UTC). */
function data(valor: string | undefined, fimDoDia: boolean): Date | undefined {
  if (!valor) return undefined;
  if (fimDoDia && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return new Date(`${valor}T23:59:59.999Z`);
  return new Date(valor);
}

/** GET /auditoria?acao=&usuarioId=&email=&de=&ate=&pagina=&tamanho= (so Administrador). */
export async function consultar(req: Request, res: Response) {
  validar(req.query, CONSULTA);
  // Depois de validar, todo parametro presente e string; vazio conta como ausente.
  const q = (campo: string) => textoDeQuery.parse(req.query[campo])?.trim() || undefined;
  const { lista, resumo } = await auditoriaService.consultar({
    acao: q('acao'),
    usuarioId: q('usuarioId'),
    email: q('email'),
    de: data(q('de'), false),
    ate: data(q('ate'), true),
    pagina: Number(q('pagina') ?? 1),
    tamanho: Number(q('tamanho') ?? TAMANHO_PADRAO),
  });
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}
